-- Prevent an impossible provider clock sample from becoming the durable
-- progression anchor, and permit a later correction only when immutable prior
-- history proves that the latest stored clock was itself impossible.
--
-- Regulation game clocks cannot consume more seconds than wall time. The extra
-- 90 seconds covers the one-minute polling cadence plus bounded provider delay
-- and timestamp jitter. It is deliberately not a general clock-correction
-- allowance: an increase still fails unless an earlier same-quarter sample
-- proves both the poisoned jump and the incoming correction.

CREATE OR REPLACE FUNCTION public.prevent_game_state_regression()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  prior_state public.game_state_observations%ROWTYPE;
  prior_progress public.game_state_observations%ROWTYPE;
  recovery_anchor public.game_state_observations%ROWTYPE;
  prior_rank smallint;
  new_rank smallint;
  prior_clock integer;
  new_clock integer;
  elapsed_seconds numeric;
  clock_elapsed_tolerance_seconds CONSTANT integer := 90;
BEGIN
  -- A transaction-scoped provider/game lock makes the subsequent reads see the
  -- winner of any concurrent insert before validating this candidate.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.provider || ':' || NEW.nfl_game_id::text, 0)
  );

  SELECT observation.* INTO prior_state
  FROM public.game_state_observations observation
  WHERE observation.provider = NEW.provider
    AND observation.nfl_game_id = NEW.nfl_game_id
  ORDER BY observation.observed_at DESC, observation.request_completed_at DESC,
    observation.created_at DESC, observation.id DESC
  LIMIT 1;

  IF FOUND THEN
    IF NEW.observed_at < prior_state.observed_at
      OR NEW.request_completed_at < prior_state.request_completed_at THEN
      RAISE EXCEPTION 'game-state regression: source time moved backward';
    END IF;
    IF prior_state.status_code = 2 AND NEW.status_code <> 2 THEN
      RAISE EXCEPTION 'game-state regression: final game became non-final';
    END IF;
    IF (prior_state.status_code = 1
      OR (prior_state.status_code = 4
        AND public.projection_game_period_rank(prior_state.period) IS NOT NULL))
      AND NEW.status_code = 0 THEN
      RAISE EXCEPTION 'game-state regression: started game became pregame';
    END IF;
    IF prior_state.status_code = 1 AND NEW.status_code = 3 THEN
      RAISE EXCEPTION 'game-state regression: live game became postponed';
    END IF;
    IF (prior_state.status_code = 4 AND NEW.status_code = 3
        AND public.projection_game_period_rank(prior_state.period) IS NOT NULL)
      OR (prior_state.status_code = 3 AND NEW.status_code = 4
        AND public.projection_game_period_rank(NEW.period) IS NOT NULL) THEN
      RAISE EXCEPTION 'game-state regression: interruption status changed ambiguously';
    END IF;
  END IF;

  IF NEW.status_code = 1 THEN
    new_rank := public.projection_game_period_rank(NEW.period);
    IF new_rank IS NULL THEN
      RAISE EXCEPTION 'game-state regression: live period is unavailable';
    END IF;
    IF new_rank IN (1, 2, 4, 5)
      AND public.projection_game_clock_seconds(NEW.game_clock) IS NULL THEN
      RAISE EXCEPTION 'game-state regression: regulation clock is unavailable';
    END IF;
  END IF;

  SELECT observation.* INTO prior_progress
  FROM public.game_state_observations observation
  WHERE observation.provider = NEW.provider
    AND observation.nfl_game_id = NEW.nfl_game_id
    AND observation.status_code IN (1, 4)
    AND public.projection_game_period_rank(observation.period) IS NOT NULL
  ORDER BY observation.observed_at DESC, observation.request_completed_at DESC,
    observation.created_at DESC, observation.id DESC
  LIMIT 1;

  IF FOUND AND NEW.status_code IN (1, 4) THEN
    prior_rank := public.projection_game_period_rank(prior_progress.period);
    new_rank := public.projection_game_period_rank(NEW.period);
    IF new_rank IS NOT NULL AND new_rank < prior_rank THEN
      RAISE EXCEPTION 'game-state regression: period moved backward';
    END IF;
    IF new_rank = prior_rank AND new_rank IN (1, 2, 4, 5) THEN
      prior_clock := public.projection_game_clock_seconds(prior_progress.game_clock);
      new_clock := public.projection_game_clock_seconds(NEW.game_clock);
      IF prior_clock IS NOT NULL AND new_clock IS NOT NULL THEN
        elapsed_seconds := GREATEST(
          EXTRACT(EPOCH FROM (NEW.observed_at - prior_progress.observed_at)),
          0
        );

        IF new_clock < prior_clock
          AND (prior_clock - new_clock) > elapsed_seconds + clock_elapsed_tolerance_seconds THEN
          RAISE EXCEPTION 'game-state plausibility: regulation clock advanced faster than elapsed time';
        END IF;

        IF new_clock > prior_clock THEN
          -- Recovery is live-to-live only. Find an earlier same-quarter clock
          -- that proves the latest stored low value fell impossibly fast, while
          -- the new correction is non-increasing and physically plausible from
          -- that earlier anchor. The malformed row remains append-only history.
          IF prior_progress.status_code = 1 AND NEW.status_code = 1
            AND NEW.observed_at > prior_progress.observed_at THEN
            SELECT observation.* INTO recovery_anchor
            FROM public.game_state_observations observation
            WHERE observation.provider = NEW.provider
              AND observation.nfl_game_id = NEW.nfl_game_id
              AND observation.status_code = 1
              AND public.projection_game_period_rank(observation.period) = prior_rank
              AND observation.observed_at < prior_progress.observed_at
              AND public.projection_game_clock_seconds(observation.game_clock) IS NOT NULL
              AND public.projection_game_clock_seconds(observation.game_clock) >= new_clock
              AND (
                public.projection_game_clock_seconds(observation.game_clock) - prior_clock
              ) > GREATEST(
                EXTRACT(EPOCH FROM (prior_progress.observed_at - observation.observed_at)),
                0
              ) + clock_elapsed_tolerance_seconds
              AND (
                public.projection_game_clock_seconds(observation.game_clock) - new_clock
              ) <= GREATEST(
                EXTRACT(EPOCH FROM (NEW.observed_at - observation.observed_at)),
                0
              ) + clock_elapsed_tolerance_seconds
            ORDER BY observation.observed_at DESC, observation.request_completed_at DESC,
              observation.created_at DESC, observation.id DESC
            LIMIT 1;
          END IF;

          IF recovery_anchor.id IS NULL THEN
            RAISE EXCEPTION 'game-state regression: regulation clock increased';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_game_state_regression() FROM PUBLIC;

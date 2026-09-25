-- Explicit, bounded account onboarding into the existing league registry.
-- Preparation is inactive; only complete canonical source evidence activates work.
CREATE FUNCTION public.prepare_account_league_enrollment(p_league uuid,p_season integer,p_external text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-league-enrollment',0));
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues league
    JOIN public.league_seasons season ON season.league_id=league.id AND season.season=p_season
    JOIN public.league_source_connections connection ON connection.league_season_id=season.id
    WHERE league.id=p_league AND league.league_key='sleeper-'||p_external
      AND p_external ~ '^[1-9][0-9]{0,31}$' AND connection.provider='sleeper'
      AND connection.external_league_id=p_external
  ) THEN RAISE EXCEPTION 'onboarding registration mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.league_administration_enrollments WHERE league_id=p_league
    AND evidence<>'account-onboarding-v1') THEN RAISE EXCEPTION 'enrollment is operator managed'; END IF;
  -- The measured cadence is bounded. Further fleet expansion needs an explicit
  -- capacity decision; reservations count too, so concurrent imports cannot race.
  IF NOT EXISTS (SELECT 1 FROM public.league_administration_enrollments WHERE league_id=p_league)
    AND (SELECT count(*) FROM public.league_administration_enrollments)>=16 THEN
    RAISE EXCEPTION 'account enrollment capacity reached';
  END IF;
  INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence)
    VALUES(p_league,'sleeper',false,'account-onboarding-v1') ON CONFLICT DO NOTHING;
  INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
    VALUES(p_league,p_season,'sleeper','account-onboarding-v1') ON CONFLICT DO NOTHING;
END; $$;

CREATE FUNCTION public.activate_account_league_enrollment(p_key text,p_season integer,p_external text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target uuid; season_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-league-enrollment',0));
  SELECT league.id,season.id INTO STRICT target,season_id FROM public.leagues league
    JOIN public.league_seasons season ON season.league_id=league.id AND season.season=p_season
    JOIN public.league_source_connections connection ON connection.league_season_id=season.id
    JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=league.id
    WHERE league.league_key=p_key AND p_key='sleeper-'||p_external
      AND connection.provider='sleeper' AND connection.external_league_id=p_external
      AND enrollment.evidence='account-onboarding-v1';
  IF (SELECT count(*) FROM public.league_administration_heads head
    JOIN public.league_administration_observations observation ON observation.id=head.accepted_observation_id
    JOIN public.league_administration_contents content ON content.id=observation.content_id
    WHERE head.league_season_id=season_id AND head.family IN ('league','rosters','users') AND head.week=0
      AND head.read_conflict IS NULL AND head.generation>0
      AND head.verified_at BETWEEN clock_timestamp()-interval '2 minutes' AND clock_timestamp()
      AND observation.league_season_id=season_id AND observation.family=head.family AND observation.week=0
      AND observation.outcome IN ('changed','unchanged')
      AND content.league_season_id=season_id AND content.family=head.family AND content.week=0
      AND content.external_league_id=p_external AND content.provider='sleeper'
      AND content.accepted AND content.completeness='complete'
      AND content.normalizer_version='sleeper-administration-v1')<>3 THEN
    RAISE EXCEPTION 'complete current onboarding evidence is required';
  END IF;
  UPDATE public.league_administration_enrollments SET active=true WHERE league_id=target;
END; $$;

REVOKE ALL ON FUNCTION public.prepare_account_league_enrollment(uuid,integer,text),
  public.activate_account_league_enrollment(text,integer,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.prepare_account_league_enrollment(uuid,integer,text),
      public.activate_account_league_enrollment(text,integer,text) TO league_one_runtime;
  END IF;
END; $$;

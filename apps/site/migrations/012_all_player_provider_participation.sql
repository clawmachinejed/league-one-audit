-- Additive provider participation evidence; installed 010 and 011 remain unchanged.
-- Existing function replacements preserve ownership and ACLs. Context is
-- observation-only: it does not alter raw content or scoring semantic identity.

ALTER TABLE public.all_player_stat_observations ADD COLUMN provider_context jsonb;
ALTER TABLE public.all_player_stat_observations ADD CONSTRAINT all_player_provider_context_shape
  CHECK (provider_context IS NULL OR (jsonb_typeof(provider_context) = 'object'
    AND octet_length(provider_context::text) <= 1200000));

CREATE FUNCTION public.validate_all_player_provider_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  context jsonb := NEW.provider_context;
  player jsonb;
  context_observed_at timestamptz;
  text_key text;
BEGIN
  IF context IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(context) IS DISTINCT FROM 'object'
    OR octet_length(context::text) > 1200000
    OR context - ARRAY['version','role','source','sourceRevision','observedAt','effectivePeriod','players'] <> '{}'::jsonb
    OR context->>'version' IS DISTINCT FROM 'catalog-status-context-v1'
    OR context->>'role' IS DISTINCT FROM 'context-only'
    OR context->>'source' IS DISTINCT FROM 'official-player-catalog'
    OR jsonb_typeof(context->'sourceRevision') IS DISTINCT FROM 'string'
    OR context->>'sourceRevision' !~ '^sha256:[0-9a-f]{64}$'
    OR context->'effectivePeriod' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(context->'observedAt') IS DISTINCT FROM 'string'
    OR context->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR jsonb_typeof(context->'players') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'all-player provider context has an invalid shape';
  END IF;
  BEGIN
    context_observed_at := (context->>'observedAt')::timestamptz;
    IF NOT isfinite(context_observed_at)
      OR to_char(context_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        IS DISTINCT FROM context->>'observedAt'
      OR context_observed_at > NEW.observed_at THEN
      RAISE EXCEPTION 'invalid catalog observation time';
    END IF;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'all-player provider context has an invalid observation time';
  END;
  IF jsonb_array_length(context->'players') > 10000 THEN
    RAISE EXCEPTION 'all-player provider context exceeds its player bound';
  END IF;
  IF (SELECT count(DISTINCT item->>'providerExternalId') FROM jsonb_array_elements(context->'players') item)
    <> jsonb_array_length(context->'players') THEN
    RAISE EXCEPTION 'all-player provider context has duplicate or missing player identities';
  END IF;
  FOR player IN SELECT value FROM jsonb_array_elements(context->'players') LOOP
    IF jsonb_typeof(player) IS DISTINCT FROM 'object'
      OR player - ARRAY['providerExternalId','nflGameId','currentTeam','status','active','injuryStatus'] <> '{}'::jsonb
      OR jsonb_typeof(player->'providerExternalId') IS DISTINCT FROM 'string'
      OR btrim(player->>'providerExternalId') = '' OR length(player->>'providerExternalId') > 128
      OR btrim(player->>'providerExternalId') IS DISTINCT FROM player->>'providerExternalId'
      OR NOT (player ? 'nflGameId')
      OR (player->'nflGameId' <> 'null'::jsonb AND (
        jsonb_typeof(player->'nflGameId') IS DISTINCT FROM 'string'
        OR player->>'nflGameId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      OR (player ? 'active' AND jsonb_typeof(player->'active') IS DISTINCT FROM 'boolean') THEN
      RAISE EXCEPTION 'all-player provider context has an invalid player';
    END IF;
    FOREACH text_key IN ARRAY ARRAY['currentTeam','status','injuryStatus'] LOOP
      IF player ? text_key AND (jsonb_typeof(player->text_key) IS DISTINCT FROM 'string'
        OR btrim(player->>text_key) = '' OR length(player->>text_key) > 128
        OR btrim(player->>text_key) IS DISTINCT FROM player->>text_key) THEN
        RAISE EXCEPTION 'all-player provider context has invalid player metadata';
      END IF;
    END LOOP;
  END LOOP;
  -- One set-based identity check keeps this bounded bulk metadata operation
  -- from performing a database lookup for every retained catalog player.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(context->'players') item
    LEFT JOIN public.all_player_stat_entries entry
      ON entry.all_player_stat_content_id = NEW.all_player_stat_content_id
      AND entry.entity_kind = 'player' AND entry.provider_external_id = item->>'providerExternalId'
      AND entry.nfl_game_id IS NOT DISTINCT FROM (item->>'nflGameId')::uuid
    WHERE entry.provider_external_id IS NULL) THEN
    RAISE EXCEPTION 'all-player provider context does not match its observed player and game';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_all_player_provider_context() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    REVOKE ALL ON FUNCTION public.validate_all_player_provider_context() FROM league_one_runtime;
  END IF;
END; $$;
CREATE TRIGGER all_player_provider_context_guard
  BEFORE INSERT ON public.all_player_stat_observations
  FOR EACH ROW EXECUTE FUNCTION public.validate_all_player_provider_context();

CREATE OR REPLACE FUNCTION public.all_player_eligibility_evidence_matches(
  p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  evidence_kind text;
  active_count smallint;
  appearance_count smallint;
  expected_eligible smallint;
  expected_appearance smallint;
  period_evidence jsonb;
  weekly jsonb;
  has_conflict boolean;
  invalid_flags boolean;
  positive_snaps boolean;
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  evidence_kind := p_evidence->>'kind';
  IF evidence_kind = 'weekly-stat' THEN
    IF p_evidence - ARRAY['kind', 'source', 'gmsActive', 'appearances', 'rawFlags', 'individualSnaps'] <> '{}'::jsonb
      OR p_evidence->>'source' IS DISTINCT FROM 'weekly-stat-provider'
      OR (p_evidence ? 'gmsActive' AND (jsonb_typeof(p_evidence->'gmsActive') IS DISTINCT FROM 'number'
        OR p_evidence->>'gmsActive' NOT IN ('0','1')))
      OR (p_evidence ? 'appearances' AND (jsonb_typeof(p_evidence->'appearances') IS DISTINCT FROM 'number'
        OR p_evidence->>'appearances' NOT IN ('0','1'))) THEN RETURN false; END IF;
    IF p_evidence ? 'individualSnaps' THEN
      IF jsonb_typeof(p_evidence->'individualSnaps') IS DISTINCT FROM 'object'
        OR p_evidence->'individualSnaps' = '{}'::jsonb
        OR (p_evidence->'individualSnaps') - ARRAY['off_snp','def_snp','st_snp'] <> '{}'::jsonb
        OR EXISTS (SELECT 1 FROM jsonb_each(p_evidence->'individualSnaps') AS snap
          WHERE CASE WHEN jsonb_typeof(snap.value) = 'number' THEN
            (snap.value::text)::numeric NOT BETWEEN 0 AND 9007199254740991
            OR trunc((snap.value::text)::numeric) <> (snap.value::text)::numeric
          ELSE true END) THEN RETURN false; END IF;
    END IF;
    IF p_evidence ? 'rawFlags' THEN
      IF jsonb_typeof(p_evidence->'rawFlags') IS DISTINCT FROM 'object'
        OR p_evidence->'rawFlags' = '{}'::jsonb
        OR (p_evidence->'rawFlags') - ARRAY['gms_active','gp','off_snp','def_snp','st_snp'] <> '{}'::jsonb
        OR EXISTS (SELECT 1 FROM jsonb_each(p_evidence->'rawFlags') AS flag
          WHERE CASE WHEN flag.key IN ('gms_active','gp') THEN
            flag.value IN ('0'::jsonb, '1'::jsonb)
            OR (flag.key = 'gms_active' AND p_evidence ? 'gmsActive')
            OR (flag.key = 'gp' AND p_evidence ? 'appearances')
          ELSE COALESCE(p_evidence->'individualSnaps' ? flag.key,false)
            OR CASE WHEN jsonb_typeof(flag.value) = 'number' THEN
              (flag.value::text)::numeric BETWEEN 0 AND 9007199254740991
              AND trunc((flag.value::text)::numeric) = (flag.value::text)::numeric
            ELSE false END END) THEN RETURN false; END IF;
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    END IF;
    positive_snaps := EXISTS (SELECT 1 FROM jsonb_each(COALESCE(p_evidence->'individualSnaps','{}'::jsonb)) AS snap
      WHERE (snap.value::text)::numeric > 0);
    active_count := (p_evidence->>'gmsActive')::smallint;
    appearance_count := (p_evidence->>'appearances')::smallint;
    IF (active_count = 0 AND appearance_count = 1)
      OR (positive_snaps AND (active_count = 0 OR appearance_count = 0)) THEN
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    ELSIF active_count = 0 THEN expected_eligible := 0; expected_appearance := 0;
    ELSIF appearance_count = 1 OR positive_snaps THEN expected_eligible := 1; expected_appearance := 1;
    ELSIF active_count = 1 AND appearance_count = 0 THEN expected_eligible := 1; expected_appearance := 0;
    END IF;
    RETURN p_eligible_game_count IS NOT DISTINCT FROM expected_eligible
      AND p_appearance_game_count IS NOT DISTINCT FROM expected_appearance;
  ELSIF evidence_kind IN ('explicit-ineligible', 'period-participation') THEN
    IF jsonb_typeof(p_evidence->'sourceRevision') IS DISTINCT FROM 'string'
      OR btrim(p_evidence->>'sourceRevision') = ''
      OR jsonb_typeof(p_evidence->'observedAt') IS DISTINCT FROM 'string'
      OR p_evidence->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      OR jsonb_typeof(p_evidence->'effectivePeriod') IS DISTINCT FROM 'object'
      OR (p_evidence->'effectivePeriod') - ARRAY['season','seasonType','week'] <> '{}'::jsonb
      OR jsonb_typeof(p_evidence->'effectivePeriod'->'season') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_evidence->'effectivePeriod'->'week') IS DISTINCT FROM 'number'
      OR p_evidence->'effectivePeriod'->>'seasonType' IS DISTINCT FROM 'reg'
      OR (p_evidence->'effectivePeriod'->>'season') !~ '^[0-9]+$'
      OR (p_evidence->'effectivePeriod'->>'week') !~ '^[0-9]+$'
      OR (p_evidence->'effectivePeriod'->>'season')::integer NOT BETWEEN 2026 AND 2200
      OR (p_evidence->'effectivePeriod'->>'week')::integer NOT BETWEEN 1 AND 18 THEN RETURN false; END IF;
    BEGIN
      IF NOT isfinite((p_evidence->>'observedAt')::timestamptz) THEN RETURN false; END IF;
    EXCEPTION WHEN others THEN RETURN false;
    END;
    IF evidence_kind = 'explicit-ineligible' THEN
      RETURN COALESCE(p_evidence - ARRAY['kind','reason','source','sourceRevision','observedAt','effectivePeriod'] = '{}'::jsonb
        AND p_evidence->>'reason' IN ('inactive','suspended','reserve','bye','teamless','other')
        AND p_evidence->>'source' IN ('player-status-provider','schedule','manual-review')
        AND p_eligible_game_count = 0 AND p_appearance_game_count = 0, false);
    END IF;
    IF p_evidence - ARRAY['kind','decision','source','sourceRevision','observedAt','effectivePeriod','reason','weekly'] <> '{}'::jsonb
      OR COALESCE(p_evidence->>'decision','') NOT IN ('appearance','dressed-unused','ineligible','ambiguous')
      OR COALESCE(p_evidence->>'source','') NOT IN ('gamebook','official-period-roster','manual-review')
      OR jsonb_typeof(p_evidence->'reason') IS DISTINCT FROM 'string'
      OR btrim(p_evidence->>'reason') = '' THEN RETURN false; END IF;
    IF p_evidence ? 'weekly' THEN
      weekly := p_evidence->'weekly';
      IF weekly->>'kind' IS DISTINCT FROM 'weekly-stat' OR NOT (
        public.all_player_eligibility_evidence_matches(weekly,0::smallint,0::smallint)
        OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,0::smallint)
        OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,1::smallint)
        OR public.all_player_eligibility_evidence_matches(weekly,NULL::smallint,NULL::smallint)
      ) THEN RETURN false; END IF;
    END IF;
    IF p_evidence->>'decision' = 'ambiguous' THEN
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    ELSIF p_evidence->>'decision' = 'appearance' THEN expected_eligible := 1; expected_appearance := 1;
    ELSIF p_evidence->>'decision' = 'dressed-unused' THEN expected_eligible := 1; expected_appearance := 0;
    ELSE expected_eligible := 0; expected_appearance := 0;
    END IF;
    IF weekly IS NOT NULL THEN
      positive_snaps := EXISTS (SELECT 1 FROM jsonb_each(COALESCE(weekly->'individualSnaps','{}'::jsonb)) AS snap
        WHERE (snap.value::text)::numeric > 0);
      invalid_flags := weekly ? 'rawFlags' OR (weekly->>'gmsActive' = '0' AND weekly->>'appearances' = '1')
        OR (positive_snaps AND (weekly->>'gmsActive' = '0' OR weekly->>'appearances' = '0'));
      has_conflict := NOT public.all_player_eligibility_evidence_matches(weekly,NULL::smallint,NULL::smallint)
        AND NOT public.all_player_eligibility_evidence_matches(weekly,expected_eligible,expected_appearance);
      IF COALESCE(invalid_flags,false) OR has_conflict THEN
        RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
      END IF;
    END IF;
    RETURN p_eligible_game_count IS NOT DISTINCT FROM expected_eligible
      AND p_appearance_game_count IS NOT DISTINCT FROM expected_appearance;
  ELSIF evidence_kind IN ('combined-ineligible','conflict') THEN
    IF p_evidence - ARRAY['kind','weekly','ineligibility'] <> '{}'::jsonb
      OR p_evidence->'ineligibility'->>'kind' IS DISTINCT FROM 'explicit-ineligible'
      OR NOT public.all_player_eligibility_evidence_matches(p_evidence->'ineligibility',0::smallint,0::smallint)
      OR p_evidence->'weekly'->>'kind' IS DISTINCT FROM 'weekly-stat' THEN RETURN false; END IF;
    weekly := p_evidence->'weekly';
    IF NOT (public.all_player_eligibility_evidence_matches(weekly,0::smallint,0::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,0::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,1::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,NULL::smallint,NULL::smallint)) THEN RETURN false; END IF;
    has_conflict := public.all_player_eligibility_evidence_matches(weekly,1::smallint,0::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,1::smallint)
      OR weekly ? 'rawFlags'
      OR COALESCE(weekly->>'gmsActive' = '0' AND weekly->>'appearances' = '1',false)
      OR (EXISTS (SELECT 1 FROM jsonb_each(COALESCE(weekly->'individualSnaps','{}'::jsonb)) AS snap
        WHERE (snap.value::text)::numeric > 0)
        AND COALESCE(weekly->>'gmsActive' = '0' OR weekly->>'appearances' = '0',false));
    IF evidence_kind = 'conflict' THEN
      RETURN has_conflict AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    END IF;
    RETURN COALESCE(NOT has_conflict AND p_eligible_game_count = 0 AND p_appearance_game_count = 0,false);
  ELSIF evidence_kind = 'missing-provider-row' THEN
    RETURN p_evidence - ARRAY['kind','inventoryFingerprint'] = '{}'::jsonb
      AND COALESCE(p_evidence->>'inventoryFingerprint','') ~ '^sha256:[0-9a-f]{64}$'
      AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
  ELSIF evidence_kind = 'unknown-weekly-stat' THEN
    RETURN p_evidence = '{"kind":"unknown-weekly-stat","source":"weekly-stat-provider"}'::jsonb
      AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_all_player_stat_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  content_context record;
  game_context record;
  period_evidence jsonb;
  weekly_evidence jsonb;
  raw_key text;
  evidence_key text;
  expected_raw jsonb;
BEGIN
  IF public.all_player_eligibility_evidence_matches(NEW.eligibility_evidence,
    NEW.eligible_game_count,NEW.appearance_game_count) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'all-player eligibility evidence does not support its counts';
  END IF;
  SELECT season,season_type,week,normalizer_version INTO STRICT content_context
  FROM public.all_player_stat_contents WHERE id = NEW.all_player_stat_content_id;
  weekly_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' = 'weekly-stat'
    THEN NEW.eligibility_evidence ELSE NEW.eligibility_evidence->'weekly' END;
  IF content_context.normalizer_version LIKE '%-weekly-stats-v3'
    AND weekly_evidence IS NULL AND NEW.stats ?| ARRAY['gms_active','gp','off_snp','def_snp','st_snp'] THEN
    RAISE EXCEPTION 'all-player retained participation statistics require weekly evidence';
  END IF;
  IF weekly_evidence IS NOT NULL THEN
    FOREACH raw_key IN ARRAY ARRAY['gms_active','gp'] LOOP
      evidence_key := CASE WHEN raw_key = 'gms_active' THEN 'gmsActive' ELSE 'appearances' END;
      IF weekly_evidence->'rawFlags' ? raw_key THEN
        expected_raw := CASE WHEN jsonb_typeof(weekly_evidence->'rawFlags'->raw_key) = 'number'
          THEN weekly_evidence->'rawFlags'->raw_key ELSE NULL END;
      ELSE expected_raw := weekly_evidence->evidence_key;
      END IF;
      IF NEW.stats->raw_key IS DISTINCT FROM expected_raw THEN
        RAISE EXCEPTION 'all-player weekly eligibility flag disagrees with retained statistics';
      END IF;
    END LOOP;
    IF weekly_evidence ? 'individualSnaps'
      OR COALESCE(weekly_evidence->'rawFlags' ?| ARRAY['off_snp','def_snp','st_snp'],false) THEN
      IF NEW.entity_kind IS DISTINCT FROM 'player' THEN
        RAISE EXCEPTION 'all-player individual snap evidence requires a player identity';
      END IF;
    END IF;
    -- v2 observations may already retain snap statistics without using them as
    -- participation evidence. Preserve those exact historical replays. v3
    -- and any caller using the new evidence must bind every retained snap key.
    IF content_context.normalizer_version LIKE '%-weekly-stats-v3'
      OR weekly_evidence ? 'individualSnaps'
      OR COALESCE(weekly_evidence->'rawFlags' ?| ARRAY['off_snp','def_snp','st_snp'],false) THEN
      FOREACH raw_key IN ARRAY ARRAY['off_snp','def_snp','st_snp'] LOOP
        IF weekly_evidence->'rawFlags' ? raw_key THEN
          expected_raw := CASE WHEN jsonb_typeof(weekly_evidence->'rawFlags'->raw_key) = 'number'
            THEN weekly_evidence->'rawFlags'->raw_key ELSE NULL END;
        ELSE expected_raw := weekly_evidence->'individualSnaps'->raw_key;
        END IF;
        IF NEW.stats->raw_key IS DISTINCT FROM expected_raw THEN
          RAISE EXCEPTION 'all-player individual snap evidence disagrees with retained statistics';
        END IF;
      END LOOP;
    END IF;
  END IF;
  period_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' IN ('combined-ineligible','conflict')
    THEN NEW.eligibility_evidence->'ineligibility'
    WHEN NEW.eligibility_evidence->>'kind' IN ('explicit-ineligible','period-participation')
    THEN NEW.eligibility_evidence ELSE NULL END;
  IF period_evidence IS NOT NULL AND (
    (period_evidence->'effectivePeriod'->>'season')::integer IS DISTINCT FROM content_context.season
    OR period_evidence->'effectivePeriod'->>'seasonType' IS DISTINCT FROM content_context.season_type
    OR (period_evidence->'effectivePeriod'->>'week')::integer IS DISTINCT FROM content_context.week
  ) THEN RAISE EXCEPTION 'all-player eligibility evidence does not match its content period'; END IF;
  IF NEW.eligible_game_count = 1 AND NEW.nfl_game_id IS NULL THEN
    RAISE EXCEPTION 'eligible all-player entry requires an NFL game';
  END IF;
  IF NEW.nfl_game_id IS NOT NULL THEN
    SELECT season,season_type,week,home_team,away_team INTO STRICT game_context
    FROM public.nfl_games WHERE id = NEW.nfl_game_id;
    IF NEW.nfl_team IS NULL OR game_context.season <> content_context.season
      OR game_context.season_type <> content_context.season_type OR game_context.week <> content_context.week
      OR NEW.nfl_team NOT IN (game_context.home_team,game_context.away_team) THEN
      RAISE EXCEPTION 'all-player NFL game does not match its content period and team';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

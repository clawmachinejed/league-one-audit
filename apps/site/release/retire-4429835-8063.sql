-- Prepared correction, not an automatic migration. Execute only through the
-- reviewed owner session after docs/all-player-identity-repair.md gates pass.
-- Required transaction-local settings set by that session:
-- league_one.alias_repair_authorization = retire-tank01-4429835-sleeper-8063
-- league_one.alias_repair_expected_candidates = freshly reviewed physical count
-- league_one.alias_repair_application_sha = exact reviewed deployed 40-character SHA
-- Caller must BEGIN, retain the before/after results, and COMMIT only with the
-- exact success marker. No credentials or environment defaults belong here.

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'));
LOCK TABLE projection_jobs, external_scoring_entity_ids, scoring_entities,
  pregame_projection_candidates, pregame_projection_baselines,
  official_player_point_observations, all_player_scores IN SHARE ROW EXCLUSIVE MODE;

SELECT 'before' AS evidence_stage, transaction_timestamp() AS transaction_time,
  txid_current() AS transaction_id, current_user AS operator_role,
  current_setting('league_one.alias_repair_application_sha', true) AS application_sha,
  provider, entity_kind, external_id, scoring_entity_id, mapping_status, valid_from, valid_to
FROM external_scoring_entity_ids
WHERE entity_kind = 'player' AND ((provider = 'tank01' AND external_id = '4429835')
  OR (provider = 'sleeper' AND external_id IN ('8063', '12048')))
ORDER BY provider, external_id;

DO $repair$
DECLARE
  expected_entity constant uuid := '10ae356b-990f-5ed1-8b31-2fd98dd5acbd';
  tank_row external_scoring_entity_ids%ROWTYPE;
  official_row external_scoring_entity_ids%ROWTYPE;
  expected_candidates integer;
  actual_candidates integer;
BEGIN
  IF current_setting('league_one.alias_repair_authorization', true)
    IS DISTINCT FROM 'retire-tank01-4429835-sleeper-8063' THEN
    RAISE EXCEPTION 'Exact reviewed alias-retirement authorization is missing';
  END IF;
  IF COALESCE(current_setting('league_one.alias_repair_application_sha', true), '')
    !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'Exact reviewed deployed application revision is missing';
  END IF;
  expected_candidates := current_setting('league_one.alias_repair_expected_candidates')::integer;
  IF expected_candidates < 0 THEN RAISE EXCEPTION 'Reviewed reference count is invalid'; END IF;
  IF EXISTS (SELECT 1 FROM projection_jobs WHERE state = 'running' AND lease_until > clock_timestamp()) THEN
    RAISE EXCEPTION 'A projection job has live ownership; correction aborted';
  END IF;
  SELECT * INTO STRICT tank_row FROM external_scoring_entity_ids
    WHERE provider = 'tank01' AND entity_kind = 'player' AND external_id = '4429835';
  SELECT * INTO STRICT official_row FROM external_scoring_entity_ids
    WHERE provider = 'sleeper' AND entity_kind = 'player' AND external_id = '8063';
  IF tank_row.scoring_entity_id <> expected_entity
    OR official_row.scoring_entity_id <> expected_entity
    OR official_row.mapping_status <> 'verified' OR official_row.valid_to IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM scoring_entities WHERE id = expected_entity AND kind = 'player') THEN
    RAISE EXCEPTION 'Reviewed canonical pairing has changed; correction aborted';
  END IF;
  SELECT count(*) INTO actual_candidates FROM pregame_projection_candidates
    WHERE scoring_entity_id = expected_entity;
  IF actual_candidates <> expected_candidates
    OR EXISTS (SELECT 1 FROM pregame_projection_baselines WHERE scoring_entity_id = expected_entity)
    OR EXISTS (SELECT 1 FROM official_player_point_observations WHERE scoring_entity_id = expected_entity)
    OR EXISTS (SELECT 1 FROM all_player_scores WHERE scoring_entity_id = expected_entity) THEN
    RAISE EXCEPTION 'Reviewed affected references changed; correction aborted';
  END IF;
  IF tank_row.mapping_status = 'retired' AND tank_row.valid_to IS NOT NULL THEN
    RAISE NOTICE 'ALL_PLAYER_ALIAS_RETIREMENT_ALREADY_APPLIED';
    RETURN;
  END IF;
  IF tank_row.mapping_status <> 'verified' OR tank_row.valid_to IS NOT NULL
    OR tank_row.valid_from >= transaction_timestamp() THEN
    RAISE EXCEPTION 'Reviewed source mapping state changed; correction aborted';
  END IF;
  UPDATE external_scoring_entity_ids SET mapping_status = 'retired', valid_to = transaction_timestamp()
    WHERE provider = 'tank01' AND entity_kind = 'player' AND external_id = '4429835'
      AND scoring_entity_id = expected_entity AND mapping_status = 'verified' AND valid_to IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expected alias retirement did not occur'; END IF;
  RAISE NOTICE 'ALL_PLAYER_ALIAS_RETIREMENT_APPLIED';
END;
$repair$;

SELECT 'after' AS evidence_stage, transaction_timestamp() AS transaction_time,
  txid_current() AS transaction_id, provider, entity_kind, external_id, scoring_entity_id,
  mapping_status, valid_from, valid_to
FROM external_scoring_entity_ids
WHERE entity_kind = 'player' AND ((provider = 'tank01' AND external_id = '4429835')
  OR (provider = 'sleeper' AND external_id IN ('8063', '12048')))
ORDER BY provider, external_id;

-- B2a expansion only. The provenance interner remains unbound until a separate
-- forward activation after compatible readers. Original attempts and history stay inline.
CREATE TABLE public.league_roster_provenance_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  source_mapping_revision_id uuid NOT NULL REFERENCES public.league_source_mapping_revisions(id),
  legacy_observation_id uuid NOT NULL REFERENCES public.league_administration_observations(id),
  content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
  first_receipt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_capture_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  UNIQUE(league_season_id,source_mapping_revision_id,legacy_observation_id,content_hash)
);
ALTER TABLE public.league_roster_capture_receipts
  ALTER COLUMN provenance DROP NOT NULL,
  ADD COLUMN provenance_storage_format text NOT NULL DEFAULT 'inline-v1' CHECK(provenance_storage_format IN ('inline-v1','shared-v1')),
  ADD COLUMN provenance_content_id uuid REFERENCES public.league_roster_provenance_contents(id),
  ADD CONSTRAINT roster_provenance_storage_shape CHECK(
    (provenance_storage_format='inline-v1' AND provenance_content_id IS NULL AND provenance IS NOT NULL) OR
    (provenance_storage_format='shared-v1' AND provenance_content_id IS NOT NULL AND provenance IS NULL));
CREATE INDEX roster_capture_provenance_content_idx ON public.league_roster_capture_receipts(provenance_content_id)
  WHERE provenance_content_id IS NOT NULL;
CREATE TRIGGER roster_provenance_content_immutable BEFORE UPDATE OR DELETE ON public.league_roster_provenance_contents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

-- Composite NEW and SQL-null LEFT JOIN receipts are supported. Historical reads
-- validate immutable witnesses only: no current owner, mapping, head or clock lookup.
CREATE FUNCTION public.roster_capture_provenance(p_receipt public.league_roster_capture_receipts)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE header public.league_roster_provenance_contents%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE; scope public.league_roster_resource_scopes%ROWTYPE;
  witness jsonb; role_name text; role_names text[];
BEGIN
  IF p_receipt IS NULL THEN RETURN NULL; END IF;
  IF p_receipt.id IS NULL THEN RAISE EXCEPTION 'invalid roster provenance receipt'; END IF;
  IF p_receipt.provenance_storage_format='inline-v1' AND p_receipt.provenance_content_id IS NULL
    AND p_receipt.provenance IS NOT NULL THEN RETURN p_receipt.provenance; END IF;
  IF p_receipt.provenance_storage_format IS DISTINCT FROM 'shared-v1'
    OR p_receipt.provenance_content_id IS NULL OR p_receipt.provenance IS NOT NULL THEN
    RAISE EXCEPTION 'invalid roster provenance storage shape'; END IF;
  SELECT * INTO STRICT header FROM public.league_roster_provenance_contents WHERE id=p_receipt.provenance_content_id;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=p_receipt.attempt_id;
  SELECT * INTO STRICT scope FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  IF header.league_season_id IS DISTINCT FROM scope.league_season_id
    OR header.source_mapping_revision_id::text IS DISTINCT FROM attempt.source_mapping->>'revisionId'
    OR header.legacy_observation_id IS DISTINCT FROM p_receipt.legacy_observation_id
    OR NOT (scope.identity IN (SELECT jsonb_build_object('scope',jsonb_build_object(
      'kind','enrolled-resource','connectionId',scope.connection_id,'leagueSeasonId',scope.league_season_id,
      'family',policy.family,'entityId',NULL,'scoringPeriodId',NULL,'audienceId','public','coverageSpecId',policy.coverage),
      'policy',jsonb_build_object('audienceId','public','coverageSpecId',policy.coverage,
        'canonicalNormalizerVersion',policy.normalizer,'validationVersion','latest-network-attempt-v1'))
    FROM (VALUES ('roster-membership','sleeper-current-all-teams-players-v1','sleeper-current-players-v1'),
      ('teams','sleeper-current-all-teams-primary-owners-v1','sleeper-current-team-managers-v1'),
      ('teams','sleeper-current-all-teams-manager-evidence-v2','sleeper-current-team-manager-evidence-v2'))
      AS policy(family,coverage,normalizer))) THEN
    RAISE EXCEPTION 'shared roster provenance context mismatch'; END IF;
  IF encode(digest(convert_to(header.provenance::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM header.content_hash
    OR NOT EXISTS(SELECT 1 FROM public.league_administration_observations observation
      JOIN public.league_administration_contents content ON content.id=observation.content_id
      JOIN public.league_source_mapping_revisions revision ON revision.id=header.source_mapping_revision_id
      WHERE observation.id=header.legacy_observation_id AND observation.content_id=p_receipt.content_id
        AND observation.league_season_id=scope.league_season_id AND observation.family='rosters' AND observation.week=0
        AND content.league_season_id=scope.league_season_id AND content.provider='sleeper' AND content.family='rosters' AND content.week=0
        AND content.normalizer_version='sleeper-administration-v1'
        AND content.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
        AND revision.connection_id=scope.connection_id AND revision.league_season_id=scope.league_season_id
        AND revision.provider=content.provider AND revision.external_league_id=content.external_league_id) THEN
    RAISE EXCEPTION 'shared roster provenance observation binding mismatch'; END IF;
  -- Unchanged raw captures may reuse an older observation. Its clocks/origin are
  -- not the fresh receipt's clocks; retain the exact original JSON independently.
  witness:=header.provenance->'acquisition';
  role_name:=CASE scope.identity->'policy'->>'canonicalNormalizerVersion'
    WHEN 'sleeper-current-players-v1' THEN 'players'
    WHEN 'sleeper-current-team-managers-v1' THEN 'managers'
    WHEN 'sleeper-current-team-manager-evidence-v2' THEN 'managersV2' END;
  IF header.provenance->>'origin' IS DISTINCT FROM 'network'
    OR jsonb_typeof(witness) IS DISTINCT FROM 'object'
    OR NOT(witness ?& ARRAY['version','work','fence','dispatchNonce','mapping','attempts'])
    OR witness-ARRAY['version','work','fence','dispatchNonce','mapping','attempts'] IS DISTINCT FROM '{}'::jsonb
    OR witness->>'version' IS DISTINCT FROM 'public-network-capture-v1'
    OR witness->'work'->>'kind' IS DISTINCT FROM 'core'
    OR witness->'fence' IS DISTINCT FROM attempt.write_fence OR attempt.write_fence IS NULL
    OR witness->'mapping' IS DISTINCT FROM attempt.source_mapping
    OR attempt.capture_nonce IS NULL
    OR witness->'attempts'->role_name IS DISTINCT FROM jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce)
    OR NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch
      WHERE dispatch.worker_id=attempt.write_fence->>'workerId' AND dispatch.generation=(attempt.write_fence->>'generation')::integer
        AND dispatch.resource='core' AND dispatch.work=witness->'work'
        AND dispatch.intake_id::text=witness->'work'->>'requestId'
        AND dispatch.capture_nonce::text=witness->>'dispatchNonce' AND dispatch.admitted_at<=attempt.reserved_at) THEN
    RAISE EXCEPTION 'shared roster provenance acquisition binding mismatch'; END IF;
  -- Recheck the complete retained witness group, not merely this receipt's role.
  -- Reservations precede the capture, so other receipts need not exist yet.
  -- Later same-fence reservations are not part of this immutable witness; do not
  -- compare its membership with the current append-only attempt table size.
  IF jsonb_typeof(witness->'attempts') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'shared roster provenance attempt group mismatch'; END IF;
  SELECT COALESCE(array_agg(key ORDER BY key COLLATE "C"),ARRAY[]::text[]) INTO role_names
    FROM jsonb_object_keys(witness->'attempts') key;
  IF role_names NOT IN (ARRAY['managers','players','settings'],ARRAY['managers','managersV2','players','settings'])
    OR (SELECT count(DISTINCT value->>'id') FROM jsonb_each(witness->'attempts'))<>cardinality(role_names)
    OR (SELECT count(DISTINCT value->>'nonce') FROM jsonb_each(witness->'attempts'))<>cardinality(role_names)
    OR EXISTS(SELECT 1 FROM jsonb_each(witness->'attempts') item WHERE
      CASE WHEN jsonb_typeof(item.value)='object' THEN
        NOT(item.value ?& ARRAY['id','nonce']) OR item.value-ARRAY['id','nonce'] IS DISTINCT FROM '{}'::jsonb
          OR jsonb_typeof(item.value->'id') IS DISTINCT FROM 'string'
          OR jsonb_typeof(item.value->'nonce') IS DISTINCT FROM 'string'
      ELSE true END
      OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_attempts reserved
        JOIN public.league_roster_resource_scopes resource ON resource.id=reserved.scope_id
        JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
          AND dispatch.generation=(attempt.write_fence->>'generation')::integer
        WHERE reserved.id::text=item.value->>'id' AND reserved.capture_nonce::text=item.value->>'nonce'
          AND reserved.source_mapping=attempt.source_mapping AND reserved.write_fence=attempt.write_fence
          AND reserved.reserved_at>=dispatch.admitted_at
          AND resource.league_season_id=scope.league_season_id AND resource.connection_id=scope.connection_id
          AND resource.identity->'policy'->>'canonicalNormalizerVersion'=CASE item.key
            WHEN 'settings' THEN 'sleeper-league-settings-v1' WHEN 'players' THEN 'sleeper-current-players-v1'
            WHEN 'managers' THEN 'sleeper-current-team-managers-v1'
            WHEN 'managersV2' THEN 'sleeper-current-team-manager-evidence-v2' END)) THEN
    RAISE EXCEPTION 'shared roster provenance attempt group mismatch'; END IF;
  -- Only the actual creating NEW receipt may precede its own INSERT. Later uses
  -- require its persisted immutable first reference, including original nonce/context.
  IF NOT COALESCE(header.capture_transaction=pg_current_xact_id_if_assigned() AND header.first_receipt_id=p_receipt.id,false)
    AND NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts first_receipt
      JOIN public.league_roster_resource_attempts first_attempt ON first_attempt.id=first_receipt.attempt_id
      JOIN public.league_roster_resource_scopes first_scope ON first_scope.id=first_attempt.scope_id
      WHERE first_receipt.id=header.first_receipt_id AND first_receipt.provenance_storage_format='shared-v1'
        AND first_receipt.provenance_content_id=header.id AND first_receipt.provenance IS NULL
        AND first_receipt.legacy_observation_id=header.legacy_observation_id AND first_receipt.content_id=p_receipt.content_id
        AND first_scope.league_season_id=header.league_season_id AND first_scope.connection_id=scope.connection_id
        AND first_attempt.source_mapping=attempt.source_mapping AND first_attempt.write_fence=attempt.write_fence
        AND witness->'attempts'->(CASE first_scope.identity->'policy'->>'canonicalNormalizerVersion'
          WHEN 'sleeper-current-players-v1' THEN 'players' WHEN 'sleeper-current-team-managers-v1' THEN 'managers'
          WHEN 'sleeper-current-team-manager-evidence-v2' THEN 'managersV2' END)
          =jsonb_build_object('id',first_attempt.id,'nonce',first_attempt.capture_nonce)) THEN
    RAISE EXCEPTION 'shared roster provenance first receipt missing'; END IF;
  RETURN header.provenance;
END; $$;

CREATE FUNCTION public.validate_roster_provenance_content()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_receipt public.league_roster_capture_receipts%ROWTYPE;
BEGIN
  IF NEW.capture_transaction<>pg_current_xact_id() THEN RAISE EXCEPTION 'roster provenance creation transaction mismatch'; END IF;
  SELECT * INTO STRICT first_receipt FROM public.league_roster_capture_receipts
    WHERE id=NEW.first_receipt_id AND provenance_storage_format='shared-v1' AND provenance_content_id=NEW.id;
  IF public.roster_capture_provenance(first_receipt) IS DISTINCT FROM NEW.provenance THEN
    RAISE EXCEPTION 'roster provenance first receipt mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER roster_provenance_content_complete AFTER INSERT ON public.league_roster_provenance_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_roster_provenance_content();

-- Private dormant candidate: local tests may bind roster_metadata_intern_before_lineage
-- before roster_population_intern_before_lineage and roster_receipt_lineage only.
CREATE FUNCTION public.intern_roster_capture_provenance()
RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_roster_resource_attempts%ROWTYPE; scope public.league_roster_resource_scopes%ROWTYPE;
  original_provenance jsonb:=NEW.provenance; digest_value text; created_id uuid; content_id_value uuid; stored_provenance jsonb;
BEGIN
  IF NEW.provenance_storage_format IS DISTINCT FROM 'inline-v1' OR NEW.provenance_content_id IS NOT NULL THEN
    RAISE EXCEPTION 'roster provenance interner requires inline input'; END IF;
  IF original_provenance->>'origin' IS DISTINCT FROM 'network'
    OR original_provenance->'acquisition'->>'version' IS DISTINCT FROM 'public-network-capture-v1'
    OR original_provenance->'acquisition'->'work'->>'kind' IS DISTINCT FROM 'core' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=NEW.attempt_id;
  SELECT * INTO STRICT scope FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  IF NOT (scope.identity IN (SELECT jsonb_build_object('scope',jsonb_build_object(
      'kind','enrolled-resource','connectionId',scope.connection_id,'leagueSeasonId',scope.league_season_id,
      'family',policy.family,'entityId',NULL,'scoringPeriodId',NULL,'audienceId','public','coverageSpecId',policy.coverage),
      'policy',jsonb_build_object('audienceId','public','coverageSpecId',policy.coverage,
        'canonicalNormalizerVersion',policy.normalizer,'validationVersion','latest-network-attempt-v1'))
    FROM (VALUES ('roster-membership','sleeper-current-all-teams-players-v1','sleeper-current-players-v1'),
      ('teams','sleeper-current-all-teams-primary-owners-v1','sleeper-current-team-managers-v1'),
      ('teams','sleeper-current-all-teams-manager-evidence-v2','sleeper-current-team-manager-evidence-v2'))
      AS policy(family,coverage,normalizer))) THEN RETURN NEW; END IF;
  -- Original witness validation remains live only at insertion. Do not weaken it
  -- to a digest lookup; repeat the same original fence/witness after any key wait.
  PERFORM public.public_capture_after_reservation(original_provenance,attempt.id);
  PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
  digest_value:=encode(digest(convert_to(original_provenance::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.league_roster_provenance_contents(league_season_id,source_mapping_revision_id,legacy_observation_id,
    content_hash,provenance,first_receipt_id)
  VALUES(scope.league_season_id,(attempt.source_mapping->>'revisionId')::uuid,NEW.legacy_observation_id,
    digest_value,original_provenance,NEW.id)
  ON CONFLICT(league_season_id,source_mapping_revision_id,legacy_observation_id,content_hash)
    DO NOTHING RETURNING id INTO created_id;
  IF created_id IS NULL THEN
    SELECT id,provenance INTO STRICT content_id_value,stored_provenance FROM public.league_roster_provenance_contents
      WHERE league_season_id=scope.league_season_id AND source_mapping_revision_id=(attempt.source_mapping->>'revisionId')::uuid
        AND legacy_observation_id=NEW.legacy_observation_id AND content_hash=digest_value;
  ELSE content_id_value:=created_id; stored_provenance:=original_provenance;
  END IF;
  IF stored_provenance IS DISTINCT FROM original_provenance THEN RAISE EXCEPTION 'roster provenance digest collision'; END IF;
  PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
  PERFORM public.public_capture_after_reservation(original_provenance,attempt.id);
  NEW.provenance_storage_format:='shared-v1'; NEW.provenance_content_id:=content_id_value; NEW.provenance:=NULL;
  IF public.roster_capture_provenance(NEW) IS DISTINCT FROM original_provenance THEN
    RAISE EXCEPTION 'roster provenance reconstruction mismatch'; END IF;
  RETURN NEW;
END; $$;

-- Compatible consumers only. Copied owners retain original hashes, replay order,
-- mapping/fence rules, clocks, scopes, settlement and cadence except logical reads.
CREATE OR REPLACE FUNCTION public.roster_capture_population_evidence(p_receipt public.league_roster_capture_receipts)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE header public.league_roster_population_contents%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE; scope public.league_roster_resource_scopes%ROWTYPE;
  receipt_provenance jsonb:=public.roster_capture_provenance(p_receipt);
BEGIN
  IF p_receipt IS NULL THEN RETURN NULL; END IF;
  IF p_receipt.id IS NULL THEN RAISE EXCEPTION 'invalid roster population receipt'; END IF;
  IF p_receipt.population_storage_format='inline-v1' AND p_receipt.population_content_id IS NULL THEN
    RETURN p_receipt.population_evidence;
  END IF;
  IF p_receipt.population_storage_format IS DISTINCT FROM 'shared-v1'
    OR p_receipt.population_content_id IS NULL OR p_receipt.population_evidence IS NOT NULL
    OR p_receipt.configuration_content_id IS NULL OR p_receipt.expected_team_count IS NULL THEN
    RAISE EXCEPTION 'invalid roster population storage shape'; END IF;
  SELECT * INTO STRICT header FROM public.league_roster_population_contents WHERE id=p_receipt.population_content_id;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=p_receipt.attempt_id;
  SELECT * INTO STRICT scope FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  IF header.league_season_id IS DISTINCT FROM scope.league_season_id
    OR header.source_mapping_revision_id::text IS DISTINCT FROM attempt.source_mapping->>'revisionId'
    OR header.configuration_content_id IS DISTINCT FROM p_receipt.configuration_content_id
    OR header.proof_version IS DISTINCT FROM 'roster-population-proof-v1'
    OR p_receipt.expected_team_count<=0 OR NOT (scope.identity IN (SELECT jsonb_build_object('scope',jsonb_build_object(
      'kind','enrolled-resource','connectionId',scope.connection_id,'leagueSeasonId',scope.league_season_id,
      'family',policy.family,'entityId',NULL,'scoringPeriodId',NULL,'audienceId','public','coverageSpecId',policy.coverage),
      'policy',jsonb_build_object('audienceId','public','coverageSpecId',policy.coverage,
        'canonicalNormalizerVersion',policy.normalizer,'validationVersion','latest-network-attempt-v1'))
    FROM (VALUES ('roster-membership','sleeper-current-all-teams-players-v1','sleeper-current-players-v1'),
      ('teams','sleeper-current-all-teams-primary-owners-v1','sleeper-current-team-managers-v1'),
      ('teams','sleeper-current-all-teams-manager-evidence-v2','sleeper-current-team-manager-evidence-v2'))
      AS policy(family,coverage,normalizer))) THEN
    RAISE EXCEPTION 'shared roster population context mismatch'; END IF;
  IF jsonb_typeof(header.population_evidence) IS DISTINCT FROM 'object'
    OR NOT (header.population_evidence ?& ARRAY['observationId','contentHash','provenance'])
    OR header.population_evidence-ARRAY['observationId','contentHash','provenance'] IS DISTINCT FROM '{}'::jsonb
    OR jsonb_typeof(header.population_evidence->'observationId') IS DISTINCT FROM 'string'
    OR (header.population_evidence->>'observationId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR jsonb_typeof(header.population_evidence->'contentHash') IS DISTINCT FROM 'string'
    OR (header.population_evidence->>'contentHash') !~ '^(sha256:)?[0-9a-f]{64}$'
    OR jsonb_typeof(header.population_evidence->'provenance') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid shared roster population proof'; END IF;
  IF NOT COALESCE(header.population_evidence->'provenance'->'acquisition' IS NOT DISTINCT FROM receipt_provenance->'acquisition'
    AND (receipt_provenance->'acquisition' IS NOT NULL
      OR (header.population_evidence->'provenance'->>'requestStartedAt')::timestamptz>=attempt.reserved_at),false) THEN
    RAISE EXCEPTION 'shared roster population acquisition unproved'; END IF;
  IF encode(digest(convert_to(header.population_evidence::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM header.content_hash
    OR NOT EXISTS(SELECT 1 FROM public.league_administration_contents configuration
    JOIN public.league_administration_contents capture ON capture.id=p_receipt.content_id
    JOIN public.league_administration_observations observation ON observation.id=(header.population_evidence->>'observationId')::uuid
    JOIN public.league_source_mapping_revisions revision ON revision.id=(attempt.source_mapping->>'revisionId')::uuid
    WHERE configuration.id=p_receipt.configuration_content_id AND configuration.league_season_id=scope.league_season_id
      AND configuration.provider='sleeper' AND configuration.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND configuration.family='league' AND configuration.week=0 AND configuration.normalizer_version='sleeper-administration-v1'
      AND configuration.accepted AND configuration.completeness='complete' AND configuration.content_hash=header.population_evidence->>'contentHash'
      AND capture.league_season_id=scope.league_season_id AND capture.provider=configuration.provider
      AND capture.external_league_id=configuration.external_league_id AND capture.family='rosters' AND capture.week=0
      AND observation.content_id=configuration.id AND observation.league_season_id=configuration.league_season_id
      AND observation.family='league' AND observation.week=0
      AND revision.connection_id=scope.connection_id AND revision.league_season_id=scope.league_season_id
      AND revision.provider='sleeper' AND revision.external_league_id=configuration.external_league_id) THEN
    RAISE EXCEPTION 'shared roster population proof binding mismatch'; END IF;
  -- Only the creating NEW receipt may precede its own INSERT. No future receipt,
  -- current head or current mapping can stand in for immutable first-reference proof.
  IF NOT COALESCE(header.capture_transaction=pg_current_xact_id_if_assigned() AND header.first_receipt_id=p_receipt.id,false)
    AND NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts first_receipt
      JOIN public.league_roster_resource_attempts first_attempt ON first_attempt.id=first_receipt.attempt_id
      JOIN public.league_roster_resource_scopes first_scope ON first_scope.id=first_attempt.scope_id
      WHERE first_receipt.id=header.first_receipt_id AND first_receipt.population_storage_format='shared-v1'
        AND first_receipt.population_content_id=header.id AND first_receipt.population_evidence IS NULL
        AND first_receipt.configuration_content_id=header.configuration_content_id AND first_receipt.expected_team_count>0
        AND first_scope.league_season_id=header.league_season_id
        AND first_attempt.source_mapping->>'revisionId'=header.source_mapping_revision_id::text) THEN
    RAISE EXCEPTION 'shared roster population first receipt missing'; END IF;
  RETURN header.population_evidence;
END; $$;

CREATE OR REPLACE FUNCTION public.intern_roster_population_evidence()
RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_roster_resource_attempts%ROWTYPE; scope public.league_roster_resource_scopes%ROWTYPE;
  receipt_provenance jsonb:=public.roster_capture_provenance(NEW);
  proof jsonb:=NEW.population_evidence; digest_value text; created_id uuid; content_id_value uuid; stored_proof jsonb;
BEGIN
  IF NEW.population_storage_format IS DISTINCT FROM 'inline-v1' OR NEW.population_content_id IS NOT NULL THEN
    RAISE EXCEPTION 'roster population interner requires inline input'; END IF;
  -- Unsupported/unproved inputs retain their original exact inline representation.
  IF NEW.configuration_content_id IS NULL OR NEW.expected_team_count IS NULL OR NEW.expected_team_count<=0
    OR proof IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(proof) IS DISTINCT FROM 'object'
    OR NOT (proof ?& ARRAY['observationId','contentHash','provenance'])
    OR proof-ARRAY['observationId','contentHash','provenance'] IS DISTINCT FROM '{}'::jsonb
    OR jsonb_typeof(proof->'observationId') IS DISTINCT FROM 'string'
    OR (proof->>'observationId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR jsonb_typeof(proof->'contentHash') IS DISTINCT FROM 'string'
    OR (proof->>'contentHash') !~ '^(sha256:)?[0-9a-f]{64}$'
    OR jsonb_typeof(proof->'provenance') IS DISTINCT FROM 'object' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=NEW.attempt_id;
  SELECT * INTO STRICT scope FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  IF NOT (scope.identity IN (SELECT jsonb_build_object('scope',jsonb_build_object(
      'kind','enrolled-resource','connectionId',scope.connection_id,'leagueSeasonId',scope.league_season_id,
      'family',policy.family,'entityId',NULL,'scoringPeriodId',NULL,'audienceId','public','coverageSpecId',policy.coverage),
      'policy',jsonb_build_object('audienceId','public','coverageSpecId',policy.coverage,
        'canonicalNormalizerVersion',policy.normalizer,'validationVersion','latest-network-attempt-v1'))
    FROM (VALUES ('roster-membership','sleeper-current-all-teams-players-v1','sleeper-current-players-v1'),
      ('teams','sleeper-current-all-teams-primary-owners-v1','sleeper-current-team-managers-v1'),
      ('teams','sleeper-current-all-teams-manager-evidence-v2','sleeper-current-team-manager-evidence-v2'))
      AS policy(family,coverage,normalizer))) OR NOT EXISTS(SELECT 1 FROM public.league_administration_contents configuration
    JOIN public.league_administration_contents capture ON capture.id=NEW.content_id
    JOIN public.league_administration_observations observation ON observation.id=(proof->>'observationId')::uuid
    JOIN public.league_source_mapping_revisions revision ON revision.id=(attempt.source_mapping->>'revisionId')::uuid
    WHERE configuration.id=NEW.configuration_content_id AND configuration.league_season_id=scope.league_season_id
      AND configuration.provider='sleeper' AND configuration.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND configuration.family='league' AND configuration.week=0 AND configuration.normalizer_version='sleeper-administration-v1'
      AND configuration.accepted AND configuration.completeness='complete' AND configuration.content_hash=proof->>'contentHash'
      AND capture.league_season_id=scope.league_season_id AND capture.provider=configuration.provider
      AND capture.external_league_id=configuration.external_league_id AND capture.family='rosters' AND capture.week=0
      AND observation.content_id=configuration.id AND observation.league_season_id=configuration.league_season_id
      AND observation.family='league' AND observation.week=0
      AND revision.connection_id=scope.connection_id AND revision.league_season_id=scope.league_season_id
      AND revision.provider='sleeper' AND revision.external_league_id=configuration.external_league_id) THEN RETURN NEW; END IF;
  -- Use the existing048 native population acquisition/time distinction only for
  -- storage eligibility. Old or malformed unproved evidence remains verbatim inline.
  IF proof->'provenance'->'acquisition' IS DISTINCT FROM receipt_provenance->'acquisition' THEN RETURN NEW; END IF;
  IF receipt_provenance->'acquisition' IS NULL THEN
    BEGIN
      IF proof->'provenance'->>'requestStartedAt' IS NULL
        OR (proof->'provenance'->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RETURN NEW; END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NEW;
    END;
  END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  digest_value:=encode(digest(convert_to(proof::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.league_roster_population_contents(league_season_id,source_mapping_revision_id,configuration_content_id,
    proof_version,content_hash,population_evidence,first_receipt_id)
  VALUES(scope.league_season_id,(attempt.source_mapping->>'revisionId')::uuid,NEW.configuration_content_id,
    'roster-population-proof-v1',digest_value,proof,NEW.id)
  ON CONFLICT(league_season_id,source_mapping_revision_id,configuration_content_id,proof_version,content_hash)
    DO NOTHING RETURNING id INTO created_id;
  IF created_id IS NULL THEN
    -- VOLATILE separate statement observes a committed unique-key winner after
    -- waiting. A snapshot unable to establish that winner fails closed.
    SELECT id,population_evidence INTO STRICT content_id_value,stored_proof FROM public.league_roster_population_contents
      WHERE league_season_id=scope.league_season_id AND source_mapping_revision_id=(attempt.source_mapping->>'revisionId')::uuid
        AND configuration_content_id=NEW.configuration_content_id AND proof_version='roster-population-proof-v1' AND content_hash=digest_value;
  ELSE content_id_value:=created_id; stored_proof:=proof;
  END IF;
  IF stored_proof IS DISTINCT FROM proof THEN RAISE EXCEPTION 'roster population digest collision'; END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  NEW.population_storage_format:='shared-v1'; NEW.population_content_id:=content_id_value; NEW.population_evidence:=NULL;
  IF public.roster_capture_population_evidence(NEW) IS DISTINCT FROM proof THEN
    RAISE EXCEPTION 'roster population reconstruction mismatch'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_current_roster_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE population_proof jsonb;
BEGIN
  IF TG_TABLE_NAME='league_roster_capture_receipts' THEN
    PERFORM public.roster_capture_provenance(NEW);
    population_proof:=public.roster_capture_population_evidence(NEW);
    IF NEW.configuration_content_id=NEW.content_id AND NOT EXISTS(SELECT 1
      FROM public.league_roster_resource_attempts attempt
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE attempt.id=NEW.attempt_id AND scope.identity->'scope'->>'family'='league-season') THEN
      RAISE EXCEPTION 'self configuration requires league resource'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_attempts attempt
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      JOIN public.league_administration_contents content ON content.id=NEW.content_id
      JOIN public.league_administration_observations observation ON observation.id=NEW.legacy_observation_id
      WHERE attempt.id=NEW.attempt_id AND content.league_season_id=scope.league_season_id
        AND content.provider='sleeper' AND content.family=CASE
          WHEN scope.identity->'scope'->>'family'='league-season' THEN 'league'
          WHEN scope.identity->'scope'->>'family'='drafts' AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb THEN 'drafts'
          WHEN scope.identity->'scope'->>'family'='playoff-brackets' AND scope.identity->'scope'->>'entityId' IN ('winners_bracket','losers_bracket')
            AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb THEN scope.identity->'scope'->>'entityId'
          WHEN scope.identity->'scope'->>'family'='weekly-reports' AND scope.identity->'scope'->>'entityId'='league_report' THEN 'weekly_report'
          WHEN scope.identity->'scope'->>'family' IN ('matchups','transactions') THEN scope.identity->'scope'->>'family' ELSE 'rosters' END
        AND content.week=CASE WHEN scope.identity->'scope'->>'family'='weekly-reports'
          THEN substring(scope.identity->'scope'->>'scoringPeriodId' FROM '^sleeper:report-week:([0-9]+)$')::integer
          WHEN scope.identity->'scope'->>'family'='matchups'
          THEN substring(scope.identity->'scope'->>'scoringPeriodId' FROM '^sleeper:matchup-week:([0-9]+)$')::integer
          WHEN scope.identity->'scope'->>'family'='transactions'
          THEN substring(scope.identity->'scope'->>'scoringPeriodId' FROM '^sleeper:transaction-week:([0-9]+)$')::integer ELSE 0 END
        AND content.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
        AND observation.content_id=content.id AND observation.league_season_id=content.league_season_id)
      OR (NEW.configuration_content_id IS NOT NULL AND NEW.configuration_content_id<>NEW.content_id AND NOT EXISTS(SELECT 1
        FROM public.league_administration_contents capture
        JOIN public.league_administration_contents configuration ON configuration.id=NEW.configuration_content_id
        JOIN public.league_administration_observations observation ON observation.id=(population_proof->>'observationId')::uuid
        WHERE capture.id=NEW.content_id AND configuration.league_season_id=capture.league_season_id
          AND configuration.provider=capture.provider AND configuration.external_league_id=capture.external_league_id
          AND configuration.family='league' AND configuration.week=0 AND configuration.accepted
          AND observation.content_id=configuration.id)) THEN RAISE EXCEPTION 'resource receipt lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_roster_resource_acceptances' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_source_mapping_revisions revision ON revision.id=NEW.source_mapping_revision_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE receipt.id=NEW.receipt_id AND attempt.scope_id=NEW.scope_id
        AND attempt.source_mapping->>'revisionId'=revision.id::text AND revision.connection_id=scope.connection_id
        AND revision.league_season_id=scope.league_season_id AND (receipt.coverage->>'completeness'='complete' OR (
          receipt.coverage->>'completeness'='partial'
          AND scope.identity->'scope'->>'family'='teams'
          AND scope.identity->'scope'->>'audienceId'='public'
          AND scope.identity->'scope'->>'coverageSpecId'='sleeper-current-all-teams-manager-evidence-v2'
          AND scope.identity->'policy'=jsonb_build_object('audienceId','public',
            'coverageSpecId','sleeper-current-all-teams-manager-evidence-v2',
            'canonicalNormalizerVersion','sleeper-current-team-manager-evidence-v2','validationVersion','latest-network-attempt-v1')
          AND receipt.coverage->>'entitySet'='full' AND receipt.coverage->'fields'='["owner_id","co_owners"]'::jsonb
          AND receipt.coverage->>'pagination'='complete' AND receipt.coverage->'nextCursor'='null'::jsonb
          AND receipt.coverage->'periodIds'='[]'::jsonb AND receipt.coverage->'interval'='null'::jsonb
          AND jsonb_typeof(receipt.coverage->'reasons')='array' AND jsonb_array_length(receipt.coverage->'reasons')>0))
        AND ((scope.identity->'scope'->>'family'='league-season' AND receipt.configuration_content_id=receipt.content_id
          AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL)
          OR (scope.identity->'scope'->>'family' IN ('transactions','playoff-brackets','weekly-reports','drafts') AND receipt.configuration_content_id IS NULL
            AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL)
          OR (scope.identity->'scope'->>'family' NOT IN ('league-season','transactions','playoff-brackets','weekly-reports','drafts') AND receipt.configuration_content_id IS NOT NULL
            AND receipt.expected_team_count>0))
        AND NEW.generation=attempt.expected_generation+1) THEN RAISE EXCEPTION 'resource acceptance lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_roster_resource_heads' THEN
    IF NEW.accepted_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      WHERE accepted.id=NEW.accepted_id AND accepted.scope_id=NEW.scope_id AND accepted.generation=NEW.generation) THEN
      RAISE EXCEPTION 'resource head lineage mismatch'; END IF;
    IF TG_OP='UPDATE' AND (NEW.scope_id<>OLD.scope_id OR NEW.latest_ordinal<OLD.latest_ordinal
      OR NEW.generation<OLD.generation OR (OLD.accepted_id IS NOT NULL AND NEW.accepted_id IS NULL)) THEN
      RAISE EXCEPTION 'resource head cannot regress'; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.official_standings_receipt_coverage(p_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt public.league_roster_capture_receipts%ROWTYPE; attempt public.league_roster_resource_attempts%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; header public.league_official_standings_contents%ROWTYPE;
  configuration public.league_administration_contents%ROWTYPE; expected integer; population text; entity text; records text; reasons jsonb;
BEGIN
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts WHERE id=p_receipt_id;
  receipt.population_evidence:=public.roster_capture_population_evidence(receipt);
  receipt.provenance:=public.roster_capture_provenance(receipt);
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=receipt.content_id;
  SELECT * INTO STRICT header FROM public.league_official_standings_contents WHERE content_id=receipt.content_id;
  IF receipt.population_evidence->'provenance'->'acquisition' IS NOT DISTINCT FROM receipt.provenance->'acquisition'
    AND (receipt.provenance->'acquisition' IS NOT NULL
      OR (receipt.population_evidence->'provenance'->>'requestStartedAt')::timestamptz>=attempt.reserved_at) THEN
    -- The legacy expected count is additionally gated by scoring compatibility.
    -- Official native population is independent from those derived-feature gates.
    SELECT * INTO configuration FROM public.league_administration_contents candidate
      WHERE candidate.id=receipt.configuration_content_id AND candidate.league_season_id=content.league_season_id
        AND candidate.provider=content.provider AND candidate.external_league_id=content.external_league_id
        AND candidate.family='league' AND candidate.week=0 AND candidate.normalizer_version='sleeper-administration-v1'
        AND candidate.accepted AND candidate.completeness='complete'
        AND candidate.content_hash=receipt.population_evidence->>'contentHash'
        AND candidate.payload->'league_id'=to_jsonb(content.external_league_id)
        AND candidate.payload->'season'=to_jsonb(attempt.source_mapping->'scope'->>'season')
        AND candidate.payload->'sport'='"nfl"'::jsonb
        AND EXISTS(SELECT 1 FROM public.league_administration_observations observation
          WHERE observation.id=(receipt.population_evidence->>'observationId')::uuid AND observation.content_id=candidate.id
            AND observation.league_season_id=candidate.league_season_id AND observation.family='league' AND observation.week=0);
    IF FOUND AND jsonb_typeof(configuration.payload->'total_rosters')='number'
      AND (configuration.payload->>'total_rosters')::numeric BETWEEN 1 AND 2147483647
      AND (configuration.payload->>'total_rosters')::numeric=trunc((configuration.payload->>'total_rosters')::numeric) THEN
      expected:=(configuration.payload->>'total_rosters')::integer;
    END IF;
  END IF;
  population:=CASE WHEN expected IS NULL THEN 'unproved' WHEN header.structural_status='qualified' AND expected=header.team_count
    THEN 'proven' ELSE 'mismatch' END;
  entity:=CASE WHEN header.structural_status='qualified' AND content.completeness='complete' AND population='proven' THEN 'full'
    WHEN header.structural_status='qualified' AND (population='mismatch' OR content.completeness='partial') THEN 'partial' ELSE 'unknown' END;
  records:=CASE WHEN header.structural_status<>'qualified' OR header.team_count=0 THEN 'unknown'
    WHEN NOT EXISTS(SELECT 1 FROM public.league_official_standings_teams WHERE content_id=content.id
      AND (field_states->>'wins'<>'known' OR field_states->>'losses'<>'known' OR field_states->>'ties'<>'known'
        OR points_for_state<>'known' OR points_against_state<>'known')) THEN 'complete' ELSE 'partial' END;
  reasons:=header.reasons;
  IF population<>'proven' THEN reasons:=reasons||jsonb_build_array('standings_population_'||population); END IF;
  IF content.completeness='partial' THEN reasons:=reasons||'["standings_capture_partial"]'::jsonb; END IF;
  IF records<>'complete' THEN reasons:=reasons||'["standings_record_fields_incomplete"]'::jsonb; END IF;
  RETURN jsonb_build_object('expectedTeamCount',expected,'population',population,'entitySet',entity,'recordCompleteness',records,'reasons',reasons);
END; $$;

CREATE OR REPLACE FUNCTION public.guard_official_standings_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE; witness jsonb; qualified jsonb;
BEGIN
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=NEW.content_id;
  IF content.provider<>'sleeper' OR content.family<>'rosters' OR content.week<>0
    OR content.normalizer_version<>'sleeper-administration-v1' THEN RAISE EXCEPTION 'official standings content scope mismatch'; END IF;
  IF TG_TABLE_NAME='league_official_standings_teams' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_official_standings_contents header
      WHERE header.content_id=NEW.content_id AND header.capture_transaction=pg_current_xact_id() AND header.structural_status='qualified')
      OR NOT EXISTS(SELECT 1 FROM public.league_season_teams team WHERE team.id=NEW.season_team_id
        AND team.league_season_id=content.league_season_id AND team.provider=content.provider
        AND team.external_league_id=content.external_league_id AND team.external_roster_id=NEW.external_roster_id)
      OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(NEW.field_states) key)
        IS DISTINCT FROM ARRAY['fpts','fpts_against','fpts_against_decimal','fpts_decimal','losses','rank','seed','ties','wins'] THEN
      RAISE EXCEPTION 'official standings child lineage mismatch'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts
    WHERE id=(to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='league_official_standings_contents' THEN 'first_receipt_id' ELSE 'receipt_id' END)::uuid;
  receipt.provenance:=public.roster_capture_provenance(receipt);
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  IF receipt.content_id<>NEW.content_id OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope
    WHERE scope.id=attempt.scope_id AND scope.league_season_id=content.league_season_id
      AND scope.identity->'policy'->>'canonicalNormalizerVersion'='sleeper-current-players-v1')
    OR attempt.source_mapping->>'leagueSeasonId' IS DISTINCT FROM content.league_season_id::text
    OR attempt.source_mapping->'scope'->>'season' IS DISTINCT FROM '2026'
    OR attempt.source_mapping->'scope'->>'externalLeagueId' IS DISTINCT FROM content.external_league_id
    OR receipt.provenance->>'origin' IS DISTINCT FROM 'network'
    OR attempt.write_fence IS NULL THEN RAISE EXCEPTION 'official standings capture lineage mismatch'; END IF;
  -- A supplement cannot be inserted in a later transaction for a historic receipt.
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts stored WHERE stored.id=receipt.id
    AND stored.xmin=((pg_current_xact_id()::text::numeric % 4294967296)::text)::xid) THEN
    RAISE EXCEPTION 'official standings requires newly recorded receipt'; END IF;
  PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
  PERFORM public.validate_current_roster_mapping(attempt.source_mapping);
  IF TG_TABLE_NAME='league_official_standings_contents' THEN
    IF NEW.capture_transaction<>pg_current_xact_id() THEN RAISE EXCEPTION 'official standings content transaction mismatch'; END IF;
    RETURN NEW;
  END IF;
  qualified:=public.official_standings_receipt_coverage(receipt.id);
  IF NEW.attempt_id<>attempt.id OR NEW.attempt_ordinal<>attempt.ordinal OR NEW.source_mapping IS DISTINCT FROM attempt.source_mapping
    OR NEW.expected_team_count IS DISTINCT FROM (qualified->>'expectedTeamCount')::integer
    OR NEW.population_state IS DISTINCT FROM qualified->>'population' OR NEW.entity_set IS DISTINCT FROM qualified->>'entitySet'
    OR NEW.record_completeness IS DISTINCT FROM qualified->>'recordCompleteness' OR NEW.reasons IS DISTINCT FROM qualified->'reasons' THEN
    RAISE EXCEPTION 'official standings receipt qualification mismatch'; END IF;
  witness:=receipt.provenance->'acquisition';
  IF witness IS NOT NULL THEN
    PERFORM public.assert_public_data_capture_witness(witness,attempt.write_fence,'rosters',NULL,attempt.source_mapping);
    IF witness->'attempts'->'players' IS DISTINCT FROM jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce)
      OR NEW.intake_id::text IS DISTINCT FROM witness->'work'->>'requestId'
      OR NEW.worker_id IS DISTINCT FROM witness->'fence'->>'workerId'
      OR NEW.generation IS DISTINCT FROM (witness->'fence'->>'generation')::integer
      OR witness->'work'->>'kind' IS DISTINCT FROM 'core'
      OR NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch
        JOIN public.public_data_league_candidates candidate ON candidate.intake_id=dispatch.intake_id
          AND candidate.season=(dispatch.work->>'season')::integer
          AND candidate.external_league_id=dispatch.work->>'externalLeagueId'
        WHERE dispatch.worker_id=NEW.worker_id AND dispatch.generation=NEW.generation
          AND dispatch.intake_id=NEW.intake_id AND dispatch.resource='core' AND dispatch.work=witness->'work'
          AND dispatch.capture_nonce::text=witness->>'dispatchNonce'
          AND candidate.league_season_id=content.league_season_id) THEN
      RAISE EXCEPTION 'official standings public receipt binding mismatch'; END IF;
  ELSIF NEW.intake_id IS NOT NULL OR NEW.worker_id IS NOT NULL OR NEW.generation IS NOT NULL THEN
    RAISE EXCEPTION 'unwitnessed official standings cannot bind intake'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.record_league_administration_observation_v48(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; projection jsonb:=p_input->'officialStandings'; expected jsonb; row_value jsonb; coverage_value jsonb;
  receipt public.league_roster_capture_receipts%ROWTYPE; attempt public.league_roster_resource_attempts%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; header public.league_official_standings_contents%ROWTYPE;
  identity_value uuid; witness jsonb;
BEGIN
  -- New fields must never alter any predecessor receipt evidence hash.
  result:=public.record_league_administration_observation_v47(p_input-'officialStandings');
  IF projection IS NULL THEN RETURN result; END IF;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'rosters'
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'provenance'->>'origin' IS DISTINCT FROM 'network'
    OR p_input->'writeFence' IS NULL OR p_input->'rosterAcceptance' IS NULL
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope'
    OR result->'rosterAcceptance'->>'receiptId' IS NULL THEN
    RAISE EXCEPTION 'official standings requires fenced mapped roster receipt'; END IF;
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts WHERE id=(result->'rosterAcceptance'->>'receiptId')::uuid;
  receipt.provenance:=public.roster_capture_provenance(receipt);
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=receipt.content_id;
  expected:=public.project_official_standings_native(content.payload,content.external_league_id);
  IF projection IS DISTINCT FROM expected THEN RAISE EXCEPTION 'official standings projection mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.league_official_standings_captures WHERE receipt_id=receipt.id) THEN
    IF public.official_standings_typed_value(content.id) IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'official standings replay conflict'; END IF;
    RETURN result||jsonb_build_object('officialStandings',jsonb_build_object('status','replayed','receiptId',receipt.id,
      'contentId',content.id,'version','sleeper-official-standings-v1'));
  END IF;
  IF result->'rosterAcceptance'->>'reason'='exact_receipt_replay' THEN
    RETURN result||jsonb_build_object('officialStandings',jsonb_build_object('status','legacy-unqualified','receiptId',receipt.id,
      'contentId',content.id,'version','sleeper-official-standings-v1'));
  END IF;
  PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
  SELECT * INTO header FROM public.league_official_standings_contents WHERE content_id=content.id;
  IF NOT FOUND THEN
    INSERT INTO public.league_official_standings_contents(content_id,value_version,first_receipt_id,structural_status,team_count,reasons)
      VALUES(content.id,'sleeper-official-standings-v1',receipt.id,expected->>'status',jsonb_array_length(expected->'teams'),expected->'reasons');
    FOR row_value IN SELECT value FROM jsonb_array_elements(expected->'teams') LOOP
      -- Only canonical team identity is shared. No legacy team/member rows or players acceptance are manufactured.
      INSERT INTO public.league_season_teams(league_season_id,provider,external_league_id,external_roster_id)
        VALUES(content.league_season_id,content.provider,content.external_league_id,row_value->>'externalRosterId') ON CONFLICT DO NOTHING;
      SELECT id INTO STRICT identity_value FROM public.league_season_teams WHERE league_season_id=content.league_season_id
        AND provider=content.provider AND external_league_id=content.external_league_id AND external_roster_id=row_value->>'externalRosterId';
      INSERT INTO public.league_official_standings_teams(content_id,external_roster_id,season_team_id,source_ordinal,field_states,
        wins,losses,ties,fpts,fpts_decimal,fpts_against,fpts_against_decimal,rank,seed,
        points_for_state,points_for_value,points_against_state,points_against_value)
      VALUES(content.id,row_value->>'externalRosterId',identity_value,(row_value->>'sourceOrdinal')::integer,
        jsonb_build_object('wins',row_value->'record'->'wins'->>'state','losses',row_value->'record'->'losses'->>'state',
          'ties',row_value->'record'->'ties'->>'state','fpts',row_value->'pointsFor'->'whole'->>'state',
          'fpts_decimal',row_value->'pointsFor'->'fraction'->>'state','fpts_against',row_value->'pointsAgainst'->'whole'->>'state',
          'fpts_against_decimal',row_value->'pointsAgainst'->'fraction'->>'state','rank',row_value->'providerRank'->>'state',
          'seed',row_value->'providerSeed'->>'state'),
        (row_value->'record'->'wins'->>'value')::bigint,(row_value->'record'->'losses'->>'value')::bigint,
        (row_value->'record'->'ties'->>'value')::bigint,(row_value->'pointsFor'->'whole'->>'value')::numeric,
        (row_value->'pointsFor'->'fraction'->>'value')::numeric,(row_value->'pointsAgainst'->'whole'->>'value')::numeric,
        (row_value->'pointsAgainst'->'fraction'->>'value')::numeric,(row_value->'providerRank'->>'value')::bigint,
        (row_value->'providerSeed'->>'value')::bigint,row_value->'pointsFor'->>'state',row_value->'pointsFor'->>'value',
        row_value->'pointsAgainst'->>'state',row_value->'pointsAgainst'->>'value');
    END LOOP;
  ELSIF public.official_standings_typed_value(content.id) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'official standings content conflict';
  END IF;
  coverage_value:=public.official_standings_receipt_coverage(receipt.id);witness:=receipt.provenance->'acquisition';
  INSERT INTO public.league_official_standings_captures(receipt_id,content_id,value_version,attempt_id,attempt_ordinal,source_mapping,
    expected_team_count,population_state,entity_set,record_completeness,reasons,intake_id,worker_id,generation)
  VALUES(receipt.id,content.id,'sleeper-official-standings-v1',attempt.id,attempt.ordinal,attempt.source_mapping,
    (coverage_value->>'expectedTeamCount')::integer,coverage_value->>'population',coverage_value->>'entitySet',
    coverage_value->>'recordCompleteness',coverage_value->'reasons',(witness->'work'->>'requestId')::uuid,
    witness->'fence'->>'workerId',(witness->'fence'->>'generation')::integer);
  PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
  RETURN result||jsonb_build_object('officialStandings',jsonb_build_object('status','recorded','receiptId',receipt.id,
    'contentId',content.id,'version','sleeper-official-standings-v1'));
END; $$;

CREATE OR REPLACE FUNCTION public.checkpoint_public_data_intake_v43(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; kind text:=p_work->>'kind';
  acquisition jsonb;
  value jsonb:=p_capture->'value'; native text; manager_id uuid; started timestamptz; completed timestamptz;
  v_league_id uuid; season_id uuid; connection_id uuid; item jsonb; count_selected integer;
  observation uuid; v_family text; mapping jsonb; receipt_key text; wanted_receipt_id uuid;
  dispatch_row public.public_data_dispatches%ROWTYPE; directory jsonb; directory_content uuid; directory_capture_id uuid; task public.public_data_exact_period_tasks%ROWTYPE; period_scope jsonb;
BEGIN
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  SELECT exact_periods INTO STRICT period_scope FROM public.public_data_intakes WHERE id=request_id;
  IF NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE dispatch.worker_id=p_fence->>'workerId'
    AND dispatch.generation=(p_fence->>'generation')::integer AND dispatch.work=p_work AND NOT EXISTS(
      SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
    RAISE EXCEPTION 'matching admitted public dispatch required';
  END IF;
  SELECT * INTO STRICT dispatch_row FROM public.public_data_dispatches
    WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
  IF p_capture->'failed'='true'::jsonb THEN
    PERFORM public.fail_public_data_work(p_work);
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome)
      VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'failed');
    RETURN;
  END IF;
  IF kind IN ('identity','leagues','bootstrap') THEN
    started:=(p_capture->>'requestStartedAt')::timestamptz; completed:=(p_capture->>'requestCompletedAt')::timestamptz;
    acquisition:=p_capture->'acquisition';
    IF acquisition IS NOT NULL THEN
      PERFORM public.assert_public_data_capture_witness(acquisition,p_fence,
        CASE WHEN kind='bootstrap' THEN 'league' ELSE kind END,NULL);
    END IF;
    IF started IS NULL OR completed IS NULL OR started>completed
      OR (acquisition IS NULL AND (completed>clock_timestamp() OR started<clock_timestamp()-interval '30 seconds')) THEN
      RAISE EXCEPTION 'invalid public capture timing'; END IF;
  END IF;
  IF p_capture->>'diagnostic'='invalid-source' THEN
    INSERT INTO public.public_data_rejections(intake_id,revision,resource,source_scope,payload,request_started_at,request_completed_at,reason)
      VALUES(request_id,(p_work->>'revision')::integer,kind,p_work,p_capture->'payload',started,completed,'invalid-source');
    PERFORM public.checkpoint_public_data_intake(p_work,'{"failed":true}'::jsonb,p_fence);
    RETURN;
  END IF;
  IF kind='identity' THEN
    native:=value->>'userId';
    IF native IS NULL OR native !~ '^[1-9][0-9]{0,31}$' OR p_capture->'payload'->>'user_id' IS DISTINCT FROM native
      OR btrim(p_capture->'payload'->>'username') IS DISTINCT FROM value->>'username'
      OR length(value->>'username') NOT BETWEEN 1 AND 100 OR length(value->>'displayName') NOT BETWEEN 1 AND 100
      OR (p_work->>'username' ~ '^[1-9][0-9]{0,31}$' AND native<>p_work->>'username') THEN
      RAISE EXCEPTION 'invalid public identity capture'; END IF;
    INSERT INTO public.league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',native) ON CONFLICT DO NOTHING;
    SELECT id INTO STRICT manager_id FROM public.league_source_manager_accounts WHERE provider='sleeper' AND external_manager_id=native;
    INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,avatar_url,payload,request_started_at,request_completed_at)
      VALUES(request_id,manager_id,value->>'username',value->>'displayName',value->>'avatarUrl',p_capture->'payload',started,completed);
  ELSIF kind='leagues' THEN
    IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value)>1000
      OR jsonb_typeof(p_capture->'payload') IS DISTINCT FROM 'array' OR jsonb_array_length(p_capture->'payload')>1000 THEN
      RAISE EXCEPTION 'invalid public list'; END IF;
    INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at)
      VALUES(request_id,(p_work->>'season')::integer,p_capture->'payload',started,completed);
    SELECT count(*) INTO count_selected FROM public.public_data_league_candidates WHERE intake_id=request_id AND stage<>'capacity';
    FOR item IN SELECT entry FROM jsonb_array_elements(value) entry LOOP
      IF item->>'id' IS NULL OR item->>'id' !~ '^[1-9][0-9]{0,31}$' OR item->>'season' IS DISTINCT FROM p_work->>'season'
        OR length(item->>'name') NOT BETWEEN 1 AND 200 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_capture->'payload') raw
          WHERE raw->>'league_id'=item->>'id' AND raw->>'season'=p_work->>'season' AND raw->>'sport'='nfl'
            AND btrim(raw->>'name')=item->>'name') THEN RAISE EXCEPTION 'invalid public list member'; END IF;
      INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name,stage)
        VALUES(request_id,(p_work->>'season')::integer,item->>'id',item->>'name',CASE WHEN count_selected<20 THEN 'bootstrap' ELSE 'capacity' END);
      count_selected:=count_selected+1;
    END LOOP;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_capture->'payload') raw WHERE NOT EXISTS(
      SELECT 1 FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=request_id
        AND candidate.season=(p_work->>'season')::integer AND candidate.external_league_id=raw->>'league_id')) THEN
      RAISE EXCEPTION 'public list silently omitted a source member'; END IF;
    IF period_scope<>'[]'::jsonb THEN
      INSERT INTO public.public_data_exact_period_tasks(intake_id,ordinal,season,external_league_id,native_week)
      SELECT request_id,(SELECT count(*) FROM public.public_data_exact_period_tasks WHERE intake_id=request_id)
        +row_number() OVER(ORDER BY candidate.season,candidate.external_league_id),candidate.season,candidate.external_league_id,(period->>'nativeWeek')::integer
      FROM public.public_data_league_candidates candidate JOIN public.public_data_intakes request ON request.id=candidate.intake_id
      CROSS JOIN LATERAL jsonb_array_elements(request.exact_periods) period
      WHERE candidate.intake_id=request_id AND candidate.season=(p_work->>'season')::integer AND candidate.stage<>'capacity'
        AND (period->>'season')::integer=candidate.season;
    END IF;
  ELSIF kind='bootstrap' THEN
    IF p_capture->>'capacity'='roster-count-unqualified' THEN
      UPDATE public.public_data_league_candidates SET stage='capacity',bootstrap_payload=p_capture->'payload',
        bootstrap_started_at=started,bootstrap_completed_at=completed WHERE intake_id=request_id
        AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
      IF period_scope<>'[]'::jsonb THEN
        UPDATE public.public_data_exact_period_tasks SET status='unavailable',reason='bootstrap-capacity' WHERE intake_id=request_id
          AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
      END IF;
      UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0 WHERE id=request_id;
      IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
        UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id;
      END IF;
      PERFORM public.assert_public_data_owner(request_id,p_fence);
      INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome,capture_acquisition)
        VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed',acquisition);
      RETURN;
    END IF;
    season_id:=(p_capture->>'leagueSeasonId')::uuid; v_league_id:=(p_capture->>'leagueId')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.league_source_connections connection JOIN public.league_seasons season ON season.id=connection.league_season_id
      WHERE season.id=season_id AND season.league_id=v_league_id AND season.season=(p_work->>'season')::integer
        AND connection.provider='sleeper' AND connection.external_league_id=p_work->>'externalLeagueId')
      OR p_capture->'payload'->>'league_id' IS DISTINCT FROM p_work->>'externalLeagueId'
      OR p_capture->'payload'->>'season' IS DISTINCT FROM p_work->>'season'
      OR p_capture->'payload'->>'sport' IS DISTINCT FROM 'nfl' THEN RAISE EXCEPTION 'public registration mismatch'; END IF;
    PERFORM public.assert_league_collection_capacity(p_work->>'externalLeagueId');
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence)
      VALUES(v_league_id,'sleeper',false,'public-data-intake-v1') ON CONFLICT DO NOTHING;
    INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES(v_league_id,(p_work->>'season')::integer,'sleeper','public-data-intake-v1') ON CONFLICT DO NOTHING;
    UPDATE public.public_data_league_candidates SET league_season_id=season_id,bootstrap_payload=p_capture->'payload',
      bootstrap_started_at=started,bootstrap_completed_at=completed,stage='core'
      WHERE intake_id=request_id AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
  ELSIF kind='exact-matchups' THEN
    IF period_scope='[]'::jsonb THEN RAISE EXCEPTION 'explicit public period scope required'; END IF;
    IF jsonb_typeof(p_capture->'observations') IS DISTINCT FROM 'object' OR jsonb_typeof(p_capture->'receipts') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'exact period checkpoint incomplete'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>2
      OR NOT(p_capture->'observations' ?& ARRAY['league','matchups'])
      OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'receipts'))<>2
      OR NOT(p_capture->'receipts' ?& ARRAY['settings','matchups']) THEN RAISE EXCEPTION 'exact period checkpoint incomplete'; END IF;
    SELECT * INTO STRICT task FROM public.public_data_exact_period_tasks WHERE intake_id=request_id
      AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId'
      AND native_week=(p_work->>'nativeWeek')::integer AND status='pending';
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      WHERE receipt.id=(p_capture->'receipts'->>'settings')::uuid AND attempt.write_fence=p_fence
        AND receipt.legacy_observation_id=(p_capture->'observations'->>'league')::uuid)
      OR NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      WHERE receipt.id=(p_capture->'receipts'->>'matchups')::uuid AND attempt.write_fence=p_fence
        AND receipt.legacy_observation_id=(p_capture->'observations'->>'matchups')::uuid) THEN RAISE EXCEPTION 'exact period observation mismatch'; END IF;
    INSERT INTO public.public_data_exact_period_checkpoints(intake_id,task_ordinal,worker_id,generation,league_season_id,
      source_mapping,settings_receipt_id,matchups_receipt_id)
      VALUES(request_id,task.ordinal,p_fence->>'workerId',(p_fence->>'generation')::integer,(p_capture->'mapping'->>'leagueSeasonId')::uuid,
        p_capture->'mapping',(p_capture->'receipts'->>'settings')::uuid,(p_capture->'receipts'->>'matchups')::uuid);
    SELECT provenance->'acquisition' INTO acquisition FROM public.league_roster_capture_receipts
      WHERE id=(p_capture->'receipts'->>'settings')::uuid;
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    UPDATE public.public_data_exact_period_tasks SET status='complete' WHERE intake_id=request_id AND ordinal=task.ordinal;
  ELSIF kind IN ('core','users') THEN
    mapping:=p_capture->'mapping'; season_id:=(mapping->>'leagueSeasonId')::uuid; connection_id:=(mapping->>'connectionId')::uuid;
    PERFORM public.validate_current_roster_mapping(mapping);
    IF NOT EXISTS(SELECT 1 FROM public.league_source_connections connection
      JOIN public.public_data_league_candidates candidate ON candidate.league_season_id=connection.league_season_id
      WHERE candidate.intake_id=request_id AND candidate.season=(p_work->>'season')::integer
        AND candidate.external_league_id=p_work->>'externalLeagueId' AND connection.id=connection_id
        AND connection.league_season_id=season_id AND connection.provider='sleeper'
        AND connection.external_league_id=candidate.external_league_id
        AND connection.current_mapping_revision_id=(mapping->>'revisionId')::uuid
        AND connection.mapping_generation=(mapping->>'generation')::integer) THEN RAISE EXCEPTION 'public source mapping changed'; END IF;
    IF jsonb_typeof(p_capture->'observations') IS DISTINCT FROM 'object'
      OR (kind='core' AND (p_capture->'observations'->>'league' IS NULL OR p_capture->'observations'->>'rosters' IS NULL
        OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>2))
      OR (kind='users' AND (p_capture->'observations'->>'users' IS NULL
        OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>1 OR p_capture ? 'receipts')) THEN
      RAISE EXCEPTION 'public resource checkpoint incomplete'; END IF;
    FOR v_family,observation IN SELECT entries.key,entries.value::uuid FROM jsonb_each_text(p_capture->'observations') entries LOOP
      IF v_family NOT IN ('league','rosters','users') OR NOT EXISTS(SELECT 1 FROM public.league_administration_observations observed
        JOIN public.league_administration_contents content ON content.id=observed.content_id
        WHERE observed.id=observation AND observed.league_season_id=season_id AND observed.family=v_family AND observed.week=0
          AND (v_family='league' OR observed.outcome IN ('changed','unchanged'))
          AND content.accepted AND content.completeness='complete' AND content.provider='sleeper'
          AND content.external_league_id=p_work->>'externalLeagueId') THEN RAISE EXCEPTION 'public resource lineage mismatch'; END IF;
    END LOOP;
    IF kind='core' THEN
      SELECT provenance->'acquisition' INTO acquisition FROM public.league_roster_capture_receipts
        WHERE id=(p_capture->'receipts'->>'settings')::uuid;
      FOREACH receipt_key IN ARRAY ARRAY['settings','players','managers'] LOOP
        wanted_receipt_id:=(p_capture->'receipts'->>receipt_key)::uuid;
        IF wanted_receipt_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
          JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
          JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
          JOIN public.league_roster_resource_scopes resource ON resource.id=attempt.scope_id
          JOIN public.league_roster_resource_heads head ON head.scope_id=resource.id AND head.accepted_id=accepted.id
          WHERE receipt.id=wanted_receipt_id AND accepted.source_mapping_revision_id=(mapping->>'revisionId')::uuid
            AND attempt.source_mapping=mapping AND attempt.write_fence=p_fence
            AND attempt.ordinal=head.latest_ordinal AND attempt.reserved_at>=dispatch_row.admitted_at
            AND public.roster_capture_provenance(receipt)->>'origin'='network'
            AND public.roster_capture_provenance(receipt)->'acquisition' IS NOT DISTINCT FROM acquisition
            AND CASE WHEN acquisition IS NULL THEN
              (public.roster_capture_provenance(receipt)->>'requestStartedAt')::timestamptz>=dispatch_row.admitted_at
              AND (public.roster_capture_provenance(receipt)->>'requestStartedAt')::timestamptz>=clock_timestamp()-interval '30 seconds'
              AND (public.roster_capture_provenance(receipt)->>'requestCompletedAt')::timestamptz BETWEEN
                (public.roster_capture_provenance(receipt)->>'requestStartedAt')::timestamptz AND clock_timestamp()
            ELSE public.public_capture_after_reservation(public.roster_capture_provenance(receipt),attempt.id)
              AND receipt.recorded_at BETWEEN attempt.reserved_at AND clock_timestamp()
              AND (public.roster_capture_provenance(receipt)->>'requestStartedAt')::timestamptz<=(public.roster_capture_provenance(receipt)->>'requestCompletedAt')::timestamptz END
            AND (public.roster_capture_provenance(receipt)->>'sourceObservedAt')::timestamptz=(public.roster_capture_provenance(receipt)->>'requestCompletedAt')::timestamptz
            AND receipt.coverage->>'completeness'='complete'
            AND receipt.legacy_observation_id=(p_capture->'observations'->>CASE WHEN receipt_key='settings' THEN 'league' ELSE 'rosters' END)::uuid
            AND resource.identity->'policy'->>'canonicalNormalizerVersion'=CASE receipt_key
              WHEN 'settings' THEN 'sleeper-league-settings-v1' WHEN 'players' THEN 'sleeper-current-players-v1'
              ELSE 'sleeper-current-team-managers-v1' END) THEN
          RAISE EXCEPTION 'current typed public resource receipt required';
        END IF;
      END LOOP;
    END IF;
    IF kind='users' THEN
      directory:=p_capture->'directoryCapture';
      acquisition:=directory->'acquisition';
      IF acquisition IS NOT NULL THEN
        PERFORM public.assert_public_data_capture_witness(acquisition,p_fence,'users',NULL,mapping);
      END IF;
      started:=(directory->>'requestStartedAt')::timestamptz;
      completed:=(directory->>'requestCompletedAt')::timestamptz;
      IF directory->>'family' IS DISTINCT FROM 'users' OR directory->'week' IS DISTINCT FROM 'null'::jsonb
        OR directory->>'origin' IS DISTINCT FROM 'network'
        OR COALESCE(directory->>'completeness','complete')<>'complete'
        OR started IS NULL OR completed IS NULL OR started>completed
        OR (acquisition IS NULL AND (completed>clock_timestamp()
          OR started<dispatch_row.admitted_at OR started<clock_timestamp()-interval '30 seconds'))
        OR COALESCE(directory->>'sourceObservedAt',directory->>'requestCompletedAt')::timestamptz IS DISTINCT FROM completed THEN
        RAISE EXCEPTION 'fresh dispatch-bound directory capture required';
      END IF;
      SELECT content.id INTO directory_content FROM public.league_administration_observations observed
        JOIN public.league_administration_contents content ON content.id=observed.content_id
        JOIN public.league_administration_heads head ON head.league_season_id=observed.league_season_id
          AND head.family='users' AND head.week=0 AND head.accepted_observation_id=observed.id
        WHERE observed.id=(p_capture->'observations'->>'users')::uuid AND observed.league_season_id=season_id
          AND observed.family='users' AND observed.week=0
          AND observed.outcome IN ('changed','unchanged') AND content.accepted AND content.completeness='complete'
          AND content.provider='sleeper' AND content.external_league_id=p_work->>'externalLeagueId'
          AND content.payload=directory->'payload' AND content.normalizer_version='sleeper-administration-v1'
          AND head.read_conflict IS NULL AND head.verified_at=completed AND head.ordering_at=completed;
      IF directory_content IS NULL THEN RAISE EXCEPTION 'directory capture content or freshness mismatch'; END IF;
      INSERT INTO public.public_data_directory_captures(intake_id,worker_id,generation,league_season_id,source_mapping,
        content_id,legacy_observation_id,request_started_at,request_completed_at,source_observed_at)
        VALUES(request_id,p_fence->>'workerId',(p_fence->>'generation')::integer,season_id,mapping,directory_content,
          (p_capture->'observations'->>'users')::uuid,started,completed,completed) RETURNING id INTO directory_capture_id;
    END IF;
    UPDATE public.public_data_league_candidates SET
      league_observation_id=coalesce((p_capture->'observations'->>'league')::uuid,league_observation_id),
      roster_observation_id=coalesce((p_capture->'observations'->>'rosters')::uuid,roster_observation_id),
      users_observation_id=coalesce((p_capture->'observations'->>'users')::uuid,users_observation_id),
      users_capture_id=coalesce(directory_capture_id,users_capture_id),
      settings_receipt_id=coalesce((p_capture->'receipts'->>'settings')::uuid,settings_receipt_id),
      players_receipt_id=coalesce((p_capture->'receipts'->>'players')::uuid,players_receipt_id),
      managers_receipt_id=coalesce((p_capture->'receipts'->>'managers')::uuid,managers_receipt_id),
      stage=CASE WHEN kind='core' THEN 'users' ELSE 'complete' END
      WHERE intake_id=request_id AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
  ELSE RAISE EXCEPTION 'invalid public checkpoint kind'; END IF;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
  IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
    UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id;
  END IF;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome,capture_acquisition)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed',acquisition);
END; $$;

CREATE OR REPLACE FUNCTION public.reconcile_public_data_resource_request(p_request uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE occurrence public.public_data_resource_occurrences%ROWTYPE; resource public.public_data_resources%ROWTYPE;
  request public.public_data_intakes%ROWTYPE; receipt_id uuid; observed_at timestamptz;
  bracket public.public_data_bracket_checkpoints%ROWTYPE; paired_receipt uuid; paired_at timestamptz;
  cadence interval:=interval '4 minutes';
BEGIN
 SELECT * INTO occurrence FROM public.public_data_resource_occurrences WHERE id=p_request;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=p_request;
 SELECT * INTO STRICT resource FROM public.public_data_resources WHERE id=occurrence.resource_id FOR UPDATE;
 IF resource.open_intake_id IS DISTINCT FROM p_request THEN RETURN; END IF;
 IF public.next_public_data_intake(p_request)='"complete"'::jsonb THEN
   IF resource.kind='playoff-brackets' THEN
     SELECT * INTO STRICT bracket FROM public.public_data_bracket_checkpoints WHERE intake_id=p_request AND task_ordinal=1;
     IF bracket.source_mapping IS DISTINCT FROM resource.source_mapping THEN RAISE EXCEPTION 'bracket resource mapping changed'; END IF;
     -- Both immutable accepted receipts must belong to the SAME committed paired
     -- dispatch. The older successful observation bounds the whole resource age.
     FOREACH paired_receipt IN ARRAY ARRAY[bracket.winners_bracket_receipt_id,bracket.losers_bracket_receipt_id] LOOP
       SELECT (receipt.provenance->>'sourceObservedAt')::timestamptz INTO STRICT paired_at
         FROM public.league_roster_capture_receipts receipt
         JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
         JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
         JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
           AND dispatch.generation=(attempt.write_fence->>'generation')::integer
         JOIN public.public_data_dispatch_outcomes outcome ON outcome.worker_id=dispatch.worker_id
           AND outcome.generation=dispatch.generation AND outcome.outcome='checkpoint-committed'
         WHERE receipt.id=paired_receipt AND attempt.source_mapping=resource.source_mapping
           AND dispatch.worker_id=bracket.worker_id AND dispatch.generation=bracket.generation
           AND dispatch.intake_id=p_request AND dispatch.resource='playoff-brackets' AND dispatch.max_requests=2
           AND scope.identity->'scope'->>'family'='playoff-brackets'
           AND scope.identity->'scope'->>'entityId'=CASE WHEN paired_receipt=bracket.winners_bracket_receipt_id
             THEN 'winners_bracket' ELSE 'losers_bracket' END
           AND receipt.provenance->'acquisition'=outcome.capture_acquisition
           AND receipt.provenance->>'origin'='network'
           AND receipt.provenance->>'sourceObservedAt'=receipt.provenance->>'requestCompletedAt';
       IF paired_at IS NULL OR NOT isfinite(paired_at) OR paired_at>clock_timestamp() THEN
         RAISE EXCEPTION 'paired bracket successful source clocks required'; END IF;
       IF observed_at IS NULL OR paired_at<observed_at THEN observed_at:=paired_at; receipt_id:=paired_receipt; END IF;
     END LOOP;
     cadence:=interval '12 minutes';
   ELSE
   IF resource.kind='core' THEN SELECT players_receipt_id INTO receipt_id FROM public.public_data_league_candidates WHERE intake_id=p_request;
   ELSIF resource.kind='exact-matchups' THEN SELECT matchups_receipt_id INTO receipt_id FROM public.public_data_exact_period_checkpoints WHERE intake_id=p_request AND task_ordinal=1;
   ELSE SELECT transaction_receipt_id INTO receipt_id FROM public.public_data_transaction_checkpoints WHERE intake_id=p_request AND task_ordinal=1; END IF;
   SELECT (public.roster_capture_provenance(receipt)->>'sourceObservedAt')::timestamptz INTO STRICT observed_at FROM public.league_roster_capture_receipts receipt
     JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
     JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
       AND dispatch.generation=(attempt.write_fence->>'generation')::integer AND dispatch.intake_id=p_request
     JOIN public.public_data_dispatch_outcomes outcome ON outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation AND outcome.outcome='checkpoint-committed'
     WHERE receipt.id=receipt_id AND attempt.source_mapping=resource.source_mapping AND public.roster_capture_provenance(receipt)->>'origin'='network'
       AND public.roster_capture_provenance(receipt)->>'sourceObservedAt'=public.roster_capture_provenance(receipt)->>'requestCompletedAt';
   END IF;
   IF observed_at IS NULL OR NOT isfinite(observed_at) OR observed_at>clock_timestamp() THEN RAISE EXCEPTION 'resource successful source clock required'; END IF;
   UPDATE public.public_data_resources SET last_success_at=observed_at,last_success_receipt_id=receipt_id,
     due_at=observed_at+cadence,next_eligible_at=clock_timestamp(),failure_count=0,open_intake_id=NULL WHERE id=resource.id;
 ELSIF request.terminal THEN
   UPDATE public.public_data_resources SET open_intake_id=NULL,failure_count=least(7,failure_count+1),
     next_eligible_at=clock_timestamp()+interval '60 seconds' WHERE id=resource.id;
 ELSE
   UPDATE public.public_data_resources SET next_eligible_at=request.next_attempt_at,failure_count=least(7,request.failure_count) WHERE id=resource.id;
 END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.public_data_settled_capture_upper_bound(
  p_dispatch public.public_data_dispatches,p_outcome public.public_data_dispatch_outcomes)
RETURNS timestamptz LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE acquisition jsonb:=p_outcome.capture_acquisition; fence jsonb; kind text:=p_dispatch.resource;
  role_names text[]; role_name text; expected_attempt jsonb; captures jsonb:='[]'::jsonb; captured jsonb;
  attempt_row public.league_roster_resource_attempts%ROWTYPE; receipt_row public.league_roster_capture_receipts%ROWTYPE;
  identity_row public.public_data_identity_observations%ROWTYPE; list_row public.public_data_league_lists%ROWTYPE;
  candidate_row public.public_data_league_candidates%ROWTYPE; directory_row public.public_data_directory_captures%ROWTYPE;
  accepted_time timestamptz; started_time timestamptz; completed_time timestamptz; checked_time timestamptz;
  observed_time timestamptz; upper_bound timestamptz; reserved_time timestamptz; recorded_time timestamptz;
BEGIN
  IF p_dispatch.request_budget_policy IS DISTINCT FROM 'public-data-settled-request-budget-v1'
    OR p_outcome.outcome IS DISTINCT FROM 'checkpoint-committed'
    OR p_outcome.worker_id IS DISTINCT FROM p_dispatch.worker_id OR p_outcome.generation IS DISTINCT FROM p_dispatch.generation
    OR p_dispatch.admitted_at IS NULL OR NOT isfinite(p_dispatch.admitted_at)
    OR p_outcome.recorded_at IS NULL OR NOT isfinite(p_outcome.recorded_at)
    OR p_outcome.recorded_at<p_dispatch.admitted_at OR p_outcome.recorded_at>clock_timestamp()
    OR jsonb_typeof(acquisition) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(acquisition))<>6
    OR NOT(acquisition ?& ARRAY['version','work','fence','dispatchNonce','mapping','attempts'])
    OR acquisition->>'version' IS DISTINCT FROM 'public-network-capture-v1'
    OR acquisition->'work' IS DISTINCT FROM p_dispatch.work
    OR acquisition->>'dispatchNonce' IS DISTINCT FROM p_dispatch.capture_nonce::text
    OR p_dispatch.capture_nonce IS NULL
    OR p_dispatch.work->>'requestId' IS DISTINCT FROM p_dispatch.intake_id::text
    OR p_dispatch.work->>'revision' IS DISTINCT FROM p_dispatch.revision::text
    OR p_dispatch.work->>'kind' IS DISTINCT FROM kind
    OR p_dispatch.max_requests IS DISTINCT FROM (CASE WHEN kind IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END)
    THEN RETURN NULL; END IF;
  fence:=acquisition->'fence';
  IF jsonb_typeof(fence) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(fence))<>4
    OR NOT(fence ?& ARRAY['jobKey','workerId','generation','deadlineAt'])
    OR fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake'
    OR fence->>'workerId' IS DISTINCT FROM p_dispatch.worker_id
    OR fence->>'generation' IS DISTINCT FROM p_dispatch.generation::text
    OR jsonb_typeof(fence->'deadlineAt') IS DISTINCT FROM 'string'
    OR NOT isfinite((fence->>'deadlineAt')::timestamptz)
    OR (fence->>'deadlineAt')::timestamptz<=p_dispatch.admitted_at
    OR (fence->>'deadlineAt')::timestamptz>p_dispatch.admitted_at+interval '20 seconds'
    OR jsonb_typeof(acquisition->'attempts') IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  role_names:=CASE kind
    WHEN 'core' THEN CASE WHEN acquisition->'attempts' ? 'managersV2' THEN ARRAY['settings','players','managers','managersV2'] ELSE ARRAY['settings','players','managers'] END
    WHEN 'exact-matchups' THEN ARRAY['settings','matchups']
    WHEN 'playoff-brackets' THEN ARRAY['winners_bracket','losers_bracket']
    WHEN 'weekly-report' THEN ARRAY['weekly_report'] WHEN 'transactions' THEN ARRAY['transactions']
    WHEN 'drafts' THEN ARRAY[CASE WHEN p_dispatch.work->>'resource' IN ('catalog','detail') THEN 'draftMetadata'
      WHEN p_dispatch.work->>'resource'='selections' THEN 'draftSelections'
      WHEN p_dispatch.work->>'resource' IN ('league-trades','draft-trades') THEN 'tradedPicks' ELSE NULL END]
    WHEN 'identity' THEN ARRAY[]::text[] WHEN 'leagues' THEN ARRAY[]::text[]
    WHEN 'bootstrap' THEN ARRAY[]::text[] WHEN 'users' THEN ARRAY[]::text[] ELSE NULL END;
  IF role_names IS NULL OR array_position(role_names,NULL) IS NOT NULL
    OR (SELECT count(*) FROM jsonb_object_keys(acquisition->'attempts'))<>cardinality(role_names)
    OR NOT(acquisition->'attempts' ?& role_names)
    OR (SELECT count(DISTINCT value->>'id') FROM jsonb_each(acquisition->'attempts'))<>cardinality(role_names)
    OR (SELECT count(DISTINCT value->>'nonce') FROM jsonb_each(acquisition->'attempts'))<>cardinality(role_names)
    OR (SELECT count(*) FROM public.league_roster_resource_attempts attempt WHERE attempt.write_fence=fence)<>cardinality(role_names)
    THEN RETURN NULL; END IF;
  upper_bound:=greatest(p_dispatch.admitted_at,p_outcome.recorded_at);
  IF cardinality(role_names)>0 THEN
    IF jsonb_typeof(acquisition->'mapping') IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
    FOREACH role_name IN ARRAY role_names LOOP
      expected_attempt:=acquisition->'attempts'->role_name;
      IF jsonb_typeof(expected_attempt) IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(expected_attempt))<>2
        OR NOT(expected_attempt ?& ARRAY['id','nonce']) THEN RETURN NULL; END IF;
      SELECT * INTO attempt_row FROM public.league_roster_resource_attempts WHERE id=(expected_attempt->>'id')::uuid;
      IF NOT FOUND OR attempt_row.write_fence IS DISTINCT FROM fence
        OR attempt_row.capture_nonce::text IS DISTINCT FROM expected_attempt->>'nonce'
        OR attempt_row.source_mapping IS DISTINCT FROM acquisition->'mapping' THEN RETURN NULL; END IF;
      SELECT * INTO receipt_row FROM public.league_roster_capture_receipts WHERE attempt_id=attempt_row.id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      receipt_row.provenance:=public.roster_capture_provenance(receipt_row);
      IF receipt_row.provenance->>'origin' IS DISTINCT FROM 'network'
        OR receipt_row.provenance->'acquisition' IS DISTINCT FROM acquisition THEN RETURN NULL; END IF;
      SELECT accepted_at INTO accepted_time FROM public.league_roster_resource_acceptances
        WHERE receipt_id=receipt_row.id AND source_mapping_revision_id=(acquisition->'mapping'->>'revisionId')::uuid;
      IF NOT FOUND OR accepted_time IS NULL OR NOT isfinite(accepted_time)
        OR accepted_time<receipt_row.recorded_at OR accepted_time>p_outcome.recorded_at THEN RETURN NULL; END IF;
      captures:=captures||jsonb_build_array(jsonb_build_object('started',receipt_row.provenance->>'requestStartedAt',
        'completed',receipt_row.provenance->>'requestCompletedAt','observed',receipt_row.provenance->>'sourceObservedAt',
        'checked',receipt_row.provenance->>'checkedAt','reserved',attempt_row.reserved_at,'recorded',receipt_row.recorded_at));
      upper_bound:=greatest(upper_bound,accepted_time);
    END LOOP;
  ELSIF kind='identity' THEN
    IF acquisition->'mapping' IS DISTINCT FROM 'null'::jsonb THEN RETURN NULL; END IF;
    SELECT * INTO identity_row FROM public.public_data_identity_observations WHERE intake_id=p_dispatch.intake_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    captures:=jsonb_build_array(jsonb_build_object('started',identity_row.request_started_at,'completed',identity_row.request_completed_at,
      'observed',identity_row.request_completed_at,'checked',identity_row.request_completed_at,'reserved',p_dispatch.admitted_at,'recorded',p_outcome.recorded_at));
  ELSIF kind='leagues' THEN
    IF acquisition->'mapping' IS DISTINCT FROM 'null'::jsonb THEN RETURN NULL; END IF;
    SELECT * INTO list_row FROM public.public_data_league_lists WHERE intake_id=p_dispatch.intake_id AND season=(p_dispatch.work->>'season')::integer;
    IF NOT FOUND THEN RETURN NULL; END IF;
    captures:=jsonb_build_array(jsonb_build_object('started',list_row.request_started_at,'completed',list_row.request_completed_at,
      'observed',list_row.request_completed_at,'checked',list_row.request_completed_at,'reserved',p_dispatch.admitted_at,'recorded',p_outcome.recorded_at));
  ELSIF kind='bootstrap' THEN
    IF acquisition->'mapping' IS DISTINCT FROM 'null'::jsonb THEN RETURN NULL; END IF;
    SELECT * INTO candidate_row FROM public.public_data_league_candidates WHERE intake_id=p_dispatch.intake_id
      AND season=(p_dispatch.work->>'season')::integer AND external_league_id=p_dispatch.work->>'externalLeagueId';
    IF NOT FOUND OR candidate_row.bootstrap_payload IS NULL THEN RETURN NULL; END IF;
    captures:=jsonb_build_array(jsonb_build_object('started',candidate_row.bootstrap_started_at,'completed',candidate_row.bootstrap_completed_at,
      'observed',candidate_row.bootstrap_completed_at,'checked',candidate_row.bootstrap_completed_at,'reserved',p_dispatch.admitted_at,'recorded',p_outcome.recorded_at));
  ELSIF kind='users' THEN
    SELECT * INTO directory_row FROM public.public_data_directory_captures
      WHERE worker_id=p_dispatch.worker_id AND generation=p_dispatch.generation AND intake_id=p_dispatch.intake_id;
    IF NOT FOUND OR directory_row.source_mapping IS DISTINCT FROM acquisition->'mapping'
      OR directory_row.source_mapping->'scope'->>'externalLeagueId' IS DISTINCT FROM p_dispatch.work->>'externalLeagueId'
      THEN RETURN NULL; END IF;
    captures:=jsonb_build_array(jsonb_build_object('started',directory_row.request_started_at,'completed',directory_row.request_completed_at,
      'observed',directory_row.source_observed_at,'checked',directory_row.request_completed_at,'reserved',p_dispatch.admitted_at,'recorded',directory_row.recorded_at));
  ELSE RETURN NULL;
  END IF;
  -- Source and SQL clocks are retained independently. Compare each clock domain's
  -- order; the maximum across both domains is conservative without assuming zero skew.
  FOR captured IN SELECT value FROM jsonb_array_elements(captures) LOOP
    started_time:=(captured->>'started')::timestamptz; completed_time:=(captured->>'completed')::timestamptz;
    observed_time:=(captured->>'observed')::timestamptz; checked_time:=(captured->>'checked')::timestamptz;
    reserved_time:=(captured->>'reserved')::timestamptz; recorded_time:=(captured->>'recorded')::timestamptz;
    IF started_time IS NULL OR completed_time IS NULL OR observed_time IS NULL OR checked_time IS NULL
      OR reserved_time IS NULL OR recorded_time IS NULL
      OR NOT isfinite(started_time) OR NOT isfinite(completed_time) OR NOT isfinite(observed_time) OR NOT isfinite(checked_time)
      OR NOT isfinite(reserved_time) OR NOT isfinite(recorded_time)
      OR started_time>completed_time OR observed_time IS DISTINCT FROM completed_time OR checked_time<completed_time
      OR reserved_time<p_dispatch.admitted_at OR recorded_time<reserved_time OR recorded_time>p_outcome.recorded_at
      THEN RETURN NULL; END IF;
    upper_bound:=greatest(upper_bound,completed_time,checked_time,reserved_time,recorded_time);
  END LOOP;
  IF jsonb_array_length(captures)=0 THEN RETURN NULL; END IF;
  RETURN upper_bound;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RETURN NULL; -- Malformed retained clocks/identities never shorten a reservation.
END; $$;

-- BEGIN OPTIONAL ROSTER PROVENANCE CONTENT GRANTS
DO $$ DECLARE role_name text; helper text; accessor text:='public.roster_capture_provenance(public.league_roster_capture_receipts)';
  denied text:='INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'; BEGIN
  IF current_setting('server_version_num')::integer>=170000 THEN denied:=denied||',MAINTAIN'; END IF;
  IF to_regclass('public.league_roster_provenance_contents') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.league_roster_provenance_contents FROM PUBLIC;
    FOREACH helper IN ARRAY ARRAY['public.validate_roster_provenance_content()','public.intern_roster_capture_provenance()'] LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
      FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
          EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,role_name);
          IF has_function_privilege(role_name,helper,'EXECUTE') THEN RAISE EXCEPTION 'restricted role can execute private roster provenance helper'; END IF;
        END IF;
      END LOOP;
    END LOOP;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',accessor);
    FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.league_roster_provenance_contents FROM %I',role_name);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',accessor,role_name);
        IF role_name='league_one_runtime' THEN
          GRANT SELECT ON TABLE public.league_roster_provenance_contents TO league_one_runtime;
          EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO league_one_runtime',accessor);
          IF NOT has_table_privilege(role_name,'public.league_roster_provenance_contents','SELECT')
            OR NOT has_function_privilege(role_name,accessor,'EXECUTE') THEN RAISE EXCEPTION 'runtime cannot read roster provenance content'; END IF;
        ELSIF has_table_privilege(role_name,'public.league_roster_provenance_contents','SELECT')
          OR has_function_privilege(role_name,accessor,'EXECUTE') THEN RAISE EXCEPTION 'account role can read roster provenance content'; END IF;
        IF has_table_privilege(role_name,'public.league_roster_provenance_contents',denied)
          OR has_any_column_privilege(role_name,'public.league_roster_provenance_contents','INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'restricted role can write roster provenance content'; END IF;
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_proc function_entry,
      LATERAL aclexplode(COALESCE(function_entry.proacl,acldefault('f',function_entry.proowner))) privilege
      WHERE function_entry.oid IN (to_regprocedure(accessor),to_regprocedure('public.validate_roster_provenance_content()'),
        to_regprocedure('public.intern_roster_capture_provenance()')) AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'public can execute roster provenance function'; END IF;
  END IF;
END; $$;
-- END OPTIONAL ROSTER PROVENANCE CONTENT GRANTS

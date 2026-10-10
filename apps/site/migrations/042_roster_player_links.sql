-- CP6 extends the existing accepted roster owner. No backfill or v1 receipt/hash changes.
-- One shared identity writer; the TypeScript legacy statements remain only for pre-042 schemas.
CREATE FUNCTION public.scoring_identity_uuid(p_scope text,p_key text)
RETURNS uuid LANGUAGE plpgsql STABLE STRICT PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE hash_value text; variant text;
BEGIN
  hash_value:=substr(encode(digest(convert_to(p_scope,'UTF8')||decode('00','hex')||convert_to(p_key,'UTF8'),'sha256'),'hex'),1,32);
  variant:=substr('89ab',(strpos('0123456789abcdef',substr(hash_value,17,1))-1)%4+1,1);
  RETURN (substr(hash_value,1,8)||'-'||substr(hash_value,9,4)||'-5'||substr(hash_value,14,3)||'-'||variant||substr(hash_value,18,3)||'-'||substr(hash_value,21,12))::uuid;
END; $$;

CREATE FUNCTION public.upsert_scoring_entity_identities(p_inputs jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE written_count bigint; resolved_rows jsonb; resolved_at_value timestamptz;
BEGIN
  IF jsonb_typeof(p_inputs) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid scoring identity input'; END IF;
  IF jsonb_array_length(p_inputs)=0 THEN RETURN jsonb_build_object('evaluatedAt',clock_timestamp(),'rows','[]'::jsonb); END IF;
  -- These are the existing prepared identity inputs, not caller assertions of a resolved crosswalk.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_inputs) AS input_item(value)
    WHERE jsonb_typeof(input_item.value) IS DISTINCT FROM 'object'
      OR input_item.value->>'kind' NOT IN ('player','team_defense') OR input_item.value->>'kind' IS NULL
      OR jsonb_typeof(input_item.value->'ordinal') IS DISTINCT FROM 'number'
      OR (input_item.value->>'ordinal') !~ '^(0|[1-9][0-9]*)$' OR (input_item.value->>'ordinal')::numeric>2147483647
      OR jsonb_typeof(input_item.value->'input_key') IS DISTINCT FROM 'string' OR btrim(input_item.value->>'input_key')=''
      OR jsonb_typeof(input_item.value->'display_name') IS DISTINCT FROM 'string' OR btrim(input_item.value->>'display_name')=''
      OR (input_item.value->>'proposed_id')::uuid IS DISTINCT FROM public.scoring_identity_uuid('scoring-entity:'||(input_item.value->>'kind'),input_item.value->>'input_key')
      OR jsonb_typeof(input_item.value->'provider_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(input_item.value->'provider_ids')=0)
    OR (SELECT count(*) FROM jsonb_array_elements(p_inputs) AS input_item(value))<>(SELECT count(DISTINCT input_item.value->>'input_key') FROM jsonb_array_elements(p_inputs) AS input_item(value))
    OR (SELECT count(*) FROM jsonb_array_elements(p_inputs) AS input_item(value))<>(SELECT count(DISTINCT input_item.value->>'ordinal') FROM jsonb_array_elements(p_inputs) AS input_item(value))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_inputs) AS input_item(value) CROSS JOIN LATERAL jsonb_array_elements(input_item.value->'provider_ids') AS provider_id(value)
      WHERE jsonb_typeof(provider_id.value->'provider') IS DISTINCT FROM 'string' OR btrim(provider_id.value->>'provider')=''
        OR jsonb_typeof(provider_id.value->'external_id') IS DISTINCT FROM 'string' OR btrim(provider_id.value->>'external_id')='')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_inputs) AS input_item(value) CROSS JOIN LATERAL jsonb_array_elements(input_item.value->'provider_ids') AS provider_id(value)
      GROUP BY provider_id.value->>'provider',input_item.value->>'kind',provider_id.value->>'external_id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'invalid or duplicate scoring identity input';
  END IF;
  -- Serialize shared provider identities across kinds; all callers use a stable lock order.
  PERFORM pg_advisory_xact_lock(hashtextextended('scoring-native:'||jsonb_build_array(keys.provider,keys.external_id)::text,0))
    FROM (SELECT DISTINCT (provider_id.value->>'provider') COLLATE "C" AS provider,(provider_id.value->>'external_id') COLLATE "C" AS external_id
      FROM jsonb_array_elements(p_inputs) AS input_item(value) CROSS JOIN LATERAL jsonb_array_elements(input_item.value->'provider_ids') AS provider_id(value)
      ORDER BY provider,external_id) keys;
  WITH input AS (
          SELECT * FROM jsonb_to_recordset(p_inputs) AS value(
            ordinal integer, proposed_id uuid, input_key text, kind text,
            display_name text, nfl_team text, preserve_existing_metadata boolean,
            provider_ids jsonb
          )
        ), expanded AS (
          SELECT input.*, ids.provider, ids.external_id
          FROM input
          CROSS JOIN LATERAL jsonb_to_recordset(input.provider_ids) AS ids(
            provider text, external_id text
          )
        ), existing AS (
          SELECT expanded.ordinal,
            COALESCE(array_agg(DISTINCT mapping.scoring_entity_id)
              FILTER (WHERE mapping.scoring_entity_id IS NOT NULL), '{}'::uuid[]) AS entity_ids,
            COALESCE(bool_or(mapping.scoring_entity_id IS NOT NULL AND (
              mapping.mapping_status <> 'verified' OR mapping.valid_from > statement_timestamp()
              OR mapping.valid_to <= statement_timestamp() OR entity.kind <> expanded.kind
            )), false) AS unusable
          FROM expanded
          LEFT JOIN external_scoring_entity_ids mapping
            ON mapping.provider = expanded.provider
            AND mapping.entity_kind = expanded.kind
            AND mapping.external_id = expanded.external_id
          LEFT JOIN scoring_entities entity ON entity.id = mapping.scoring_entity_id
          GROUP BY expanded.ordinal
        ), proposed_targets AS (
          SELECT input.*,
            CASE
              WHEN cardinality(existing.entity_ids) = 1 THEN existing.entity_ids[1]
              ELSE input.proposed_id
            END AS target_id,
            cardinality(existing.entity_ids) > 1 OR existing.unusable AS conflict
          FROM input JOIN existing USING (ordinal)
        ), targets AS (
          SELECT proposed_targets.*,
            count(*) OVER (PARTITION BY target_id) > 1 AS target_collision
          FROM proposed_targets
        ), upserted_entities AS (
          INSERT INTO scoring_entities (id, kind, display_name, nfl_team)
          SELECT DISTINCT ON (target_id) target_id, kind, display_name, nfl_team
          FROM targets WHERE NOT conflict AND NOT target_collision
          ORDER BY target_id, ordinal
          ON CONFLICT (id) DO UPDATE SET
            display_name = CASE WHEN EXISTS (
              SELECT 1 FROM targets target
              WHERE target.target_id = EXCLUDED.id AND target.preserve_existing_metadata
            ) THEN scoring_entities.display_name ELSE EXCLUDED.display_name END,
            nfl_team = CASE WHEN EXISTS (
              SELECT 1 FROM targets target
              WHERE target.target_id = EXCLUDED.id AND target.preserve_existing_metadata
            ) THEN scoring_entities.nfl_team ELSE EXCLUDED.nfl_team END,
            updated_at = now()
          RETURNING id
        ), inserted_mappings AS (
          INSERT INTO external_scoring_entity_ids
            (provider, entity_kind, external_id, scoring_entity_id)
          SELECT expanded.provider, expanded.kind, expanded.external_id, targets.target_id
          FROM expanded
          JOIN targets USING (ordinal)
          JOIN upserted_entities ON upserted_entities.id = targets.target_id
          WHERE NOT targets.conflict AND NOT targets.target_collision
          ON CONFLICT (provider, entity_kind, external_id) DO NOTHING
          RETURNING scoring_entity_id
        )
        SELECT count(*) INTO written_count FROM inserted_mappings;

  -- Preserve the old fresh resolve command's post-wait validity instant. Internal
  -- statement_timestamp() would still be the outer call start after contention.
  resolved_at_value:=clock_timestamp();
  -- A separate VOLATILE statement obtains the post-conflict READ COMMITTED snapshot.
  SELECT COALESCE(jsonb_agg(to_jsonb(result) ORDER BY input_order.ordinal),'[]'::jsonb) INTO resolved_rows FROM (
    WITH input AS (
          SELECT * FROM jsonb_to_recordset(p_inputs) AS value(
            ordinal integer, proposed_id uuid, input_key text, kind text,
            display_name text, nfl_team text, provider_ids jsonb
          )
        ), expanded AS (
          SELECT input.ordinal, input.input_key, input.proposed_id,
            ids.provider, input.kind, ids.external_id
          FROM input
          CROSS JOIN LATERAL jsonb_to_recordset(input.provider_ids) AS ids(
            provider text, external_id text
          )
        ), resolved AS (
          SELECT expanded.ordinal, expanded.input_key, expanded.proposed_id,
            COALESCE(array_agg(DISTINCT mapping.scoring_entity_id)
              FILTER (WHERE mapping.scoring_entity_id IS NOT NULL), '{}'::uuid[]) AS entity_ids,
            COALESCE(bool_or(mapping.scoring_entity_id IS NULL
              OR mapping.mapping_status <> 'verified' OR mapping.valid_from > resolved_at_value
              OR mapping.valid_to <= resolved_at_value OR entity.kind <> expanded.kind
            ), false) AS unusable
          FROM expanded
          LEFT JOIN external_scoring_entity_ids mapping
            ON mapping.provider = expanded.provider
            AND mapping.entity_kind = expanded.kind
            AND mapping.external_id = expanded.external_id
          LEFT JOIN scoring_entities entity ON entity.id = mapping.scoring_entity_id
          GROUP BY expanded.ordinal, expanded.input_key, expanded.proposed_id
        ), validated AS (
          SELECT resolved.*, cardinality(entity_ids) > 1 OR unusable
            OR (cardinality(entity_ids) = 1
              AND count(*) OVER (PARTITION BY entity_ids[1]) > 1) AS conflict
          FROM resolved
        )
        SELECT input_key,
          CASE WHEN cardinality(entity_ids) = 1 AND NOT conflict THEN entity_ids[1] END AS entity_id,
          conflict,
          proposed_id
        FROM validated ORDER BY ordinal
  ) result JOIN jsonb_to_recordset(p_inputs) AS input_order(input_key text,ordinal integer) ON input_order.input_key=result.input_key;

  -- Preserve proposed-ID orphan cleanup while retaining identities referenced by immutable CP6 history.
  DELETE FROM public.scoring_entities entity
    WHERE entity.id IN (SELECT (resolved_item.value->>'proposed_id')::uuid FROM jsonb_array_elements(resolved_rows) AS resolved_item(value)
      WHERE resolved_item.value->>'entity_id' IS DISTINCT FROM resolved_item.value->>'proposed_id')
      AND NOT EXISTS(SELECT 1 FROM public.external_scoring_entity_ids mapping WHERE mapping.scoring_entity_id=entity.id)
      AND NOT EXISTS(SELECT 1 FROM public.league_roster_player_links historical WHERE historical.canonical_entity_id=entity.id);
  RETURN jsonb_build_object('evaluatedAt',resolved_at_value,'rows',resolved_rows);
END; $$;

CREATE TABLE public.league_roster_player_link_receipts (
  roster_acceptance_id uuid PRIMARY KEY REFERENCES public.league_roster_resource_acceptances(id),
  roster_receipt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_capture_receipts(id),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  source_mapping_revision_id uuid NOT NULL REFERENCES public.league_source_mapping_revisions(id),
  roster_content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  link_version text NOT NULL CHECK(link_version='sleeper-roster-player-links-v1'),
  directory_version_id uuid REFERENCES public.league_player_directory_versions(id),
  resolved_at timestamptz NOT NULL,
  mapping_evaluated_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('complete','partial','capacity_exceeded','owner_unqualified')),
  reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array'),
  held_count integer NOT NULL CHECK(held_count>=0),team_count integer NOT NULL CHECK(team_count>=0),
  resolved_count integer NOT NULL CHECK(resolved_count>=0),unresolved_count integer NOT NULL CHECK(unresolved_count>=0),
  conflict_count integer NOT NULL CHECK(conflict_count>=0),
  CHECK(held_count=resolved_count+unresolved_count+conflict_count)
);
CREATE TABLE public.league_roster_player_links (
  roster_acceptance_id uuid NOT NULL REFERENCES public.league_roster_player_link_receipts(roster_acceptance_id),
  season_team_id uuid NOT NULL REFERENCES public.league_season_teams(id),
  external_roster_id text NOT NULL,native_player_id text NOT NULL,
  native_player_id_hash text GENERATED ALWAYS AS (encode(digest(native_player_id,'sha256'),'hex')) STORED,
  membership_ordinal integer NOT NULL CHECK(membership_ordinal>0),
  entity_kind text CHECK(entity_kind IN ('player','team_defense')),
  identity_state text NOT NULL CHECK(identity_state IN ('resolved','unresolved','conflict')),
  reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array'),
  directory_identity_status text NOT NULL CHECK(directory_identity_status IN ('valid','invalid','conflict','missing')),
  kind_evidence jsonb CHECK(kind_evidence IS NULL OR jsonb_typeof(kind_evidence)='object'),
  canonical_entity_id uuid REFERENCES public.scoring_entities(id),
  mapping_proof jsonb NOT NULL CHECK(jsonb_typeof(mapping_proof)='array' AND jsonb_array_length(mapping_proof)<=2),
  PRIMARY KEY(roster_acceptance_id,season_team_id,native_player_id_hash),
  UNIQUE(roster_acceptance_id,season_team_id,membership_ordinal),
  CHECK((identity_state='resolved')=(canonical_entity_id IS NOT NULL)),
  CHECK(identity_state<>'resolved' OR (entity_kind IS NOT NULL AND reasons='[]'::jsonb))
);
CREATE INDEX roster_player_link_canonical_history_idx ON public.league_roster_player_links(canonical_entity_id)
  WHERE canonical_entity_id IS NOT NULL;
CREATE TRIGGER roster_player_link_receipt_immutable BEFORE UPDATE OR DELETE ON public.league_roster_player_link_receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER roster_player_link_immutable BEFORE UPDATE OR DELETE ON public.league_roster_player_links
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

CREATE FUNCTION public.validate_roster_player_link_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='league_roster_player_link_receipts' THEN
    -- AFTER INSERT acceptance precedes the old owner's head update: bind NEW lineage directly.
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=accepted.scope_id
      WHERE accepted.id=NEW.roster_acceptance_id AND receipt.id=NEW.roster_receipt_id
        AND receipt.content_id=NEW.roster_content_id AND scope.league_season_id=NEW.league_season_id
        AND accepted.source_mapping_revision_id=NEW.source_mapping_revision_id
        AND scope.identity->'scope'->>'coverageSpecId'='sleeper-current-all-teams-players-v1') THEN
      RAISE EXCEPTION 'roster player link receipt lineage mismatch';
    END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_player_link_receipts header
      JOIN public.league_administration_team_entries entry ON entry.content_id=header.roster_content_id
        AND entry.team_id=NEW.season_team_id AND entry.league_season_id=header.league_season_id
      JOIN public.league_season_teams team ON team.id=entry.team_id AND team.league_season_id=header.league_season_id
      WHERE header.roster_acceptance_id=NEW.roster_acceptance_id AND header.outcome IN ('complete','partial')
        AND team.external_roster_id=NEW.external_roster_id
        AND entry.source_value->'playerExternalIds'->>(NEW.membership_ordinal-1)=NEW.native_player_id) THEN
      RAISE EXCEPTION 'roster player membership lineage mismatch';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER roster_player_link_receipt_lineage BEFORE INSERT ON public.league_roster_player_link_receipts
  FOR EACH ROW EXECUTE FUNCTION public.validate_roster_player_link_lineage();
CREATE TRIGGER roster_player_link_lineage BEFORE INSERT ON public.league_roster_player_links
  FOR EACH ROW EXECUTE FUNCTION public.validate_roster_player_link_lineage();

CREATE FUNCTION public.assert_roster_player_link_fence(p_fence jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_fence IS NULL OR NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'roster player link writer fence expired';
  END IF;
END; $$;

CREATE FUNCTION public.capture_roster_player_links()
RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope public.league_roster_resource_scopes%ROWTYPE;
  receipt public.league_roster_capture_receipts%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;
  content public.league_administration_contents%ROWTYPE;
  directory_version uuid; directory_content uuid;
  team_count_value integer; held_count_value integer; resolved_count_value integer:=0; conflict_count_value integer:=0;
  estimated_bytes numeric:=0; candidates jsonb:='[]'::jsonb; identity_inputs jsonb; owner_results jsonb;
  owner_result jsonb;
  links jsonb:='[]'::jsonb; outcome_value text; reasons_value jsonb:='[]'::jsonb;
  evaluated_at timestamptz:=statement_timestamp();
  js_whitespace text:=E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
BEGIN
  SELECT * INTO STRICT scope FROM public.league_roster_resource_scopes WHERE id=NEW.scope_id;
  IF scope.identity->'scope'->>'coverageSpecId' IS DISTINCT FROM 'sleeper-current-all-teams-players-v1' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts WHERE id=NEW.receipt_id;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=receipt.content_id;
  SELECT version.id,version.content_id INTO directory_version,directory_content
    FROM public.league_player_directory_heads head JOIN public.league_player_directory_versions version ON version.id=head.accepted_version_id
    WHERE head.provider='sleeper' AND head.sport='nfl';
  SELECT count(*)::integer,COALESCE(sum(jsonb_array_length(roster_team.value->'playerExternalIds')),0)::integer
    INTO team_count_value,held_count_value FROM jsonb_array_elements(content.normalized_value->'teams') AS roster_team(value);
  IF attempt.write_fence IS NULL THEN outcome_value:='owner_unqualified'; reasons_value:='["owner_unqualified"]'::jsonb;
  ELSE
    PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
    IF held_count_value>10000 OR team_count_value>1000 THEN outcome_value:='capacity_exceeded';
    ELSE
      -- Estimate before constructing a repeated snapshot or mutating canonical identities.
      -- Three JSON native-ID copies cover the link plus both possible mapping proofs;
      -- 2048 bytes/member covers bounded keys, UUIDs, timestamps and proof metadata.
      -- Kind facts are measured once per native ID and multiplied by actual membership count.
      SELECT COALESCE(sum(held.memberships*(2048+3*octet_length(to_jsonb(held.native_id)::text)
          +octet_length(COALESCE(jsonb_build_object('position',entry.position,'fantasyPositions',entry.fantasy_positions,
            'positionState',entry.field_states->'position','fantasyPositionsState',entry.field_states->'fantasy_positions')::text,'null'))))
        +COALESCE((SELECT sum(jsonb_array_length(roster_team.value->'playerExternalIds')*octet_length(to_jsonb(roster_team.value->>'externalRosterId')::text))
          FROM jsonb_array_elements(content.normalized_value->'teams') AS roster_team(value)),0),0)
        INTO estimated_bytes
      FROM (SELECT held_player.value#>>'{}' AS native_id,count(*) AS memberships
        FROM jsonb_array_elements(content.normalized_value->'teams') AS roster_team(value)
        CROSS JOIN LATERAL jsonb_array_elements(roster_team.value->'playerExternalIds') AS held_player(value) GROUP BY held_player.value#>>'{}') held
      LEFT JOIN public.league_player_directory_entries entry ON entry.content_id=directory_content
        AND entry.external_player_id_hash=encode(digest(held.native_id,'sha256'),'hex') AND entry.external_player_id=held.native_id;
      IF estimated_bytes>8388608 THEN outcome_value:='capacity_exceeded'; END IF;
    END IF;
    IF outcome_value='capacity_exceeded' THEN reasons_value:='["capacity_exceeded"]'::jsonb;
    ELSE
      -- Same native-key locks and order as the shared identity owner, never a directory-head lock.
      PERFORM pg_advisory_xact_lock(hashtextextended('scoring-native:'||jsonb_build_array('sleeper',held.native_id)::text,0))
        FROM (SELECT DISTINCT (held_player.value#>>'{}') COLLATE "C" AS native_id FROM jsonb_array_elements(content.normalized_value->'teams') AS roster_team(value)
          CROSS JOIN LATERAL jsonb_array_elements(roster_team.value->'playerExternalIds') AS held_player(value)
          WHERE length(held_player.value#>>'{}')<=256 ORDER BY native_id) held;
      PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
      WITH held AS (
        SELECT DISTINCT held_player.value#>>'{}' AS native_id FROM jsonb_array_elements(content.normalized_value->'teams') AS roster_team(value)
          CROSS JOIN LATERAL jsonb_array_elements(roster_team.value->'playerExternalIds') AS held_player(value)
      ), native AS (
        SELECT held.native_id,entry.identity_status,
          CASE WHEN octet_length(entry.full_name)<=1024 THEN entry.full_name END AS full_name,
          CASE WHEN octet_length(concat_ws(' ',entry.first_name,entry.last_name))<=1024 THEN concat_ws(' ',entry.first_name,entry.last_name) END AS combined_name,
          CASE WHEN octet_length(entry.team)<=64 THEN entry.team END AS team,
          CASE WHEN entry.external_player_id IS NULL THEN NULL ELSE jsonb_build_object('position',entry.position,
            'fantasyPositions',entry.fantasy_positions,'positionState',entry.field_states->'position',
            'fantasyPositionsState',entry.field_states->'fantasy_positions') END AS kind_evidence,
          CASE WHEN entry.external_player_id IS NOT NULL THEN
            (SELECT COALESCE(bool_or(translate(btrim(kind_clue.value,js_whitespace),'def','DEF')='DEF'),false) FROM unnest(ARRAY[entry.position]||COALESCE(entry.fantasy_positions,'{}'::text[])) AS kind_clue(value) WHERE btrim(kind_clue.value,js_whitespace)<>'') ELSE false END AS has_def,
          CASE WHEN entry.external_player_id IS NOT NULL THEN
            (SELECT COALESCE(bool_or(translate(btrim(kind_clue.value,js_whitespace),'def','DEF')<>'DEF'),false) FROM unnest(ARRAY[entry.position]||COALESCE(entry.fantasy_positions,'{}'::text[])) AS kind_clue(value) WHERE btrim(kind_clue.value,js_whitespace)<>'') ELSE false END AS has_player,
          -- Reuse CP5's exact native-ID validation, including UTF-16 and JS whitespace.
          CASE WHEN length(held.native_id)>256 THEN false ELSE
            NOT (public.player_directory_native_row(held.native_id,'{}'::jsonb)->'reasons' ? 'invalid-native-id') END AS valid_id
        FROM held LEFT JOIN public.league_player_directory_entries entry ON entry.content_id=directory_content
          AND entry.external_player_id_hash=encode(digest(held.native_id,'sha256'),'hex') AND entry.external_player_id=held.native_id
      ), classified AS (
        SELECT native.*,CASE WHEN has_def AND NOT has_player THEN 'team_defense' WHEN has_player AND NOT has_def THEN 'player' END AS entity_kind,
          CASE WHEN native_id='0' THEN 'vacancy_marker_not_player' WHEN NOT valid_id THEN 'native_player_id_invalid'
            WHEN directory_version IS NULL THEN 'directory_unavailable' WHEN identity_status IS NULL THEN 'directory_player_missing'
            WHEN identity_status='invalid' THEN 'directory_identity_invalid' WHEN identity_status='conflict' THEN 'directory_identity_conflict'
            WHEN has_def AND has_player THEN 'kind_conflict' WHEN NOT has_def AND NOT has_player THEN 'kind_unavailable' END AS native_reason
        FROM native
      ), decisions AS (
        SELECT classified.*,CASE WHEN native_reason IS NOT NULL THEN native_reason
          WHEN EXISTS(SELECT 1 FROM public.external_scoring_entity_ids mapping WHERE mapping.provider='sleeper'
            AND mapping.external_id=native_id AND mapping.entity_kind=CASE classified.entity_kind WHEN 'player' THEN 'team_defense' ELSE 'player' END) THEN 'canonical_kind_conflict'
          WHEN mapping.scoring_entity_id IS NOT NULL AND entity.kind IS DISTINCT FROM classified.entity_kind THEN 'canonical_identity_conflict' END AS reason
        FROM classified LEFT JOIN public.external_scoring_entity_ids mapping ON mapping.provider='sleeper'
          AND mapping.external_id=native_id AND mapping.entity_kind=classified.entity_kind
        LEFT JOIN public.scoring_entities entity ON entity.id=mapping.scoring_entity_id
      ) SELECT COALESCE(jsonb_agg(to_jsonb(decisions) ORDER BY native_id COLLATE "C"),'[]'::jsonb) INTO candidates FROM decisions;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('ordinal',candidate.ordinal-1,
        'proposed_id',public.scoring_identity_uuid('scoring-entity:'||(candidate.value->>'entity_kind'),
          (candidate.value->>'entity_kind')||':'||(candidate.value->>'native_id')),
        'input_key',(candidate.value->>'entity_kind')||':'||(candidate.value->>'native_id'),'kind',candidate.value->>'entity_kind',
        'display_name',COALESCE(NULLIF(btrim(candidate.value->>'full_name'),''),NULLIF(btrim(candidate.value->>'combined_name'),''),candidate.value->>'native_id'),
        'nfl_team',NULLIF(btrim(candidate.value->>'team'),''),'preserve_existing_metadata',true,
        'provider_ids',jsonb_build_array(jsonb_build_object('provider','sleeper','external_id',candidate.value->>'native_id')))
        ORDER BY candidate.ordinal),'[]'::jsonb) INTO identity_inputs
      FROM jsonb_array_elements(candidates) WITH ORDINALITY candidate(value,ordinal)
      WHERE candidate.value->>'reason' IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(content.payload) AS source_row(value)
        WHERE source_row.value->'players' ? (candidate.value->>'native_id') AND (NOT source_row.value ? 'league_id' OR source_row.value->'league_id'=to_jsonb(content.external_league_id)));
      owner_result:=public.upsert_scoring_entity_identities(identity_inputs);
      owner_results:=owner_result->'rows'; evaluated_at:=(owner_result->>'evaluatedAt')::timestamptz;
      PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
      WITH memberships AS (
        SELECT team.id AS season_team_id,team.external_roster_id,player.value#>>'{}' AS native_player_id,
          player.ordinal AS membership_ordinal,EXISTS(SELECT 1 FROM jsonb_array_elements(content.payload) AS source_row(value)
            WHERE source_row.value->>'roster_id'=team.external_roster_id AND source_row.value ? 'league_id'
              AND source_row.value->'league_id' IS DISTINCT FROM to_jsonb(content.external_league_id)) AS scope_conflict
        FROM public.league_administration_team_entries entry JOIN public.league_season_teams team ON team.id=entry.team_id
          AND team.league_season_id=entry.league_season_id
        CROSS JOIN LATERAL jsonb_array_elements(entry.source_value->'playerExternalIds') WITH ORDINALITY player(value,ordinal)
        WHERE entry.content_id=content.id AND entry.league_season_id=scope.league_season_id
          AND team.provider='sleeper' AND team.external_league_id=content.external_league_id
      ), enriched AS (
        SELECT memberships.*,candidate.value->>'entity_kind' AS entity_kind,COALESCE(candidate.value->>'identity_status','missing') AS directory_identity_status,
          NULLIF(candidate.value->'kind_evidence','null'::jsonb) AS kind_evidence,result.value->>'entity_id' AS resolved_id,
          CASE WHEN scope_conflict THEN 'roster_source_scope_conflict' WHEN candidate.value->>'reason' IS NOT NULL THEN candidate.value->>'reason'
            WHEN mapping.mapping_status='unverified' THEN 'canonical_mapping_unverified'
            WHEN mapping.mapping_status='retired' THEN 'canonical_mapping_retired'
            WHEN mapping.valid_from>evaluated_at THEN 'canonical_mapping_not_yet_valid'
            WHEN mapping.valid_to<=evaluated_at THEN 'canonical_mapping_expired'
            WHEN result.value->>'entity_id' IS NULL OR (result.value->>'conflict')::boolean THEN 'canonical_identity_conflict' END AS reason,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',mapping.provider,'entityKind',mapping.entity_kind,
            'externalId',mapping.external_id,'scoringEntityId',mapping.scoring_entity_id,'mappingStatus',mapping.mapping_status,
            'validFrom',mapping.valid_from,'validTo',mapping.valid_to,'canonicalKind',entity.kind) ORDER BY mapping.entity_kind)
            FROM public.external_scoring_entity_ids mapping JOIN public.scoring_entities entity ON entity.id=mapping.scoring_entity_id
            WHERE mapping.provider='sleeper' AND mapping.external_id=memberships.native_player_id
              AND mapping.entity_kind IN ('player','team_defense')),'[]'::jsonb) AS mapping_proof
        FROM memberships JOIN jsonb_array_elements(candidates) AS candidate(value) ON candidate.value->>'native_id'=memberships.native_player_id
        LEFT JOIN jsonb_array_elements(owner_results) AS result(value) ON result.value->>'input_key'=(candidate.value->>'entity_kind')||':'||memberships.native_player_id
        LEFT JOIN public.external_scoring_entity_ids mapping ON mapping.provider='sleeper' AND mapping.external_id=memberships.native_player_id
          AND mapping.entity_kind=candidate.value->>'entity_kind'
      ) SELECT COALESCE(jsonb_agg(jsonb_build_object('season_team_id',season_team_id,'external_roster_id',external_roster_id,
          'native_player_id',native_player_id,'membership_ordinal',membership_ordinal,'entity_kind',entity_kind,
          'directory_identity_status',directory_identity_status,'kind_evidence',kind_evidence,'mapping_proof',mapping_proof,
          'canonical_entity_id',CASE WHEN reason IS NULL THEN resolved_id END,
          'identity_state',CASE WHEN reason IS NULL THEN 'resolved' WHEN reason IN ('kind_conflict','directory_identity_conflict',
            'canonical_kind_conflict','canonical_identity_conflict','roster_source_scope_conflict') THEN 'conflict' ELSE 'unresolved' END,
          'reasons',CASE WHEN reason IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(reason) END)
          ORDER BY external_roster_id COLLATE "C",membership_ordinal),'[]'::jsonb) INTO links FROM enriched;
      IF jsonb_array_length(links)<>held_count_value THEN RAISE EXCEPTION 'incomplete roster player snapshot'; END IF;
      SELECT count(*) FILTER(WHERE link_item.value->>'identity_state'='resolved')::integer,
        count(*) FILTER(WHERE link_item.value->>'identity_state'='conflict')::integer INTO resolved_count_value,conflict_count_value
        FROM jsonb_array_elements(links) AS link_item(value);
      outcome_value:=CASE WHEN resolved_count_value=held_count_value THEN 'complete' ELSE 'partial' END;
      IF outcome_value='partial' THEN reasons_value:='["unresolved_player_links"]'::jsonb; END IF;
    END IF;
  END IF;
  INSERT INTO public.league_roster_player_link_receipts(roster_acceptance_id,roster_receipt_id,league_season_id,
    source_mapping_revision_id,roster_content_id,link_version,directory_version_id,resolved_at,mapping_evaluated_at,
    outcome,reasons,held_count,team_count,resolved_count,unresolved_count,conflict_count)
  VALUES(NEW.id,receipt.id,scope.league_season_id,NEW.source_mapping_revision_id,content.id,'sleeper-roster-player-links-v1',
    directory_version,clock_timestamp(),evaluated_at,outcome_value,reasons_value,held_count_value,team_count_value,
    resolved_count_value,held_count_value-resolved_count_value-conflict_count_value,conflict_count_value);
  INSERT INTO public.league_roster_player_links(roster_acceptance_id,season_team_id,external_roster_id,native_player_id,
    membership_ordinal,entity_kind,identity_state,reasons,directory_identity_status,kind_evidence,canonical_entity_id,mapping_proof)
  SELECT NEW.id,(link_item.value->>'season_team_id')::uuid,link_item.value->>'external_roster_id',link_item.value->>'native_player_id',
    (link_item.value->>'membership_ordinal')::integer,link_item.value->>'entity_kind',link_item.value->>'identity_state',link_item.value->'reasons',
    link_item.value->>'directory_identity_status',NULLIF(link_item.value->'kind_evidence','null'::jsonb),(link_item.value->>'canonical_entity_id')::uuid,link_item.value->'mapping_proof'
    FROM jsonb_array_elements(links) AS link_item(value);
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER roster_player_links_after_acceptance AFTER INSERT ON public.league_roster_resource_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.capture_roster_player_links();

REVOKE ALL ON public.league_roster_player_link_receipts,public.league_roster_player_links FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scoring_identity_uuid(text,text),public.upsert_scoring_entity_identities(jsonb),
  public.validate_roster_player_link_lineage(),public.assert_roster_player_link_fence(jsonb),public.capture_roster_player_links() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_roster_player_link_receipts,public.league_roster_player_links FROM league_one_runtime;
    GRANT SELECT ON public.league_roster_player_link_receipts,public.league_roster_player_links TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.validate_roster_player_link_lineage(),public.assert_roster_player_link_fence(jsonb),
      public.capture_roster_player_links() FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.scoring_identity_uuid(text,text),public.upsert_scoring_entity_identities(jsonb) TO league_one_runtime;
  END IF;
END; $$;

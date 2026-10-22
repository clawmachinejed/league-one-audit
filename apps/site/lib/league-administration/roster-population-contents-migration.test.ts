import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('migrations/064_roster_population_contents.sql');
const standings = read('migrations/048_official_standings.sql');
const lineage = read('migrations/053_draft_metadata.sql');
const provisioner = read('scripts/provision-runtime-role.sql');
const body = (source: string, name: string) => {
  const match = source.match(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.' + name + '\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;'));
  if (!match) throw new Error('Missing function: ' + name);
  return match[1];
};
const accessor = body(migration, 'roster_capture_population_evidence');
const interner = body(migration, 'intern_roster_population_evidence');
const grantBlock = (source: string) => source.split('-- BEGIN OPTIONAL ROSTER POPULATION CONTENT GRANTS')[1]
  .split('-- END OPTIONAL ROSTER POPULATION CONTENT GRANTS')[0];

describe('B1 roster population expansion boundaries (source proof, not native SQL qualification)', () => {
  it('leaves the interner unbound and existing receipt storage inline by default', () => {
    expect(migration).toContain("DEFAULT 'inline-v1'");
    expect(migration).not.toMatch(/EXECUTE FUNCTION public\.intern_roster_population_evidence|(?:DROP|ALTER) TRIGGER|ENABLE TRIGGER|DISABLE TRIGGER/iu);
    expect(migration.match(/CREATE (?:CONSTRAINT )?TRIGGER /gu)).toHaveLength(2);
    expect(migration.split('-- Compatible SQL consumers.')[0]).not.toContain('SECURITY DEFINER');
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public\.(?:capture_roster_player_links|assert_public_capture_input_shape|public_data_settled_capture_upper_bound)\(/u);
  });
  it('preserves both complete048 writer bodies except logical prior-proof access', () => {
    for (const name of ['record_league_administration_observation_v29', 'record_league_administration_observation_v42']) {
      expect(body(migration, name).replace('SELECT public.roster_capture_population_evidence(prior) INTO population_proof',
        'SELECT prior.population_evidence INTO population_proof')).toBe(body(standings, name));
    }
  });
  it('preserves all latest053 lineage branches except reconstructing NEW population once', () => {
    const compatible = body(migration, 'validate_current_roster_lineage')
      .replace('DECLARE population_proof jsonb;\n', '')
      .replace('\n    population_proof:=public.roster_capture_population_evidence(NEW);', '')
      .replace("(population_proof->>'observationId')", "(NEW.population_evidence->>'observationId')");
    expect(compatible).toBe(body(lineage, 'validate_current_roster_lineage'));
  });
  it('preserves native standings qualification after one logical receipt reconstruction', () => {
    expect(body(migration, 'official_standings_receipt_coverage')
      .replace('\n  receipt.population_evidence:=public.roster_capture_population_evidence(receipt);', ''))
      .toBe(body(standings, 'official_standings_receipt_coverage'));
  });
  it('separates SQL-null receipt, arbitrary original inline proof, and malformed shared state', () => {
    expect(accessor).toContain('IF p_receipt IS NULL THEN RETURN NULL; END IF;');
    expect(accessor).toContain("IF p_receipt.population_storage_format='inline-v1' AND p_receipt.population_content_id IS NULL THEN\n    RETURN p_receipt.population_evidence;");
    expect(accessor.indexOf('RETURN p_receipt.population_evidence')).toBeLessThan(accessor.indexOf('p_receipt.configuration_content_id IS NULL'));
    expect(accessor).toContain("p_receipt.population_storage_format IS DISTINCT FROM 'shared-v1'");
    expect(accessor).toContain('OR p_receipt.population_content_id IS NULL OR p_receipt.population_evidence IS NOT NULL');
    expect(accessor).not.toMatch(/COALESCE\(\s*(?:header|p_receipt)\.population_evidence\s*,|EXCEPTION WHEN/iu);
  });
  it('keeps config-null, expected-null and unsupported proof inline without an arbitrary new size limit', () => {
    expect(interner).toContain('NEW.configuration_content_id IS NULL OR NEW.expected_team_count IS NULL OR NEW.expected_team_count<=0');
    expect(interner).toContain('OR proof IS NULL THEN RETURN NEW; END IF;');
    expect(interner).toContain("OR jsonb_typeof(proof->'provenance') IS DISTINCT FROM 'object' THEN RETURN NEW; END IF;");
    expect(interner).not.toMatch(/octet_length|pg_column_size|LIMIT |set_config|clock_timestamp/iu);
  });
  it('keeps older positive-count fallback proof inline using the existing standings acquisition rule', () => {
    expect(interner).toContain("proof->'provenance'->'acquisition' IS DISTINCT FROM NEW.provenance->'acquisition' THEN RETURN NEW");
    expect(interner).toContain("IF NEW.provenance->'acquisition' IS NULL THEN");
    expect(interner).toContain("(proof->'provenance'->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RETURN NEW");
    expect(interner).toContain('EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NEW');
    expect(accessor).toContain("header.population_evidence->'provenance'->'acquisition' IS NOT DISTINCT FROM p_receipt.provenance->'acquisition'");
    expect(accessor).toContain("(header.population_evidence->'provenance'->>'requestStartedAt')::timestamptz>=attempt.reserved_at),false)");
    expect(accessor).toContain("RAISE EXCEPTION 'shared roster population acquisition unproved'");
  });
  it('uses the same complete exact three-policy whitelist for eligibility and shared reads', () => {
    const policies = [
      "('roster-membership','sleeper-current-all-teams-players-v1','sleeper-current-players-v1')",
      "('teams','sleeper-current-all-teams-primary-owners-v1','sleeper-current-team-managers-v1')",
      "('teams','sleeper-current-all-teams-manager-evidence-v2','sleeper-current-team-manager-evidence-v2')",
    ];
    for (const source of [accessor, interner]) {
      for (const policy of policies) expect(source).toContain(policy);
      expect(source).toContain("'kind','enrolled-resource','connectionId',scope.connection_id,'leagueSeasonId',scope.league_season_id");
      expect(source).toContain("'family',policy.family,'entityId',NULL,'scoringPeriodId',NULL,'audienceId','public','coverageSpecId',policy.coverage");
      expect(source).toContain("'canonicalNormalizerVersion',policy.normalizer,'validationVersion','latest-network-attempt-v1'");
      expect(source).not.toMatch(/league_roster_resource_heads|current_mapping_revision_id|league_configuration_heads/u);
    }
  });
  it('binds immutable configuration, observation and original mapping revision without a current-head fallback', () => {
    for (const source of [accessor, interner]) {
      expect(source).toContain('observation.content_id=configuration.id AND observation.league_season_id=configuration.league_season_id');
      expect(source).toContain("observation.family='league' AND observation.week=0");
      expect(source).toContain('revision.connection_id=scope.connection_id AND revision.league_season_id=scope.league_season_id');
      expect(source).toContain("configuration.accepted AND configuration.completeness='complete'");
    }
    expect(accessor).toContain("header.source_mapping_revision_id::text IS DISTINCT FROM attempt.source_mapping->>'revisionId'");
    expect(accessor).toContain('header.configuration_content_id IS DISTINCT FROM p_receipt.configuration_content_id');
  });
  it('retains the whole proof JSON and fails closed on a same-hash different value', () => {
    expect(interner).toContain("digest_value:=encode(digest(convert_to(proof::text,'UTF8'),'sha256'),'hex')");
    expect(interner).toContain("IF stored_proof IS DISTINCT FROM proof THEN RAISE EXCEPTION 'roster population digest collision'");
    expect(accessor).toContain("encode(digest(convert_to(header.population_evidence::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM header.content_hash");
    expect(migration).toContain('UNIQUE(league_season_id,source_mapping_revision_id,configuration_content_id,proof_version,content_hash)');
    expect(interner).not.toMatch(/NEW\.(?:evidence_hash|provenance|coverage|attempt_id|recorded_at)\s*:=/u);
  });
  it('checks the original fence before interning and after the separate post-wait winner lookup', () => {
    const fence = 'PERFORM public.assert_roster_player_link_fence(attempt.write_fence)';
    expect(interner.indexOf(fence)).toBeLessThan(interner.indexOf('INSERT INTO public.league_roster_population_contents'));
    expect(interner).toContain('DO NOTHING RETURNING id INTO created_id;');
    expect(interner).toContain('SELECT id,population_evidence INTO STRICT content_id_value,stored_proof');
    expect(interner.lastIndexOf(fence)).toBeGreaterThan(interner.indexOf('SELECT id,population_evidence INTO STRICT'));
    expect(migration).toContain('RETURNS trigger LANGUAGE plpgsql VOLATILE');
  });
  it('allows only the same-xid first NEW receipt before insertion and does not allocate xid during reads', () => {
    expect(accessor).toContain('IF NOT COALESCE(header.capture_transaction=pg_current_xact_id_if_assigned() AND header.first_receipt_id=p_receipt.id,false)');
    expect(accessor).not.toContain('pg_current_xact_id()');
    expect(accessor).toContain("first_receipt.id=header.first_receipt_id AND first_receipt.population_storage_format='shared-v1'");
    expect(accessor).toContain('first_receipt.population_content_id=header.id AND first_receipt.population_evidence IS NULL');
    expect(accessor).not.toContain('roster_capture_population_evidence(first_receipt)');
  });
  it('requires the persisted first receipt at commit and immutable parent history thereafter', () => {
    expect(migration).toContain('first_receipt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_capture_receipts(id) DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('roster_population_content_immutable BEFORE UPDATE OR DELETE');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_roster_population_content()');
    const check = body(migration, 'validate_roster_population_content');
    expect(check).toContain('NEW.capture_transaction<>pg_current_xact_id()');
    expect(check).toContain("WHERE id=NEW.first_receipt_id AND population_storage_format='shared-v1' AND population_content_id=NEW.id");
    expect(check).toContain('public.roster_capture_population_evidence(first_receipt) IS DISTINCT FROM NEW.population_evidence');
    expect(migration).not.toMatch(/ON DELETE CASCADE|DELETE FROM public\.league_roster_population/iu);
  });
  it('uses an exclusive representation and validates reconstructed NEW before returning', () => {
    expect(migration).toContain("(population_storage_format='inline-v1' AND population_content_id IS NULL) OR");
    expect(migration).toContain("(population_storage_format='shared-v1' AND population_content_id IS NOT NULL AND population_evidence IS NULL)");
    expect(interner).toContain("NEW.population_storage_format:='shared-v1'; NEW.population_content_id:=content_id_value; NEW.population_evidence:=NULL;");
    expect(interner).toContain('public.roster_capture_population_evidence(NEW) IS DISTINCT FROM proof');
  });
  it('grants only the read accessor and SELECT while denying private interning and late-role writes', () => {
    const block = grantBlock(provisioner);
    expect(block).toBe(grantBlock(migration));
    expect(block.trim()).toMatch(/^DO \$\$[\s\S]*END; \$\$;$/u);
    expect(block).toContain("accessor text:='public.roster_capture_population_evidence(public.league_roster_capture_receipts)'");
    expect(block).toContain("ARRAY['public.validate_roster_population_content()','public.intern_roster_population_evidence()']");
    expect(block).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper)");
    expect(block).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,role_name)");
    expect(block).toContain('GRANT SELECT ON TABLE public.league_roster_population_contents TO league_one_runtime;');
    expect(block).toContain("EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO league_one_runtime',accessor)");
    expect(block).toContain("ARRAY['league_one_runtime','league_one_account','league_one_auth']");
    expect(block).toContain("denied:=denied||',MAINTAIN'");
    expect(block).toContain('has_any_column_privilege');
    expect(block).not.toMatch(/GRANT ALL|ALTER DEFAULT PRIVILEGES/iu);
  });
});

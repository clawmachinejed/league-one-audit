import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('migrations/065_roster_provenance_contents.sql');
const b1 = read('migrations/064_roster_population_contents.sql');
const standings = read('migrations/048_official_standings.sql');
const checkpoint = read('migrations/039_public_data_capture_witness.sql');
const scheduler = read('migrations/061_public_data_active_brackets.sql');
const settlement = read('migrations/062_public_data_settled_request_budget.sql');
const provisioner = read('scripts/provision-runtime-role.sql');
const body = (source: string, name: string) => {
  const match = source.match(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.' + name + '\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;'));
  if (!match) throw new Error('Missing function: ' + name);
  return match[1];
};
const accessor = body(migration, 'roster_capture_provenance');
const interner = body(migration, 'intern_roster_capture_provenance');
const grantBlock = (source: string) => source.split('-- BEGIN OPTIONAL ROSTER PROVENANCE CONTENT GRANTS')[1]
  .split('-- END OPTIONAL ROSTER PROVENANCE CONTENT GRANTS')[0];

describe('B2a roster provenance expansion boundaries (source proof, not native SQL qualification)', () => {
  it('adds one immutable parent and an exclusive inline-default receipt representation without activation', () => {
    expect(migration.match(/CREATE TABLE /gu)).toHaveLength(1);
    expect(migration).toContain("provenance_storage_format text NOT NULL DEFAULT 'inline-v1'");
    expect(migration).toContain("(provenance_storage_format='inline-v1' AND provenance_content_id IS NULL AND provenance IS NOT NULL) OR");
    expect(migration).toContain("(provenance_storage_format='shared-v1' AND provenance_content_id IS NOT NULL AND provenance IS NULL)");
    expect(migration).not.toMatch(/EXECUTE FUNCTION public\.intern_roster_capture_provenance|(?:DROP|ALTER) TRIGGER|ENABLE TRIGGER|DISABLE TRIGGER/iu);
    expect(migration.match(/CREATE (?:CONSTRAINT )?TRIGGER /gu)).toHaveLength(2);
    expect(migration).not.toMatch(/ALTER TABLE public\.league_roster_resource_attempts|SET STORAGE|SET COMPRESSION|toast_tuple_target|VACUUM/iu);
  });
  it('keeps the exact nine active compatibility owners and introduces only three new functions', () => {
    const owners = Array.from(migration.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)/gu), (match) => match[1]);
    expect(owners).toEqual(['roster_capture_population_evidence', 'intern_roster_population_evidence',
      'validate_current_roster_lineage', 'official_standings_receipt_coverage', 'guard_official_standings_insert',
      'record_league_administration_observation_v48', 'checkpoint_public_data_intake_v43',
      'reconcile_public_data_resource_request', 'public_data_settled_capture_upper_bound']);
    expect(Array.from(migration.matchAll(/CREATE FUNCTION public\.([a-z_0-9]+)/gu), (match) => match[1]))
      .toEqual(['roster_capture_provenance', 'validate_roster_provenance_content', 'intern_roster_capture_provenance']);
  });
  it('preserves the B1 accessor except obtaining the original logical provenance once', () => {
    expect(body(migration, 'roster_capture_population_evidence')
      .replace('  receipt_provenance jsonb:=public.roster_capture_provenance(p_receipt);\n', '')
      .replaceAll('receipt_provenance->', 'p_receipt.provenance->'))
      .toBe(body(b1, 'roster_capture_population_evidence'));
  });
  it('preserves the B1 interner except obtaining the original logical provenance once', () => {
    expect(body(migration, 'intern_roster_population_evidence')
      .replace('  receipt_provenance jsonb:=public.roster_capture_provenance(NEW);\n', '')
      .replaceAll('receipt_provenance->', 'NEW.provenance->'))
      .toBe(body(b1, 'intern_roster_population_evidence'));
  });
  it('adds unconditional receipt validation without altering original lineage branches', () => {
    const lineage = body(migration, 'validate_current_roster_lineage');
    expect(lineage).toContain("IF TG_TABLE_NAME='league_roster_capture_receipts' THEN\n    PERFORM public.roster_capture_provenance(NEW);");
    expect(lineage.replace('\n    PERFORM public.roster_capture_provenance(NEW);', ''))
      .toBe(body(b1, 'validate_current_roster_lineage'));
  });
  it('preserves standings qualification, guard and wrapper after one logical reconstruction', () => {
    for (const [name, originalName, source] of [
      ['official_standings_receipt_coverage', 'official_standings_receipt_coverage', b1],
      ['guard_official_standings_insert', 'guard_official_standings_insert', standings],
      ['record_league_administration_observation_v48', 'record_league_administration_observation', standings],
    ]) {
      expect(body(migration, name).replace('\n  receipt.provenance:=public.roster_capture_provenance(receipt);', ''))
        .toBe(body(source, originalName));
    }
  });
  it('preserves the active checkpoint body and its original witness, clock and replay checks', () => {
    expect(body(migration, 'checkpoint_public_data_intake_v43').replaceAll('public.roster_capture_provenance(receipt)', 'receipt.provenance'))
      .toBe(body(checkpoint, 'checkpoint_public_data_intake'));
    expect(read('migrations/044_public_data_period_inventory.sql')).toContain('RENAME TO checkpoint_public_data_intake_v43');
  });
  it('preserves the scheduler including both original cadences and untouched bracket branch', () => {
    const actual = body(migration, 'reconcile_public_data_resource_request');
    const original = body(scheduler, 'reconcile_public_data_resource_request');
    expect(actual.replaceAll('public.roster_capture_provenance(receipt)', 'receipt.provenance')).toBe(original);
    expect(actual.split("   IF resource.kind='core' THEN")[0]).toBe(original.split("   IF resource.kind='core' THEN")[0]);
    expect(actual).toContain("cadence interval:=interval '4 minutes'");
    expect(actual).toContain("cadence:=interval '12 minutes'");
  });
  it('preserves settlement after its missing-receipt check and one logical reconstruction', () => {
    expect(body(migration, 'public_data_settled_capture_upper_bound').replace(
      "      IF NOT FOUND THEN RETURN NULL; END IF;\n      receipt_row.provenance:=public.roster_capture_provenance(receipt_row);\n      IF receipt_row.provenance->>'origin'",
      "      IF NOT FOUND OR receipt_row.provenance->>'origin'"))
      .toBe(body(settlement, 'public_data_settled_capture_upper_bound'));
  });
  it('separates SQL-null receipt, verbatim inline provenance and malformed shared storage', () => {
    expect(accessor).toContain('IF p_receipt IS NULL THEN RETURN NULL; END IF;');
    expect(accessor).toContain("IF p_receipt.provenance_storage_format='inline-v1' AND p_receipt.provenance_content_id IS NULL\n    AND p_receipt.provenance IS NOT NULL THEN RETURN p_receipt.provenance;");
    expect(accessor).toContain("p_receipt.provenance_storage_format IS DISTINCT FROM 'shared-v1'");
    expect(accessor).toContain('OR p_receipt.provenance_content_id IS NULL OR p_receipt.provenance IS NOT NULL');
    expect(accessor).not.toMatch(/COALESCE\(\s*(?:header|p_receipt)\.provenance\s*,|EXCEPTION WHEN/iu);
  });
  it('uses the same complete exact three-policy whitelist for candidate insertion and historical reading', () => {
    const policies = [
      "('roster-membership','sleeper-current-all-teams-players-v1','sleeper-current-players-v1')",
      "('teams','sleeper-current-all-teams-primary-owners-v1','sleeper-current-team-managers-v1')",
      "('teams','sleeper-current-all-teams-manager-evidence-v2','sleeper-current-team-manager-evidence-v2')",
    ];
    for (const source of [accessor, interner]) {
      for (const policy of policies) expect(source).toContain(policy);
      expect(source).toContain("'kind','enrolled-resource','connectionId',scope.connection_id,'leagueSeasonId',scope.league_season_id");
      expect(source).toContain("'canonicalNormalizerVersion',policy.normalizer,'validationVersion','latest-network-attempt-v1'");
      expect(source).not.toMatch(/league_roster_resource_heads|current_mapping_revision_id|league_configuration_heads/u);
    }
    expect(interner).toContain("original_provenance->'acquisition'->'work'->>'kind' IS DISTINCT FROM 'core' THEN RETURN NEW");
    expect(interner).not.toMatch(/octet_length|pg_column_size|LIMIT |set_config/iu);
  });
  it('binds immutable content/observation/mapping without substituting older deduplicated observation clocks', () => {
    expect(accessor).toContain('observation.id=header.legacy_observation_id AND observation.content_id=p_receipt.content_id');
    expect(accessor).toContain("observation.family='rosters' AND observation.week=0");
    expect(accessor).toContain('revision.connection_id=scope.connection_id AND revision.league_season_id=scope.league_season_id');
    expect(accessor).not.toMatch(/observation\.(?:origin|request_started_at|request_completed_at|source_observed_at|checked_at)/u);
    expect(accessor).toContain('RETURN header.provenance;');
    expect(accessor).toContain("header.source_mapping_revision_id::text IS DISTINCT FROM attempt.source_mapping->>'revisionId'");
  });
  it('retains exact original JSON, hashes it and rejects full-value mismatch without normalization', () => {
    expect(interner).toContain("digest_value:=encode(digest(convert_to(original_provenance::text,'UTF8'),'sha256'),'hex')");
    expect(interner).toContain("IF stored_provenance IS DISTINCT FROM original_provenance THEN RAISE EXCEPTION 'roster provenance digest collision'");
    expect(accessor).toContain("encode(digest(convert_to(header.provenance::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM header.content_hash");
    expect(migration).toContain('UNIQUE(league_season_id,source_mapping_revision_id,legacy_observation_id,content_hash)');
    expect(interner).not.toMatch(/NEW\.(?:evidence_hash|coverage|attempt_id|recorded_at|population_evidence|configuration_content_id)\s*:=/u);
  });
  it('keeps original live witness/fence checks before and after any unique-key wait', () => {
    for (const check of ['public.public_capture_after_reservation(original_provenance,attempt.id)',
      'public.assert_roster_player_link_fence(attempt.write_fence)']) {
      expect(interner.indexOf(check)).toBeLessThan(interner.indexOf('INSERT INTO public.league_roster_provenance_contents'));
      expect(interner.lastIndexOf(check)).toBeGreaterThan(interner.indexOf('SELECT id,provenance INTO STRICT'));
    }
    expect(interner).toContain('DO NOTHING RETURNING id INTO created_id;');
    expect(interner).toContain('SELECT id,provenance INTO STRICT content_id_value,stored_provenance');
  });
  it('uses immutable original dispatch and attempt witnesses for historical reads without live checks', () => {
    expect(accessor).toContain("witness->'fence' IS DISTINCT FROM attempt.write_fence");
    expect(accessor).toContain("witness->'mapping' IS DISTINCT FROM attempt.source_mapping");
    expect(accessor).toContain("witness->'attempts'->role_name IS DISTINCT FROM jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce)");
    expect(accessor).toContain("dispatch.capture_nonce::text=witness->>'dispatchNonce' AND dispatch.admitted_at<=attempt.reserved_at");
    expect(accessor).not.toMatch(/public_capture_after_reservation|assert_public_data_capture_witness|derive_public_data_capture_witness|assert_roster_player_link_fence|clock_timestamp|pg_current_xact_id\(\)/u);
  });
  it('validates every original core role and nonce without requiring later receipts or current ownership', () => {
    expect(accessor).toContain("role_names NOT IN (ARRAY['managers','players','settings'],ARRAY['managers','managersV2','players','settings'])");
    expect(accessor).toContain("count(DISTINCT value->>'id') FROM jsonb_each(witness->'attempts')");
    expect(accessor).toContain("count(DISTINCT value->>'nonce') FROM jsonb_each(witness->'attempts')");
    expect(accessor).toContain("NOT(item.value ?& ARRAY['id','nonce']) OR item.value-ARRAY['id','nonce'] IS DISTINCT FROM '{}'::jsonb");
    expect(accessor).toContain("reserved.id::text=item.value->>'id' AND reserved.capture_nonce::text=item.value->>'nonce'");
    expect(accessor).toContain('reserved.source_mapping=attempt.source_mapping AND reserved.write_fence=attempt.write_fence');
    expect(accessor).toContain('reserved.reserved_at>=dispatch.admitted_at');
    expect(accessor).not.toContain('WHERE reserved.write_fence=attempt.write_fence)<>cardinality(role_names)');
    expect(accessor).not.toMatch(/SELECT count\(\*\) FROM public\.league_roster_resource_attempts/u);
    expect(accessor).toContain("RAISE EXCEPTION 'shared roster provenance attempt group mismatch'");
    const group = accessor.split('-- Recheck the complete retained witness group')[1].split('-- Only the actual creating NEW receipt')[0];
    expect(group).not.toMatch(/league_roster_capture_receipts|league_roster_resource_acceptances|public_data_dispatch_outcomes|projection_jobs|clock_timestamp/u);
  });
  it('permits only the same-xid actual first NEW and requires its persisted immutable context afterwards', () => {
    expect(accessor).toContain('header.capture_transaction=pg_current_xact_id_if_assigned() AND header.first_receipt_id=p_receipt.id');
    expect(accessor).toContain("first_receipt.id=header.first_receipt_id AND first_receipt.provenance_storage_format='shared-v1'");
    expect(accessor).toContain('first_receipt.provenance_content_id=header.id AND first_receipt.provenance IS NULL');
    expect(accessor).toContain('first_receipt.legacy_observation_id=header.legacy_observation_id AND first_receipt.content_id=p_receipt.content_id');
    expect(accessor).toContain('first_attempt.source_mapping=attempt.source_mapping AND first_attempt.write_fence=attempt.write_fence');
    expect(accessor).not.toContain('roster_capture_provenance(first_receipt)');
  });
  it('requires persisted first-reference closure and rejects later parent mutation', () => {
    expect(migration).toContain('first_receipt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_capture_receipts(id) DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('roster_provenance_content_immutable BEFORE UPDATE OR DELETE');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_roster_provenance_content()');
    expect(body(migration, 'validate_roster_provenance_content')).toContain('NEW.capture_transaction<>pg_current_xact_id()');
    expect(body(migration, 'validate_roster_provenance_content')).toContain("WHERE id=NEW.first_receipt_id AND provenance_storage_format='shared-v1' AND provenance_content_id=NEW.id");
    expect(interner).toContain('public.roster_capture_provenance(NEW) IS DISTINCT FROM original_provenance');
    expect(migration).not.toMatch(/ON DELETE CASCADE|DELETE FROM public\.league_roster_provenance/iu);
  });
  it('grants only SELECT/accessor to runtime and denies private helpers to every restricted role', () => {
    const block = grantBlock(provisioner);
    expect(block).toBe(grantBlock(migration));
    expect(block.trim()).toMatch(/^DO \$\$[\s\S]*END; \$\$;$/u);
    expect(block).toContain("accessor text:='public.roster_capture_provenance(public.league_roster_capture_receipts)'");
    expect(block).toContain("ARRAY['public.validate_roster_provenance_content()','public.intern_roster_capture_provenance()']");
    expect(block).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper)");
    expect(block).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,role_name)");
    expect(block).toContain('GRANT SELECT ON TABLE public.league_roster_provenance_contents TO league_one_runtime;');
    expect(block).toContain("EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO league_one_runtime',accessor)");
    expect(block).toContain("ARRAY['league_one_runtime','league_one_account','league_one_auth']");
    expect(block).toContain("denied:=denied||',MAINTAIN'");
    expect(block).toContain('has_any_column_privilege');
    expect(block).not.toMatch(/GRANT ALL|ALTER DEFAULT PRIVILEGES/iu);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (name: string) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('migrations/063_roster_player_link_contents.sql');
const previous = read('migrations/042_roster_player_links.sql');
const identityOwner = read('migrations/054_draft_selections.sql');
const provisioner = read('scripts/provision-runtime-role.sql');
const body = (source: string, name: string) => {
  const match = source.match(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.' + name + '\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;'));
  if (!match) throw new Error('Missing function: ' + name);
  return match[1];
};
const privateFunctions = ['roster_player_link_content_value(uuid)', 'guard_roster_player_link_content_entry()',
  'guard_legacy_roster_player_link_insert()', 'validate_shared_roster_player_link_receipt()',
  'validate_roster_player_link_content()', 'store_roster_player_link_content(uuid,uuid,jsonb,jsonb)', 'capture_roster_player_links_shared()'];

describe('shared roster link expansion boundaries (source proof, not installed-schema qualification)', () => {
  it('keeps the active legacy trigger and writer unchanged with no automatic activation path', () => {
    expect(previous).toContain('CREATE TRIGGER roster_player_links_after_acceptance AFTER INSERT ON public.league_roster_resource_acceptances\n  FOR EACH ROW EXECUTE FUNCTION public.capture_roster_player_links();');
    expect(migration).not.toMatch(/(?:CREATE|DROP|ALTER) TRIGGER roster_player_links_after_acceptance/iu);
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public\.capture_roster_player_links\(\)/u);
    expect(migration).not.toMatch(/set_config|current_setting|SECURITY DEFINER|ENABLE TRIGGER|DISABLE TRIGGER/iu);
    expect(migration).toContain("DEFAULT 'acceptance-v1'");
  });
  it('copies the entire042 resolver and its bounds, locks and time semantics before the storage tail', () => {
    const legacy = body(previous, 'capture_roster_player_links').split('  INSERT INTO public.league_roster_player_link_receipts(')[0];
    const shared = body(migration, 'capture_roster_player_links_shared')
      .replace('directory_version uuid; directory_content uuid; shared_content uuid;', 'directory_version uuid; directory_content uuid;')
      .split("  IF outcome_value IN ('complete','partial') THEN")[0];
    expect(shared).toBe(legacy);
    const candidate = body(migration, 'capture_roster_player_links_shared');
    expect(candidate).not.toContain('INSERT INTO public.league_roster_player_links(');
    expect(candidate).toContain("conflict_count_value,'shared-v1',shared_content)");
    expect(candidate.trimEnd()).toMatch(/IF attempt\.write_fence IS NOT NULL THEN PERFORM public\.assert_roster_player_link_fence\(attempt\.write_fence\); END IF;\n  RETURN NEW;\nEND;$/u);
  });
  it('adds only the new retained reference to the latest054 identity owner', () => {
    expect(body(migration, 'upsert_scoring_entity_identities')
      .replace('\n      AND NOT EXISTS(SELECT 1 FROM public.league_roster_player_link_content_entries historical WHERE historical.canonical_entity_id=entity.id)', ''))
      .toBe(body(identityOwner, 'upsert_scoring_entity_identities'));
  });
  it('preserves nullable-directory equality without a nullable composite-FK bypass', () => {
    expect(migration).toContain('UNIQUE NULLS NOT DISTINCT(league_season_id,source_mapping_revision_id,directory_version_id,storage_version,content_hash)');
    expect(migration).toContain('ADD COLUMN link_content_id uuid REFERENCES public.league_roster_player_link_contents(id)');
    expect(migration).toContain('FOREIGN KEY(link_content_id,league_season_id,source_mapping_revision_id)');
    expect(body(migration, 'validate_shared_roster_player_link_receipt')).toContain('header.directory_version_id IS DISTINCT FROM NEW.directory_version_id');
    const header = migration.split('CREATE TABLE public.league_roster_player_link_contents (')[1].split('\n);')[0];
    expect(header).not.toMatch(/roster_content_id|resolved_at|mapping_evaluated_at/u);
  });
  it('uses the complete ordered typed result as sharing value without dropped members or proof', () => {
    const value = body(migration, 'roster_player_link_content_value');
    for (const field of ['season_team_id', 'external_roster_id', 'native_player_id', 'membership_ordinal', 'entity_kind',
      'directory_identity_status', 'kind_evidence', 'mapping_proof', 'canonical_entity_id', 'identity_state', 'reasons']) {
      expect(value).toContain("'" + field + "',item." + field);
    }
    expect(value).toContain('ORDER BY item.external_roster_id COLLATE "C",item.membership_ordinal');
    expect(value).toContain("'[]'::jsonb"); expect(value).not.toMatch(/DISTINCT|LIMIT/iu);
  });
  it('seals members at first reference using the existing creation-transaction pattern', () => {
    const guard = body(migration, 'guard_roster_player_link_content_entry');
    expect(guard).toContain('header.capture_transaction=pg_current_xact_id()');
    expect(guard).toContain('NOT EXISTS(SELECT 1 FROM public.league_roster_player_link_receipts linked WHERE linked.link_content_id=header.id)');
    expect(migration).toContain('roster_link_content_entry_creation BEFORE INSERT');
    expect(migration).toContain('roster_link_content_immutable BEFORE UPDATE OR DELETE');
    expect(migration).toContain('roster_link_content_entry_immutable BEFORE UPDATE OR DELETE');
    expect(migration).not.toMatch(/ON DELETE CASCADE|sealed boolean|DELETE FROM public\.league_roster_player_link/iu);
  });
  it('requires complete typed content and a valid first receipt at commit', () => {
    const validation = body(migration, 'validate_roster_player_link_content');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_roster_player_link_content()');
    expect(validation).toContain('NEW.capture_transaction<>pg_current_xact_id()');
    expect(validation).toContain('roster_acceptance_id=NEW.first_roster_acceptance_id AND roster_receipt_id=NEW.first_roster_receipt_id');
    expect(validation).toContain("AND link_content_id=NEW.id AND storage_format='shared-v1'");
    expect(validation).toContain('total<>NEW.held_count OR resolved<>NEW.resolved_count OR conflicts<>NEW.conflict_count');
    expect(validation).toContain("encode(digest(convert_to(value::text,'UTF8'),'sha256'),'hex')<>NEW.content_hash");
  });
  it('validates each receipt against its own exact raw roster despite content reuse', () => {
    const validation = body(migration, 'validate_shared_roster_player_link_receipt');
    expect(validation).toContain('entry.content_id=NEW.roster_content_id');
    expect(validation).toContain('entry.team_id=item.season_team_id AND entry.league_season_id=NEW.league_season_id');
    expect(validation).toContain("entry.source_value->'playerExternalIds'->>(item.membership_ordinal-1) IS DISTINCT FROM item.native_player_id");
    expect(validation).toContain('source_teams<>NEW.team_count OR source_held<>NEW.held_count');
    // Native PostgreSQL rejected the unparenthesized CASE at its inner THEN (42601).
    expect(validation).toContain(`OR NEW.reasons IS DISTINCT FROM (CASE WHEN NEW.outcome='complete' THEN '[]'::jsonb ELSE '["unresolved_player_links"]'::jsonb END) THEN`);
    expect(validation).toContain('header.source_mapping_revision_id<>NEW.source_mapping_revision_id');
    expect(validation).toContain('header.link_version<>NEW.link_version');
  });
  it('fails closed on a collision or invisible concurrent winner and rechecks the fence after waiting', () => {
    const store = body(migration, 'store_roster_player_link_content');
    expect(store).toContain('DO NOTHING RETURNING id INTO created_id');
    expect(store).toContain('SELECT id INTO STRICT content_id_value');
    expect(store).toContain('directory_version_id IS NOT DISTINCT FROM p_directory');
    expect(store).toContain('public.roster_player_link_content_value(content_id_value) IS DISTINCT FROM p_links');
    expect(store.indexOf('PERFORM public.assert_roster_player_link_fence(p_fence);', store.indexOf('ON CONFLICT'))).toBeGreaterThan(store.indexOf('ON CONFLICT'));
    expect(store).not.toMatch(/DO UPDATE|LOOP|pg_sleep/iu);
  });
  it('keeps empty/partial and explicit negative outcomes separate from legacy rows', () => {
    expect(migration).toContain("(storage_format='acceptance-v1' AND link_content_id IS NULL)");
    expect(migration).toContain("(storage_format='shared-v1' AND ((outcome IN ('complete','partial'))=(link_content_id IS NOT NULL)))");
    expect(body(migration, 'capture_roster_player_links_shared')).toContain("IF outcome_value IN ('complete','partial') THEN");
    expect(body(migration, 'guard_legacy_roster_player_link_insert')).toContain("linked.storage_format='acceptance-v1'");
    expect(body(migration, 'validate_shared_roster_player_link_receipt')).toContain('shared roster receipt has legacy members');
  });
  it('denies direct staging/activation and repairs late runtime privileges idempotently', () => {
    const block = provisioner.split('-- BEGIN OPTIONAL SHARED ROSTER PLAYER LINK CONTENT GRANTS')[1].split('-- END OPTIONAL SHARED ROSTER PLAYER LINK CONTENT GRANTS')[0];
    expect(block.trim()).toMatch(/^DO \$\$[\s\S]*END; \$\$;$/u);
    for (const fn of privateFunctions) { expect(migration).toContain("'public." + fn + "'"); expect(block).toContain("'public." + fn + "'"); }
    expect(migration).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper)");
    expect(migration).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,role_name)");
    expect(block).toContain("ARRAY['league_one_runtime','league_one_account','league_one_auth']");
    expect(block).toContain("denied:=denied||',MAINTAIN'");
    expect(block).toContain('GRANT SELECT ON TABLE public.%I TO league_one_runtime');
    expect(block).not.toMatch(/GRANT EXECUTE|GRANT ALL|ALTER DEFAULT PRIVILEGES/iu);
  });
});

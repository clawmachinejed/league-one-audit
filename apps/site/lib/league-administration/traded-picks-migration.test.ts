import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('migrations/055_traded_pick_ownership.sql'), previous = read('migrations/054_draft_selections.sql');
const provisioning = read('scripts/provision-runtime-role.sql');
describe('CP18 additive source boundaries (not SQL qualification)', () => {
  it('uses scoped native asset identity and leaves future years as scalar references', () => {
    const table = migration.split('CREATE TABLE public.league_traded_pick_assets (')[1].split(');')[0];
    expect(table).toContain('UNIQUE(league_season_id,provider,external_league_id,endpoint_key,pick_season,round_value,original_roster_id)');
    expect(table).not.toMatch(/owner_id|source_ordinal|pick_number/);
    expect(migration).not.toMatch(/INSERT INTO public\.(?:league_seasons|league_administration_enrollment_seasons|projection_jobs)/);
    expect(migration).not.toContain('upsert_scoring_entity_identities');
  });
  it('retains row order independently of stable identity and forbids canonical ambiguous owner', () => {
    expect(migration).toContain('PRIMARY KEY(content_id,source_ordinal)');
    expect(migration).toContain("CHECK((ownership_state='resolved')=(owner_team_id IS NOT NULL))");
    expect(migration).toContain("WHERE item->>'ownershipState'='resolved'");
    expect(migration).not.toMatch(/draft_order|slot_to_roster_id|picked_by|player_id/);
  });
  it('preserves prior writer delegation before resource locking and after-lock fence checks', () => {
    const writer = migration.split('CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)')[1];
    expect(writer).toContain('RETURN public.record_league_administration_observation_v54(p_input)');
    expect(writer.indexOf("result:=public.record_league_administration_observation_v54(p_input-'tradedPicksAcceptance'-'tradedPicksProjection'-'sourceMapping')"))
      .toBeLessThan(writer.indexOf('WHERE scope_id=attempt.scope_id FOR UPDATE'));
    expect(writer).toContain("'draftSelectionsAcceptance','draftSelectionsProjection'");
    expect(writer).toContain("'draftMetadataAcceptance','draftMetadataProjection'");
    expect(writer).toContain('traded_picks_source_not_newer');
    for (const event of ['receipt', 'acceptance']) expect(previous).toMatch(new RegExp(`CREATE CONSTRAINT TRIGGER draft_selections_${event}_fence[\\s\\S]*?DEFERRABLE INITIALLY DEFERRED`));
    expect(previous).toContain("WHERE receipt.id=receipt_id AND scope.identity->'scope'->>'family'='drafts'");
  });
  it('enforces native parity and immutable children at deferred commit', () => {
    expect(migration).toContain('public.traded_picks_typed_value(content.id) IS DISTINCT FROM expected');
    expect(migration).toContain('header.capture_transaction=pg_current_xact_id()');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER traded_picks_typed_lineage');
    expect(migration).toContain('traded picks history cannot gain later facts');
  });
  it('closes new writer PUBLIC execute and fresh-runtime helpers without weakening account provisioners', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.record_league_administration_observation(jsonb) FROM PUBLIC;');
    const optional = provisioning.split('-- BEGIN OPTIONAL TRADED PICKS GRANTS')[1];
    for (const table of ['league_traded_pick_assets', 'league_traded_pick_contents', 'league_traded_pick_catalog_entries', 'league_traded_pick_entries']) expect(optional).toContain(`'${table}'`);
    expect(optional).toContain('GRANT SELECT ON TABLE'); expect(optional).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)/);
    expect(optional).toContain('public.record_league_administration_observation_v54(jsonb)');
  });
});

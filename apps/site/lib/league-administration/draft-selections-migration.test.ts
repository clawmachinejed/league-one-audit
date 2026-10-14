import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('migrations/054_draft_selections.sql');
const previous = read('migrations/042_roster_player_links.sql');
const provisioning = read('scripts/provision-runtime-role.sql');
const functionBody = (source: string, name: string) => source.split(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`))[1].split('END; $$;')[0];

describe('additive draft selections migration source boundaries (not PostgreSQL qualification)', () => {
  it('changes the shared identity owner only to preserve immutable selection references', () => {
    const updated = functionBody(migration, 'upsert_scoring_entity_identities')
      .replace('\n      AND NOT EXISTS(SELECT 1 FROM public.league_draft_selection_player_links historical WHERE historical.canonical_entity_id=entity.id)', '');
    expect(updated).toBe(functionBody(previous, 'upsert_scoring_entity_identities'));
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.validate_current_roster_lineage');
  });
  it('keeps stable identity independent of source ordering and correction fields', () => {
    const table = migration.split('CREATE TABLE public.league_draft_selections (')[1].split(');')[0];
    expect(table).toContain('UNIQUE(draft_id,native_pick_number)');
    expect(table).not.toMatch(/source_ordinal|round_value|player_id|season_team_id/u);
    expect(migration).toContain('PRIMARY KEY(content_id,source_ordinal)');
    expect(migration).toContain("CHECK((identity_state='valid')=(selection_id IS NOT NULL))");
    const capture = functionBody(migration, 'capture_draft_selections_typed');
    expect(capture).toContain("item->'rosterId'->>'value'");
    expect(capture).not.toMatch(/draft_order|slot_to_roster_id|pickedBy.*season_team/u);
    expect(capture).not.toContain('FOR item');
    expect(capture).toContain("WHERE item->>'identityState'='valid' AND item->'rosterId'->>'value' IS NOT NULL");
    expect(capture).toContain("LEFT JOIN public.league_season_teams team ON item->>'identityState'='valid'");
    expect(migration).toContain("CHECK((identity_state='valid' AND external_roster_id IS NOT NULL)=(season_team_id IS NOT NULL))");
  });
  it('retains ambiguous positions and scope contradictions without accepted coverage', () => {
    const facts = functionBody(migration, 'draft_selection_facts');
    expect(facts.indexOf("THEN 'conflict'")).toBeLessThan(facts.indexOf("THEN 'invalid'"));
    expect(facts).toContain("WHEN p_duplicate THEN 'duplicate'");
    const projection = functionBody(migration, 'project_draft_selections_native');
    expect(projection).toContain("count(*) OVER(PARTITION BY public.draft_selection_field(value,'pick_no','slot')->'value')");
    expect(projection).toContain('total=valid_count AND p_complete');
    expect(projection).toContain('IF total>10000 THEN RETURN NULL');
  });
  it('wraps the existing writer and preserves job-before-resource lock order', () => {
    expect(migration.match(/ALTER FUNCTION public\.record_league_administration_observation\(jsonb\) RENAME/gu)).toHaveLength(1);
    const writer = functionBody(migration, 'record_league_administration_observation');
    const delegated = writer.indexOf("result:=public.record_league_administration_observation_v53(p_input-'draftSelectionsAcceptance'-'draftSelectionsProjection'-'sourceMapping')");
    expect(writer).toContain('RETURN public.record_league_administration_observation_v53(p_input)');
    expect(delegated).toBeGreaterThan(0);
    expect(delegated).toBeLessThan(writer.indexOf('PERFORM public.validate_current_roster_mapping'));
    expect(delegated).toBeLessThan(writer.indexOf('WHERE scope_id=attempt.scope_id FOR UPDATE'));
    expect(writer).toContain("'draftMetadataAcceptance','draftMetadataProjection'");
    expect(writer).toContain("OR provenance ? 'acquisition'");
    expect(writer.indexOf('invalid draft selections ISO clock')).toBeLessThan(delegated);
    expect(writer.indexOf('draft selections persistence budget exceeded')).toBeLessThan(delegated);
    expect(writer).toContain("COALESCE(jsonb_array_length(projection->'value'->'entries'),0)*(1536");
    expect(writer).toContain("+2*COALESCE(octet_length((p_input->'envelope'->'scope'->'externalLeagueId')::text),0)");
    expect(writer).toContain("+2*COALESCE(octet_length((p_input->'envelope'->'payload'->'externalDraftId')::text),0))+8388608>33554432");
  });
  it('fences partial and reused receipts at commit and cannot augment frozen children later', () => {
    for (const event of ['receipt', 'acceptance']) expect(migration).toMatch(new RegExp(`CREATE CONSTRAINT TRIGGER draft_selections_${event}_fence[\\s\\S]*?DEFERRABLE INITIALLY DEFERRED`));
    expect(migration).toContain('header.capture_transaction=pg_current_xact_id()');
    expect(migration).toContain('public.draft_selections_typed_value(content.id) IS DISTINCT FROM expected');
    expect(migration).toContain('draft_selections_source_not_newer');
    expect(migration).toContain('draft selections attempt receipt conflict');
  });
  it('freezes player evidence per acceptance through the existing directory and identity owner', () => {
    const capture = functionBody(migration, 'capture_draft_selection_player_links');
    expect(capture).toContain('version.id=head.accepted_version_id');
    expect(capture).toContain('owner_result:=public.upsert_scoring_entity_identities(identity_inputs)');
    expect(capture).toContain("'preserve_existing_metadata',true");
    expect(capture).toContain("outcome_value:='owner_unqualified'");
    expect(capture).toContain('estimated_bytes>8388608');
    expect(capture).toContain('octet_length(links::text)>8388608');
    expect(migration).toContain('PRIMARY KEY(selection_acceptance_id,source_ordinal)');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER draft_selection_link_counts');
    expect(migration).toContain('selection_receipt_id uuid NOT NULL UNIQUE');
  });
  it('closes private helpers and exposes only read tables and the existing writer boundary', () => {
    const acl = migration.slice(migration.lastIndexOf('REVOKE ALL ON public.league_draft_selections'));
    expect(acl).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)/u);
    expect(acl).toContain('public.record_league_administration_observation_v53(jsonb) FROM league_one_runtime');
    expect(acl).toContain('GRANT EXECUTE ON FUNCTION public.begin_draft_selections_attempt(jsonb,jsonb,uuid,jsonb),public.record_league_administration_observation(jsonb) TO league_one_runtime');
    const optional = provisioning.split('-- BEGIN OPTIONAL DRAFT SELECTIONS GRANTS')[1];
    for (const table of ['league_draft_selections', 'league_draft_selection_contents', 'league_draft_selection_catalog_entries',
      'league_draft_selection_entries', 'league_draft_selection_link_receipts', 'league_draft_selection_player_links']) expect(optional).toContain(`'${table}'`);
    expect(optional).toContain("'public.record_league_administration_observation_v53(jsonb)'");
    expect(optional).toContain('runtime can execute private draft selections helper');
  });
});

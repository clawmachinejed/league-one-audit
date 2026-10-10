import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../../database';

vi.mock('server-only', () => ({}));
import { createIdentityMethods } from './identities';
import { deterministicUuid } from './database-values';

type Call = { statement: string; parameters: readonly unknown[] };
function fixture(respond: (call: Call) => readonly DatabaseRow[]) {
  const calls: Call[] = [];
  const database: DatabaseClient = { enabled: true,
    query: async <Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = []) => {
      const call = { statement, parameters }; calls.push(call);
      return respond(call) as readonly Row[];
    } };
  return { calls, store: createIdentityMethods(database) };
}
const person = { key: 'player:001234', kind: 'player' as const, displayName: ' Native Name ', nflTeam: ' NE ',
  preserveExistingMetadata: true, providerIds: [{ provider: 'Sleeper', externalId: '001234' }] };
const defense = { key: 'team_defense:NE', kind: 'team_defense' as const, displayName: 'NE Defense', nflTeam: 'NE',
  providerIds: [{ provider: 'sleeper', externalId: 'NE' }] };

function results(call: Call, conflict = false) {
  return (JSON.parse(String(call.parameters[0])) as Array<{ input_key: string; proposed_id: string }>).map(value => ({
    input_key: value.input_key, proposed_id: value.proposed_id, entity_id: conflict ? null : value.proposed_id, conflict,
  }));
}

describe('shared scoring identity owner compatibility', () => {
  it('uses the installed shared owner with stable provider-only keys, metadata policy and input order', async () => {
    const f = fixture(call => call.statement.includes('capability') ? [{ installed: true }] : results(call));
    const value = await f.store.upsertScoringEntities([person, defense, { ...person, key: 'player:選手😀',
      providerIds: [{ provider: 'sleeper', externalId: '選手😀' }] }]);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].statement).toContain("to_regprocedure('public.upsert_scoring_entity_identities(jsonb)')");
    expect(f.calls[1].statement).toContain('public.upsert_scoring_entity_identities($1::jsonb)');
    const inputs = JSON.parse(String(f.calls[1].parameters[0]));
    expect(inputs).toMatchObject([
      { ordinal: 0, input_key: 'player:001234', display_name: 'Native Name', nfl_team: 'NE', preserve_existing_metadata: true,
        provider_ids: [{ provider: 'sleeper', external_id: '001234' }] },
      { ordinal: 1, input_key: 'team_defense:NE', kind: 'team_defense', preserve_existing_metadata: false },
      { ordinal: 2, input_key: 'player:選手😀' },
    ]);
    for (const input of inputs) expect(input.proposed_id).toBe(deterministicUuid('scoring-entity:' + input.kind, input.input_key));
    expect(value).toEqual({ kind: 'stored', value: inputs.map((input: { input_key: string; proposed_id: string }) => ({
      key: input.input_key, entityId: input.proposed_id, conflict: false,
    })) });
  });

  it('selects the exact legacy insert, fresh reread and orphan cleanup only when the helper is absent', async () => {
    const f = fixture(call => call.statement.includes('capability') ? [{ installed: false }]
      : call.statement.includes('resolve-scoring-entities') ? results(call, true) : []);
    expect(await f.store.upsertScoringEntities([person])).toEqual({ kind: 'stored', value: [
      { key: person.key, entityId: null, conflict: true },
    ] });
    expect(f.calls.map(call => call.statement.match(/projection-store:([a-z-]+)/u)?.[1])).toEqual([
      'scoring-identity-owner-capability', 'upsert-scoring-entities', 'resolve-scoring-entities', 'clean-orphan-scoring-entities',
    ]);
    expect(f.calls[1].statement).toContain('ON CONFLICT (provider, entity_kind, external_id) DO NOTHING');
    expect(f.calls[2].statement).toContain('cardinality(entity_ids) > 1 OR unusable');
    expect(f.calls[3].parameters).toEqual([[deterministicUuid('scoring-entity:player', person.key)]]);
  });

  it('does not retry an installed helper failure or identity conflict through legacy writes', async () => {
    const error = new Error('shared owner rejected');
    const failed = fixture(call => { if (call.statement.includes('capability')) return [{ installed: true }]; throw error; });
    await expect(failed.store.upsertScoringEntities([person])).rejects.toBe(error);
    expect(failed.calls).toHaveLength(2);
    const conflict = fixture(call => call.statement.includes('capability') ? [{ installed: true }] : results(call, true));
    expect(await conflict.store.upsertScoringEntities([person])).toEqual({ kind: 'stored', value: [
      { key: person.key, entityId: null, conflict: true },
    ] });
    expect(conflict.calls).toHaveLength(2);
  });

  it.each([{ response: [] }, { response: [{ installed: null }] }, { response: [{ installed: 'false' }] },
    { response: [{ installed: false }, { installed: true }] }])(
    'fails closed on an indeterminate capability response %#', async ({ response }) => {
      const f = fixture(() => response);
      await expect(f.store.upsertScoringEntities([person])).rejects.toThrow('capability is unavailable');
      expect(f.calls).toHaveLength(1);
    });

  it('keeps empty and duplicate identity validation ahead of capability and writes', async () => {
    const f = fixture(() => { throw new Error('unexpected SQL'); });
    expect(await f.store.upsertScoringEntities([])).toEqual({ kind: 'stored', value: [] });
    await expect(f.store.upsertScoringEntities([person, person])).rejects.toThrow('Duplicate scoring entity key');
    expect(f.calls).toHaveLength(0);
  });

  it('preserves legacy insert and reread SQL with post-wait validity and history-safe cleanup', async () => {
    const [typescript, migration] = await Promise.all([
      readFile(new URL('./identities.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../../../migrations/042_roster_player_links.sql', import.meta.url), 'utf8'),
    ]);
    const sql = (marker: string) => typescript.match(new RegExp('`/\\* projection-store:' + marker + ' \\*/([\\s\\S]*?)`'))![1]
      .trim().replaceAll('$1::jsonb', 'p_inputs').replace(/\s+/gu, ' ');
    const compact = migration.replace(/\s+/gu, ' ');
    expect(compact).toContain(sql('upsert-scoring-entities').replace('SELECT count(*) AS mappings_written FROM inserted_mappings',
      'SELECT count(*) INTO written_count FROM inserted_mappings'));
    expect(compact).toContain(sql('resolve-scoring-entities').replaceAll('statement_timestamp()', 'resolved_at_value'));
    expect(migration.indexOf('resolved_at_value:=clock_timestamp()')).toBeGreaterThan(migration.indexOf('SELECT count(*) INTO written_count'));
    expect(migration).toContain("jsonb_build_object('evaluatedAt',resolved_at_value,'rows',resolved_rows)");
    expect(migration).toContain("convert_to(p_scope,'UTF8')||decode('00','hex')||convert_to(p_key,'UTF8')");
    expect(migration).toContain('VOLATILE SECURITY INVOKER');
    expect(migration).toContain('historical.canonical_entity_id=entity.id');
  });
});

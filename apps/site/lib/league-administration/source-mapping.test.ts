import { describe, expect, it, vi } from 'vitest';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from './source-mapping';
import { captureAdministrationSourceMapping, recordCapturedAdministration } from './runtime';
import { createLeagueAdministrationStore } from './store';
import { createLeagueAdministrationMethods } from './neon/administration';
import type { DatabaseClient, DatabaseRow } from '../database';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock('../database', async importOriginal => ({ ...await importOriginal<object>(), getDatabase: mocks.database }));

const mapping: AdministrationSourceMapping = {
  connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
  revisionId: '33333333-3333-4333-8333-333333333333', generation: 2,
  scope: { provider: 'sleeper', leagueKey: 'fixture', externalLeagueId: 'opaque-2150', season: 2150 },
};
const row = { connection_id: mapping.connectionId, league_season_id: mapping.leagueSeasonId,
  revision_id: mapping.revisionId, mapping_generation: '2', league_key: mapping.scope.leagueKey,
  external_league_id: mapping.scope.externalLeagueId, provider: 'sleeper', season: 2150 };
const document = { family: 'rosters' as const, week: null, payload: [{ roster_id: 1, players: ['a'], reserve: [], taxi: [] }],
  origin: 'network' as const, requestStartedAt: '2026-09-28T12:00:00.000Z', requestCompletedAt: '2026-09-28T12:00:01.000Z' };

function client(respond: (sql: string, args: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, args: readonly unknown[] = []) {
    return respond(sql, args) as readonly Row[];
  } };
}

describe('captured source mapping boundary', () => {
  it('validates UUID scope and positive safe generations without treating provider IDs as numbers', () => {
    expect(isAdministrationSourceMapping(mapping)).toBe(true);
    for (const invalid of [{ ...mapping, generation: 0 }, { ...mapping, generation: 2 ** 53 },
      { ...mapping, revisionId: 'made-up' }, { ...mapping, scope: { ...mapping.scope, provider: 'yahoo' } }]) {
      expect(isAdministrationSourceMapping(invalid)).toBe(false);
    }
  });

  it('reads a single enrolled mapping with a bounded cancellation signal before acquisition', async () => {
    const events: string[] = [];
    const query = vi.fn(async (_sql, _parameters, options) => {
      events.push('mapping'); expect(options.signal).toBeInstanceOf(AbortSignal); return [row];
    });
    mocks.database.mockReturnValue({ enabled: true, query });
    const captured = await captureAdministrationSourceMapping(mapping.scope.externalLeagueId);
    events.push('fetch');
    expect(captured).toEqual(mapping); expect(events).toEqual(['mapping', 'fetch']);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]).toEqual([mapping.scope.externalLeagueId]);
  });

  it('fails closed on absent, ambiguous, malformed or unavailable new schema without a legacy retry', async () => {
    for (const rows of [[], [row, row], [{ ...row, mapping_generation: null }]]) {
      const store = createLeagueAdministrationMethods(client(() => rows));
      await expect(store.readSourceMapping(mapping.scope.externalLeagueId)).rejects.toThrow();
    }
    const query = vi.fn(() => { throw new Error('column does not exist'); });
    await expect(createLeagueAdministrationMethods(client(query)).readSourceMapping('source')).rejects.toThrow('column');
    expect(query).toHaveBeenCalledOnce();
  });

  it('keeps disabled preview free of mapping SQL and input inspection', async () => {
    const store = createLeagueAdministrationStore({ enabled: false, reason: 'preview-persistence-disabled' });
    expect(await captureAdministrationSourceMapping('source', store)).toBeNull();
  });

  it('sends the same prefetch token on changed-cache verification and preserves source age', async () => {
    const writes: Record<string, unknown>[] = [];
    const store = { enabled: true, ...createLeagueAdministrationMethods(client((_sql, args) => {
      writes.push(JSON.parse(String(args[0])));
      return [{ result: writes.length === 1 ? { status: 'stale', reason: 'unproven_cache_change' } : { status: 'changed' } }];
    })) };
    const verify = vi.fn(async () => document);
    await recordCapturedAdministration(mapping.scope, [{ ...document, origin: 'cache' }], { store, mapping, verify });
    expect(verify).toHaveBeenCalledOnce(); expect(writes).toHaveLength(2);
    expect(writes.map(value => value.sourceMapping)).toEqual([mapping, mapping]);
    expect(writes[0]).toMatchObject({ envelope: { provenance: { sourceObservedAt: null, origin: 'cache' } } });
    expect(writes[1]).toMatchObject({ envelope: { provenance: { sourceObservedAt: document.requestCompletedAt, origin: 'network' } } });
  });

  it('never retries a stale mapping as legacy or relabels a foreign scope', async () => {
    const query = vi.fn(() => { throw new Error('administration source mapping revision is stale'); });
    const store = { enabled: true, ...createLeagueAdministrationMethods(client(query)) };
    const verify = vi.fn();
    await expect(recordCapturedAdministration(mapping.scope, [document], { store, mapping, verify })).rejects.toThrow('stale');
    expect(query).toHaveBeenCalledOnce(); expect(verify).not.toHaveBeenCalled();
    await expect(recordCapturedAdministration({ ...mapping.scope, season: 2151 }, [document], { store, mapping })).rejects.toThrow('scope');
    expect(query).toHaveBeenCalledOnce();
  });
});

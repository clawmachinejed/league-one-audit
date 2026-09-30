import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../../database';
import { createLeagueAdministrationStore, createRetainedMatchupComparisonReader } from '../store';
import { retainedMatchupFixture, retainedMatchupSelection } from '../../aggregator/retained-matchups.fixtures';
import { RETAINED_MATCHUP_BATCH_LIMIT, RETAINED_MATCHUP_INVENTORY_LIMIT, RETAINED_MATCHUP_MAPPING_LIMIT,
  type RetainedMatchupSelection } from '../retained-matchups-contracts';
import { retainedMatchupMethods, RETAINED_MATCHUP_READ_SQL, RETAINED_MATCHUP_SCAN_SQL } from './retained-matchups';

vi.mock('server-only', () => ({}));
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const selection: RetainedMatchupSelection = { leagueSeasonId: id(1),
  scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'original-source', season: 2026 }, nativeWeeks: [3, 4] };
function database(respond: (sql: string, parameters: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) {
    return respond(sql, parameters) as readonly Row[];
  } };
}
const result = (evidence: readonly unknown[]) => [{ selection_valid: true, evidence_rows: evidence }];

describe('bounded retained matchup storage reads', () => {
  it('freezes one bounded inventory statement using the explicit original scope and deterministic order', async () => {
    const query = vi.fn(() => result([]));
    const store = retainedMatchupMethods(database(query));
    expect(await store.scanRetainedMatchups(selection)).toEqual({ status: 'available', evidence: [] });
    expect(query).toHaveBeenCalledExactlyOnceWith(RETAINED_MATCHUP_SCAN_SQL,
      [selection.leagueSeasonId, [3, 4], 'sleeper', 'original-source', 'league1', 2026]);
    expect(RETAINED_MATCHUP_SCAN_SQL).toContain('ORDER BY observation.week,observation.recorded_at,observation.id LIMIT 1001');
  });

  it('refuses inventory overflow instead of returning a truncated manifest', async () => {
    const evidence = { observation: { id: id(3) } };
    expect(await retainedMatchupMethods(database(() => result(Array(RETAINED_MATCHUP_INVENTORY_LIMIT + 1).fill(evidence))))
      .scanRetainedMatchups(selection)).toEqual({ status: 'unavailable', reason: 'retained_matchup_inventory_limit_exceeded' });
  });

  it('reads only fixed manifest observation IDs and leaves missing entries visible to the planner', async () => {
    const row = { observation: { id: id(4), provenance: { sourceObservedAt: '2026-09-15T12:00:00.123456Z' } },
      content: null, teamLinks: [{ team: null }], mapping: { revision: null } };
    const query = vi.fn(() => result([row]));
    const store = retainedMatchupMethods(database(query));
    expect(await store.readRetainedMatchups(selection, [id(3), id(4)])).toEqual({ status: 'available', evidence: [row] });
    expect(query).toHaveBeenCalledExactlyOnceWith(RETAINED_MATCHUP_READ_SQL,
      [selection.leagueSeasonId, [3, 4], [id(3), id(4)], 'league1', 2026]);
    // Neither source time nor broken immutable joins are replaced by present-day data.
    expect(RETAINED_MATCHUP_READ_SQL).toContain('LEFT JOIN public.league_season_teams team ON team.id=entry.team_id');
    expect(RETAINED_MATCHUP_READ_SQL).not.toContain('team.league_season_id=entry.league_season_id');
    expect(RETAINED_MATCHUP_READ_SQL).toContain("YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"");
  });

  it.each([
    { ...selection, nativeWeeks: [] }, { ...selection, nativeWeeks: [4, 3] },
    { ...selection, nativeWeeks: [3, 3] }, { ...selection, nativeWeeks: [0] },
    { ...selection, nativeWeeks: [19] }, { ...selection, leagueSeasonId: 'wrong' },
    { ...selection, scope: { ...selection.scope, season: 0 } },
    { ...selection, scope: { ...selection.scope, externalLeagueId: ' source ' } },
  ])('rejects malformed explicit selection before querying: %j', async invalid => {
    const query = vi.fn(() => []);
    const store = retainedMatchupMethods(database(query));
    expect(await store.scanRetainedMatchups(invalid)).toMatchObject({ status: 'unavailable', reason: 'invalid_retained_matchup_selection' });
    expect(await store.readRetainedMatchups(invalid, [id(3)])).toMatchObject({ status: 'unavailable' });
    expect(query).not.toHaveBeenCalled();
  });

  it('bounds exact rereads, refuses duplicate or malformed IDs, and makes an empty reread a no-op', async () => {
    const query = vi.fn(() => []);
    const store = retainedMatchupMethods(database(query));
    for (const ids of [[id(3), id(3)], ['bad-id'], Array.from({ length: RETAINED_MATCHUP_BATCH_LIMIT + 1 }, (_, i) => id(i))]) {
      expect(await store.readRetainedMatchups(selection, ids)).toMatchObject({ status: 'unavailable' });
    }
    expect(await store.readRetainedMatchups(selection, [])).toEqual({ status: 'available', evidence: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves immutable mapping revisions through A-to-B-to-A without consulting current mapping', async () => {
    const rows = [5, 7].map(revision => ({ observation: { id: id(revision + 10) },
      mapping: { revisionId: id(revision), revision: { id: id(revision), externalLeagueId: 'original-source' } } }));
    expect(await retainedMatchupMethods(database(() => result(rows))).scanRetainedMatchups(selection))
      .toEqual({ status: 'available', evidence: rows });
    for (const sql of [RETAINED_MATCHUP_SCAN_SQL, RETAINED_MATCHUP_READ_SQL]) {
      expect(sql).not.toMatch(/current_mapping|administration_heads|resource_heads|enrollment|INSERT|UPDATE|DELETE|begin_|record_/iu);
      expect(sql).toContain('revision.id=mapping.source_mapping_revision_id');
    }
  });

  it('bounds captured mappings and binds receipts and calculation inputs to the original provenance', async () => {
    const evidence = { observation: { id: id(3) }, mappingCandidates: Array(RETAINED_MATCHUP_MAPPING_LIMIT + 1).fill({}) };
    expect(await retainedMatchupMethods(database(() => result([evidence]))).scanRetainedMatchups(selection))
      .toEqual({ status: 'unavailable', reason: 'retained_matchup_mapping_limit_exceeded' });
    for (const alias of ['receipt', 'input']) {
      expect(RETAINED_MATCHUP_SCAN_SQL).toContain(`${alias}.provenance->>'origin'=observation.origin`);
      for (const [field, column] of [['requestStartedAt', 'request_started_at'], ['requestCompletedAt', 'request_completed_at'],
        ['sourceObservedAt', 'source_observed_at'], ['checkedAt', 'checked_at']]) {
        expect(RETAINED_MATCHUP_SCAN_SQL).toContain(`(${alias}.provenance->>'${field}')::timestamptz IS NOT DISTINCT FROM observation.${column}`);
      }
    }
    expect(RETAINED_MATCHUP_SCAN_SQL).toContain('ORDER BY kind,id LIMIT 101');
  });

  it('separates connection failures and malformed transport rows', async () => {
    const failed = retainedMatchupMethods(database(() => { throw new Error('database failed'); }));
    expect(await failed.scanRetainedMatchups(selection)).toEqual({ status: 'unavailable', reason: 'retained_matchup_database_unavailable' });
    expect(await failed.readRetainedMatchups(selection, [id(3)])).toEqual({ status: 'unavailable', reason: 'retained_matchup_database_unavailable' });
    expect(await retainedMatchupMethods(database(() => [{ selection_valid: true, evidence_rows: 'not-json' }])).scanRetainedMatchups(selection))
      .toEqual({ status: 'unavailable', reason: 'invalid_retained_matchup_evidence' });
  });

  it('rejects a wrong league key or season even when no observations match', async () => {
    const store = retainedMatchupMethods(database(() => [{ selection_valid: false, evidence_rows: [] }]));
    expect(await store.scanRetainedMatchups(selection)).toEqual({ status: 'unavailable', reason: 'retained_matchup_scope_mismatch' });
    expect(await store.readRetainedMatchups(selection, [id(3)])).toEqual({ status: 'unavailable', reason: 'retained_matchup_scope_mismatch' });
    expect(RETAINED_MATCHUP_SCAN_SQL).toContain('selected_league.league_key=$5');
    expect(RETAINED_MATCHUP_SCAN_SQL).toContain('selected_season.season=$6::integer');
  });

  it('uses the existing disabled facade without examining input or constructing a provider client', async () => {
    const store = createLeagueAdministrationStore({ enabled: false, reason: 'preview-persistence-disabled' });
    const poisoned = Object.defineProperty({}, 'leagueSeasonId', { get() { throw new Error('input examined'); } }) as RetainedMatchupSelection;
    expect(await store.scanRetainedMatchups(poisoned)).toEqual({ status: 'disabled', reason: 'persistence_disabled' });
    expect(await store.readRetainedMatchups(poisoned, [])).toEqual({ status: 'disabled', reason: 'persistence_disabled' });
  });

  it('starts a fresh database deadline for manifest creation and every resumed or retried batch', async () => {
    const controllers: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      expect(milliseconds).toBe(3_000);
      const controller = new AbortController(); controllers.push(controller); return controller.signal;
    });
    try {
      const evidence = retainedMatchupFixture(); const signals: AbortSignal[] = [];
      const client: DatabaseClient = { enabled: true,
        async query<Row extends DatabaseRow>(_sql: string, _parameters?: readonly unknown[], options?: DatabaseQueryOptions) {
          expect(options?.signal).toBeDefined(); expect(options?.signal?.aborted).toBe(false);
          signals.push(options!.signal!); return result([evidence]) as unknown as readonly Row[];
        } };
      const reader = createRetainedMatchupComparisonReader(client);
      expect(controllers).toHaveLength(0);
      const planned = await reader.createManifest(retainedMatchupSelection);
      if (planned.status !== 'available') throw new Error('Missing fixture manifest.');
      controllers[0].abort();
      const first = await reader.compareBatch({ manifest: planned.manifest, batchSize: 1 });
      expect(first.status).toBe('complete'); controllers[1].abort();
      expect(await reader.compareBatch({ manifest: planned.manifest, batchSize: 1 })).toEqual(first);
      expect(signals).toHaveLength(3); expect(new Set(signals).size).toBe(3);
    } finally { timeout.mockRestore(); }
  });
});

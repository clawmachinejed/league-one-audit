import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { measuredReaderDatabase, readerFailureDiagnostic, ReaderCorrectnessError, readerPercentiles, runReaderSchedule, READER_PERFORMANCE_SCHEDULE,
  assertCompleteReaderPerformanceEvidence, createReaderSourceDataset, readerDigest, READER_SOURCE_DIGEST,
  READER_PERFORMANCE_PROFILE, READER_PERFORMANCE_MODULE, READER_PERFORMANCE_TESTS,
  type ReaderPerformanceEvidence, type QueryMeasurement, type ReaderSample } from './reader-performance';
import type { QualificationBinding } from './qualification-profile';
import { PUBLIC_OFFICIAL_STANDINGS_SQL } from '../lib/league-administration/public-official-results-reader';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { projectExactMatchupValues } from '../lib/aggregator/exact-matchup-values';
import { projectPlayoffBracket } from '../lib/aggregator/playoff-brackets';
import { projectWeeklyReport } from '../lib/aggregator/weekly-reports';
import { projectDraftMetadata, DRAFT_METADATA_VERSION } from '../lib/aggregator/draft-metadata';
import { projectDraftSelections, DRAFT_SELECTIONS_VERSION } from '../lib/aggregator/draft-selections';
import { projectTradedPicks, TRADED_PICKS_VERSION } from '../lib/aggregator/traded-picks';
import { normalizePlayerDirectoryRow } from '../lib/league-administration/player-directory';
import type { AdministrationFamily, JsonValue } from '../lib/league-administration/contracts';

const sample = (index: number, elapsedMs: number, status: ReaderSample['status'] = 'passed'): ReaderSample => ({
  ...READER_PERFORMANCE_SCHEDULE[index], lane: index % 10, startedMs: 0, elapsedMs, status,
  failure: status === 'passed' ? 'none' : 'reader-or-correctness', statements: 1, rows: 1,
  decodedBytes: 2, statementMs: 1, resultDigest: 'a'.repeat(64), failureDetail: status === 'failed' ? { stage: 'reader', checkpoint: null, category: 'unknown', code: 'unknown' } : null, sqlFailure: null,
});
describe('CP27 bounded reader measurement without SQL qualification', () => {
  const binding: QualificationBinding = { directory: '/not-executed', context: { kind: 'integration-qualification-context-v1',
    runId: '11111111-1111-4111-8111-111111111111', nonce: '22222222-2222-4222-8222-222222222222', gitSha: 'a'.repeat(40),
    profile: READER_PERFORMANCE_PROFILE, profileDigest: 'b'.repeat(64), modules: [{ path: READER_PERFORMANCE_MODULE, sourceDigest: 'c'.repeat(64) }] } };
  let dataset: ReturnType<typeof createReaderSourceDataset>, specimen: ReaderPerformanceEvidence;
  beforeAll(() => {
    // Build the source once for both normalization and evidence checks; each adverse
    // case receives its own specimen clone and never rebuilds the entire fleet.
    dataset = createReaderSourceDataset();
    const sql = 'SELECT 1 AS value', digest = readerDigest(sql);
    specimen = { kind: 'data-reader-performance-evidence-v1', contextDigest: readerDigest(binding.context), gitSha: binding.context.gitSha,
      runId: binding.context.runId, profile: READER_PERFORMANCE_PROFILE, setupResponseCount: 865, operationalResets: 16,
      serverVersion: '18.6', serverVersionNum: '180006', runtimeLogin: 'league_one_runtime', transport: 'production-neon-http', sourceDigest: READER_SOURCE_DIGEST,
      dataset: { leagues: 16, rosters: 320, weeks: 288, players: 160, requestIds: Array.from({ length: 16 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
        receiptCount: 700, sourceBindings: dataset.leagues.map(readerDigest) },
      cases: READER_PERFORMANCE_TESTS.map((name, i) => ({ name, state: 'passed', startedAt: new Date(1_000_000 + i * 1_000).toISOString(), endedAt: new Date(1_000_500 + i * 1_000).toISOString() })),
      samples: READER_PERFORMANCE_SCHEDULE.map((_, i) => sample(i, 100)), maximumActive: 10, elapsedMs: 10_000,
      lists: Array.from({ length: 32 }, (_, i) => ({ kind: i % 2 ? 'player-directory' : 'period-task-list', elapsedMs: 100, rows: i % 2 ? 160 : 18,
        bound: i % 2 ? 200 : 360, digest: 'd'.repeat(64), statements: 1, statementRows: 1, decodedBytes: 2 })),
      queries: [{ digest, sql, calls: 1032, failures: 0, rows: 1032, decodedBytes: 2064, elapsedMs: 1032, firstFailure: null }],
      plans: [{ digest, sql, parameterDigest: readerDigest([]), explainedRows: 1, plan: [{ 'QUERY PLAN': [{ Plan: { 'Actual Rows': 1 } }] }] }],
      tableCounts: [{ table: 'league_roster_capture_receipts', rows: 700, totalBytes: 8192 }], beforeDigest: 'e'.repeat(64), afterDigest: 'e'.repeat(64),
      snapshotFailure: null, snapshotCleanupFailures: [], providerRequests: 0, blockedFetches: 0, cleanupComplete: true };
  }, 30_000);
  it('freezes all slots both500-read classes and sixteen single-league identities', () => {
    expect(READER_PERFORMANCE_SCHEDULE).toHaveLength(1_000);
    expect(READER_PERFORMANCE_SCHEDULE.filter(row => row.kind === 'current')).toHaveLength(500);
    expect(READER_PERFORMANCE_SCHEDULE.filter(row => row.kind === 'history')).toHaveLength(500);
    expect(new Set(READER_PERFORMANCE_SCHEDULE.map(row => row.league)).size).toBe(16);
    expect(READER_PERFORMANCE_SCHEDULE.filter(row => row.temperature === 'first-reader-call')).toHaveLength(32);
  });
  it('uses nearest rank and retains failed slots as positive infinity', () => {
    const rows = Array.from({ length: 100 }, (_, i) => sample(i, i + 1));
    expect(readerPercentiles(rows)).toMatchObject({ p50Ms: 50, p95Ms: 95, p99Ms: 99, maximumMs: 100 });
    rows[98] = sample(98, 1, 'failed'); rows[99] = sample(99, 1, 'unserved');
    expect(readerPercentiles(rows)).toMatchObject({ count: 100, passed: 98, failed: 1, unserved: 1, p95Ms: 95, p99Ms: null, maximumMs: null });
  });
  it('uses ten actual in-flight lanes and keeps correctness failures without replacement', async () => {
    let active = 0, peak = 0, calls = 0;
    const queries = new Map<string, QueryMeasurement>();
    const result = await runReaderSchedule({ database: { enabled: true, query: async () => [] }, queries,
      read: async slot => { active++; peak = Math.max(peak, active); calls++;
        await new Promise(resolve => setTimeout(resolve, 1)); active--; return slot.index; },
      verify: (slot, value) => { expect(value).toBe(slot.index); if (slot.index === 41) throw new Error('corrupt result'); return 'a'.repeat(64); } });
    expect(peak).toBe(10); expect(result.maximumActive).toBe(10); expect(calls).toBe(1_000);
    expect(result.samples.filter(row => row.status === 'failed').map(row => row.index)).toEqual([41]);
    expect(result.samples.filter(row => row.status === 'passed')).toHaveLength(999);
  });
  it('retains every unserved slot after the fixed budget expires', async () => {
    let calls = 0;
    const result = await runReaderSchedule({ database: { enabled: true, query: async () => [] }, queries: new Map(), maximumMs: 0,
      read: async () => { calls++; }, verify: () => 'a'.repeat(64) });
    expect(calls).toBe(0); expect(result.samples).toHaveLength(1_000);
    expect(readerPercentiles(result.samples)).toMatchObject({ unserved: 1_000, p95Ms: null, p99Ms: null });
  });
  it('records decoded rows and failed queries while rejecting writes before dispatch', async () => {
    let calls = 0; const queries = new Map<string, QueryMeasurement>(), measurement = sample(0, 1);
    measurement.statements = 0; measurement.rows = 0;
    const database = measuredReaderDatabase({ enabled: true, query: async <Row>() => {
      calls++; if (calls === 2) throw new Error('database unavailable'); return [{ value: 'native' }] as Row[];
    } }, queries, measurement);
    await database.query('/* reader */ SELECT value FROM public.test WHERE id=$1', ['one']);
    await expect(database.query('/* reader */ SELECT value FROM public.test WHERE id=$1', ['two'])).rejects.toThrow();
    await expect(database.query('DELETE FROM public.test')).rejects.toThrow('non-SELECT');
    await expect(database.query('WITH changed AS (DELETE FROM public.test) SELECT 1')).rejects.toThrow('attempted a write');
    expect(calls).toBe(2); expect(measurement.statements).toBe(2); expect(measurement.rows).toBe(1);
    expect([...queries.values()][0]).toMatchObject({ calls: 2, failures: 1, rows: 1, parameters: ['one'] });
  });
  it('retains distinct SQL, reader and correctness failure stages without leaking raw errors', async () => {
    const secret = 'postgres://private-user:secret@private-host/database';
    const queries = new Map<string, QueryMeasurement>();
    const result = await runReaderSchedule({ database: { enabled: true, query: async () => { throw Object.assign(new Error(secret), { code: '53200' }); } }, queries,
      read: async (slot, database) => { if (slot.index % 3 === 0) return database.query('SELECT 1');
        if (slot.index % 3 === 1) throw Object.assign(new Error(secret), { code: 'ECONNRESET' }); return {}; },
      verify: () => { throw new ReaderCorrectnessError('exact-periods', Object.assign(new Error(secret), { code: 'ERR_ASSERTION' })); } });
    expect(result.samples.every(row => row.status === 'failed')).toBe(true);
    expect(result.samples[0]).toMatchObject({ failureDetail: { stage: 'reader', category: 'postgresql', code: '53200' },
      sqlFailure: { queryDigest: readerDigest('SELECT 1'), category: 'postgresql', code: '53200' } });
    expect(result.samples[1]).toMatchObject({ failureDetail: { stage: 'reader', category: 'transport', code: 'ECONNRESET' }, sqlFailure: null });
    expect(result.samples[2]).toMatchObject({ failureDetail: { stage: 'correctness', checkpoint: 'exact-periods', category: 'assertion', code: 'unknown' }, sqlFailure: null });
    expect([...queries.values()][0].firstFailure).toEqual({ category: 'postgresql', code: '53200' });
    expect(JSON.stringify({ samples: result.samples, queries: [...queries.values()] })).not.toContain(secret);
  });
  it('retains the first SQL failure even if the reader converts it to an unavailable resource', async () => {
    const measurement = sample(0, 1), queries = new Map<string, QueryMeasurement>(); let calls = 0;
    const database = measuredReaderDatabase({ enabled: true, query: async () => { calls++;
      throw Object.assign(new Error('private'), { code: calls === 1 ? '53200' : '57014' }); } }, queries, measurement);
    await database.query('SELECT 1').catch(() => undefined); await database.query('SELECT 2').catch(() => undefined);
    expect(measurement.sqlFailure).toEqual({ queryDigest: readerDigest('SELECT 1'), category: 'postgresql', code: '53200' });
    expect([...queries.values()].map(row => row.firstFailure?.code)).toEqual(['53200', '57014']);
  });
  it('does not pass a SQL failure hidden by a reader fallback even when the oracle accepts its result', async () => {
    const result = await runReaderSchedule({ database: { enabled: true, query: async () => { throw { code: '53200' }; } }, queries: new Map(),
      read: async (_slot, database) => { await database.query('SELECT 1').catch(() => undefined); return {}; }, verify: () => 'a'.repeat(64) });
    expect(result.samples.every(row => row.status === 'failed' && row.resultDigest === null && row.failureDetail?.stage === 'reader')).toBe(true);
    expect(readerPercentiles(result.samples).p95Ms).toBeNull();
  });
  it('uses closed failure labels without invoking hostile getters or serializing arbitrary fields', () => {
    const hostile = Object.defineProperty({}, 'code', { get() { throw Error('do not invoke'); } });
    for (const error of [hostile, new Proxy({}, { getOwnPropertyDescriptor() { throw Error('private'); } }), { code: 'secret', message: 'secret' }, 'secret'])
      expect(readerFailureDiagnostic(error)).toEqual({ category: 'unknown', code: 'unknown' });
    expect(readerFailureDiagnostic(new Error('private'), true)).toEqual({ category: 'deadline', code: 'unknown' });
    expect(readerFailureDiagnostic({ code: '53200' }, true)).toEqual({ category: 'postgresql', code: '53200' });
  });
  it('permits the actual maintained official-standings read-only WITH query', async () => {
    const database = measuredReaderDatabase({ enabled: true, query: async () => [] }, new Map(), sample(0, 1));
    await expect(database.query(PUBLIC_OFFICIAL_STANDINGS_SQL)).resolves.toEqual([]);
  });
  it('normalizes every source family and all288 exact periods with the maintained projections offline', () => {
    expect(dataset.leagues).toHaveLength(16); expect(Object.keys(dataset.players)).toHaveLength(160);
    for (const [id, row] of Object.entries(dataset.players)) expect(normalizePlayerDirectoryRow(id, row as JsonValue).identityStatus).toBe('valid');
    for (const league of dataset.leagues) {
      const normalize = (family: AdministrationFamily, payload: unknown, week: number | null = null) => normalizeAdministrationObservation({
        schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
        scope: { leagueKey: league.key, provider: 'sleeper', externalLeagueId: league.native, season: 2026 }, family, week,
        completeness: 'complete', payload: payload as JsonValue,
        // Authored source timestamps for pure projection compatibility, never SQL/network evidence.
        provenance: family === 'drafts' ? { origin: 'network', requestStartedAt: '2026-10-18T00:00:00.000Z', requestCompletedAt: '2026-10-18T00:00:00.000Z',
          sourceObservedAt: '2026-10-18T00:00:00.000Z', checkedAt: '2026-10-18T00:00:00.000Z' }
          : { origin: 'bootstrap', requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null, checkedAt: '2026-10-18T00:00:00.000Z' },
      }, { expectedRosterCount: 20, managerEvidenceVersion: 'v2' });
      for (const [family, payload, week] of [['league', league.payload, null], ['rosters', league.rosters, null], ['users', league.users, null],
        ['transactions', league.transactions, 7], ['weekly_report', league.report, 7]] as const) expect(normalize(family, payload, week).status).toBe('accepted');
      expect(new Set(league.rosters.flatMap(row => row.players)).size).toBe(160);
      league.matchups.forEach((rows, index) => {
        const result = projectExactMatchupValues(normalize('matchups', rows, index + 1), league.rosters.map(roster => ({ seasonTeamId: 'offline-' + roster.roster_id, externalRosterId: String(roster.roster_id) })));
        expect(result.teams).toHaveLength(20); expect(result.nativeWeek).toBe(index + 1);
        expect(result.teams[0].effectivePoints.value).toBe(index === 5 ? '0' : String(rows[0].points));
      });
      expect(projectPlayoffBracket(normalize('winners_bracket', league.winners)).status).toBe('accepted');
      expect(projectPlayoffBracket(normalize('losers_bracket', league.losers)).status).toBe('accepted');
      expect(projectWeeklyReport(normalize('weekly_report', league.report, 7)).value?.teams).toHaveLength(20);
      const catalog = { metadataVersion: DRAFT_METADATA_VERSION, kind: 'catalog', catalog: [league.draft], details: [], reason: null };
      const detail = { metadataVersion: DRAFT_METADATA_VERSION, kind: 'detail', externalDraftId: league.draft.draft_id, catalog: league.draft, draft: league.draft };
      const picks = { selectionsVersion: DRAFT_SELECTIONS_VERSION, kind: 'selections', externalDraftId: league.draft.draft_id, catalog: league.draft, picks: league.picks };
      expect(projectDraftMetadata(normalize('drafts', catalog)).status).toBe('accepted');
      expect(projectDraftMetadata(normalize('drafts', detail)).status).toBe('accepted');
      expect(projectDraftSelections(normalize('drafts', picks)).status).toBe('accepted');
      for (const kind of ['league', 'draft'] as const) expect(projectTradedPicks(normalize('drafts', { tradedPicksVersion: TRADED_PICKS_VERSION, kind,
        ...(kind === 'draft' ? { externalDraftId: league.draft.draft_id, catalog: league.draft } : {}), tradedPicks: league.trades })).status).toBe('accepted');
    }
    expect(readerDigest(dataset)).toBe(READER_SOURCE_DIGEST);
  }, 30_000);
  it('accepts a complete offline evidence specimen', () => {
    expect(() => assertCompleteReaderPerformanceEvidence(specimen, binding)).not.toThrow();
  });
  const mutations: [string, (value: ReaderPerformanceEvidence) => void][] = [
    ['missing slot', value => { value.samples.pop(); }],
    ['duplicate slot', value => { value.samples[2].index = 1; }],
    ['wrong reader class', value => { value.samples[0].kind = 'history'; }],
    ['wrong league identity', value => { value.samples[0].league = 15; }],
    ['duplicate request identity', value => { value.dataset.requestIds[1] = value.dataset.requestIds[0]; }],
    ['wrong source digest', value => { value.sourceDigest = 'f'.repeat(64); }],
    ['wrong league source binding', value => { value.dataset.sourceBindings[0] = 'f'.repeat(64); }],
    ['missing query inventory', value => { value.queries = []; value.plans = []; }],
    ['missing query plan', value => { value.plans = []; }],
    ['incorrect row total', value => { value.samples[0].rows++; }],
    ['reordered cases', value => { value.cases.reverse(); }],
    ['overlapping cases', value => { value.cases[1].startedAt = value.cases[0].startedAt; }],
    ['failed read', value => { value.samples[0].status = 'failed'; }],
    ['failed latency target', value => { value.samples.forEach(row => { row.elapsedMs = 501; }); }],
    ['incorrect roster count', value => { value.dataset.rosters = 20; }],
    ['changed stored state', value => { value.beforeDigest = 'f'.repeat(64); }],
    ['unrecognized diagnostic code', value => { value.queries[0].failures = 1; value.queries[0].firstFailure = { category: 'postgresql', code: 'private' as '53200' }; }],
    ['raw diagnostic fields', value => { value.samples[0].failureDetail = { stage: 'reader', category: 'unknown', code: 'unknown', message: 'private' } as never; }],
    ['failed snapshot', value => { value.snapshotFailure = { stage: 'fetch', table: 'leagues', code: '53200' }; }],
    ['provider request', value => { value.providerRequests = 1; }],
  ];
  it.each(mutations)('rejects an offline evidence specimen with %s', (_name, mutate) => {
    const corrupted = structuredClone(specimen); mutate(corrupted);
    expect(() => assertCompleteReaderPerformanceEvidence(corrupted, binding)).toThrow();
  });
});

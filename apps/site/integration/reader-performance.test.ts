import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
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

import { bindStorageFixture, loadStorageFixture, createStorageSourceDataset, storageReplayBoundary, STORAGE_PHASES, STORAGE_PACKAGED_CATALOG_PATH } from './reader-performance';
import type { LeagueAdministrationStore } from '../lib/league-administration/store-contracts';
import type { PublicIntakeStore } from '../lib/league-administration/public-intake-contracts';
const cp28Catalog = () => Object.fromEntries(Array.from({length:164},(_,i)=>{const id=String(1000+i),position=['QB','RB','WR','TE'][i%4];return [id,{player_id:id,position,fantasy_positions:[position]}];}));
const cp28Metadata={rawCatalogPath:'test-results/cp28-fixture/sleeper-players-nfl.raw.json',capturedAt:'2026-10-18T21:09:02.281Z',provenance:'Offline synthetic fixture only; never complete live-catalog proof.'};
describe('CP28 focused offline fixture and exact replay boundary',()=>{
  it('binds exact bytes, complete mapping, all cumulative source versions and the fixed matrix arithmetic',async()=>{
    const raw=JSON.stringify(cp28Catalog()),manifest=await bindStorageFixture(raw,cp28Metadata),source=createStorageSourceDataset(manifest.mapping);
    expect(manifest.mapping).toHaveLength(160);expect(new Set(manifest.mapping).size).toBe(160);expect(manifest.sourceBindings).toHaveLength(12);expect(source).toHaveLength(2);
    for(const league of source){expect(league.versions.map(rows=>rows.reduce((sum,row)=>sum+row.players.length,0))).toEqual([160,160,159,159,159]);
      expect(league.versions[1][0].starters).toEqual([manifest.mapping[4],manifest.mapping[1],manifest.mapping[2],manifest.mapping[3]]);
      expect(league.versions[2][0].taxi).toEqual([]);expect(league.versions[3][1].players.at(-1)).toBe(manifest.mapping[5]);
      expect(league.versions[4][0].owner_id).toBe(String(BigInt(league.manager)+20n));expect(league.versions[4][0].settings.fpts).toBe(81);expect(league.versions[4][0].settings.fpts_decimal).toBe(25);}
    expect(2*(17*160+160+3*159)).toBe(6714);expect(STORAGE_PHASES).toHaveLength(17);
    expect((await bindStorageFixture(raw+' ',cp28Metadata)).rawSha256).not.toBe(manifest.rawSha256);
    expect((await bindStorageFixture(raw,cp28Metadata)).fixtureDigest).toBe(manifest.fixtureDigest);
    source[0].payload.name='mutated offline copy';source[0].versions[0][0].settings.fpts=-1;source[0].versions[0][0].players.pop();
    const independent=createStorageSourceDataset(manifest.mapping);expect(independent[0].payload.name).not.toBe('mutated offline copy');expect(independent[0].versions[0][0].settings.fpts).toBe(80);expect(independent[0].versions[0][0].players).toHaveLength(8);
  });
  it.each(['duplicate','insufficient','conflict','position','path','oversize'] as const)('rejects %s catalog binding without inventing identities',async fault=>{
    const catalog=cp28Catalog();if(fault==='insufficient')delete catalog['1000'];
    if(fault==='insufficient')for(let i=1001;i<1020;i++)delete catalog[String(i)];
    if(fault==='conflict')for(const row of Object.values(catalog))row.player_id='foreign';
    if(fault==='position')for(const row of Object.values(catalog))row.fantasy_positions=['QB','RB'];
    const raw=fault==='duplicate'?' {"1000":{},"1000":{}}':fault==='oversize'?' '.repeat(16*1024*1024+1):JSON.stringify(catalog);
    await expect(bindStorageFixture(raw,{...cp28Metadata,...(fault==='path'?{rawCatalogPath:'../outside.json'}:{})})).rejects.toThrow();
  });
  function replay(fault=''){
    const requestId='11111111-1111-4111-8111-111111111111',fence={jobKey:'league-administration-public-intake',workerId:'worker',generation:1,deadlineAt:new Date(Date.now()+20_000).toISOString()};
    let calls=0,audits=0;const seen:unknown[][]=[];
    const result=(family:string)=>({status:'changed',observationId:family,versionId:family,generation:1,...(family==='league'?{leagueSettingsAcceptance:{status:'accepted',receiptId:'settings',acceptedGeneration:1}}:{rosterAcceptance:{status:'accepted',receiptId:'players',acceptedGeneration:1},teamManagerAcceptance:{status:'accepted',receiptId:'managers',acceptedGeneration:1},teamManagerEvidenceAcceptance:{status:'accepted',receiptId:'v2',acceptedGeneration:1}})});
    const writer=vi.fn(async(...args:unknown[])=>{seen.push(args);calls++;const family=(args[0] as {envelope:{family:string}}).envelope.family;const value=result(family);
      if(calls>2){value.status=fault==='rejected'?'rejected':fault==='stale'?'stale':'replayed';if(fault==='receipt')value.observationId='foreign';if(fault==='preserved'&&'leagueSettingsAcceptance' in value&&value.leagueSettingsAcceptance)value.leagueSettingsAcceptance.status='preserved';}return value;});
    const complete=vi.fn(async()=>{}),completed=vi.fn();
    const boundary=storageReplayBoundary({recordObservation:writer} as unknown as LeagueAdministrationStore,{completeCore:complete} as unknown as PublicIntakeStore,
      {requestId,audit:async()=>({rows:fault==='mutation'?++audits:2}),completed});
    const args=[{envelope:{family:'league'}},fence],rosters=[{envelope:{family:'rosters'}},fence];
    const run=async()=>{await boundary.administration.recordObservation(...args as Parameters<LeagueAdministrationStore['recordObservation']>);
      if(fault!=='missing')await boundary.administration.recordObservation(...rosters as Parameters<LeagueAdministrationStore['recordObservation']>);
      if(fault==='mutated-tuple')(args[0] as {envelope:{family:string}}).envelope.family='changed';
      if(fault==='expired')fence.deadlineAt='2000-01-01T00:00:00.000Z';
      await boundary.intake.completeCore({kind:'core',requestId:fault==='foreign'?'foreign':requestId} as Parameters<PublicIntakeStore['completeCore']>[0],{} as Parameters<PublicIntakeStore['completeCore']>[1],{observations:{}},fence);};
    return{run,writer,complete,completed,seen,args,rosters};
  }
  it('replays the identical original argument objects once before one acknowledgement',async()=>{const test=replay();await test.run();expect(test.writer).toHaveBeenCalledTimes(4);expect(test.complete).toHaveBeenCalledTimes(1);expect(test.completed).toHaveBeenCalledTimes(1);
    expect(test.seen[2][0]).toBe(test.args[0]);expect(test.seen[3][0]).toBe(test.rosters[0]);expect(test.seen[2][1]).toBe(test.args[1]);});
  it.each(['rejected','stale','preserved','receipt','mutation','missing','foreign','expired','mutated-tuple'])('refuses %s replay without acknowledging',async fault=>{const test=replay(fault);await expect(test.run()).rejects.toThrow();expect(test.complete).not.toHaveBeenCalled();expect(test.completed).not.toHaveBeenCalled();});
});

import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORAGE_RELATIONS, type StoragePhaseEvidence } from './reader-performance-snapshot';
import { assertCompleteStorageMeasurementEvidence, assertStorageBaseline, storagePhaseDeltas, STORAGE_LIMITATIONS, STORAGE_MEASUREMENT_PROFILE, STORAGE_RESOURCE_SERVICE_SEED_DIGEST,
  storageReplayAuditStatement, type StorageMeasurementEvidence } from './reader-performance';
import { compatibleRevision } from '../lib/projections/shared/revision-compatibility';
async function cp28EvidenceSpecimen(){
  const fixture=JSON.parse(await readFile(new URL('../../../docs/aggregator-backend/data-backend-cp28-measurement-fixture.json',import.meta.url),'utf8'));
  const binding:QualificationBinding={directory:'/not-executed',context:{kind:'integration-qualification-context-v1',runId:'11111111-1111-4111-8111-111111111111',nonce:'22222222-2222-4222-8222-222222222222',gitSha:'a'.repeat(40),profile:STORAGE_MEASUREMENT_PROFILE,profileDigest:'b'.repeat(64),modules:[{path:'integration/reader-performance.qualification-case.ts',sourceDigest:'c'.repeat(64)}]}};
  const final:Record<string,number>={league_roster_resource_attempts:168,league_roster_capture_receipts:168,league_roster_resource_acceptances:168,league_roster_player_link_receipts:42,league_roster_player_links:6714,league_official_standings_contents:10,league_official_standings_teams:200,league_official_standings_captures:42,league_administration_contents:12,league_administration_observations:12,league_administration_team_entries:200,league_administration_manager_entries:0,league_team_manager_entries:400,league_administration_memberships:208,league_team_manager_memberships:416,league_roster_resource_scopes:8,league_roster_resource_heads:8,league_season_teams:40,league_source_manager_accounts:42,scoring_entities:160,external_scoring_entity_ids:160,league_player_directory_entries:fixture.entryCount,public_data_intakes:42,public_data_identity_observations:42,public_data_league_lists:42,public_data_league_candidates:42,public_data_dispatches:42,public_data_dispatch_outcomes:42,projection_jobs:1,public_data_resource_service:1};
  for(const suffix of ['heads','attempts','contents','captures','source_slices','versions'])final['league_player_directory_'+suffix]=1;
  const cores=[0,0,0,1,1,2,18,34,35,36,37,38,39,40,41,42,42];
  const metadata=STORAGE_RELATIONS.map((row,index)=>({schemaname:row.schema,tablename:row.table,oid:String(index+1),relkind:'r',owner:'test_owner',dependencies:[],columns:[],constraints:[],indexes:[]}));
  const phases:StoragePhaseEvidence[]=STORAGE_PHASES.map((name,index)=>{
    const relations=STORAGE_RELATIONS.map((row,ordinal)=>{let rows=Math.floor((final[row.table]??0)*cores[index]/42);
      if(['league_roster_resource_attempts','league_roster_capture_receipts','league_roster_resource_acceptances'].includes(row.table))rows=cores[index]*4;
      if(['league_roster_player_link_receipts','league_official_standings_captures'].includes(row.table))rows=cores[index];
      const seeded=row.table==='public_data_resource_service';if(seeded)rows=1;
      return{...row,oid:ordinal+1,owner:'test_owner',dependencies:[],...(index===0?{metadata:{kind:'r',columns:[],constraints:[],indexes:[]}}:{}),rows,digest:seeded?STORAGE_RESOURCE_SERVICE_SEED_DIGEST:readerDigest([row.table,rows]).slice(0,32),totalBytes:8192,tableBytes:8192,indexBytes:0,heapMainBytes:8192,heapFsmBytes:0,heapVmBytes:0,heapInitBytes:0,toastAndAuxBytes:0,tupleBytes:rows*(seeded?48:100),jsonBytes:rows*(seeded?95:120)};});
    return{name,digest:readerDigest(relations.map(row=>({table:row.schema+'.'+row.table,rows:row.rows,digest:row.digest}))),metadataDigest:readerDigest(metadata),relations,allocatedBytes:154*8192,databaseBytes:2000000,totalRows:relations.reduce((sum,row)=>sum+row.rows,0),elapsedMs:1};});
  const sequence=[{league:0,correction:0},{league:1,correction:0},...[0,1].flatMap(league=>Array.from({length:16},()=>({league,correction:0}))),...Array.from({length:4},(_,index)=>index+1).flatMap(correction=>[0,1].map(league=>({league,correction})))];
  const uuid=(value:number)=>'00000000-0000-4000-8000-'+String(value).padStart(12,'0');
  const captures=sequence.map((entry,index)=>({...entry,requestId:uuid(index+1),held:entry.correction<2?160:159,receipts:Array.from({length:4},(_,slot)=>uuid(1000+index*4+slot)),resultDigest:'d'.repeat(64),elapsedMs:1}));
  const evidence:StorageMeasurementEvidence={kind:'data-cp28-storage-evidence-v1',profile:STORAGE_MEASUREMENT_PROFILE,gitSha:binding.context.gitSha,contextDigest:readerDigest(binding.context),fixtureDigest:fixture.fixtureDigest,runId:binding.context.runId,state:'passed',startedAt:'2026-10-18T00:00:00.000Z',endedAt:'2026-10-18T00:01:00.000Z',serverVersion:'offline specimen',runtimeLogin:'league_one_runtime',fixtureResponses:85,responseBytes:100,statements:2000,snapshotCleanupStatements:17,resourceReads:172,catalogPages:62,catalogDigest:'e'.repeat(64),captures,replays:captures.slice(-2).map(row=>({requestId:row.requestId,tupleDigests:['f'.repeat(64),'a'.repeat(64)],stateDigest:'b'.repeat(64)})),phases,deltas:storagePhaseDeltas(phases),failure:null,cleanupComplete:true,limitations:STORAGE_LIMITATIONS};
  return{binding,evidence};
}
describe('CP28 bounded companion acceptance, synthetic evidence only',()=>{
  it('accepts internally reconciled frozen evidence and computes16-capture finite differences',async()=>{const{binding,evidence}=await cp28EvidenceSpecimen();await expect(assertCompleteStorageMeasurementEvidence(evidence,binding)).resolves.toBeUndefined();
    expect(()=>assertStorageBaseline(evidence.phases[0])).not.toThrow();
    expect(evidence.phases.every(phase=>phase.relations.find(row=>row.table==='public_data_resource_service')?.rows===1)).toBe(true);
    expect(evidence.deltas?.[5]).toMatchObject({before:'S5-B-baseline',after:'S6-A-unchanged',captures:16,meanDataAllocatedBytesPerCapture:0});expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThan(4*1024*1024);});
  it.each(['fixture','order','counter-type','elapsed-type','relation','allocation','digest','metadata','final-count','delta','missing-phase','cleanup'] as const)('rejects %s companion drift',async fault=>{
    const{binding,evidence}=await cp28EvidenceSpecimen();if(fault==='fixture')evidence.fixtureDigest='0'.repeat(64);if(fault==='order')[evidence.captures[0],evidence.captures[1]]=[evidence.captures[1],evidence.captures[0]];
    if(fault==='counter-type')evidence.statements='2000' as unknown as number;if(fault==='elapsed-type')evidence.captures[0].elapsedMs='1' as unknown as number;
    if(fault==='relation')evidence.phases[1].relations[0].group='shared';if(fault==='allocation')evidence.phases[1].relations[0].indexBytes=1;if(fault==='digest')evidence.phases[1].digest='0'.repeat(64);
    if(fault==='metadata')evidence.phases[1].metadataDigest='0'.repeat(64);if(fault==='final-count')evidence.phases[16].relations.find(row=>row.table==='league_roster_player_links')!.rows--;
    if(fault==='delta')evidence.deltas![5].captures=1;if(fault==='missing-phase')evidence.phases.pop();if(fault==='cleanup')evidence.cleanupComplete=false;
    await expect(assertCompleteStorageMeasurementEvidence(evidence,binding)).rejects.toThrow();
  });
  it.each(['missing-seed','duplicate-seed','singleton-false','history-credit','active-reserved','history-reserved',
    'late-removal','late-change','missing-relation','inactive-control','initial-core-row'] as const)
  ('rejects rehashed %s baseline/control evidence',async fault=>{
    const{binding,evidence}=await cp28EvidenceSpecimen();
    const phase=evidence.phases[fault.startsWith('late-')||fault==='missing-relation'?8:0];
    const service=phase.relations.find(row=>row.table==='public_data_resource_service')!;
    const native={singleton:true,history_credit:0,active_reserved_http:0,history_reserved_http:0};
    const md5=(text:string)=>createHash('md5').update(text).digest('hex');
    if(fault==='singleton-false')native.singleton=false;
    if(fault==='history-credit'||fault==='late-change')native.history_credit=1;
    if(fault==='active-reserved')native.active_reserved_http=1;
    if(fault==='history-reserved')native.history_reserved_http=1;
    if(fault==='missing-seed'||fault==='late-removal')service.rows=0;
    if(fault==='duplicate-seed')service.rows=2;
    const nativeJson=JSON.stringify(native).replaceAll(':',': ').replaceAll(',',', ');
    service.digest=md5(md5(nativeJson).repeat(service.rows));
    service.tupleBytes=48*service.rows;service.jsonBytes=Buffer.byteLength(nativeJson)*service.rows;
    if(fault==='missing-relation')phase.relations=phase.relations.filter(row=>row!==service);
    if(fault==='inactive-control'||fault==='initial-core-row'){
      const row=phase.relations.find(row=>row.table===(fault==='inactive-control'?'public_data_resource_selection_failures':'public_data_intakes'))!;
      row.rows=1;row.digest=md5('unexpected-control');row.tupleBytes=100;row.jsonBytes=120;
    }
    phase.totalRows=phase.relations.reduce((sum,row)=>sum+row.rows,0);
    phase.allocatedBytes=phase.relations.reduce((sum,row)=>sum+row.totalBytes,0);
    phase.digest=readerDigest(phase.relations.map(row=>({table:row.schema+'.'+row.table,rows:row.rows,digest:row.digest})));
    evidence.deltas=storagePhaseDeltas(evidence.phases);
    if(fault==='missing-relation'){
      await expect(assertCompleteStorageMeasurementEvidence(evidence,binding)).rejects.toMatchObject({actual:153,expected:154,operator:'strictEqual'});
    }else{
      const message=fault==='inactive-control'?'Unexpected CP28 control rows public_data_resource_selection_failures'
        :fault==='initial-core-row'?'Unexpected CP28 baseline public_data_intakes'
        :['missing-seed','duplicate-seed','late-removal'].includes(fault)?'Unexpected CP28 control rows public_data_resource_service'
        :'Unexpected CP28 migration-059 singleton values';
      await expect(assertCompleteStorageMeasurementEvidence(evidence,binding)).rejects.toThrow(message);
    }
  });
  it('keeps raw-byte identity separate from JSONB source parity and bounds exact replay proof',()=>{
    const raw={z:null,a:{y:2,x:1}},stored=Object.assign(Object.create(null),{a:{x:1,y:2},z:null});expect(compatibleRevision(raw)).toBe(compatibleRevision(stored));expect(readerDigest(raw)).not.toBe(readerDigest(stored));
    const id='11111111-1111-4111-8111-111111111111',query=storageReplayAuditStatement([id,id,id,id],[id,id],id);
    expect(query.sql).toContain('LIMIT 4097');expect(query.sql).toContain('league_administration_heads');expect(query.sql).toContain('league_configuration_heads');expect(query.sql).toContain('ANY($1::uuid[])');
    expect(query.sql).not.toMatch(/league_player_directory|jsonb_agg|string_agg/);expect(()=>storageReplayAuditStatement(['bad'],[],id)).toThrow();
  });
});

it('CP28 preflight rejects missing or changed raw and fabricated manifest bindings before any database work',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cp28-fixture-offline-'));
  try{
    const raw=JSON.stringify(cp28Catalog()),manifest=await bindStorageFixture(raw,cp28Metadata),manifestPath=join(root,'docs/aggregator-backend/data-backend-cp28-measurement-fixture.json'),rawPath=join(root,manifest.rawCatalogPath);
    await mkdir(join(root,'docs/aggregator-backend'),{recursive:true});await mkdir(join(root,'test-results/cp28-fixture'),{recursive:true});await writeFile(manifestPath,JSON.stringify(manifest));
    await expect(loadStorageFixture(root)).rejects.toThrow();await writeFile(rawPath,raw);
    await expect(loadStorageFixture(root)).resolves.toMatchObject({manifest});await writeFile(rawPath,raw+' ');
    await expect(loadStorageFixture(root)).rejects.toThrow('binding changed');await writeFile(rawPath,raw);
    await writeFile(manifestPath,JSON.stringify({...manifest,fixtureDigest:'0'.repeat(64)}));await expect(loadStorageFixture(root)).rejects.toThrow('binding changed');
  }finally{await rm(root,{recursive:true,force:true});}
});

describe('CP28 checkout-delivered gzip fixture, offline only',()=>{
  async function packaged(fault=''){
    const root=await mkdtemp(join(tmpdir(),'cp28-package-offline-'));
    try{
      const raw=JSON.stringify(cp28Catalog()),source=await bindStorageFixture(raw,cp28Metadata);
      let compressed=gzipSync(Buffer.from(raw));
      if(fault==='corrupt')compressed=Buffer.from('invalid gzip');if(fault==='truncated')compressed=compressed.subarray(0,compressed.length-4);
      if(fault==='expanded')compressed=gzipSync(Buffer.alloc(16*1024*1024+1));
      const descriptor:Record<string,unknown>={path:STORAGE_PACKAGED_CATALOG_PATH,sha256:createHash('sha256').update(compressed).digest('hex'),bytes:compressed.byteLength};
      if(fault==='hash')descriptor.sha256='0'.repeat(64);if(fault==='path')descriptor.path='../outside.json.gz';if(fault==='descriptor')descriptor.extra='unexpected';if(fault==='byte-type')descriptor.bytes=String(descriptor.bytes);if(fault==='compressed-cap')descriptor.bytes=4*1024*1024+1;
      const manifest:Record<string,unknown>={...source,packagedCatalog:descriptor};if(fault==='raw-size')manifest.rawBytes=source.rawBytes+1;if(fault==='raw-hash')manifest.rawSha256='0'.repeat(64);if(fault==='extra-core')manifest.unexpected=true;
      await mkdir(join(root,'docs/aggregator-backend'),{recursive:true});await mkdir(join(root,'apps/site/integration/fixtures'),{recursive:true});await mkdir(join(root,'test-results/cp28-fixture'),{recursive:true});
      await writeFile(join(root,'docs/aggregator-backend/data-backend-cp28-measurement-fixture.json'),JSON.stringify(manifest));
      // A valid legacy raw file must never conceal a missing or invalid declared package.
      await writeFile(join(root,cp28Metadata.rawCatalogPath),raw);if(fault!=='missing')await writeFile(join(root,STORAGE_PACKAGED_CATALOG_PATH),compressed);
      if(fault)await expect(loadStorageFixture(root)).rejects.toThrow();else{const loaded=await loadStorageFixture(root);expect(loaded.raw).toBe(raw);expect(loaded.manifest.fixtureDigest).toBe(source.fixtureDigest);expect(loaded.manifest.sourceBindings).toEqual(source.sourceBindings);}
    }finally{await rm(root,{recursive:true,force:true});}
  }
  it('verifies binary gzip and exact raw identity while retaining all source bindings',async()=>{await packaged();});
  it.each(['missing','hash','corrupt','truncated','expanded','path','descriptor','byte-type','compressed-cap','raw-size','raw-hash','extra-core'])('rejects %s package without raw fallback',async fault=>{await packaged(fault);});
});

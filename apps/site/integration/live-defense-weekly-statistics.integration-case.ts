import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import type { AllPlayerJobFence, AllPlayerJobPeriod, SleeperWeeklyStatReceipt } from '../lib/projections/adapters/neon/contracts';
import { createIndependentDatabase, ownerQuery, runtimeQuery } from './neon-integration-harness';
import { databaseTime } from './lineup-lineage-fixture';

const key = 'all-player-ingestion:sleeper';
const clock = '2196-09-20T16:02:00.000Z';
const connection = createIndependentDatabase();
const store = createProjectionStore(connection.database);
let previousClock: string;
let previousJob: Record<string, unknown> | undefined;
let week = 0;
let period: AllPlayerJobPeriod;
let gameId: string;
let externalGameId: string;

async function schedule(at: string) {
  const iso = new Date(at).toISOString();
  await ownerQuery(`CREATE OR REPLACE FUNCTION public.all_player_request_clock()
    RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path=pg_catalog,public,pg_temp
    AS $$ SELECT '${iso}'::timestamptz $$`);
}
const claim = (mode: 'live-defense' | 'recurring' | 'backfill' | 'shadow' = 'live-defense',
  options: { period?: AllPlayerJobPeriod; captureReceipt?: SleeperWeeklyStatReceipt; workerId?: string } = {}) => (
  store.acquireAllPlayerJob({ mode, period, workerId: '019-primary', leaseSeconds: 120,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(), ...options })
);
async function acquire() {
  const result = await claim();
  if (result.kind !== 'acquired') throw new Error(`Expected live claim, received ${result.kind}`);
  return result.fence;
}
const mark = (fence: AllPlayerJobFence) => store.markAllPlayerRequest({ fence, period });
function receipt(fence: AllPlayerJobFence): SleeperWeeklyStatReceipt {
  // Real callers use their own clock; cross-host millisecond skew cannot prove
  // whether the already awaited database reservation preceded the request.
  const at = new Date().toISOString();
  return { period, sourceRevision: 'synthetic-shared-weekly', bodyHash: `sha256:${'a'.repeat(64)}`,
    requestStartedAt: at, requestCompletedAt: at, requestGeneration: fence.generation };
}
async function finishCapture(fence: AllPlayerJobFence) {
  const captureReceipt = receipt(fence);
  const finished = await store.finishLiveDefenseStatRequest({ fence, outcome: 'captured', captureReceipt });
  const evidence = finished ? undefined : (await ownerQuery(`SELECT
    clock_timestamp()::text AS database_now, scheduled_for::text AS claimed_at,
    public.weekly_stat_receipt_is_valid($2::jsonb,payload->'period',attempt_count) AS receipt_valid,
    public.all_player_job_fence_is_live($3::jsonb) AS fence_live,
    (($2::jsonb->>'requestStartedAt')::timestamptz>=scheduled_for) AS request_after_claim,
    ((payload->>'requestGeneration')::integer=attempt_count) AS request_reserved
    FROM projection_jobs WHERE job_key=$1`, [key, JSON.stringify(captureReceipt), JSON.stringify(fence)]))[0];
  expect(finished, JSON.stringify({ receipt: captureReceipt, evidence })).toBe(true);
  return captureReceipt;
}

// Every fixture below runs only after the standard isolated Neon reset, role,
// TLS, authorization, sentinel and production-denylist guards have passed.
describe('019 shared weekly statistics budget, receipts and ownership', () => {
  beforeAll(async () => {
    previousClock = (await ownerQuery<{ definition: string }>(
      "SELECT pg_get_functiondef('public.all_player_request_clock()'::regprocedure) AS definition"))[0].definition;
    previousJob = (await ownerQuery<{ job: Record<string, unknown> }>(
      'SELECT to_jsonb(job) AS job FROM projection_jobs job WHERE job_key=$1', [key]))[0]?.job;
  });
  beforeEach(async () => {
    period = { season: 2196, seasonType: 'reg', week: ++week };
    await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [key]);
    await schedule(clock);
    await ownerQuery(`INSERT INTO league_period_authorities
      (league_key,default_season,default_season_type,default_week,active_season,active_season_type,active_week,
       league_lifecycle,nfl_phase,source_provider,source_revision,source_observed_at,verified_at,
       source_external_league_id,expected_roster_count,expected_starter_slot_count,expected_roster_ids)
      VALUES ('019-live',2196,'reg',$1,2196,'reg',$1,'active','regular','sleeper','019-fixture',
        clock_timestamp(),clock_timestamp(),'019-league',1,1,ARRAY['1'])
      ON CONFLICT(league_key) DO UPDATE SET default_week=$1,active_week=$1,
        source_observed_at=clock_timestamp(),verified_at=clock_timestamp()`, [period.week]);
    externalGameId = `019-live-${week}`;
    const games = await store.upsertNflGames([{ key: externalGameId, externalGameId,
      provider: 'tank01', ...period, homeTeam: 'NE', awayTeam: 'ATL',
      kickoffAt: new Date(Date.now() - 3_600_000).toISOString() }]);
    if (games.kind !== 'stored') throw new Error('Isolated live game unavailable');
    gameId = games.value[0].gameId;
    const at = new Date().toISOString();
    expect((await store.recordGameStates({ provider: 'tank01', states: [{ externalGameId,
      sourceRevision: `019-state-${week}`, requestStartedAt: at, requestCompletedAt: at, observedAt: at,
      statusCode: 1, period: 'Q2', gameClock: '08:00', homeScore: 3, awayScore: 7, sourceData: {} }] })).kind)
      .toBe('stored');
  });
  afterAll(async () => {
    try {
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [key]);
      if (previousJob) await ownerQuery('INSERT INTO projection_jobs SELECT * FROM jsonb_populate_record(NULL::projection_jobs,$1::jsonb)',
        [JSON.stringify(previousJob)]);
      if (previousClock) await ownerQuery(previousClock);
    } finally { await connection.close(); }
  });

  it('reserves one shared network opportunity and replays it under an independent hourly fence', async () => {
    const fence = await acquire();
    expect(await mark(fence)).toBe(true);
    await expect(runtimeQuery('SELECT public.assert_all_player_job_fence($1::jsonb,$2::jsonb,true)',
      [JSON.stringify(fence), JSON.stringify(period)])).rejects.toThrow('all-player lease');
    expect(await mark(fence)).toBe(false);
    expect(await store.finishAllPlayerJob({ fence, outcome: 'partial', diagnostic: {} })).toBe(false);
    const captureReceipt = await finishCapture(fence);
    const before = (await store.readAllPlayerJobState())!.payload;
    expect(before.requestStarts).toBeUndefined();
    expect(before.periodHistory).toBeUndefined();
    expect(before.lastWeeklyRequestAt).toBeDefined();
    expect((await claim()).kind).toBe('not-due');
    expect((await claim('recurring')).kind).toBe('not-due');
    const replay = await claim('recurring', { captureReceipt });
    if (replay.kind !== 'acquired') throw new Error('Expected independently fenced replay');
    expect(replay.fence.generation).toBe(fence.generation + 1);
    expect(await mark(replay.fence)).toBe(true);
    const after = (await store.readAllPlayerJobState())!.payload;
    expect(after.lastWeeklyRequestAt).toBe(before.lastWeeklyRequestAt);
    expect(after.lastWeeklyRequestGeneration).toBe(fence.generation);
    expect(after.requestStarts).toHaveLength(1);
    expect(await store.finishAllPlayerJob({ fence: replay.fence, outcome: 'partial', diagnostic: {} })).toBe(true);
    expect((await claim('recurring', { captureReceipt })).kind).toBe('not-due');
  });

  it('shares ownership among current, operator and recurring callers and consumes failures without a retry storm', async () => {
    const fence = await acquire();
    for (const mode of ['live-defense', 'recurring', 'shadow', 'backfill'] as const) {
      expect((await claim(mode, { workerId: '019-peer' })).kind).toBe('busy');
    }
    expect(await mark(fence)).toBe(true);
    expect(await store.finishLiveDefenseStatRequest({ fence, outcome: 'provider-failed' })).toBe(true);
    expect((await store.readAllPlayerJobState())?.payload.lastLiveDefenseOutcome)
      .toMatchObject({ outcome: 'provider-failed' });
    await schedule('2196-09-20T16:02:59.999Z');
    expect((await claim('backfill')).kind).toBe('not-due');
    await schedule('2196-09-20T16:03:00.000Z');
    expect((await claim('backfill')).kind).toBe('acquired');
  });

  it('protects both hourly correction opportunities from a late previous-minute request', async () => {
    await schedule('2196-09-20T16:59:45.000Z');
    const live = await acquire(); expect(await mark(live)).toBe(true);
    expect(await store.finishLiveDefenseStatRequest({ fence: live, outcome: 'provider-failed' })).toBe(true);
    await schedule('2196-09-20T17:00:15.000Z');
    expect((await claim()).kind).toBe('not-due');
    expect((await claim('recurring')).kind).toBe('not-due');
    await schedule('2196-09-20T17:01:15.000Z');
    expect((await claim()).kind).toBe('not-due');
    const correction = await claim('recurring', { period: { ...period, week: 1 } });
    if (correction.kind !== 'acquired') throw new Error('Expected protected correction opportunity');
    expect(await store.markAllPlayerRequest({ fence: correction.fence, period: { ...period, week: 1 } })).toBe(true);
    expect(await store.finishAllPlayerJob({ fence: correction.fence, outcome: 'provider-failed', diagnostic: {} })).toBe(true);
    await schedule('2196-09-20T17:02:15.000Z');
    expect((await claim()).kind).toBe('acquired');
  });

  it('rechecks current period and finality at mark rather than trusting application proof', async () => {
    expect((await claim('live-defense', { period: { ...period, week: 18 } })).kind).toBe('not-due');
    const fence = await acquire();
    const at = new Date().toISOString();
    expect((await store.recordGameStates({ provider: 'tank01', states: [{ externalGameId,
      sourceRevision: '019-final', requestStartedAt: at, requestCompletedAt: at, observedAt: at,
      statusCode: 2, period: 'Q4', gameClock: '00:00', homeScore: 3, awayScore: 7, sourceData: {} }] })).kind)
      .toBe('stored');
    expect(await mark(fence)).toBe(false);
    expect((await store.readAllPlayerJobState())?.payload.lastWeeklyRequestAt).toBeUndefined();
  });

  it('rejects a stale current authority before any reservation', async () => {
    await ownerQuery(`UPDATE league_period_authorities SET source_observed_at=clock_timestamp()-interval '11 minutes',
      verified_at=clock_timestamp()-interval '11 minutes' WHERE league_key='019-live'`);
    expect((await claim()).kind).toBe('not-due');
    expect(await store.readAllPlayerJobState()).toBeNull();
  });

  it('rejects forged, mismatched-period and stale capture receipts', async () => {
    const fence = await acquire(); expect(await mark(fence)).toBe(true);
    const captureReceipt = await finishCapture(fence);
    for (const altered of [{ ...captureReceipt, bodyHash: `sha256:${'b'.repeat(64)}` },
      { ...captureReceipt, period: { ...period, week: 18 } },
      { ...captureReceipt, requestGeneration: fence.generation + 1 }]) {
      await expect(claim('recurring', { captureReceipt: altered })).rejects.toThrow('receipt is unavailable');
    }
    const stale = { ...captureReceipt, requestStartedAt: new Date(Date.now() - 91_000).toISOString() };
    await ownerQuery("UPDATE projection_jobs SET payload=jsonb_set(payload,'{lastWeeklyCapture}',$2::jsonb) WHERE job_key=$1",
      [key, JSON.stringify(stale)]);
    await expect(claim('recurring', { captureReceipt: stale })).rejects.toThrow('receipt is unavailable');
  });

  it('rejects a stale worker after takeover without erasing the accepted hourly history', async () => {
    const fence = await acquire(); expect(await mark(fence)).toBe(true);
    await ownerQuery("UPDATE projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=$1", [key]);
    await schedule('2196-09-20T16:03:00.000Z');
    const replacement = await acquire();
    expect(replacement.generation).toBe(fence.generation + 1);
    expect(await store.finishLiveDefenseStatRequest({ fence, outcome: 'captured', captureReceipt: receipt(fence) })).toBe(false);
    expect(await mark(fence)).toBe(false);
    expect(await store.finishLiveDefenseStatRequest({ fence: replacement, outcome: 'timeout' })).toBe(true);
    expect((await store.readAllPlayerJobState())?.payload.periodHistory).toBeUndefined();
  });



  it('accepts bounded source-clock skew only under the marked current generation', async () => {
    const fence = await acquire();
    const at = new Date(Date.parse(await databaseTime()) - 500).toISOString();
    const clockSkew = { ...receipt(fence), requestStartedAt: at, requestCompletedAt: at };
    expect(await store.finishLiveDefenseStatRequest({ fence, outcome: 'captured', captureReceipt: clockSkew })).toBe(false);
    expect(await mark(fence)).toBe(true);
    expect(await store.finishLiveDefenseStatRequest({ fence, outcome: 'captured', captureReceipt: {
      ...clockSkew, requestGeneration: fence.generation + 1,
    } })).toBe(false);
    const dbNow = Date.parse(await databaseTime());
    for (const seconds of [-91, 31]) {
      const invalid = new Date(dbNow + seconds * 1_000).toISOString();
      expect(await store.finishLiveDefenseStatRequest({ fence, outcome: 'captured', captureReceipt: {
        ...clockSkew, requestStartedAt: invalid, requestCompletedAt: invalid,
      } })).toBe(false);
    }
    expect(await store.finishLiveDefenseStatRequest({ fence, outcome: 'captured', captureReceipt: clockSkew })).toBe(true);
  });

  it('permits bounded source-clock lead while rejecting future game evidence beyond it', async () => {
    const fence = await acquire(); expect(await mark(fence)).toBe(true);
    const ahead = new Date(Date.parse(await databaseTime()) + 500).toISOString();
    expect(await store.finishLiveDefenseStatRequest({ fence, outcome: 'captured', captureReceipt: {
      ...receipt(fence), requestStartedAt: ahead, requestCompletedAt: ahead,
    } })).toBe(true);
    const future = new Date(Date.parse(await databaseTime()) + 31_000).toISOString();
    expect((await store.recordGameStates({ provider: 'tank01', states: [{ externalGameId,
      sourceRevision: '019-too-far-future', requestStartedAt: future, requestCompletedAt: future, observedAt: future,
      statusCode: 1, period: 'Q2', gameClock: '08:00', homeScore: 3, awayScore: 7, sourceData: {} }] })).kind)
      .toBe('stored');
    await schedule('2196-09-20T16:03:00.000Z');
    expect((await claim()).kind).toBe('not-due');
  });

  it('allows only one concurrent claimant across live and ordinary collection', async () => {
    const peer = createIndependentDatabase();
    try {
      const peerStore = createProjectionStore(peer.database);
      const outcomes = await Promise.all([claim(), peerStore.acquireAllPlayerJob({ mode: 'recurring', period,
        workerId: '019-concurrent', leaseSeconds: 120, deadlineAt: new Date(Date.now() + 60_000).toISOString() })]);
      expect(outcomes.map(outcome => outcome.kind).sort()).toEqual(['acquired', 'busy']);
    } finally { await peer.close(); }
  });

  it('does not expose budget clocks, receipt validators, or internal unfenced claims to the runtime role', async () => {
    for (const statement of [
      "SELECT public.weekly_stat_next_request_at('{}',clock_timestamp())",
      "SELECT public.live_weekly_stat_period_is_current('{}')",
      "SELECT public.weekly_stat_receipt_is_valid('{}','{}',1)",
      "SELECT public.claim_weekly_stat_job('live-defense','{}','x',60,clock_timestamp(),NULL)",
    ]) await expect(runtimeQuery(statement)).rejects.toThrow(/permission denied/iu);
    expect((await ownerQuery<{ seconds: number }>(`SELECT extract(epoch FROM
      public.weekly_stat_next_request_at(jsonb_build_object('requestStarts',jsonb_build_array($1::timestamptz)),
        $1::timestamptz)-$1::timestamptz)::integer AS seconds`, [clock]))[0].seconds).toBe(60);
    expect((await ownerQuery<{ present: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM game_state_observations WHERE nfl_game_id=$1) AS present', [gameId]))[0].present).toBe(true);
  });
});

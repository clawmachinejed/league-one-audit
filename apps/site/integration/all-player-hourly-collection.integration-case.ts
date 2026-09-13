import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import type { AllPlayerJobFence } from '../lib/projections/adapters/neon/contracts';
import { createIndependentDatabase, ownerQuery, runtimeQuery } from './neon-integration-harness';

const jobKey = 'all-player-ingestion:sleeper';
const period = { season: 2198, seasonType: 'reg', week: 1 } as const;
const noon = '2198-09-20T16:00:00.000Z';
const connection = createIndependentDatabase();
const store = createProjectionStore(connection.database);

async function setScheduleClock(at: string) {
  // Owner-only fixture DDL on the guarded disposable database. No production
  // setting or runtime parameter can choose this time. Inputs are ISO constants.
  const iso = new Date(at).toISOString();
  await ownerQuery(`CREATE OR REPLACE FUNCTION public.all_player_request_clock()
    RETURNS timestamptz LANGUAGE sql VOLATILE
    SET search_path = pg_catalog, public, pg_temp AS $$ SELECT '${iso}'::timestamptz $$`);
}

async function claim(mode: 'shadow' | 'backfill' | 'recurring' = 'recurring', week = 1, worker = 'hourly-test') {
  return store.acquireAllPlayerJob({ mode, period: { ...period, week }, workerId: worker,
    leaseSeconds: 60, deadlineAt: new Date(Date.now() + 55_000).toISOString() });
}

async function acquire(mode: 'shadow' | 'backfill' | 'recurring' = 'recurring', week = 1) {
  const result = await claim(mode, week);
  if (result.kind !== 'acquired') throw new Error(`Expected acquired hourly claim; received ${result.kind}.`);
  return result.fence;
}

async function mark(fence: AllPlayerJobFence, week = 1) {
  return store.markAllPlayerRequest({ fence, period: { ...period, week } });
}

async function finish(fence: AllPlayerJobFence) {
  return store.finishAllPlayerJob({ fence, outcome: 'provider-failed',
    diagnostic: { stage: 'weekly-stat-request', reason: 'synthetic-hourly-provider-failure' } });
}

describe('014 hourly all-player SQL schedule and global ownership', () => {
  let previousClock: string;
  let previousJob: Record<string, unknown> | undefined;

  beforeAll(async () => {
    previousClock = (await ownerQuery<{ definition: string }>(
      "SELECT pg_get_functiondef('public.all_player_request_clock()'::regprocedure) AS definition"))[0].definition;
    previousJob = (await ownerQuery<{ job: Record<string, unknown> }>(
      'SELECT to_jsonb(job) AS job FROM projection_jobs job WHERE job_key=$1', [jobKey]))[0]?.job;
  });
  beforeEach(async () => {
    await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [jobKey]);
    await setScheduleClock(noon);
  });
  afterAll(async () => {
    try {
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [jobKey]);
      if (previousJob) await ownerQuery(
        'INSERT INTO projection_jobs SELECT * FROM jsonb_populate_record(NULL::projection_jobs,$1::jsonb)',
        [JSON.stringify(previousJob)]);
      if (previousClock) await ownerQuery(previousClock);
    } finally { await connection.close(); }
  });

  it('uses the requested Eastern hours across summer, winter and both daylight-saving transitions', async () => {
    const cases = [
      ['2026-09-13T15:59:59Z', '2026-09-13T16:00:00Z'],
      ['2026-09-13T16:00:00Z', '2026-09-13T16:00:00Z'],
      ['2026-09-14T04:59:59Z', '2026-09-14T04:00:00Z'],
      ['2026-09-14T05:00:00Z', '2026-09-14T16:00:00Z'],
      ['2026-12-13T16:59:59Z', '2026-12-13T17:00:00Z'],
      ['2026-12-13T17:00:00Z', '2026-12-13T17:00:00Z'],
      ['2026-12-14T05:59:59Z', '2026-12-14T05:00:00Z'],
      ['2026-12-14T06:00:00Z', '2026-12-14T17:00:00Z'],
      ['2026-03-08T06:30:00Z', '2026-03-08T16:00:00Z'],
      ['2026-03-08T07:30:00Z', '2026-03-08T16:00:00Z'],
      ['2026-11-01T05:30:00Z', '2026-11-01T17:00:00Z'],
      ['2026-11-01T06:30:00Z', '2026-11-01T17:00:00Z'],
    ];
    const rows = await ownerQuery<{ at: string; expected: string }>(`SELECT
      public.all_player_hourly_request_at('{}',at)::text AS at,expected::text
      FROM jsonb_to_recordset($1::jsonb) AS input(at timestamptz,expected timestamptz)`,
    [JSON.stringify(cases.map(([at, expected]) => ({ at, expected })))]);
    expect(rows.map(({ at, expected }) => new Date(at).toISOString() === new Date(expected).toISOString()))
      .toEqual(cases.map(() => true));
  });

  it('permits all 13 slots and blocks the entire closed window for recurring and both operator modes', async () => {
    for (const mode of ['recurring', 'shadow', 'backfill'] as const) {
      for (let offset = 0; offset < 13; offset += 1) {
        await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [jobKey]);
        await setScheduleClock(new Date(Date.parse(noon) + offset * 3_600_000).toISOString());
        await acquire(mode);
      }
      for (const at of ['2198-09-21T05:00:00Z', '2198-09-21T15:59:59Z']) {
        await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [jobKey]);
        await setScheduleClock(at);
        expect((await claim(mode)).kind).toBe('not-due');
      }
    }
  });

  it('deduplicates an hour across operator modes, periods and failure without imposing sliding-hour drift', async () => {
    await setScheduleClock('2198-09-20T16:00:49Z');
    const first = await acquire('backfill');
    expect(await mark(first)).toBe(true);
    expect(await mark(first)).toBe(false);
    expect(await finish(first)).toBe(true);
    await setScheduleClock('2198-09-20T16:01:02Z');
    expect((await claim('recurring', 2)).kind).toBe('not-due');
    expect((await claim('shadow', 2)).kind).toBe('not-due');
    await setScheduleClock('2198-09-20T17:00:02Z');
    const next = await acquire('recurring', 2);
    expect(await mark(next, 2)).toBe(true);
    expect((await store.readAllPlayerJobState())?.payload.requestStarts).toHaveLength(2);
  });

  it('admits the second minute after yesterday’s jitter expires under the exact rolling 24-hour boundary', async () => {
    const starts = Array.from({ length: 13 }, (_, index) =>
      new Date(Date.parse('2198-09-19T16:00:49Z') + index * 3_600_000).toISOString());
    const seed = await acquire();
    await ownerQuery(`UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,
      payload=payload || jsonb_build_object('requestStarts',$2::jsonb,'nextAttemptAt',NULL)
      WHERE job_key=$1`, [jobKey, JSON.stringify(starts)]);
    await setScheduleClock('2198-09-20T16:00:02Z');
    expect((await claim()).kind).toBe('not-due');
    await setScheduleClock('2198-09-20T16:00:48.999Z');
    expect((await claim()).kind).toBe('not-due');
    await setScheduleClock('2198-09-20T16:00:49Z');
    const boundary = await acquire();
    expect(boundary.generation).toBe(seed.generation + 1);
    expect(await mark(boundary)).toBe(true);
    expect(await finish(boundary)).toBe(true);
    const state = await store.readAllPlayerJobState();
    expect(state?.payload.requestStarts).toHaveLength(13);
    expect(state?.payload.requestStarts).not.toContain(starts[0]);
    await setScheduleClock('2198-09-20T16:01:02Z');
    expect((await claim()).kind).toBe('not-due');
  });

  it('rechecks the closed window and full request budget after claim, before a provider request', async () => {
    await setScheduleClock('2198-09-21T04:59:50Z');
    const crossing = await acquire();
    await setScheduleClock('2198-09-21T05:00:00Z');
    expect(await mark(crossing)).toBe(false);
    expect((await store.readAllPlayerJobState())?.payload.requestStarts).toBeUndefined();
    await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [jobKey]);
    await setScheduleClock(noon);
    const budgeted = await acquire();
    await ownerQuery(`UPDATE projection_jobs SET payload=payload || jsonb_build_object('requestStarts',$2::jsonb)
      WHERE job_key=$1`, [jobKey, JSON.stringify(Array.from({ length: 13 }, (_, index) =>
      new Date(Date.parse(noon) - (index + 1) * 3_600_000).toISOString()))]);
    expect(await mark(budgeted)).toBe(false);
  });

  it('serializes concurrent recurring/operator claims and records only one request', async () => {
    const peer = createIndependentDatabase();
    try {
      const peerStore = createProjectionStore(peer.database);
      const [one, two] = await Promise.all([claim('recurring'), peerStore.acquireAllPlayerJob({
        mode: 'backfill', period: { ...period, week: 2 }, workerId: 'hourly-peer',
        leaseSeconds: 60, deadlineAt: new Date(Date.now() + 55_000).toISOString(),
      })]);
      expect([one.kind, two.kind].sort()).toEqual(['acquired', 'busy']);
      const winner = one.kind === 'acquired' ? one : two;
      if (winner.kind !== 'acquired') throw new Error('No concurrent winner.');
      const winningWeek = one.kind === 'acquired' ? 1 : 2;
      expect(await Promise.all([mark(winner.fence, winningWeek), peerStore.markAllPlayerRequest({
        fence: winner.fence, period: { ...period, week: winningWeek },
      })]))
        .toEqual(expect.arrayContaining([true, false]));
      expect((await store.readAllPlayerJobState())?.payload.requestStarts).toHaveLength(1);
    } finally { await peer.close(); }
  });

  it('rejects expired deadlines, lease takeover and lost ownership at mark and completion', async () => {
    const expired = await acquire();
    await ownerQuery(`UPDATE projection_jobs SET payload=jsonb_set(payload,'{deadlineAt}',
      to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE job_key=$1`, [jobKey]);
    expect(await mark(expired)).toBe(false);
    await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [jobKey]);
    const stale = await acquire();
    await ownerQuery(`UPDATE projection_jobs SET lease_until=clock_timestamp()-interval '1 second'
      WHERE job_key=$1`, [jobKey]);
    expect(await mark(stale)).toBe(false);
    expect(await finish(stale)).toBe(false);
    const replacement = await acquire('backfill', 2);
    expect(replacement.generation).toBe(stale.generation + 1);
    expect(await mark(stale)).toBe(false);
    expect(await finish(stale)).toBe(false);
    expect(await mark(replacement, 2)).toBe(true);
  });

  it('keeps production-clock helpers owner-only and preserves the old safe read signature and global DML guard', async () => {
    for (const statement of ['SELECT public.all_player_request_clock()',
      "SELECT public.all_player_hourly_request_at('{}',clock_timestamp())"]) {
      await expect(runtimeQuery(statement)).rejects.toThrow(/permission denied/iu);
    }
    await expect(runtimeQuery("SELECT public.all_player_next_request_at('{}') AS next_at"))
      .resolves.toHaveLength(1);
    await setScheduleClock('2198-09-20T16:00:00.500Z');
    const next = await runtimeQuery<{ next_at: string }>(
      "SELECT public.all_player_next_request_at('{}')::text AS next_at");
    expect(Date.parse(next[0].next_at)).toBeLessThanOrEqual(Date.parse('2198-09-20T16:00:00.100Z'));
    const fence = await acquire();
    expect(await mark(fence)).toBe(true);
    await expect(runtimeQuery("UPDATE projection_jobs SET payload='{}' WHERE job_key=$1", [jobKey]))
      .rejects.toThrow(/dedicated job functions/iu);
    await expect(runtimeQuery('DELETE FROM projection_jobs WHERE job_key=$1', [jobKey]))
      .rejects.toThrow(/dedicated job functions/iu);
  });
});

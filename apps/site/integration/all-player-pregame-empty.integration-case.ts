import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import type { AllPlayerJobFence } from '../lib/projections/adapters/neon/contracts';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery } from './neon-integration-harness';
import { registerEnrolledIntegrationSeason } from './administration-enrollment-fixture';

const key = 'all-player-ingestion:sleeper';
const period = { season: 2197, seasonType: 'reg', week: 17 } as const;
const connection = createIndependentDatabase();
const store = createProjectionStore(connection.database);
let previousJob: Record<string, unknown> | undefined;
let fence: AllPlayerJobFence;
let kickoff: string;
let gameId: string;

async function counts() {
  return (await ownerQuery(`SELECT (SELECT count(*) FROM all_player_stat_contents)::integer AS contents,
    (SELECT count(*) FROM all_player_stat_entries)::integer AS entries,
    (SELECT count(*) FROM all_player_stat_observations)::integer AS observations,
    (SELECT count(*) FROM all_player_score_sets)::integer AS score_sets,
    (SELECT count(*) FROM current_all_player_score_sets)::integer AS pointers`))[0];
}
function diagnostic() {
  const now = new Date().toISOString();
  return { stage: 'no-statistics-yet', reason: 'no-statistics-yet', entryCount: 0,
    period: { ...period, seasonType: 'regular' },
    scoringProfileCount: 0, finalCoverage: false, retryDisposition: 'global-budget',
    responseEvidence: { httpStatus: 200, bodyShape: 'object', topLevelCount: 0,
      bodyHash: `sha256:${createHash('sha256').update('{}').digest('hex')}`,
      requestStartedAt: now, requestCompletedAt: now },
    pregameEvidence: { policy: 'exact-period-pregame-v1', verifiedAt: now,
      firstKickoffAt: kickoff, scheduledGameCount: 1, scheduleRevision: `sha256:${'b'.repeat(64)}` } };
}
const finish = (value: Record<string, unknown> = diagnostic()) => store.finishAllPlayerJob({
  fence, outcome: 'no-statistics-yet', diagnostic: value,
});

describe('018 verified empty pregame outcome under the real SQL ownership guard', () => {
  beforeAll(async () => {
    previousJob = (await ownerQuery<{ job: Record<string, unknown> }>(
      'SELECT to_jsonb(job) AS job FROM projection_jobs job WHERE job_key=$1', [key]))[0]?.job;
    await registerEnrolledIntegrationSeason(ownerQuery, { leagueKey: '018-pregame', season: period.season,
      sleeperLeagueId: '018-pregame-league', scoringRules: { pass_td: 4 } });
  });
  beforeEach(async () => {
    await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [key]);
    await ownerQuery(`INSERT INTO league_period_authorities
      (league_key,default_season,default_season_type,default_week,active_season,active_season_type,
       active_week,league_lifecycle,nfl_phase,source_provider,source_revision,source_observed_at,
       verified_at,source_external_league_id,expected_roster_count,expected_starter_slot_count,expected_roster_ids)
      VALUES ('018-pregame',2197,'reg',17,2197,'reg',17,'active','regular','sleeper','018-pregame',
        clock_timestamp(),clock_timestamp(),'018-pregame-league',1,1,ARRAY['1'])
      ON CONFLICT (league_key) DO UPDATE SET active_week=17,verified_at=clock_timestamp()`);
    kickoff = new Date(Date.now() + 3_600_000).toISOString();
    const games = await store.upsertNflGames([{ key: '018-pregame', externalGameId: '018-pregame',
      provider: 'tank01', ...period, homeTeam: 'NE', awayTeam: 'ATL', kickoffAt: kickoff }]);
    if (games.kind !== 'stored') throw new Error('Isolated game unavailable');
    gameId = games.value[0].gameId;
    const claim = await store.acquireAllPlayerJob({ mode: 'recurring', period, workerId: '018-empty',
      leaseSeconds: 60, deadlineAt: new Date(Date.now() + 55_000).toISOString() });
    if (claim.kind !== 'acquired') throw new Error('Isolated claim unavailable');
    fence = claim.fence;
    expect(await store.markAllPlayerRequest({ fence, period })).toBe(true);
  });
  afterAll(async () => {
    try {
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [key]);
      if (previousJob) await ownerQuery('INSERT INTO projection_jobs SELECT * FROM jsonb_populate_record(NULL::projection_jobs,$1::jsonb)',
        [JSON.stringify(previousJob)]);
    } finally { await connection.close(); }
  });

  it('records no-data honestly, retains the consumed global slot, writes no observations or pointers, and is not due again', async () => {
    const before = await counts();
    expect(await finish()).toBe(true);
    expect(await counts()).toEqual(before);
    const state = await store.readAllPlayerJobState();
    expect(state).toMatchObject({ state: 'completed', workerId: null, leaseUntil: null });
    expect(state?.payload.lastOutcome).toMatchObject({ outcome: 'no-statistics-yet', finalCoverage: false });
    expect(state?.payload.requestStarts).toHaveLength(1);
    const next = await store.acquireAllPlayerJob({ mode: 'recurring', period, workerId: '018-peer',
      leaseSeconds: 60, deadlineAt: new Date(Date.now() + 55_000).toISOString() });
    expect(next.kind).toBe('not-due');
  });
  it.each(['array', 'null', 'invalid-json', 'unreadable'])('refuses a %s response presented as normal pregame emptiness', async (shape) => {
    const value = diagnostic(); value.responseEvidence.bodyShape = shape;
    expect(await finish(value)).toBe(false);
  });
  it('requires zero entries, a fresh proof, exact game count and an unmodified response', async () => {
    for (const mutate of [
      (v: ReturnType<typeof diagnostic>) => { v.entryCount = 1; },
      (v: ReturnType<typeof diagnostic>) => { v.responseEvidence.topLevelCount = 1; },
      (v: ReturnType<typeof diagnostic>) => { v.responseEvidence.httpStatus = 503; },
      (v: ReturnType<typeof diagnostic>) => { v.responseEvidence.httpStatus = 200.5; },
      (v: ReturnType<typeof diagnostic>) => { v.responseEvidence.httpStatus = 1e100; },
      (v: ReturnType<typeof diagnostic>) => { v.finalCoverage = true; },
      (v: ReturnType<typeof diagnostic>) => { v.stage = 'published'; },
      (v: ReturnType<typeof diagnostic>) => { v.responseEvidence.bodyHash = 'bad'; },
      (v: ReturnType<typeof diagnostic>) => { v.pregameEvidence.scheduledGameCount = 2; },
      (v: ReturnType<typeof diagnostic>) => { v.pregameEvidence.verifiedAt = new Date(Date.now() - 120_000).toISOString(); },
    ]) { const value = diagnostic(); mutate(value); expect(await finish(value)).toBe(false); }
  });
  it('refuses a game beginning between application proof and SQL completion', async () => {
    const value = diagnostic();
    await ownerQuery('UPDATE nfl_games SET kickoff_at=clock_timestamp()-interval \'1 second\' WHERE id=$1::uuid', [gameId]);
    expect(await finish(value)).toBe(false);
  });
  it('rechecks kickoff after SQL proof queries wait inside the function', async () => {
    const locker = await createPinnedIntegrationDatabase('owner');
    let pending: Promise<boolean> | undefined;
    try {
      // The owner lock makes the runtime SELECT on nfl_games wait after the
      // function has already captured its initial `completed` timestamp.
      kickoff = new Date(Date.now() + 5_000).toISOString();
      await ownerQuery('UPDATE nfl_games SET kickoff_at=$2::timestamptz WHERE id=$1::uuid', [gameId, kickoff]);
      const value = diagnostic();
      await locker.database.query('BEGIN');
      await locker.database.query('LOCK TABLE nfl_games IN ACCESS EXCLUSIVE MODE');
      pending = finish(value);
      let waiting = false;
      const waitLimit = Date.parse(kickoff) - 500;
      while (Date.now() < waitLimit && !waiting) {
        waiting = (await ownerQuery<{ waiting: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE relation='public.nfl_games'::regclass
            AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
            AND mode='AccessShareLock' AND NOT granted) AS waiting`))[0]?.waiting === true;
        if (!waiting) await delay(25);
      }
      expect(waiting, 'Runtime SQL must reach its blocked game-proof query before kickoff.').toBe(true);
      await delay(Math.max(0, Date.parse(kickoff) - Date.now() + 50));
      await locker.database.query('COMMIT');
      expect(await pending).toBe(false);
      expect(await store.readAllPlayerJobState()).toMatchObject({ state: 'running' });
    } finally {
      try { await locker.database.query('ROLLBACK'); }
      finally { await locker.close(); }
      // Always release the blocked request, including when setup timing fails.
      if (pending) await pending.catch(() => false);
    }
  }, 15_000);
  it('refuses a period rollover after application proof', async () => {
    const value = diagnostic();
    await ownerQuery("UPDATE league_period_authorities SET active_week=18 WHERE league_key='018-pregame'");
    expect(await finish(value)).toBe(false);
  });
  it.each(['deadline', 'lease', 'takeover', 'unbudgeted', 'operator'])('rejects %s at durable completion', async (kind) => {
    if (kind === 'deadline') {
      const at = new Date(Date.now() - 1000).toISOString();
      await ownerQuery("UPDATE projection_jobs SET payload=jsonb_set(payload,'{deadlineAt}',to_jsonb($2::text)) WHERE job_key=$1", [key, at]);
      fence = { ...fence, deadlineAt: at };
    } else if (kind === 'lease') {
      await ownerQuery("UPDATE projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=$1", [key]);
    } else if (kind === 'takeover') {
      await ownerQuery("UPDATE projection_jobs SET lease_owner='018-other',attempt_count=attempt_count+1 WHERE job_key=$1", [key]);
    } else if (kind === 'unbudgeted') {
      await ownerQuery("UPDATE projection_jobs SET payload=payload-'requestGeneration' WHERE job_key=$1", [key]);
    } else {
      await ownerQuery("UPDATE projection_jobs SET payload=jsonb_set(payload,'{mode}','\"backfill\"'::jsonb) WHERE job_key=$1", [key]);
    }
    expect(await finish()).toBe(false);
  });
});

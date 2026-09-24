import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MatchupsData, MatchupWinProbability } from '../lib/types';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { databaseTime, lineageFixture } from './lineup-lineage-fixture';

const EXPECTED_MODEL = 'normal-v3';
type Probability = MatchupWinProbability | undefined;
const estimated = (modelVersion: 'normal-v1' | 'normal-v2' | 'normal-v3' = EXPECTED_MODEL): MatchupWinProbability => ({
  modelVersion, status: 'estimated', teams: [{ teamId: 1, probability: 0.6 }, { teamId: 2, probability: 0.4 }],
});
const unavailable: MatchupWinProbability = {
  modelVersion: EXPECTED_MODEL, status: 'unavailable', reason: 'missing-projection',
};

function payload(week: number, updatedAt: string, probabilities: readonly Probability[]): MatchupsData {
  const teams = probabilities.flatMap((_, index) => [1, 2].map((side) => ({
    id: index * 2 + side, managerName: `Manager ${index * 2 + side}`, name: `Team ${index * 2 + side}`,
    avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
  })));
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 }, teams, updatedAt, week,
    matchups: probabilities.map((probability, index) => ({
      id: String(index + 1), status: 'upcoming',
      sides: teams.slice(index * 2, index * 2 + 2).map((team) => ({
        team, points: 0, projectedPoints: 100, starters: [],
      })),
      ...(probability ? { winProbability: probability.status === 'unavailable' ? probability : {
        ...probability, teams: [
          { teamId: index * 2 + 1, probability: probability.teams[0].probability },
          { teamId: index * 2 + 2, probability: probability.teams[1].probability },
        ],
      } } : {}),
    })),
  };
}

describe.sequential('future probability rollout refresh in isolated Neon', () => {
  let database: IndependentDatabase;
  beforeAll(() => { database = createIndependentDatabase(); });
  afterAll(async () => { await database.close(); });

  async function fixture(probabilities: readonly Probability[]) {
    const f = await lineageFixture(database, 'future');
    const source = await f.observe();
    const first = await f.store.publishSnapshot({
      leagueSeasonId: f.league.leagueSeasonId, week: f.period.week, modelVersion: 'clock-v1',
      revisionKey: randomUUID(), leagueWeekObservationId: source.value.observationId,
      gameStateObservationIds: [], calculatedAt: source.input.observedAt,
      payload: payload(f.period.week, source.input.observedAt, probabilities), activityWindows: [],
      lineupFence: f.fence,
    });
    if (first.kind !== 'published') throw new Error('Probability fixture snapshot was not published.');
    expect(await f.store.completeFutureMaterializationAndAcknowledgeLineup(
      await f.fullAckInput(source, first.snapshot.revisionKey),
    )).toMatchObject({ kind: 'updated' });
    // Arrange the distant-week cadence without altering the production clock.
    await ownerQuery(`UPDATE league_week_materialization_states SET next_refresh_at=now()+interval '7 days'
      WHERE league_key=$1`, [f.leagueKey]);
    await ownerQuery(`UPDATE projection_period_refresh_states SET next_refresh_at=now()+interval '7 days'
      WHERE normalizer_version=$1`, [f.normalizerVersion]);
    const common = { projectionProvider: 'tank01', normalizerVersion: f.normalizerVersion, modelVersion: 'clock-v1' };
    const plan = async (winProbabilityModelVersion: string | null = EXPECTED_MODEL) => {
      const result = await f.store.readFutureRefreshPlan({ ...common,
        ...(winProbabilityModelVersion === null ? {} : { winProbabilityModelVersion }),
        leagueKeys: [f.leagueKey], targets: [{ period: f.period, weekDistance: 1 }], asOf: await databaseTime() });
      expect(result).toHaveLength(1);
      expect(result[0].projection.due).toBe(false);
      expect(result[0].materializations).toHaveLength(1);
      return result[0].materializations[0];
    };
    const claim = async (overrides: Partial<Parameters<typeof f.store.beginFutureMaterializationRefresh>[0]> = {}) => (
      f.store.beginFutureMaterializationRefresh({ ...common, leagueKey: f.leagueKey, period: f.period,
        attemptId: f.runId, attemptedAt: await databaseTime(), leaseSeconds: 120, target: f.target,
        winProbabilityModelVersion: EXPECTED_MODEL, ...overrides })
    );
    // Privileged fixture construction represents another completed publisher. It inserts immutable
    // history rather than modifying it; all planner/claim operations below use the runtime role.
    const replaceSnapshot = async (probabilityValues: readonly Probability[], modelVersion = 'clock-v1', current = true) => {
      const laterSource = await f.observe();
      const id = randomUUID();
      const revision = randomUUID();
      await ownerQuery(`INSERT INTO projection_snapshots
        (id,league_season_id,week,model_version,revision_key,content_hash,
          league_week_observation_id,calculated_at,payload)
        VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8::jsonb)`, [id, f.league.leagueSeasonId,
        f.period.week, modelVersion, revision, laterSource.value.observationId,
        laterSource.input.observedAt, JSON.stringify(payload(f.period.week, laterSource.input.observedAt, probabilityValues))]);
      if (current) await ownerQuery(`UPDATE current_projection_snapshots
        SET snapshot_id=$1, calculated_at=$2, verified_at=$2, verification_source_observation_id=$3
        WHERE league_season_id=$4 AND week=$5`, [id, laterSource.input.observedAt,
        laterSource.value.observationId, f.league.leagueSeasonId, f.period.week]);
      return id;
    };
    return { ...f, common, plan, claim, replaceSnapshot, initialSnapshotId: first.snapshot.snapshotId };
  }

  it.each([
    ['missing', undefined], ['older v1 model', estimated('normal-v1')], ['older v2 model', estimated('normal-v2')],
  ] as const)('expedites a not-due %s result only for an owned worker and explicit expected model', async (_, probability) => {
    const f = await fixture([probability]);
    expect(await f.plan(null)).toMatchObject({ due: false });
    expect(await f.claim({ winProbabilityModelVersion: undefined })).toEqual({ kind: 'unavailable' });
    expect(await f.plan()).toMatchObject({ due: true, probabilityRefreshNeeded: true, consecutiveFailures: 0 });
    expect(await f.claim()).toMatchObject({ kind: 'acquired', attemptId: f.runId });
    const rows = await ownerQuery(`SELECT snapshot_id FROM current_projection_snapshots WHERE league_season_id=$1 AND week=$2`,
      [f.league.leagueSeasonId, f.period.week]);
    expect(rows).toEqual([{ snapshot_id: f.initialSnapshotId }]);
  });

  it.each([
    ['estimated', estimated()], ['explicitly unavailable', unavailable],
  ] as const)('does not repeatedly queue a current %s result or stale historical snapshot', async (_, probability) => {
    const f = await fixture([probability]);
    await f.replaceSnapshot([estimated('normal-v1')], 'clock-v1', false);
    for (let check = 0; check < 2; check += 1) {
      expect(await f.plan()).toMatchObject({ due: false, probabilityRefreshNeeded: false });
      expect(await f.claim()).toEqual({ kind: 'unavailable' });
    }
  });

  it('refreshes a partially upgraded nonempty snapshot when any matchup lacks the model', async () => {
    const f = await fixture([estimated(), undefined]);
    expect(await f.plan()).toMatchObject({ due: true, probabilityRefreshNeeded: true });
    expect(await f.claim()).toMatchObject({ kind: 'acquired' });
  });

  it('preserves failure cooldown and then permits the normal due retry', async () => {
    const f = await fixture([undefined]);
    expect(await f.claim()).toMatchObject({ kind: 'acquired' });
    expect(await f.store.failFutureMaterializationRefresh({ ...f.common, leagueKey: f.leagueKey,
      period: f.period, attemptId: f.runId, failedAt: await databaseTime(), failureCode: 'snapshot-publication-failed',
    })).toMatchObject({ kind: 'updated', consecutiveFailures: 1 });
    expect(await f.plan()).toMatchObject({ due: false, consecutiveFailures: 1 });
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
    await ownerQuery(`UPDATE league_week_materialization_states SET next_refresh_at=now()-interval '1 second'
      WHERE league_key=$1`, [f.leagueKey]);
    expect(await f.plan()).toMatchObject({ due: true, consecutiveFailures: 1 });
    expect(await f.claim()).toMatchObject({ kind: 'acquired' });
  });

  it('preserves the busy lease and backs off an expired materialization instead of bypassing it', async () => {
    const f = await fixture([undefined]);
    expect(await f.claim()).toMatchObject({ kind: 'acquired' });
    expect(await f.plan()).toMatchObject({ due: false });
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
    await ownerQuery(`UPDATE league_week_materialization_states
      SET active_attempt_started_at=now()-interval '3 minutes', last_attempted_at=now()-interval '3 minutes',
        active_attempt_expires_at=now()-interval '1 minute' WHERE league_key=$1`, [f.leagueKey]);
    expect(await f.claim()).toMatchObject({ kind: 'backed-off', consecutiveFailures: 1 });
    expect(await f.plan()).toMatchObject({ due: false, lastFailureCode: 'deadline-exceeded' });
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
  });

  it('requires a live, running future job with the same owner for the early claim', async () => {
    const f = await fixture([undefined]);
    expect(await f.plan()).toMatchObject({ due: true });
    expect(await f.claim({ attemptId: randomUUID() })).toEqual({ kind: 'unavailable' });
    await ownerQuery(`UPDATE projection_jobs SET lease_until=now()-interval '1 second'
      WHERE job_key='future-projection-sync'`);
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
    await ownerQuery(`UPDATE projection_jobs SET state='completed', lease_owner=NULL, lease_until=NULL
      WHERE job_key='future-projection-sync'`);
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
  });

  it('rechecks current snapshot contents between a due plan and the early claim', async () => {
    const f = await fixture([undefined]);
    expect(await f.plan()).toMatchObject({ due: true, probabilityRefreshNeeded: true });
    await f.replaceSnapshot([estimated()]);
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
    expect(await f.plan()).toMatchObject({ due: false, probabilityRefreshNeeded: false });
  });

  it('retains target generation, period authority freshness, and lifecycle fences', async () => {
    const f = await fixture([undefined]);
    for (const target of [
      { ...f.target, watchId: randomUUID() }, { ...f.target, watchGeneration: 2 },
      { ...f.target, authorityGeneration: 2 }, { ...f.target, observedVersion: 2 },
      { ...f.target, lineupRevision: 'c'.repeat(64) },
    ]) expect(await f.claim({ target })).toEqual({ kind: 'unavailable' });
    await ownerQuery(`UPDATE league_period_authorities SET verified_at=now()-interval '11 minutes',
      source_observed_at=now()-interval '11 minutes' WHERE league_key=$1`, [f.leagueKey]);
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
    await ownerQuery(`UPDATE league_period_authorities SET verified_at=now(), source_observed_at=now(), active_week=2
      WHERE league_key=$1`, [f.leagueKey]);
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
  });

  it('isolates league, season, week, season type, and projection model instead of copying another snapshot', async () => {
    const f = await fixture([estimated()]);
    await fixture([undefined]);
    expect(await f.plan()).toMatchObject({ due: false, probabilityRefreshNeeded: false });
    await f.replaceSnapshot([undefined], 'other-clock');
    expect(await f.plan()).toMatchObject({ due: false, probabilityRefreshNeeded: false });
    await f.replaceSnapshot([undefined]);
    const targets = [
      { period: { ...f.period, season: 2027 }, weekDistance: 1 },
      { period: { ...f.period, week: 3 }, weekDistance: 1 },
      { period: { ...f.period, seasonType: 'pre' as const }, weekDistance: 1 },
    ];
    await f.store.ensureFutureRefreshStates({ ...f.common, leagueKeys: [f.leagueKey], targets,
      seededAt: new Date(Date.parse(await databaseTime()) + 86_400_000).toISOString() });
    const plan = await f.store.readFutureRefreshPlan({ ...f.common, winProbabilityModelVersion: EXPECTED_MODEL,
      leagueKeys: [f.leagueKey], targets, asOf: await databaseTime() });
    expect(plan).toHaveLength(3);
    for (const period of plan) expect(period.materializations).toMatchObject([
      { due: false, probabilityRefreshNeeded: false },
    ]);
  });

  it('leaves empty or absent snapshots on their normal cadence and preserves a normally due claim', async () => {
    const f = await fixture([]);
    expect(await f.plan()).toMatchObject({ due: false, probabilityRefreshNeeded: false });
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
    await ownerQuery('DELETE FROM current_projection_snapshots WHERE league_season_id=$1 AND week=$2',
      [f.league.leagueSeasonId, f.period.week]);
    expect(await f.plan()).toMatchObject({ due: false, probabilityRefreshNeeded: false });
    expect(await f.claim()).toEqual({ kind: 'unavailable' });
    await ownerQuery(`UPDATE league_week_materialization_states SET next_refresh_at=now()-interval '1 second'
      WHERE league_key=$1`, [f.leagueKey]);
    expect(await f.plan()).toMatchObject({ due: true, probabilityRefreshNeeded: false });
    expect(await f.claim({ winProbabilityModelVersion: undefined })).toMatchObject({ kind: 'acquired' });
  });
});

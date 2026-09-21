import { describe, expect, it, vi } from 'vitest';
import { fakeStore, gameState, gameStates, matchupData, NOW, PERIOD, player, projectionResult, source,
  workerDependencies } from '../../live-projection-worker.fixtures';
import { SLEEPER_LIVE_DEFENSE_MAPPING } from '../adapters/sleeper/scoring-profile';
import { tank01DefenseScoringStats } from '../adapters/tank01/projection-normalization';
import type { GameStateObservation } from '../domain/contracts';
import type { LineupPublicationFence } from '../domain/lineup-publication';
import type { LiveDefenseStatResult } from '../ports/live-defense-stat-source';
import type { LoadedLeague } from './contracts';
import { runCurrentProjectionStages } from './current-projection-stages';

const rawStats = { sacks: 2, interceptions: 1, fumbleRecoveries: 1, defensiveTouchdowns: 0.2,
  returnTouchdowns: 0.1, safeties: 0.1, blockedKicks: 0.1, pointsAllowed: 20 };
const rules = { pass_yd: 0.04, rush_yd: 0.1, sack: 1, int: 2, def_st_fum_rec: 2,
  fum_rec: 2, def_td: 6, def_st_td: 6, safe: 2, blk_kick: 2, def_3_and_out: 0.5,
  def_4_and_stop: 1, pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4,
  pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4 };

function leagues(): LoadedLeague[] {
  return ['l1', 'l2', 'dynasty'].map((id) => {
    const data = matchupData();
    data.matchups[0].sides[0].starters[1] = player('KC', 'Kansas City Chiefs', 'DEF', 'KC', 13);
    data.matchups[0].sides[0].points = 21;
    const value = source(id, data);
    const configuration = { ...value.configuration, key: id };
    return { configuration, cadence: 'live-window', source: { ...value, configuration,
      scoringSettings: { ...value.scoringSettings, rawRules: rules } } };
  });
}

function available(): Extract<LiveDefenseStatResult, { status: 'available' }> {
  return { status: 'available', mapping: SLEEPER_LIVE_DEFENSE_MAPPING, capture: {
    period: PERIOD, requestStartedAt: '2026-09-13T18:00:02.000Z',
    requestCompletedAt: '2026-09-13T18:00:03.000Z', observedAt: '2026-09-13T18:00:03.000Z',
    sourceRevision: 'shared-stat-capture', entries: [{ team: 'KC', stats: {
      pts_allow: 0, pts_allow_0: 1, sack: 1, def_3_and_out: 2, def_4_and_stop: 1,
    } }, { team: 'SEA', stats: { sack: 4 } }],
  } };
}

function harness(game: GameStateObservation = gameState()) {
  const fake = fakeStore();
  const projections = projectionResult();
  const dependencies = workerDependencies(fake, { games: gameStates(game), projections: {
    ...projections, projections: projections.projections.map((row) =>
      row.identity.primary.entityKind === 'team-defense' && row.nflTeam === 'KC'
        ? { ...row, stats: rawStats, scoringStats: tank01DefenseScoringStats(rawStats) } : row),
  } });
  // Model the canonical repository's read translation, independently tested in
  // neon/repository.test.ts, while the in-memory store preserves raw candidates.
  const readFrozen = dependencies.repository.readFrozenBaselines;
  Object.assign(dependencies.repository, { readFrozenBaselines: vi.fn(async (
    input: Parameters<typeof readFrozen>[0],
  ) => (await readFrozen(input)).map((record) => record.entityKind === 'team-defense'
    ? { ...record, scoringStats: tank01DefenseScoringStats(record.projectedStats) } : record)) });
  const observations = vi.spyOn(dependencies.repository, 'recordLeagueWeekObservation');
  const load = vi.fn(async (): Promise<LiveDefenseStatResult> => available());
  dependencies.loggerMock.mockImplementation(() => {});
  const loaded = leagues();
  const fences = new Map(loaded.map((league) => [league.configuration.key, {
    ownerLane: 'current', runId: 'worker-1', watchId: `watch-${league.configuration.key}`,
    watchGeneration: 1, authorityGeneration: 1,
  } satisfies LineupPublicationFence]));
  return { fake, dependencies, observations, load, loaded,
    run: () => runCurrentProjectionStages({ ...dependencies, liveDefenseStatSource: { load } },
      loaded, fences, NOW.toISOString(), 'worker-1') };
}

describe('shared current-worker defense statistics', () => {
  it('loads once for three leagues and persists the exact applied evidence with publication and acknowledgment lineage', async () => {
    const test = harness();
    await expect(test.run()).resolves.toMatchObject({ publishedLeagues: 3, failedLeagues: 0, providerGroups: 1 });
    expect(test.load).toHaveBeenCalledExactlyOnceWith({ period: PERIOD, statisticsRequired: true });
    expect(test.dependencies.projectionMock).toHaveBeenCalledTimes(1);
    expect(test.dependencies.gamesMock).toHaveBeenCalledTimes(1);
    expect(test.observations).toHaveBeenCalledTimes(3);
    for (const [observation] of test.observations.mock.calls) {
      expect(observation.sourceData.liveDefense).toMatchObject({ status: 'available',
        entries: [{ team: 'KC', stats: available().capture.entries[0].stats }],
        calculations: [{ team: 'KC', quality: 'defense-estimated' }] });
      expect(JSON.stringify(observation.sourceData.liveDefense)).not.toContain('SEA');
      const original = test.loaded.find((league) => league.configuration.key === observation.sourceData.leagueKey)!;
      expect(observation.sourceRevision).not.toBe(original.source.sourceRevision);
      expect(test.dependencies.lineupRepository.acknowledgeCurrentLineup).toHaveBeenCalledWith(expect.objectContaining({
        leagueKey: original.configuration.key, sourceRevision: observation.sourceRevision,
      }));
    }
    for (const payload of test.fake.published) {
      expect(payload.matchups[0].sides[0].starters[1].projectedPoints).toBeCloseTo(11.1, 10);
      expect(payload.matchups[0].sides[0].points).toBe(21);
      expect(payload.matchups[0].sides[0].projectedPoints).toBeCloseTo(24.1, 10);
      expect(payload.matchups[0].winProbability?.status).toBe('estimated');
    }
    expect(test.fake.publishInputs.every((input) => input.modelVersion === 'clock-v1')).toBe(true);
  });

  it.each(['unavailable', 'throw'] as const)('continues all league publications when optional statistics are %s', async (failure) => {
    const test = harness();
    if (failure === 'throw') test.load.mockRejectedValue(new Error('Simulated provider failure'));
    else test.load.mockResolvedValue({ status: 'unavailable', reason: 'request-not-due', mapping: SLEEPER_LIVE_DEFENSE_MAPPING });
    await expect(test.run()).resolves.toMatchObject({ publishedLeagues: 3, failedLeagues: 0 });
    expect(test.load).toHaveBeenCalledTimes(1);
    for (const payload of test.fake.published) {
      expect(payload.matchups[0].sides[0].starters[1].projectedPoints).toBeCloseTo(9.2, 10);
      expect(payload.matchups[0].sides[0].starters[0].projectedPoints).toBe(13);
      expect(payload.matchups[0].sides[0].points).toBe(21);
    }
  });

  it.each([
    { statusCode: 0, phase: 'pregame', remainingFraction: 1 },
    { statusCode: 2, phase: 'final', remainingFraction: 0 },
  ] as const)('does not load weekly statistics for $phase defenses', async (state) => {
    const test = harness({ ...gameState(), ...state });
    await expect(test.run()).resolves.toMatchObject({ publishedLeagues: 3, failedLeagues: 0 });
    expect(test.load).not.toHaveBeenCalled();
    for (const [observation] of test.observations.mock.calls) {
      expect(observation.sourceData).not.toHaveProperty('liveDefense');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { KICKOFF, NOW, PERIOD, gameState, gameStates, matchupData, player, source } from '../../live-projection-worker.fixtures';
import { normalizeSleeperScoringProfile, SLEEPER_LIVE_DEFENSE_MAPPING } from '../adapters/sleeper/scoring-profile';
import { tank01DefenseScoringStats } from '../adapters/tank01/projection-normalization';
import type { CanonicalScoringProfile, LeagueWeekState } from '../domain/contracts';
import type { LiveDefenseStatResult } from '../ports/live-defense-stat-source';
import type { ProjectionBaselineRecord, ProjectionRunId } from '../ports/projection-repository';
import type { NflGameId, ScoringEntityId } from '../ports/identity-crosswalk';
import { externalGameRef, providerKey } from '../shared/provider-identity';
import { buildProjectedMatchupSnapshot, buildSnapshotWithDefenseEvidence, type BuildSnapshotInput } from './snapshot-builder';

const rules = { pass_yd: 0.04, rush_yd: 0.1, sack: 1, int: 2, fum_rec: 2, def_st_fum_rec: 2, def_td: 6,
  def_st_td: 6, safe: 2, blk_kick: 2, def_3_and_out: 0.5, def_4_and_stop: 1,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
  pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4 };
const rawFrozenStats = Object.freeze({ returnTouchdowns: 0.1, defensiveTouchdowns: 0.2,
  safeties: 0.1, fumbleRecoveries: 1, pointsAllowed: 20, interceptions: 1, sacks: 2, blockedKicks: 0.1 });
const actualStats = { pts_allow: 0, pts_allow_0: 1, sack: 1, def_3_and_out: 2, def_4_and_stop: 1 };

function profile(rawRules: Readonly<Record<string, number>> = rules): CanonicalScoringProfile {
  const value = normalizeSleeperScoringProfile({ provider: providerKey('sleeper'), rawRules });
  if (value.status !== 'available') throw new Error('Invalid fixture profile');
  return value.profile;
}

function defenseSource(): LeagueWeekState {
  const data = matchupData();
  data.matchups[0].sides[0].starters[1] = player('KC', 'Kansas City Chiefs', 'DEF', 'KC', 13);
  data.matchups[0].sides[0].points = 21;
  data.league.rosterPositions = ['QB', 'DEF'];
  return { ...source('l1', data), scoringSettings: { provider: providerKey('sleeper'), rawRules: rules } };
}

function baselines(value: LeagueWeekState): ProjectionBaselineRecord[] {
  return value.rosteredEntities.map((entity) => {
    const isDefense = entity.kind === 'team-defense';
    return { officialEntityRef: entity.externalRef,
      entityId: `entity-${entity.externalRef.externalId}` as ScoringEntityId,
      entityKind: entity.kind, displayName: entity.displayName, nflTeam: entity.nflTeam,
      gameId: 'stored-game-1' as NflGameId, projectionGameRef: externalGameRef(providerKey('tank01'), 'game-1'),
      projectionPoints: isDefense ? 9.2 : 10,
      projectedStats: isDefense ? rawFrozenStats : { passing: { yards: 250 } },
      ...(isDefense ? { scoringStats: tank01DefenseScoringStats(rawFrozenStats) } : {}),
      quality: 'complete' as const, sourceProjectionRunId: 'run-frozen' as ProjectionRunId,
      projectionSource: providerKey('tank01'), modelVersion: 'clock-v1',
      observedAt: '2026-09-13T16:59:59.000Z', frozenAt: KICKOFF };
  });
}

function statistics(): Extract<LiveDefenseStatResult, { status: 'available' }> {
  return { status: 'available', mapping: SLEEPER_LIVE_DEFENSE_MAPPING, capture: {
    period: PERIOD, requestStartedAt: '2026-09-13T18:00:02.000Z',
    requestCompletedAt: '2026-09-13T18:00:04.000Z', observedAt: '2026-09-13T18:00:04.000Z',
    sourceRevision: 'weekly-stat-capture', entries: [{ team: 'KC', stats: actualStats },
      { team: 'SEA', stats: { pts_allow: 14, pts_allow_14_20: 1, sack: 4 } }],
  } };
}

function input(overrides: Partial<BuildSnapshotInput> = {}): BuildSnapshotInput {
  const value = defenseSource();
  return { source: value, games: gameStates(), scored: { status: 'available', projections: [] },
    latest: [], frozen: baselines(value), prior: null, calculatedAt: NOW.toISOString(),
    scoringProfile: profile(), liveDefenseStats: statistics(), ...overrides };
}

function defenseProjection(value: BuildSnapshotInput) {
  const slot = buildProjectedMatchupSnapshot(value).matchups[0].sides[0].starters[1];
  if (slot.kind !== 'occupied') throw new Error('Missing fixture defense');
  return slot;
}

describe('live defense snapshot wiring', () => {
  it('uses immutable Tank01 components, retains earned stop bonuses and propagates the estimate to totals and win chance', () => {
    const base = input();
    const latest = base.frozen.map((record) => record.entityKind === 'team-defense'
      ? { ...record, projectionPoints: 200, projectedStats: { ...rawFrozenStats, sacks: 200 },
          scoringStats: tank01DefenseScoringStats({ ...rawFrozenStats, sacks: 200 }), frozenAt: null }
      : record);
    const built = buildSnapshotWithDefenseEvidence({ ...base, latest });
    const left = built.payload.matchups[0].sides[0];
    expect(defenseProjection({ ...base, latest })).toMatchObject({ projectionQuality: 'defense-estimated' });
    // 13 official - 10 provisional PA + 4.1 remaining additive + 4 final PA bucket.
    expect(left.starters[1].projectedPoints).toBeCloseTo(11.1, 10);
    expect(left.starters[1].points).toBe(13);
    expect(left.points).toBe(21);
    expect(left.projectedPoints).toBeCloseTo(24.1, 10);
    expect(left.starters[0].projectedPoints).toBe(13);
    expect(base.frozen[1].projectedStats).toBe(rawFrozenStats);
    expect(base.frozen[1].projectionPoints).toBe(9.2);
    const held = buildSnapshotWithDefenseEvidence({ ...base, liveDefenseStats: undefined });
    const actualOdds = built.payload.matchups[0].winProbability;
    const heldOdds = held.payload.matchups[0].winProbability;
    expect(actualOdds?.status).toBe('estimated');
    if (!actualOdds || actualOdds.status === 'unavailable' || !heldOdds || heldOdds.status === 'unavailable') {
      throw new Error('Expected available probabilities');
    }
    expect(actualOdds.teams[0].probability).toBeGreaterThan(heldOdds.teams[0].probability);
    expect(built.liveDefense).toMatchObject({ status: 'available', version: 'defense-components-v1',
      sourceRevision: 'weekly-stat-capture', entries: [{ team: 'KC', stats: actualStats }],
      calculations: [{ team: 'KC', quality: 'defense-estimated' }] });
    expect(JSON.stringify(built.payload)).not.toContain('weekly-stat-capture');
    expect(JSON.stringify(built.liveDefense)).not.toContain('SEA');
  });

  it.each(['missing', 'stale', 'wrong-period', 'parity'] as const)('%s actual statistics hold only the defense forecast', (reason) => {
    const valid = statistics();
    const evidence: LiveDefenseStatResult = reason === 'missing'
      ? { status: 'unavailable', reason: 'no-request-budget', mapping: valid.mapping }
      : { ...valid, capture: { ...valid.capture,
          ...(reason === 'stale' ? { requestStartedAt: '2026-09-13T17:55:00.000Z',
            requestCompletedAt: '2026-09-13T17:55:01.000Z', observedAt: '2026-09-13T17:55:01.000Z' } : {}),
          ...(reason === 'wrong-period' ? { period: { ...PERIOD, week: 2 } } : {}),
          ...(reason === 'parity' ? { entries: [{ team: 'KC', stats: { ...actualStats, sack: 12 } }] } : {}),
        } };
    const value = input({ liveDefenseStats: evidence });
    expect(defenseProjection(value)).toMatchObject({ projectedPoints: 9.2, projectionQuality: 'defense-baseline-held' });
    const built = buildSnapshotWithDefenseEvidence(value);
    expect(built.payload.matchups[0].sides[0].starters[0].projectedPoints).toBe(13);
    expect(built.payload.matchups[0].sides[0].points).toBe(21);
    expect(built.payload.matchups[0].sides[0].projectedPoints).toBeCloseTo(22.2, 10);
    expect(built.liveDefense).toMatchObject({ status: 'unavailable',
      calculations: [{ team: 'KC', quality: 'defense-baseline-held', reason: expect.any(String) }] });
    expect(built.liveDefense).not.toHaveProperty('entries');
  });

  it('estimates additive-only defense scoring without a statistics request or speculative stop bonuses', () => {
    const base = input();
    const noPaProfile = profile({ pass_yd: 0.04, sack: 1, def_3_and_out: 0.5 });
    const value = { ...base, scoringProfile: noPaProfile,
      frozen: base.frozen.map((record) => record.entityKind === 'team-defense' ? { ...record, projectionPoints: 2 } : record),
      liveDefenseStats: { status: 'unavailable' as const, reason: 'statistics-not-required', mapping: SLEEPER_LIVE_DEFENSE_MAPPING } };
    expect(defenseProjection(value)).toMatchObject({ projectionQuality: 'defense-estimated', projectedPoints: 14 });
    expect(buildSnapshotWithDefenseEvidence(value).liveDefense).toMatchObject({ status: 'unavailable',
      calculations: [{ team: 'KC', quality: 'defense-estimated' }] });
  });

  it('keeps final official scores and the displayed frozen pregame baseline unchanged', () => {
    const final = gameStates({ ...gameState(), statusCode: 2, phase: 'final', remainingFraction: 0 });
    const value = input({ games: final });
    expect(defenseProjection(value)).toMatchObject({ projectedPoints: 13, projectionQuality: 'official-final' });
    const built = buildSnapshotWithDefenseEvidence(value);
    expect(built.payload.matchups[0].sides[0]).toMatchObject({ points: 21, projectedPoints: 21 });
    expect(built.payload.matchups[0].sides[0].starters[1]).toMatchObject({ points: 13, projectedPoints: 9.2 });
    expect(built.liveDefense).toBeUndefined();
  });
});

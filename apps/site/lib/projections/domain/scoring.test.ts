import { describe, expect, it } from 'vitest';
import type {
  DefenseProjectionStats,
  KickerProjectionStats,
  OffenseProjectionStats,
} from './contracts';
import type { ProjectionScoringRules } from './scoring-events';
import {
  DEFENSE_SCORING_EVENTS,
  KICKER_SCORING_EVENTS,
  OFFENSE_SCORING_EVENTS,
  POINTS_ALLOWED_SCORING_EVENTS,
  PROJECTION_SCORING_EVENTS,
  TWO_POINT_SCORING_EVENTS,
} from './scoring-events';
import {
  auditProjectionScoringRules,
  hasCompleteProjectionStats,
  scoreProjection,
} from './scoring';

const offense: OffenseProjectionStats = {
  kind: 'offense',
  passingYards: 278.4,
  passingTouchdowns: 1.8,
  passingInterceptions: 0.7,
  rushingYards: 14.2,
  rushingTouchdowns: 0.15,
  receptions: 0,
  receivingYards: 0,
  receivingTouchdowns: 0,
  twoPointConversions: 0.08,
  fumblesLost: 0.2,
};

const offenseRules: ProjectionScoringRules = {
  passingYards: 0.04,
  passingTouchdowns: 6,
  passingInterceptions: -2,
  rushingYards: 0.1,
  rushingTouchdowns: 6,
  receptions: 0.5,
  receivingYards: 0.1,
  receivingTouchdowns: 6,
  passingTwoPointConversions: 2,
  rushingTwoPointConversions: 2,
  receivingTwoPointConversions: 2,
  fumblesLost: -2,
};

const defense: DefenseProjectionStats = {
  kind: 'defense',
  sacks: 2.7,
  interceptions: 0.9,
  fumbleRecoveries: 0.55,
  defensiveTouchdowns: 0.18,
  specialTeamsTouchdowns: 0.02,
  safeties: 0.04,
  blockedKicks: 0.08,
  pointsAllowed: 19.6,
};

const defenseRules: ProjectionScoringRules = {
  sacks: 1,
  defensiveInterceptions: 2,
  fumbleRecoveries: 2,
  defensiveTouchdowns: 6,
  specialTeamsTouchdowns: 6,
  safeties: 2,
  blockedKicks: 2,
  pointsAllowedZero: 10,
  pointsAllowedOneToSix: 7,
  pointsAllowedSevenToThirteen: 4,
  pointsAllowedFourteenToTwenty: 1,
  pointsAllowedTwentyOneToTwentySeven: 0,
  pointsAllowedTwentyEightToThirtyFour: -1,
  pointsAllowedThirtyFivePlus: -4,
};

describe('canonical projection scoring', () => {
  it('preserves the current full-precision offense calculation', () => {
    const result = scoreProjection(offense, offenseRules);
    expect(result.available).toBe(true);
    expect(result.points).toBeCloseTo(22.616, 12);
    expect(result.missingStats).toEqual([]);
    expect(result.invalidStats).toEqual([]);
  });

  it('treats zero as data and does not require stats for inactive rules', () => {
    expect(scoreProjection({ kind: 'offense', rushingYards: 0 }, { rushingYards: 0.1 }))
      .toMatchObject({ available: true, points: 0 });
    expect(scoreProjection({ kind: 'offense' }, { rushingYards: 0 }))
      .toMatchObject({ available: true, points: 0, missingStats: [] });
  });

  it('fails closed for a required missing or invalid statistic', () => {
    expect(scoreProjection({ kind: 'offense' }, { rushingYards: 0.1 }))
      .toMatchObject({ available: false, points: null, missingStats: ['rushingYards'] });
    expect(scoreProjection({ kind: 'offense', rushingTouchdowns: -1 }, { rushingTouchdowns: 6 }))
      .toMatchObject({ available: false, points: null, invalidStats: ['rushingTouchdowns'] });
    expect(scoreProjection({ kind: 'offense', rushingYards: -5 }, { rushingYards: 0.1 }))
      .toMatchObject({ available: true, points: -0.5 });
  });

  it.each([
    ['not a number', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s projection statistics instead of returning a misleading score', (_label, value) => {
    expect(scoreProjection(
      { ...offense, passingYards: value },
      offenseRules,
    )).toMatchObject({ available: false, points: null, invalidStats: ['passingYards'] });
  });

  it('uses aggregate two-point conversions only when all three weights match', () => {
    expect(scoreProjection(offense, {
      passingTwoPointConversions: 2,
      rushingTwoPointConversions: 2,
      receivingTwoPointConversions: 2,
    })).toMatchObject({ available: true, points: 0.16, unsupportedScoringEvents: [] });
    expect(scoreProjection(offense, {
      passingTwoPointConversions: 2,
      rushingTwoPointConversions: 1,
      receivingTwoPointConversions: 2,
    })).toMatchObject({
      available: true,
      points: 0,
      unsupportedScoringEvents: [
        'passingTwoPointConversions',
        'receivingTwoPointConversions',
        'rushingTwoPointConversions',
      ],
    });
  });

  it('preserves the points-allowed rounding proxy and defense total', () => {
    const result = scoreProjection(defense, defenseRules);
    expect(result.available).toBe(true);
    expect(result.points).toBeCloseTo(8.04, 12);
    expect(result.pointsAllowedProxy).toEqual({
      projectedPointsAllowed: 19.6,
      roundedPointsAllowed: 20,
      scoringEvent: 'pointsAllowedFourteenToTwenty',
    });
  });

  it.each([
    [0, 'pointsAllowedZero', 10],
    [0.49, 'pointsAllowedZero', 10],
    [0.5, 'pointsAllowedOneToSix', 7],
    [6.49, 'pointsAllowedOneToSix', 7],
    [6.5, 'pointsAllowedSevenToThirteen', 4],
    [13.49, 'pointsAllowedSevenToThirteen', 4],
    [13.5, 'pointsAllowedFourteenToTwenty', 1],
    [20.5, 'pointsAllowedTwentyOneToTwentySeven', 0],
    [27.5, 'pointsAllowedTwentyEightToThirtyFour', -1],
    [34.5, 'pointsAllowedThirtyFivePlus', -4],
  ] as const)('maps %f expected points to the %s proxy bucket', (pointsAllowed, scoringEvent, points) => {
    const pointsAllowedRules = Object.fromEntries(POINTS_ALLOWED_SCORING_EVENTS.map((event) => (
      [event, defenseRules[event]]
    ))) as ProjectionScoringRules;
    expect(scoreProjection(
      { kind: 'defense', pointsAllowed },
      pointsAllowedRules,
    )).toMatchObject({
      available: true,
      points,
      pointsAllowedProxy: { scoringEvent },
    });
  });

  it('requires points allowed only while at least one points-allowed tier is active', () => {
    expect(scoreProjection({ kind: 'defense' }, { pointsAllowedZero: 10 }))
      .toMatchObject({ available: false, points: null, missingStats: ['pointsAllowed'] });
    expect(scoreProjection(
      { kind: 'defense', sacks: 2.25 },
      { sacks: 1, pointsAllowedZero: 0 },
    )).toMatchObject({ available: true, points: 2.25, pointsAllowedProxy: null });
  });

  it('preserves count-based kicker scoring including negative miss weights', () => {
    const kicker: KickerProjectionStats = {
      kind: 'kicker',
      fieldGoalsMade: 2.5,
      fieldGoalsMissed: 0.25,
      extraPointsMade: 2,
      extraPointsMissed: 0.1,
    };
    expect(scoreProjection(kicker, {
      fieldGoalsMade: 3,
      fieldGoalsMissed: -1,
      extraPointsMade: 1,
      extraPointsMissed: -1,
    })).toMatchObject({ available: true, points: 9.15 });
  });

  it('exposes canonical completeness without provider-specific scoring keys', () => {
    expect(hasCompleteProjectionStats(offense)).toBe(true);
    expect(hasCompleteProjectionStats({ ...offense, receivingYards: null })).toBe(false);
    expect(hasCompleteProjectionStats(defense)).toBe(true);
  });

  it('audits invalid values, aggregate two-point compatibility, and points-allowed usage', () => {
    const rules = {
      passingTwoPointConversions: 2,
      rushingTwoPointConversions: 1,
      receivingTwoPointConversions: 2,
      pointsAllowedZero: 10,
      rushingYards: Number.NaN,
    } as ProjectionScoringRules;
    expect(auditProjectionScoringRules(rules)).toEqual({
      activeScoringEvents: [
        'passingTwoPointConversions',
        'pointsAllowedZero',
        'receivingTwoPointConversions',
        'rushingTwoPointConversions',
      ],
      invalidScoringEvents: ['rushingYards'],
      aggregateTwoPointConversionSupported: false,
      usesPointsAllowedBucketProxy: true,
    });
  });

  it('keeps the canonical scoring-event groups explicit and non-overlapping', () => {
    const grouped = [
      ...OFFENSE_SCORING_EVENTS,
      ...DEFENSE_SCORING_EVENTS,
      ...KICKER_SCORING_EVENTS,
    ];
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped).toEqual(PROJECTION_SCORING_EVENTS);
    expect(TWO_POINT_SCORING_EVENTS.every((event) => OFFENSE_SCORING_EVENTS.includes(event)))
      .toBe(true);
    expect(POINTS_ALLOWED_SCORING_EVENTS.every((event) => DEFENSE_SCORING_EVENTS.includes(event)))
      .toBe(true);
  });
});

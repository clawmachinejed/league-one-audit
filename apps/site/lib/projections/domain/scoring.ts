import type {
  DefenseProjectionStats,
  KickerProjectionStats,
  OffenseProjectionStats,
  ProjectionStats,
} from './contracts';
import {
  POINTS_ALLOWED_SCORING_EVENTS,
  PROJECTION_SCORING_EVENTS,
  TWO_POINT_SCORING_EVENTS,
  type DefenseScoringEvent,
  type KickerScoringEvent,
  type OffenseScoringEvent,
  type PointsAllowedScoringEvent,
  type ProjectionScoringEvent,
  type ProjectionScoringRules,
} from './scoring-events';

type OffenseProjectionStat = Exclude<keyof OffenseProjectionStats, 'kind'>;
type DefenseProjectionStat = Exclude<keyof DefenseProjectionStats, 'kind'>;
type KickerProjectionStat = Exclude<keyof KickerProjectionStats, 'kind'>;
export type ProjectionStat = OffenseProjectionStat | DefenseProjectionStat | KickerProjectionStat;

const OFFENSE_RULES = [
  ['passingYards', 'passingYards'],
  ['passingTouchdowns', 'passingTouchdowns'],
  ['passingInterceptions', 'passingInterceptions'],
  ['rushingYards', 'rushingYards'],
  ['rushingTouchdowns', 'rushingTouchdowns'],
  ['receptions', 'receptions'],
  ['receivingYards', 'receivingYards'],
  ['receivingTouchdowns', 'receivingTouchdowns'],
  ['fumblesLost', 'fumblesLost'],
] as const satisfies ReadonlyArray<readonly [OffenseScoringEvent, OffenseProjectionStat]>;

const DEFENSE_RULES = [
  ['sacks', 'sacks'],
  ['defensiveInterceptions', 'interceptions'],
  ['fumbleRecoveries', 'fumbleRecoveries'],
  ['defensiveTouchdowns', 'defensiveTouchdowns'],
  ['specialTeamsTouchdowns', 'specialTeamsTouchdowns'],
  ['safeties', 'safeties'],
  ['blockedKicks', 'blockedKicks'],
] as const satisfies ReadonlyArray<readonly [DefenseScoringEvent, DefenseProjectionStat]>;

const KICKER_RULES = [
  ['fieldGoalsMade', 'fieldGoalsMade'],
  ['fieldGoalsMissed', 'fieldGoalsMissed'],
  ['extraPointsMade', 'extraPointsMade'],
  ['extraPointsMissed', 'extraPointsMissed'],
] as const satisfies ReadonlyArray<readonly [KickerScoringEvent, KickerProjectionStat]>;

export type PointsAllowedProxy = Readonly<{
  projectedPointsAllowed: number;
  roundedPointsAllowed: number;
  scoringEvent: PointsAllowedScoringEvent;
}>;

export type ProjectionScore = Readonly<{
  available: boolean;
  points: number | null;
  appliedScoringEvents: readonly ProjectionScoringEvent[];
  missingStats: readonly ProjectionStat[];
  invalidStats: readonly ProjectionStat[];
  invalidScoringEvents: readonly ProjectionScoringEvent[];
  unsupportedScoringEvents: readonly ProjectionScoringEvent[];
  pointsAllowedProxy: PointsAllowedProxy | null;
}>;

export type ProjectionScoringCoverage = Readonly<{
  activeScoringEvents: readonly ProjectionScoringEvent[];
  invalidScoringEvents: readonly ProjectionScoringEvent[];
  aggregateTwoPointConversionSupported: boolean;
  usesPointsAllowedBucketProxy: boolean;
}>;

type WeightResult =
  | Readonly<{ kind: 'absent'; weight: 0 }>
  | Readonly<{ kind: 'valid'; weight: number }>
  | Readonly<{ kind: 'invalid'; weight: 0 }>;

function weightFor(rules: ProjectionScoringRules, event: ProjectionScoringEvent): WeightResult {
  const value: unknown = rules[event];
  if (value === undefined || value === null) return { kind: 'absent', weight: 0 };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { kind: 'invalid', weight: 0 };
  return { kind: 'valid', weight: value };
}

function isActiveWeight(value: WeightResult): value is Extract<WeightResult, { kind: 'valid' }> {
  return value.kind === 'valid' && value.weight !== 0;
}

function uniqueSorted<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}

function readProjectionStat(
  projection: ProjectionStats,
  stat: ProjectionStat,
  missingStats: Set<ProjectionStat>,
  invalidStats: Set<ProjectionStat>,
): number | null {
  const value = (projection as unknown as Readonly<Record<string, unknown>>)[stat];
  if (value === undefined || value === null) {
    missingStats.add(stat);
    return null;
  }
  const negativeAllowed = stat === 'passingYards' || stat === 'rushingYards' || stat === 'receivingYards';
  if (typeof value !== 'number' || !Number.isFinite(value) || (value < 0 && !negativeAllowed)) {
    invalidStats.add(stat);
    return null;
  }
  return value;
}

function pointsAllowedScoringEvent(pointsAllowed: number): PointsAllowedProxy {
  const roundedPointsAllowed = Math.round(pointsAllowed);
  let scoringEvent: PointsAllowedScoringEvent;
  if (roundedPointsAllowed === 0) scoringEvent = 'pointsAllowedZero';
  else if (roundedPointsAllowed <= 6) scoringEvent = 'pointsAllowedOneToSix';
  else if (roundedPointsAllowed <= 13) scoringEvent = 'pointsAllowedSevenToThirteen';
  else if (roundedPointsAllowed <= 20) scoringEvent = 'pointsAllowedFourteenToTwenty';
  else if (roundedPointsAllowed <= 27) scoringEvent = 'pointsAllowedTwentyOneToTwentySeven';
  else if (roundedPointsAllowed <= 34) scoringEvent = 'pointsAllowedTwentyEightToThirtyFour';
  else scoringEvent = 'pointsAllowedThirtyFivePlus';
  return { projectedPointsAllowed: pointsAllowed, roundedPointsAllowed, scoringEvent };
}

function scoreOffense(
  projection: OffenseProjectionStats,
  rules: ProjectionScoringRules,
): ProjectionScore {
  const missingStats = new Set<ProjectionStat>();
  const invalidStats = new Set<ProjectionStat>();
  const invalidScoringEvents = new Set<ProjectionScoringEvent>();
  const unsupportedScoringEvents = new Set<ProjectionScoringEvent>();
  const appliedScoringEvents = new Set<ProjectionScoringEvent>();
  let points = 0;

  for (const [event, stat] of OFFENSE_RULES) {
    const weight = weightFor(rules, event);
    if (weight.kind === 'invalid') {
      invalidScoringEvents.add(event);
      continue;
    }
    if (!isActiveWeight(weight)) continue;
    const value = readProjectionStat(projection, stat, missingStats, invalidStats);
    if (value !== null) {
      points += value * weight.weight;
      appliedScoringEvents.add(event);
    }
  }

  const twoPointWeights = TWO_POINT_SCORING_EVENTS.map((event) => [event, weightFor(rules, event)] as const);
  for (const [event, weight] of twoPointWeights) {
    if (weight.kind === 'invalid') invalidScoringEvents.add(event);
  }
  const values = twoPointWeights.map(([, weight]) => weight.weight);
  const hasActiveRule = values.some((value) => value !== 0);
  const matchingWeights = values.every((value) => value === values[0]);
  if (hasActiveRule && matchingWeights && invalidScoringEvents.size === 0) {
    const value = readProjectionStat(projection, 'twoPointConversions', missingStats, invalidStats);
    if (value !== null) {
      points += value * values[0];
      TWO_POINT_SCORING_EVENTS.forEach((event) => appliedScoringEvents.add(event));
    }
  } else if (hasActiveRule && !matchingWeights) {
    for (const [event, weight] of twoPointWeights) {
      if (isActiveWeight(weight)) unsupportedScoringEvents.add(event);
    }
  }

  const available = missingStats.size === 0 && invalidStats.size === 0 && invalidScoringEvents.size === 0;
  return {
    available,
    points: available ? points : null,
    appliedScoringEvents: uniqueSorted(appliedScoringEvents),
    missingStats: uniqueSorted(missingStats),
    invalidStats: uniqueSorted(invalidStats),
    invalidScoringEvents: uniqueSorted(invalidScoringEvents),
    unsupportedScoringEvents: uniqueSorted(unsupportedScoringEvents),
    pointsAllowedProxy: null,
  };
}

function scoreKicker(
  projection: KickerProjectionStats,
  rules: ProjectionScoringRules,
): ProjectionScore {
  const missingStats = new Set<ProjectionStat>();
  const invalidStats = new Set<ProjectionStat>();
  const invalidScoringEvents = new Set<ProjectionScoringEvent>();
  const appliedScoringEvents = new Set<ProjectionScoringEvent>();
  let points = 0;
  for (const [event, stat] of KICKER_RULES) {
    const weight = weightFor(rules, event);
    if (weight.kind === 'invalid') {
      invalidScoringEvents.add(event);
      continue;
    }
    if (!isActiveWeight(weight)) continue;
    const value = readProjectionStat(projection, stat, missingStats, invalidStats);
    if (value !== null) {
      points += value * weight.weight;
      appliedScoringEvents.add(event);
    }
  }
  const available = missingStats.size === 0 && invalidStats.size === 0 && invalidScoringEvents.size === 0;
  return {
    available,
    points: available ? points : null,
    appliedScoringEvents: uniqueSorted(appliedScoringEvents),
    missingStats: uniqueSorted(missingStats),
    invalidStats: uniqueSorted(invalidStats),
    invalidScoringEvents: uniqueSorted(invalidScoringEvents),
    unsupportedScoringEvents: [],
    pointsAllowedProxy: null,
  };
}

function scoreDefense(
  projection: DefenseProjectionStats,
  rules: ProjectionScoringRules,
): ProjectionScore {
  const missingStats = new Set<ProjectionStat>();
  const invalidStats = new Set<ProjectionStat>();
  const invalidScoringEvents = new Set<ProjectionScoringEvent>();
  const appliedScoringEvents = new Set<ProjectionScoringEvent>();
  let points = 0;
  let pointsAllowedProxy: PointsAllowedProxy | null = null;
  for (const [event, stat] of DEFENSE_RULES) {
    const weight = weightFor(rules, event);
    if (weight.kind === 'invalid') {
      invalidScoringEvents.add(event);
      continue;
    }
    if (!isActiveWeight(weight)) continue;
    const value = readProjectionStat(projection, stat, missingStats, invalidStats);
    if (value !== null) {
      points += value * weight.weight;
      appliedScoringEvents.add(event);
    }
  }

  const pointsAllowedWeights = POINTS_ALLOWED_SCORING_EVENTS
    .map((event) => [event, weightFor(rules, event)] as const);
  for (const [event, weight] of pointsAllowedWeights) {
    if (weight.kind === 'invalid') invalidScoringEvents.add(event);
  }
  if (pointsAllowedWeights.some(([, weight]) => isActiveWeight(weight))) {
    const value = readProjectionStat(projection, 'pointsAllowed', missingStats, invalidStats);
    if (value !== null) {
      pointsAllowedProxy = pointsAllowedScoringEvent(value);
      const weight = weightFor(rules, pointsAllowedProxy.scoringEvent);
      if (isActiveWeight(weight)) {
        points += weight.weight;
        appliedScoringEvents.add(pointsAllowedProxy.scoringEvent);
      }
    }
  }
  const available = missingStats.size === 0 && invalidStats.size === 0 && invalidScoringEvents.size === 0;
  return {
    available,
    points: available ? points : null,
    appliedScoringEvents: uniqueSorted(appliedScoringEvents),
    missingStats: uniqueSorted(missingStats),
    invalidStats: uniqueSorted(invalidStats),
    invalidScoringEvents: uniqueSorted(invalidScoringEvents),
    unsupportedScoringEvents: [],
    pointsAllowedProxy,
  };
}

export function scoreProjection(
  projection: ProjectionStats,
  rules: ProjectionScoringRules,
): ProjectionScore {
  if (projection.kind === 'offense') return scoreOffense(projection, rules);
  if (projection.kind === 'kicker') return scoreKicker(projection, rules);
  return scoreDefense(projection, rules);
}

export const COMPLETE_PROJECTION_SCORING_RULES: ProjectionScoringRules = Object.freeze(
  Object.fromEntries(PROJECTION_SCORING_EVENTS.map((event) => [event, 1])) as Record<
    ProjectionScoringEvent,
    number
  >,
);

export function hasCompleteProjectionStats(projection: ProjectionStats): boolean {
  return scoreProjection(projection, COMPLETE_PROJECTION_SCORING_RULES).available;
}

export function auditProjectionScoringRules(
  rules: ProjectionScoringRules,
): ProjectionScoringCoverage {
  const activeScoringEvents = new Set<ProjectionScoringEvent>();
  const invalidScoringEvents = new Set<ProjectionScoringEvent>();
  for (const event of PROJECTION_SCORING_EVENTS) {
    const weight = weightFor(rules, event);
    if (weight.kind === 'invalid') invalidScoringEvents.add(event);
    else if (isActiveWeight(weight)) activeScoringEvents.add(event);
  }
  const twoPointWeights = TWO_POINT_SCORING_EVENTS.map((event) => weightFor(rules, event));
  const aggregateTwoPointConversionSupported = twoPointWeights.every((weight) => weight.kind !== 'invalid')
    && twoPointWeights.every((weight) => weight.weight === twoPointWeights[0].weight);
  return {
    activeScoringEvents: uniqueSorted(activeScoringEvents),
    invalidScoringEvents: uniqueSorted(invalidScoringEvents),
    aggregateTwoPointConversionSupported,
    usesPointsAllowedBucketProxy: POINTS_ALLOWED_SCORING_EVENTS
      .some((event) => isActiveWeight(weightFor(rules, event))),
  };
}

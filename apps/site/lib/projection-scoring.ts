export type SleeperScoringSettings = Readonly<Record<string, unknown>>;

export interface NormalizedTank01OffenseProjection {
  kind: 'offense';
  passingYards?: number | null;
  passingTouchdowns?: number | null;
  passingInterceptions?: number | null;
  rushingYards?: number | null;
  rushingTouchdowns?: number | null;
  receptions?: number | null;
  receivingYards?: number | null;
  receivingTouchdowns?: number | null;
  /** Tank01 supplies one combined total rather than a pass/rush/receive split. */
  twoPointConversions?: number | null;
  fumblesLost?: number | null;
}

export interface NormalizedTank01DefenseProjection {
  kind: 'defense';
  sacks?: number | null;
  interceptions?: number | null;
  fumbleRecoveries?: number | null;
  defensiveTouchdowns?: number | null;
  specialTeamsTouchdowns?: number | null;
  safeties?: number | null;
  blockedKicks?: number | null;
  /** Expected points allowed, which may be fractional. */
  pointsAllowed?: number | null;
}

export interface NormalizedTank01KickerProjection {
  kind: 'kicker';
  fieldGoalsMade?: number | null;
  fieldGoalsMissed?: number | null;
  extraPointsMade?: number | null;
  extraPointsMissed?: number | null;
}

export type NormalizedTank01Projection =
  | NormalizedTank01OffenseProjection
  | NormalizedTank01DefenseProjection
  | NormalizedTank01KickerProjection;

export type OffenseProjectionStat = Exclude<keyof NormalizedTank01OffenseProjection, 'kind'>;
export type DefenseProjectionStat = Exclude<keyof NormalizedTank01DefenseProjection, 'kind'>;
export type KickerProjectionStat = Exclude<keyof NormalizedTank01KickerProjection, 'kind'>;
export type ProjectionStat = OffenseProjectionStat | DefenseProjectionStat | KickerProjectionStat;

const OFFENSE_RULES = [
  ['pass_yd', 'passingYards'],
  ['pass_td', 'passingTouchdowns'],
  ['pass_int', 'passingInterceptions'],
  ['rush_yd', 'rushingYards'],
  ['rush_td', 'rushingTouchdowns'],
  ['rec', 'receptions'],
  ['rec_yd', 'receivingYards'],
  ['rec_td', 'receivingTouchdowns'],
  ['fum_lost', 'fumblesLost'],
] as const satisfies ReadonlyArray<readonly [string, OffenseProjectionStat]>;

const DEFENSE_RULES = [
  ['sack', 'sacks'],
  ['int', 'interceptions'],
  ['def_st_fum_rec', 'fumbleRecoveries'],
  ['def_td', 'defensiveTouchdowns'],
  ['def_st_td', 'specialTeamsTouchdowns'],
  ['safe', 'safeties'],
  ['blk_kick', 'blockedKicks'],
] as const satisfies ReadonlyArray<readonly [string, DefenseProjectionStat]>;

const KICKER_RULES = [
  ['fgm', 'fieldGoalsMade'],
  ['fgmiss', 'fieldGoalsMissed'],
  ['xpm', 'extraPointsMade'],
  ['xpmiss', 'extraPointsMissed'],
] as const satisfies ReadonlyArray<readonly [string, KickerProjectionStat]>;

export const TWO_POINT_SCORING_KEYS = ['pass_2pt', 'rush_2pt', 'rec_2pt'] as const;

export const POINTS_ALLOWED_SCORING_KEYS = [
  'pts_allow_0',
  'pts_allow_1_6',
  'pts_allow_7_13',
  'pts_allow_14_20',
  'pts_allow_21_27',
  'pts_allow_28_34',
  'pts_allow_35p',
] as const;

export type PointsAllowedScoringKey = typeof POINTS_ALLOWED_SCORING_KEYS[number];

export const SUPPORTED_OFFENSE_SCORING_KEYS = [
  ...OFFENSE_RULES.map(([key]) => key),
  ...TWO_POINT_SCORING_KEYS,
] as const;

export const SUPPORTED_DEFENSE_SCORING_KEYS = [
  ...DEFENSE_RULES.map(([key]) => key),
  ...POINTS_ALLOWED_SCORING_KEYS,
] as const;

export const SUPPORTED_KICKER_SCORING_KEYS = KICKER_RULES.map(([key]) => key);

export const SUPPORTED_PROJECTION_SCORING_KEYS = [
  ...SUPPORTED_OFFENSE_SCORING_KEYS,
  ...SUPPORTED_DEFENSE_SCORING_KEYS,
  ...SUPPORTED_KICKER_SCORING_KEYS,
] as const;

export interface PointsAllowedProxy {
  /** The fractional projection returned by Tank01. */
  projectedPointsAllowed: number;
  /** The nearest whole point used to select Sleeper's discrete scoring bucket. */
  roundedPointsAllowed: number;
  scoringKey: PointsAllowedScoringKey;
}

export interface ProjectionScoreResult {
  available: boolean;
  /** Full-precision total. Presentation code is responsible for display rounding. */
  points: number | null;
  appliedScoringKeys: string[];
  missingStats: ProjectionStat[];
  invalidStats: ProjectionStat[];
  invalidScoringKeys: string[];
  /** Active rules omitted because the normalized Tank01 line cannot represent them. */
  unsupportedScoringKeys: string[];
  /** Present whenever projected points allowed are converted to a Sleeper tier. */
  pointsAllowedProxy: PointsAllowedProxy | null;
}

export interface ProjectionScoringCoverage {
  supportedScoringKeys: string[];
  unsupportedScoringKeys: string[];
  invalidScoringKeys: string[];
  /** Tank01 has one aggregate 2PT value, so unequal category weights are unsupported. */
  aggregateTwoPointConversionSupported: boolean;
  usesPointsAllowedBucketProxy: boolean;
}

type WeightResult =
  | { kind: 'absent'; weight: 0 }
  | { kind: 'valid'; weight: number }
  | { kind: 'invalid'; weight: 0 };

const supportedKeys = new Set<string>(SUPPORTED_PROJECTION_SCORING_KEYS);
const offenseSupportedKeys = new Set<string>(SUPPORTED_OFFENSE_SCORING_KEYS);
const defenseSupportedKeys = new Set<string>(SUPPORTED_DEFENSE_SCORING_KEYS);
const kickerSupportedKeys = new Set<string>(SUPPORTED_KICKER_SCORING_KEYS);

function weightFor(settings: SleeperScoringSettings, key: string): WeightResult {
  const value = settings[key];
  if (value === undefined || value === null) return { kind: 'absent', weight: 0 };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { kind: 'invalid', weight: 0 };
  return { kind: 'valid', weight: value };
}

function isActiveWeight(result: WeightResult): result is Extract<WeightResult, { kind: 'valid' }> {
  return result.kind === 'valid' && result.weight !== 0;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function isOffenseScoringKey(key: string): boolean {
  return offenseSupportedKeys.has(key)
    || key === 'fum'
    || key === 'fum_rec'
    || key === 'fum_rec_td'
    || key.startsWith('st_')
    || key.startsWith('pass_')
    || key.startsWith('rush_')
    || key.startsWith('rec_')
    || key.startsWith('bonus_pass_')
    || key.startsWith('bonus_rush_')
    || key.startsWith('bonus_rec_');
}

function isDefenseScoringKey(key: string): boolean {
  return defenseSupportedKeys.has(key)
    || key === 'ff'
    || key.startsWith('def_')
    || key.startsWith('pts_allow_')
    || key.startsWith('yds_allow_');
}

function isKickerScoringKey(key: string): boolean {
  return kickerSupportedKeys.has(key) || key.startsWith('fg') || key.startsWith('xp');
}

function scoringKeysForKind(kind: NormalizedTank01Projection['kind']): {
  relevant: (key: string) => boolean;
  supported: Set<string>;
} {
  if (kind === 'defense') return { relevant: isDefenseScoringKey, supported: defenseSupportedKeys };
  if (kind === 'kicker') return { relevant: isKickerScoringKey, supported: kickerSupportedKeys };
  return { relevant: isOffenseScoringKey, supported: offenseSupportedKeys };
}

function relevantUnsupportedKeys(
  settings: SleeperScoringSettings,
  kind: NormalizedTank01Projection['kind'],
): string[] {
  const { relevant: isRelevant, supported } = scoringKeysForKind(kind);

  return uniqueSorted(Object.entries(settings).flatMap(([key]) => {
    const result = weightFor(settings, key);
    return isRelevant(key) && !supported.has(key) && isActiveWeight(result) ? [key] : [];
  }));
}

function relevantInvalidScoringKeys(
  settings: SleeperScoringSettings,
  kind: NormalizedTank01Projection['kind'],
): string[] {
  const { relevant: isRelevant } = scoringKeysForKind(kind);
  return uniqueSorted(Object.keys(settings).filter((key) => {
    return isRelevant(key) && weightFor(settings, key).kind === 'invalid';
  }));
}

function readProjectionStat(
  projection: NormalizedTank01Projection,
  stat: ProjectionStat,
  missingStats: Set<ProjectionStat>,
  invalidStats: Set<ProjectionStat>,
): number | null {
  const value = (projection as unknown as Record<string, unknown>)[stat];
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

function scoreKicker(
  projection: NormalizedTank01KickerProjection,
  settings: SleeperScoringSettings,
): ProjectionScoreResult {
  const missingStats = new Set<ProjectionStat>();
  const invalidStats = new Set<ProjectionStat>();
  const invalidScoringKeys = new Set(relevantInvalidScoringKeys(settings, 'kicker'));
  const appliedScoringKeys = new Set<string>();
  const unsupportedScoringKeys = new Set(relevantUnsupportedKeys(settings, 'kicker'));
  let points = 0;

  for (const [key, stat] of KICKER_RULES) {
    const scoring = weightFor(settings, key);
    if (scoring.kind === 'invalid') {
      invalidScoringKeys.add(key);
      continue;
    }
    if (!isActiveWeight(scoring)) continue;
    const value = readProjectionStat(projection, stat, missingStats, invalidStats);
    if (value !== null) {
      points += value * scoring.weight;
      appliedScoringKeys.add(key);
    }
  }

  const available = missingStats.size === 0 && invalidStats.size === 0 && invalidScoringKeys.size === 0;
  return {
    available,
    points: available ? points : null,
    appliedScoringKeys: uniqueSorted(appliedScoringKeys),
    missingStats: uniqueSorted(missingStats) as ProjectionStat[],
    invalidStats: uniqueSorted(invalidStats) as ProjectionStat[],
    invalidScoringKeys: uniqueSorted(invalidScoringKeys),
    unsupportedScoringKeys: uniqueSorted(unsupportedScoringKeys),
    pointsAllowedProxy: null,
  };
}

function pointsAllowedScoringKey(pointsAllowed: number): PointsAllowedProxy {
  const roundedPointsAllowed = Math.round(pointsAllowed);
  let scoringKey: PointsAllowedScoringKey;

  if (roundedPointsAllowed === 0) scoringKey = 'pts_allow_0';
  else if (roundedPointsAllowed <= 6) scoringKey = 'pts_allow_1_6';
  else if (roundedPointsAllowed <= 13) scoringKey = 'pts_allow_7_13';
  else if (roundedPointsAllowed <= 20) scoringKey = 'pts_allow_14_20';
  else if (roundedPointsAllowed <= 27) scoringKey = 'pts_allow_21_27';
  else if (roundedPointsAllowed <= 34) scoringKey = 'pts_allow_28_34';
  else scoringKey = 'pts_allow_35p';

  return { projectedPointsAllowed: pointsAllowed, roundedPointsAllowed, scoringKey };
}

function scoreOffense(
  projection: NormalizedTank01OffenseProjection,
  settings: SleeperScoringSettings,
): ProjectionScoreResult {
  const missingStats = new Set<ProjectionStat>();
  const invalidStats = new Set<ProjectionStat>();
  const invalidScoringKeys = new Set(relevantInvalidScoringKeys(settings, 'offense'));
  const appliedScoringKeys = new Set<string>();
  const unsupportedScoringKeys = new Set(relevantUnsupportedKeys(settings, 'offense'));
  let points = 0;

  for (const [key, stat] of OFFENSE_RULES) {
    const scoring = weightFor(settings, key);
    if (scoring.kind === 'invalid') {
      invalidScoringKeys.add(key);
      continue;
    }
    if (!isActiveWeight(scoring)) continue;

    const value = readProjectionStat(projection, stat, missingStats, invalidStats);
    if (value !== null) {
      points += value * scoring.weight;
      appliedScoringKeys.add(key);
    }
  }

  const twoPointWeights = TWO_POINT_SCORING_KEYS.map((key) => [key, weightFor(settings, key)] as const);
  for (const [key, result] of twoPointWeights) {
    if (result.kind === 'invalid') invalidScoringKeys.add(key);
  }

  const validTwoPointWeights = twoPointWeights.map(([, result]) => result.weight);
  const hasActiveTwoPointRule = validTwoPointWeights.some((weight) => weight !== 0);
  const matchingTwoPointWeights = validTwoPointWeights.every((weight) => weight === validTwoPointWeights[0]);

  if (hasActiveTwoPointRule && matchingTwoPointWeights && invalidScoringKeys.size === 0) {
    const value = readProjectionStat(projection, 'twoPointConversions', missingStats, invalidStats);
    if (value !== null) {
      points += value * validTwoPointWeights[0];
      TWO_POINT_SCORING_KEYS.forEach((key) => appliedScoringKeys.add(key));
    }
  } else if (hasActiveTwoPointRule && !matchingTwoPointWeights) {
    for (const [key, result] of twoPointWeights) {
      if (isActiveWeight(result)) unsupportedScoringKeys.add(key);
    }
  }

  const available = missingStats.size === 0 && invalidStats.size === 0 && invalidScoringKeys.size === 0;
  return {
    available,
    points: available ? points : null,
    appliedScoringKeys: uniqueSorted(appliedScoringKeys),
    missingStats: uniqueSorted(missingStats) as ProjectionStat[],
    invalidStats: uniqueSorted(invalidStats) as ProjectionStat[],
    invalidScoringKeys: uniqueSorted(invalidScoringKeys),
    unsupportedScoringKeys: uniqueSorted(unsupportedScoringKeys),
    pointsAllowedProxy: null,
  };
}

function scoreDefense(
  projection: NormalizedTank01DefenseProjection,
  settings: SleeperScoringSettings,
): ProjectionScoreResult {
  const missingStats = new Set<ProjectionStat>();
  const invalidStats = new Set<ProjectionStat>();
  const invalidScoringKeys = new Set(relevantInvalidScoringKeys(settings, 'defense'));
  const appliedScoringKeys = new Set<string>();
  const unsupportedScoringKeys = new Set(relevantUnsupportedKeys(settings, 'defense'));
  let points = 0;
  let pointsAllowedProxy: PointsAllowedProxy | null = null;

  for (const [key, stat] of DEFENSE_RULES) {
    const scoring = weightFor(settings, key);
    if (scoring.kind === 'invalid') {
      invalidScoringKeys.add(key);
      continue;
    }
    if (!isActiveWeight(scoring)) continue;

    const value = readProjectionStat(projection, stat, missingStats, invalidStats);
    if (value !== null) {
      points += value * scoring.weight;
      appliedScoringKeys.add(key);
    }
  }

  const pointsAllowedWeights = POINTS_ALLOWED_SCORING_KEYS.map((key) => [key, weightFor(settings, key)] as const);
  for (const [key, result] of pointsAllowedWeights) {
    if (result.kind === 'invalid') invalidScoringKeys.add(key);
  }

  if (pointsAllowedWeights.some(([, result]) => isActiveWeight(result))) {
    const projected = readProjectionStat(projection, 'pointsAllowed', missingStats, invalidStats);
    if (projected !== null) {
      pointsAllowedProxy = pointsAllowedScoringKey(projected);
      const scoring = weightFor(settings, pointsAllowedProxy.scoringKey);
      if (isActiveWeight(scoring)) {
        points += scoring.weight;
        appliedScoringKeys.add(pointsAllowedProxy.scoringKey);
      }
    }
  }

  const available = missingStats.size === 0 && invalidStats.size === 0 && invalidScoringKeys.size === 0;
  return {
    available,
    points: available ? points : null,
    appliedScoringKeys: uniqueSorted(appliedScoringKeys),
    missingStats: uniqueSorted(missingStats) as ProjectionStat[],
    invalidStats: uniqueSorted(invalidStats) as ProjectionStat[],
    invalidScoringKeys: uniqueSorted(invalidScoringKeys),
    unsupportedScoringKeys: uniqueSorted(unsupportedScoringKeys),
    pointsAllowedProxy,
  };
}

export function scoreTank01Projection(
  projection: NormalizedTank01Projection,
  scoringSettings: SleeperScoringSettings,
): ProjectionScoreResult {
  if (projection.kind === 'offense') return scoreOffense(projection, scoringSettings);
  if (projection.kind === 'kicker') return scoreKicker(projection, scoringSettings);
  return scoreDefense(projection, scoringSettings);
}

export function auditProjectionScoringSettings(
  scoringSettings: SleeperScoringSettings,
): ProjectionScoringCoverage {
  const supportedScoringKeys = new Set<string>();
  const unsupportedScoringKeys = new Set<string>();
  const invalidScoringKeys = new Set<string>();

  for (const key of Object.keys(scoringSettings)) {
    const result = weightFor(scoringSettings, key);
    if (result.kind === 'invalid') {
      invalidScoringKeys.add(key);
    } else if (isActiveWeight(result)) {
      (supportedKeys.has(key) ? supportedScoringKeys : unsupportedScoringKeys).add(key);
    }
  }

  const twoPointWeights = TWO_POINT_SCORING_KEYS.map((key) => weightFor(scoringSettings, key));
  const aggregateTwoPointConversionSupported = twoPointWeights.every((result) => result.kind !== 'invalid')
    && twoPointWeights.every((result) => result.weight === twoPointWeights[0].weight);

  if (!aggregateTwoPointConversionSupported) {
    TWO_POINT_SCORING_KEYS.forEach((key, index) => {
      if (isActiveWeight(twoPointWeights[index])) {
        supportedScoringKeys.delete(key);
        unsupportedScoringKeys.add(key);
      }
    });
  }

  return {
    supportedScoringKeys: uniqueSorted(supportedScoringKeys),
    unsupportedScoringKeys: uniqueSorted(unsupportedScoringKeys),
    invalidScoringKeys: uniqueSorted(invalidScoringKeys),
    aggregateTwoPointConversionSupported,
    usesPointsAllowedBucketProxy: POINTS_ALLOWED_SCORING_KEYS.some((key) => {
      return isActiveWeight(weightFor(scoringSettings, key));
    }),
  };
}

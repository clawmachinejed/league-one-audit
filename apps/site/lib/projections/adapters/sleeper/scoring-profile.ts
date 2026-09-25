import type {
  CanonicalScoringProfile,
  SourceScoringSettings,
} from '../../domain/contracts';
import type {
  PointsAllowedScoringEvent,
  ProjectionScoringEvent,
  ProjectionScoringRules,
} from '../../domain/scoring-events';
import type { DefenseStatMapping } from '../../ports/live-defense-stat-source';
import { SUPPLEMENTAL_PROJECTION_MODEL, SUPPLEMENTAL_PROJECTION_RULES } from './supplemental-projection-rules';

const SOURCE_RULES = [
  ['pass_yd', 'passingYards'],
  ['pass_td', 'passingTouchdowns'],
  ['pass_int', 'passingInterceptions'],
  ['rush_yd', 'rushingYards'],
  ['rush_td', 'rushingTouchdowns'],
  ['rec', 'receptions'],
  ['rec_yd', 'receivingYards'],
  ['rec_td', 'receivingTouchdowns'],
  ['pass_2pt', 'passingTwoPointConversions'],
  ['rush_2pt', 'rushingTwoPointConversions'],
  ['rec_2pt', 'receivingTwoPointConversions'],
  ['fum_lost', 'fumblesLost'],
  ['sack', 'sacks'],
  ['int', 'defensiveInterceptions'],
  ['def_st_fum_rec', 'fumbleRecoveries'],
  ['def_td', 'defensiveTouchdowns'],
  ['def_st_td', 'specialTeamsTouchdowns'],
  ['safe', 'safeties'],
  ['blk_kick', 'blockedKicks'],
  ['pts_allow_0', 'pointsAllowedZero'],
  ['pts_allow_1_6', 'pointsAllowedOneToSix'],
  ['pts_allow_7_13', 'pointsAllowedSevenToThirteen'],
  ['pts_allow_14_20', 'pointsAllowedFourteenToTwenty'],
  ['pts_allow_21_27', 'pointsAllowedTwentyOneToTwentySeven'],
  ['pts_allow_28_34', 'pointsAllowedTwentyEightToThirtyFour'],
  ['pts_allow_35p', 'pointsAllowedThirtyFivePlus'],
  ['fgm', 'fieldGoalsMade'],
  ['fgmiss', 'fieldGoalsMissed'],
  ['xpm', 'extraPointsMade'],
  ['xpmiss', 'extraPointsMissed'],
] as const satisfies ReadonlyArray<readonly [string, ProjectionScoringEvent]>;

/**
 * Exact weekly-stat keys exercised by the approved 2026 and historical parity
 * corpus. Actual weekly scoring consumes provider-native counters directly;
 * projection-only supplemental estimates never alter those counters or weights.
 */
export const SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS: ReadonlySet<string> = new Set([
  ...SOURCE_RULES.map(([sourceKey]) => sourceKey),
  'pass_td_40p',
  'rush_td_40p',
  'rec_td_40p',
  'fum_rec',
  'fum_rec_td',
  'st_td',
  'def_2pt',
  'def_3_and_out',
  'def_4_and_stop',
  'fgm_yds_over_30',
  // Native counters qualified by the retained scoring-event coverage corpus.
  'pass_int_td',
  'st_fum_rec',
  'ff',
  'def_st_ff',
  'st_ff',
  'fgm_0_19',
  'fgm_20_29',
  'fgm_30_39',
  'fgm_40_49',
  'fgm_50_59',
  'fgm_60p',
]);

const TWO_POINT_SOURCE_KEYS = ['pass_2pt', 'rush_2pt', 'rec_2pt'] as const;
const POINTS_ALLOWED_SOURCE_KEYS = [
  'pts_allow_0',
  'pts_allow_1_6',
  'pts_allow_7_13',
  'pts_allow_14_20',
  'pts_allow_21_27',
  'pts_allow_28_34',
  'pts_allow_35p',
] as const;

/** Reuses the canonical scoring-key translation for live defense evidence. */
export const SLEEPER_LIVE_DEFENSE_MAPPING: DefenseStatMapping = {
  supportedActualRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
  pointsAllowedStatKey: 'pts_allow',
  pointsAllowedBuckets: Object.fromEntries(SOURCE_RULES
    .filter(([key]) => (POINTS_ALLOWED_SOURCE_KEYS as readonly string[]).includes(key))
    .map(([key, event]) => [event, key])) as Record<PointsAllowedScoringEvent, string>,
};
export const SLEEPER_LIVE_DEFENSE_STAT_KEYS: ReadonlySet<string> = new Set([
  ...SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
  SLEEPER_LIVE_DEFENSE_MAPPING.pointsAllowedStatKey,
  ...Object.values(SLEEPER_LIVE_DEFENSE_MAPPING.pointsAllowedBuckets),
]);

const eventBySourceKey = new Map<string, ProjectionScoringEvent>(SOURCE_RULES);

export type SleeperScoringProfileNormalization =
  | Readonly<{
      status: 'available';
      profile: CanonicalScoringProfile;
    }>
  | Readonly<{
      status: 'unavailable';
      reason: 'missing' | 'invalid';
      invalidSourceKeys: readonly string[];
    }>;

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function isActiveWeight(value: number | undefined): value is number {
  return value !== undefined && value !== 0;
}

/**
 * Validates and translates Sleeper scoring only at the league-publication
 * boundary. The raw numeric rules remain intact for compatible hashing and
 * audit; source loading itself deliberately does not call this function.
 */
export function normalizeSleeperScoringProfile(
  source: SourceScoringSettings,
): SleeperScoringProfileNormalization {
  const raw = source.rawRules;
  if (!raw || Object.keys(raw).length === 0) {
    return { status: 'unavailable', reason: 'missing', invalidSourceKeys: [] };
  }

  const invalidSourceKeys = uniqueSorted(Object.entries(raw).flatMap(([key, value]) => (
    typeof value !== 'number' || !Number.isFinite(value) ? [key] : []
  )));
  if (invalidSourceKeys.length > 0) {
    return { status: 'unavailable', reason: 'invalid', invalidSourceKeys };
  }

  const rawRules = raw as Readonly<Record<string, number>>;
  const rules: Partial<Record<ProjectionScoringEvent, number>> = {};
  const supportedSourceKeys = new Set<string>();
  const unsupportedSourceKeys = new Set<string>();
  for (const [sourceKey, value] of Object.entries(rawRules)) {
    const event = eventBySourceKey.get(sourceKey);
    if (event) rules[event] = value;
    if (!isActiveWeight(value)) continue;
    (event ? supportedSourceKeys : unsupportedSourceKeys).add(sourceKey);
  }

  const estimatedSourceKeys: string[] = [];
  for (const [sourceKey, event, rate] of SUPPLEMENTAL_PROJECTION_RULES) {
    const weight = rawRules[sourceKey];
    if (!isActiveWeight(weight)) continue;
    rules[event] = (rules[event] ?? 0) + weight * rate;
    unsupportedSourceKeys.delete(sourceKey);
    supportedSourceKeys.add(sourceKey);
    estimatedSourceKeys.push(sourceKey);
  }

  const twoPointWeights = TWO_POINT_SOURCE_KEYS.map((key) => rawRules[key] ?? 0);
  const aggregateTwoPointConversionSupported = twoPointWeights
    .every((weight) => weight === twoPointWeights[0]);
  if (!aggregateTwoPointConversionSupported) {
    TWO_POINT_SOURCE_KEYS.forEach((key) => {
      if (!isActiveWeight(rawRules[key])) return;
      supportedSourceKeys.delete(key);
      unsupportedSourceKeys.add(key);
    });
  }

  const usesPointsAllowedBucketProxy = POINTS_ALLOWED_SOURCE_KEYS
    .some((key) => isActiveWeight(rawRules[key]));
  return {
    status: 'available',
    profile: {
      rules: rules as ProjectionScoringRules,
      provenance: {
        provider: source.provider,
        rawRules,
        supportedSourceKeys: uniqueSorted(supportedSourceKeys),
        unsupportedSourceKeys: uniqueSorted(unsupportedSourceKeys),
        aggregateTwoPointConversionSupported,
        usesPointsAllowedBucketProxy,
        ...(estimatedSourceKeys.length ? { supplementalEstimate: {
          model: SUPPLEMENTAL_PROJECTION_MODEL, sourceKeys: uniqueSorted(estimatedSourceKeys),
        } } : {}),
      },
    },
  };
}

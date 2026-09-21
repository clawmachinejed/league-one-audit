import type { CanonicalScoringProfile, DefenseProjectionStats } from './contracts';
import { scoreProjection, scoreSparseStatistics } from './scoring';
import {
  POINTS_ALLOWED_SCORING_EVENTS,
  type PointsAllowedScoringEvent,
  type ProjectionScoringRules,
} from './scoring-events';

/** Revision input for new calculations; existing frozen clock-v1 baselines stay immutable. */
export { DEFENSE_PROJECTION_MODEL_VERSION } from './contracts';
const SCORE_PARITY_TOLERANCE = 0.000001;

/** The adapter supplies native keys; the domain never interprets provider identities or fetches data. */
export type LiveDefenseProjectionEvidence = Readonly<{
  /** Statistics from the exact immutable candidate that established this baseline. */
  projection: DefenseProjectionStats;
  profile: CanonicalScoringProfile;
  /** One observed, validated sparse team-defense record, never a missing-row zero. */
  stats: Readonly<Record<string, unknown>> | null;
  supportedActualRuleKeys: ReadonlySet<string>;
  pointsAllowedStatKey: string;
  pointsAllowedBuckets: Readonly<Record<PointsAllowedScoringEvent, string>>;
}>;

export type LiveDefenseUnavailableReason =
  | 'invalid-input'
  | 'invalid-baseline'
  | 'baseline-score-mismatch'
  | 'invalid-scoring-mapping'
  | 'missing-actual-statistics'
  | 'invalid-actual-statistics'
  | 'unsupported-actual-scoring'
  | 'actual-score-mismatch'
  | 'invalid-points-allowed'
  | 'points-allowed-bucket-mismatch';

export type LiveDefenseProjectionResult =
  | Readonly<{ status: 'available'; projectedPoints: number }>
  | Readonly<{ status: 'unavailable'; reason: LiveDefenseUnavailableReason }>;

function unavailable(reason: LiveDefenseUnavailableReason): LiveDefenseProjectionResult {
  return { status: 'unavailable', reason };
}

/**
 * Keeps all earned official points, including unprojected bonuses, but replaces
 * the provisional points-allowed tier with the estimated final tier. Only the
 * existing supported additive projection events are extended through the clock.
 * Tier selection, rounding and scoring remain owned by the shared scorer.
 */
export function calculateLiveDefenseProjection(input: Readonly<{
  evidence: LiveDefenseProjectionEvidence;
  baselinePoints: number;
  officialPoints: number;
  remainingFraction: number;
}>): LiveDefenseProjectionResult {
  const { evidence, baselinePoints, officialPoints, remainingFraction } = input;
  if (![baselinePoints, officialPoints, remainingFraction].every(Number.isFinite)
    || remainingFraction < 0 || remainingFraction > 1) return unavailable('invalid-input');

  const { projection, profile } = evidence;
  if (projection.kind !== 'defense') return unavailable('invalid-baseline');
  const baseline = scoreProjection(projection, profile.rules);
  if (!baseline.available || baseline.points === null) return unavailable('invalid-baseline');
  if (Math.abs(baseline.points - baselinePoints) > SCORE_PARITY_TOLERANCE) {
    return unavailable('baseline-score-mismatch');
  }

  const bucketKeys = POINTS_ALLOWED_SCORING_EVENTS.map((event) => evidence.pointsAllowedBuckets[event]);
  if (bucketKeys.some((key) => typeof key !== 'string' || !key)
    || new Set(bucketKeys).size !== bucketKeys.length
    || !evidence.pointsAllowedStatKey || bucketKeys.includes(evidence.pointsAllowedStatKey)
    || POINTS_ALLOWED_SCORING_EVENTS.some((event) => (
      (profile.rules[event] ?? 0) !== (profile.provenance.rawRules[evidence.pointsAllowedBuckets[event]] ?? 0)
    ))) return unavailable('invalid-scoring-mapping');

  const hasPointsAllowed = POINTS_ALLOWED_SCORING_EVENTS.some((event) => (profile.rules[event] ?? 0) !== 0);
  const stats = evidence.stats;
  if (stats !== null && (typeof stats !== 'object' || Array.isArray(stats)
    || Object.values(stats).some((value) => typeof value !== 'number' || !Number.isFinite(value)))) {
    return unavailable('invalid-actual-statistics');
  }
  // Checking an empty object here only audits rule support. It is never evidence
  // of zero points or participation for an absent team-defense record.
  const actualScore = scoreSparseStatistics(
    (stats ?? {}) as Readonly<Record<string, number>>,
    profile.provenance.rawRules,
    evidence.supportedActualRuleKeys,
  );
  if (!actualScore.available) return unavailable('unsupported-actual-scoring');
  if (stats !== null && (actualScore.points === null
    || Math.abs(actualScore.points - officialPoints) > SCORE_PARITY_TOLERANCE)) {
    return unavailable('actual-score-mismatch');
  }
  // With only additive projected rules, the ordinary clock formula is valid and
  // needs no points-allowed record. The official score remains the actual source.
  if (!hasPointsAllowed) {
    const projectedPoints = officialPoints + baselinePoints * remainingFraction;
    return Number.isFinite(projectedPoints)
      ? { status: 'available', projectedPoints }
      : unavailable('invalid-input');
  }
  if (stats === null) return unavailable('missing-actual-statistics');
  const rawPointsAllowed = stats[evidence.pointsAllowedStatKey];
  // An observed exclusive zero bracket proves zero under the sparse contract.
  // A missing row or any nonzero range can never establish an exact allowance.
  const exclusiveZeroBucket = POINTS_ALLOWED_SCORING_EVENTS.every((event) => (
    (stats[evidence.pointsAllowedBuckets[event]] ?? 0) === (event === 'pointsAllowedZero' ? 1 : 0)
  ));
  const observedPointsAllowed = rawPointsAllowed === undefined && exclusiveZeroBucket ? 0 : rawPointsAllowed;
  if (typeof observedPointsAllowed !== 'number' || !Number.isSafeInteger(observedPointsAllowed)
    || observedPointsAllowed < 0) return unavailable('invalid-points-allowed');

  const tierRules: ProjectionScoringRules = Object.fromEntries(
    POINTS_ALLOWED_SCORING_EVENTS.map((event) => [event, profile.rules[event]]),
  );
  const observedTier = scoreProjection({ kind: 'defense', pointsAllowed: observedPointsAllowed }, tierRules);
  const observedEvent = observedTier.pointsAllowedProxy?.scoringEvent;
  if (!observedEvent || observedTier.points === null) return unavailable('invalid-points-allowed');
  // The provider's sparse records omit zero counts. Exactly one observed bracket must
  // be present, even when its configured weight is zero; conflicting buckets
  // cannot be rescued by coincidentally matching the official fantasy total.
  if (POINTS_ALLOWED_SCORING_EVENTS.some((event) => (
    (stats[evidence.pointsAllowedBuckets[event]] ?? 0) !== (event === observedEvent ? 1 : 0)
  ))) return unavailable('points-allowed-bucket-mismatch');

  const additiveRules = Object.fromEntries(Object.entries(profile.rules)
    .filter(([event]) => !POINTS_ALLOWED_SCORING_EVENTS.includes(event as PointsAllowedScoringEvent)));
  const additive = scoreProjection(projection, additiveRules);
  const expectedPointsAllowed = observedPointsAllowed + projection.pointsAllowed! * remainingFraction;
  const expectedTier = scoreProjection({ kind: 'defense', pointsAllowed: expectedPointsAllowed }, tierRules);
  if (additive.points === null || expectedTier.points === null) return unavailable('invalid-baseline');
  const projectedPoints = officialPoints - observedTier.points
    + additive.points * remainingFraction + expectedTier.points;
  return Number.isFinite(projectedPoints)
    ? { status: 'available', projectedPoints }
    : unavailable('invalid-input');
}

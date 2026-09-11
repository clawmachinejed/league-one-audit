import { scoreSparseStatistics, type SparseScoringBreakdown } from './scoring';
import { sha256 } from '../shared/sha256';
import { stableJson } from '../shared/stable-json';
import {
  validateAllPlayerEligibility,
  type AllPlayerEligibilityEvidence,
} from './all-player-eligibility';
export type {
  AllPlayerEligibilityEvidence,
  AllPlayerExplicitIneligibilityEvidence,
  AllPlayerWeeklyEligibilityEvidence,
} from './all-player-eligibility';

export const ALL_PLAYER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
export type AllPlayerPosition = typeof ALL_PLAYER_POSITIONS[number];
export type AllPlayerGamePhase = 'live' | 'final' | 'unknown';
export type AllPlayerEntityKind = 'player' | 'team_defense';
export type AllPlayerQuality = 'complete' | 'partial' | 'invalid';

export type AllPlayerStatEntry = Readonly<{
  entityKind: AllPlayerEntityKind;
  providerExternalId: string;
  nflGameId: string | null;
  nflTeam: string | null;
  position: AllPlayerPosition;
  stats: Readonly<Record<string, number>>;
  eligibilityEvidence: AllPlayerEligibilityEvidence;
  eligibleGameCount: 0 | 1 | null;
  appearanceGameCount: 0 | 1 | null;
  gamePhase: AllPlayerGamePhase;
}>;

export type AllPlayerStatObservation = Readonly<{
  provider: string;
  season: number;
  seasonType: 'pre' | 'reg' | 'post';
  week: number;
  normalizerVersion: string;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  quality: AllPlayerQuality;
  coverage: Readonly<Record<string, unknown>>;
  warnings: readonly string[];
  entries: readonly AllPlayerStatEntry[];
}>;

export type AllPlayerScoringProfile = Readonly<{
  scoringProfileId: string;
  rawRules: Readonly<Record<string, unknown>>;
  officialBatches: readonly Readonly<{
    observationId: string;
    rosterCount: number;
    rosterIds: readonly string[];
    entityCount: number;
    fingerprint: string;
    points: readonly Readonly<{
      providerExternalId: string;
      points: number;
    }>[];
  }>[];
}>;

export type AllPlayerIdentity = Readonly<{
  scoringEntityId: string | null;
  conflict: boolean;
}>;

export type AllPlayerScore = Readonly<{
  scoringEntityId: string;
  entityKind: AllPlayerEntityKind;
  providerExternalId: string;
  nflGameId: string | null;
  nflTeam: string | null;
  position: AllPlayerPosition;
  fantasyPoints: number;
  eligibleGameCount: 0 | 1;
  appearanceGameCount: 0 | 1 | null;
  gamePhase: AllPlayerGamePhase;
  scoringBreakdown: SparseScoringBreakdown;
}>;

export type AllPlayerScoreSet = Readonly<{
  scoringProfileId: string;
  scoringRulesHash: string;
  scorerVersion: string;
  semanticHash: string;
  quality: 'complete';
  scoredEntityCount: number;
  eligibleGameCount: number;
  parityComparisonCount: number;
  parityMismatchCount: 0;
  coverage: Readonly<Record<string, unknown>>;
  warnings: readonly string[];
  scores: readonly AllPlayerScore[];
}>;

export type AllPlayerScoreBuildResult =
  | Readonly<{ status: 'available'; scoreSets: readonly AllPlayerScoreSet[] }>
  | Readonly<{
      status: 'unavailable';
      reason: 'incomplete-coverage' | 'eligibility-unavailable' | 'identity-unavailable'
        | 'unsupported-scoring' | 'scoring-mismatch' | 'invalid-input';
      details: readonly string[];
    }>;

function semanticHash(value: unknown): Promise<string> {
  return sha256(stableJson(value));
}

async function fingerprint(value: unknown): Promise<string> {
  return `sha256:${await semanticHash(value)}`;
}

async function officialPointsFingerprint(points: readonly Readonly<{
  providerExternalId: string;
  points: number;
}>[]): Promise<string> {
  const lines = [...points]
    .sort((left, right) => left.providerExternalId.localeCompare(right.providerExternalId))
    .map((point) => `${point.providerExternalId}\u001f${String(point.points)}`).join('\n');
  return `sha256:${await sha256(lines)}`;
}

function unavailable(
  reason: Extract<AllPlayerScoreBuildResult, { status: 'unavailable' }>['reason'],
  details: Iterable<string>,
): AllPlayerScoreBuildResult {
  return { status: 'unavailable', reason, details: [...new Set(details)].sort() };
}

/**
 * Builds every scoring profile before persistence so one malformed identity,
 * unsupported active rule, incomplete eligibility decision, or parity mismatch
 * rejects the whole provider observation. No current pointer can advance from a
 * partially validated group.
 */
export async function buildAllPlayerScoreSets(input: Readonly<{
  observation: AllPlayerStatObservation;
  profiles: readonly AllPlayerScoringProfile[];
  expectedScoringProfileIds: readonly string[];
  scorerVersion: string;
  supportedRuleKeys: ReadonlySet<string>;
  resolveIdentity: (entry: AllPlayerStatEntry) => AllPlayerIdentity;
  parityTolerance?: number;
}>): Promise<AllPlayerScoreBuildResult> {
  if (input.observation.quality !== 'complete' || input.observation.coverage.complete !== true) {
    return unavailable('incomplete-coverage', ['provider observation is not complete']);
  }
  if (!input.scorerVersion.trim() || input.profiles.length === 0) {
    return unavailable('invalid-input', ['scorer version and scoring profiles are required']);
  }
  const actualProfileIds = input.profiles.map((profile) => profile.scoringProfileId).sort();
  const expectedProfileIds = [...new Set(input.expectedScoringProfileIds.map((id) => id.trim()))]
    .filter(Boolean).sort();
  if (expectedProfileIds.length !== input.expectedScoringProfileIds.length
    || stableJson(actualProfileIds) !== stableJson(expectedProfileIds)) {
    return unavailable('incomplete-coverage', ['scoring profile inventory is incomplete']);
  }
  if (input.observation.entries.length === 0) {
    return unavailable('incomplete-coverage', ['provider observation has no fantasy entities']);
  }
  const invalidEntryEvidence = input.observation.entries.flatMap((entry) => (
    !validateAllPlayerEligibility(entry)
      ? [`invalid-eligibility-evidence:${entry.providerExternalId}`] : []
  ));
  if (invalidEntryEvidence.length > 0) return unavailable('invalid-input', invalidEntryEvidence);
  const duplicateProfiles = input.profiles
    .map((profile) => profile.scoringProfileId)
    .filter((id, index, values) => values.indexOf(id) !== index);
  if (duplicateProfiles.length > 0) return unavailable('invalid-input', duplicateProfiles);
  const invalidParityEvidence: string[] = [];
  for (const profile of input.profiles) {
    if (profile.officialBatches.length === 0
      || profile.officialBatches.every((batch) => batch.points.length === 0)) {
      invalidParityEvidence.push(`missing-official-points:${profile.scoringProfileId}`);
    }
    if (!Object.values(profile.rawRules).some((value) => (
      typeof value === 'number' && Number.isFinite(value) && value !== 0
    ))) {
      invalidParityEvidence.push(`missing-active-scoring-rules:${profile.scoringProfileId}`);
    }
    for (const batch of profile.officialBatches) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
        .test(batch.observationId.trim())) {
        invalidParityEvidence.push(`invalid-official-observation:${profile.scoringProfileId}`);
      }
      if (!Number.isInteger(batch.rosterCount) || batch.rosterCount < 1
        || batch.rosterIds.length !== batch.rosterCount
        || new Set(batch.rosterIds).size !== batch.rosterIds.length
        || batch.rosterIds.some((id) => !id.trim())
        || stableJson([...batch.rosterIds].sort()) !== stableJson(batch.rosterIds)
        || batch.entityCount !== batch.points.length
        || batch.fingerprint !== await officialPointsFingerprint(batch.points)
        || new Set(batch.points.map((point) => point.providerExternalId)).size
          !== batch.points.length) {
        invalidParityEvidence.push(`invalid-official-batch:${profile.scoringProfileId}`);
      }
      invalidParityEvidence.push(...batch.points.flatMap((point) => (
          !point.providerExternalId.trim() || !Number.isFinite(point.points)
            ? [`invalid-official-player:${point.providerExternalId || '<blank>'}`] : []
      )));
    }
  }
  if (invalidParityEvidence.length > 0) {
    return unavailable('invalid-input', invalidParityEvidence);
  }

  const eligibilityFailures = input.observation.entries.flatMap((entry) => (
    entry.eligibleGameCount === null || entry.appearanceGameCount === null
      ? [entry.providerExternalId] : []
  ));
  if (eligibilityFailures.length > 0) {
    return unavailable('eligibility-unavailable', eligibilityFailures);
  }

  const resolved = input.observation.entries.map((entry) => ({
    entry,
    identity: input.resolveIdentity(entry),
  }));
  const identityFailures = resolved.flatMap(({ entry, identity }) => (
    identity.conflict || !identity.scoringEntityId
      || (entry.eligibleGameCount === 1 && !entry.nflGameId)
      ? [entry.providerExternalId] : []
  ));
  if (identityFailures.length > 0) {
    return unavailable('identity-unavailable', identityFailures);
  }

  const tolerance = input.parityTolerance ?? 0.000_001;
  const scoreBatchFingerprint = await fingerprint({
    provider: input.observation.provider,
    season: input.observation.season,
    seasonType: input.observation.seasonType,
    week: input.observation.week,
    sourceRevision: input.observation.sourceRevision,
    scorerVersion: input.scorerVersion,
    expectedScoringProfileIds: expectedProfileIds,
  });
  const scoreSets: AllPlayerScoreSet[] = [];
  for (const profile of input.profiles) {
    const officialPointsById = new Map<string, number>();
    const conflictingOfficialPoints: string[] = [];
    for (const batch of profile.officialBatches) {
      for (const official of batch.points) {
        const previous = officialPointsById.get(official.providerExternalId);
        if (previous !== undefined && Math.abs(previous - official.points) > tolerance) {
          conflictingOfficialPoints.push(official.providerExternalId);
        } else {
          officialPointsById.set(official.providerExternalId, official.points);
        }
      }
    }
    if (conflictingOfficialPoints.length > 0) {
      return unavailable('scoring-mismatch', conflictingOfficialPoints);
    }
    const officialPoints = [...officialPointsById]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([providerExternalId, points]) => ({ providerExternalId, points }));
    const officialObservationIds = [...new Set(
      profile.officialBatches.map((batch) => batch.observationId.trim()),
    )].sort();
    if (officialObservationIds.length !== profile.officialBatches.length) {
      return unavailable('invalid-input', [`duplicate-official-observation:${profile.scoringProfileId}`]);
    }
    const parityObservationEvidence = Object.fromEntries(profile.officialBatches.map((batch) => [
      batch.observationId,
      {
        version: 'players-points-v1',
        expectedEntityCount: batch.entityCount,
        expectedRosterCount: batch.rosterCount,
        expectedRosterIds: batch.rosterIds,
        fingerprint: batch.fingerprint,
      },
    ]));
    const scoringRulesHash = await semanticHash(profile.rawRules);
    const scores: AllPlayerScore[] = [];
    const scoringFailures: string[] = [];
    for (const { entry, identity } of resolved) {
      const result = scoreSparseStatistics(
        entry.stats,
        profile.rawRules,
        input.supportedRuleKeys,
      );
      if (!result.available || result.points === null) {
        scoringFailures.push(...result.invalidRuleKeys.map((key) => `invalid:${key}`));
        scoringFailures.push(...result.unsupportedRuleKeys.map((key) => `unsupported:${key}`));
        scoringFailures.push(...result.invalidStatKeys.map((key) => `invalid-stat:${key}`));
        continue;
      }
      if ((entry.eligibleGameCount === 0 || entry.appearanceGameCount === 0)
        && Math.abs(result.points) > tolerance) {
        scoringFailures.push(`non-appearing-nonzero:${entry.providerExternalId}`);
        continue;
      }
      scores.push({
        scoringEntityId: identity.scoringEntityId as string,
        entityKind: entry.entityKind,
        providerExternalId: entry.providerExternalId,
        nflGameId: entry.nflGameId,
        nflTeam: entry.nflTeam,
        position: entry.position,
        fantasyPoints: result.points,
        eligibleGameCount: entry.eligibleGameCount as 0 | 1,
        appearanceGameCount: entry.appearanceGameCount,
        gamePhase: entry.gamePhase,
        scoringBreakdown: result.breakdown,
      });
    }
    if (scoringFailures.length > 0) {
      return unavailable('unsupported-scoring', scoringFailures);
    }

    scores.sort((left, right) => (
      `${left.entityKind}\0${left.providerExternalId}`
        .localeCompare(`${right.entityKind}\0${right.providerExternalId}`)
    ));
    const scoreByExternalId = new Map(scores.map((score) => [score.providerExternalId, score]));
    const parityMismatches: string[] = [];
    for (const official of officialPoints) {
      const calculated = scoreByExternalId.get(official.providerExternalId)?.fantasyPoints;
      if (calculated === undefined || Math.abs(calculated - official.points) > tolerance) {
        parityMismatches.push(official.providerExternalId);
      }
    }
    if (parityMismatches.length > 0) {
      return unavailable('scoring-mismatch', parityMismatches);
    }

    const coverage = {
      ...input.observation.coverage,
      complete: true,
      identity_complete: true,
      scoring_rules_complete: true,
      scoring_rules_hash: scoringRulesHash,
      all_player_source_revision: input.observation.sourceRevision,
      expected_scoring_profile_ids: expectedProfileIds,
      score_batch_fingerprint: scoreBatchFingerprint,
      parity_observation_ids: officialObservationIds,
      parity_observation_evidence: parityObservationEvidence,
      parity_expected_entity_count: officialPoints.length,
      parity_fingerprint: await fingerprint({
        observationIds: officialObservationIds,
        points: officialPoints,
      }),
    };
    const scoreDocument = scores.map((score) => ({
      ...score,
      scoringBreakdown: score.scoringBreakdown,
    }));
    scoreSets.push({
      scoringProfileId: profile.scoringProfileId,
      scoringRulesHash,
      scorerVersion: input.scorerVersion,
      semanticHash: await semanticHash({
        scoringProfileId: profile.scoringProfileId,
        scoringRulesHash,
        scorerVersion: input.scorerVersion,
        scores: scoreDocument,
      }),
      quality: 'complete',
      scoredEntityCount: scores.length,
      eligibleGameCount: scores.reduce((total, score) => total + score.eligibleGameCount, 0),
      parityComparisonCount: officialPoints.length,
      parityMismatchCount: 0,
      coverage,
      warnings: input.observation.warnings,
      scores,
    });
  }
  return { status: 'available', scoreSets };
}

import type { AllPlayerEligibilityEvidence } from './all-player-eligibility';
import {
  ALL_PLAYER_INDIVIDUAL_SNAP_KEYS, validateAllPlayerEligibility, allPlayerEvidenceMatchesPeriod,
} from './all-player-eligibility';
import { validateAllPlayerProviderContext, type AllPlayerProviderContext } from './all-player-provider-context';

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
  /** Observation context only; never establishes eligibility or alters material statistics. */
  providerContext?: AllPlayerProviderContext | null;
}>;

/** Pure raw-evidence validation also used for valid partial observations. */
export function validateAllPlayerObservationEvidence(
  observation: AllPlayerStatObservation,
): readonly string[] {
  const details: string[] = [];
  const identities = new Set<string>();
  const requiresIndividualSnaps = observation.normalizerVersion.endsWith('-weekly-stats-v3');
  for (const entry of observation.entries) {
    if (identities.has(entry.providerExternalId)) details.push(`duplicate-official-identity:${entry.providerExternalId}`);
    identities.add(entry.providerExternalId);
    if (!entry.providerExternalId.trim() || !ALL_PLAYER_POSITIONS.includes(entry.position)
      || (entry.entityKind === 'team_defense') !== (entry.position === 'DEF')) {
      details.push(`invalid-entity-kind:${entry.providerExternalId}`);
    }
    if (!validateAllPlayerEligibility(entry)) details.push(`invalid-eligibility-evidence:${entry.providerExternalId}`);
    const evidence = entry.eligibilityEvidence;
    const weekly = evidence.kind === 'weekly-stat' ? evidence
      : evidence.kind === 'combined-ineligible' || evidence.kind === 'conflict'
        || evidence.kind === 'period-participation' ? evidence.weekly : undefined;
    const hasSnapEvidence = weekly?.individualSnaps !== undefined
      || ALL_PLAYER_INDIVIDUAL_SNAP_KEYS.some((key) => weekly?.rawFlags !== undefined
        && Object.prototype.hasOwnProperty.call(weekly.rawFlags, key));
    if (hasSnapEvidence && entry.entityKind !== 'player') {
      details.push(`invalid-individual-snap-entity:${entry.providerExternalId}`);
    }
    if (requiresIndividualSnaps && !weekly
      && ['gms_active', 'gp', ...ALL_PLAYER_INDIVIDUAL_SNAP_KEYS]
        .some((key) => Object.prototype.hasOwnProperty.call(entry.stats, key))) {
      details.push(`missing-weekly-participation-evidence:${entry.providerExternalId}`);
    }
    if (weekly) {
      for (const [rawKey, evidenceKey] of [['gms_active', 'gmsActive'], ['gp', 'appearances']] as const) {
        const raw = entry.stats[rawKey];
        const malformed = weekly.rawFlags?.[rawKey];
        const malformedPresent = weekly.rawFlags !== undefined
          && Object.prototype.hasOwnProperty.call(weekly.rawFlags, rawKey);
        const expectedRaw = malformedPresent
          ? typeof malformed === 'number' && Number.isFinite(malformed) ? malformed : undefined
          : weekly[evidenceKey];
        if (raw !== expectedRaw) details.push(`weekly-flag-evidence-mismatch:${entry.providerExternalId}:${rawKey}`);
      }
      // Earlier histories retained snaps without deriving eligibility from them.
      // New normalizers must bind every snap field, including explicit zeroes.
      if (requiresIndividualSnaps || hasSnapEvidence) {
        for (const rawKey of ALL_PLAYER_INDIVIDUAL_SNAP_KEYS) {
          const malformedPresent = weekly.rawFlags !== undefined
            && Object.prototype.hasOwnProperty.call(weekly.rawFlags, rawKey);
          const malformed = weekly.rawFlags?.[rawKey];
          const expectedRaw = malformedPresent
            ? typeof malformed === 'number' && Number.isFinite(malformed) ? malformed : undefined
            : weekly.individualSnaps?.[rawKey];
          if (entry.stats[rawKey] !== expectedRaw) {
            details.push(`weekly-snap-evidence-mismatch:${entry.providerExternalId}:${rawKey}`);
          }
        }
      }
    }
    const periodEvidence = evidence.kind === 'combined-ineligible' || evidence.kind === 'conflict'
      ? evidence.ineligibility
      : evidence.kind === 'period-participation' || evidence.kind === 'explicit-ineligible' ? evidence : null;
    if (periodEvidence && (observation.seasonType !== 'reg' || !allPlayerEvidenceMatchesPeriod(periodEvidence, {
      season: observation.season, seasonType: 'reg', week: observation.week,
    }) || Date.parse(periodEvidence.observedAt ?? '') > Date.parse(observation.observedAt))) {
      details.push(`wrong-period-eligibility-evidence:${entry.providerExternalId}`);
    }
  }
  return [...new Set([...details, ...validateAllPlayerProviderContext(observation)])].sort();
}

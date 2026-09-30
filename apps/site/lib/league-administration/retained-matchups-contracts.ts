import type { AdministrationProvenance, AdministrationScope, JsonValue } from './contracts';
import type { AdministrationSourceMapping } from './source-mapping';

export const RETAINED_MATCHUP_INVENTORY_LIMIT = 1_000;
export const RETAINED_MATCHUP_BATCH_LIMIT = 100;
export const RETAINED_MATCHUP_MAPPING_LIMIT = 100;

export type RetainedMatchupMappingRevision = Readonly<{
  id: string; connectionId: string; leagueSeasonId: string; provider: string;
  externalLeagueId: string; sourceNamespace: string; generation: number;
}>;
export type RetainedMatchupMappingCandidate = Readonly<{
  kind: 'matchup-receipt' | 'calculation-input'; id: string;
  observationId: string; contentId: string; family: string | null; nativePeriodId: string | null;
  provenance: AdministrationProvenance; sourceMapping: AdministrationSourceMapping | null;
  revision: RetainedMatchupMappingRevision | null;
}>;

/** Explicit original source scope; no current mapping, enrollment or accepted head selection. */
export type RetainedMatchupSelection = Readonly<{
  leagueSeasonId: string; scope: AdministrationScope; nativeWeeks: readonly number[];
}>;

/** Immutable storage evidence. Null joined records remain visible for rejection by the planner. */
export type RetainedMatchupEvidence = Readonly<{
  league: Readonly<{ leagueSeasonId: string; leagueKey: string; season: number }>;
  observation: Readonly<{
    id: string; leagueSeasonId: string; family: string; week: number; contentId: string;
    provenance: AdministrationProvenance; orderingAt: string; recordedAt: string; outcome: string;
  }>;
  content: Readonly<{
    id: string; leagueSeasonId: string; provider: string; externalLeagueId: string;
    family: string; week: number; normalizerVersion: string; contentHash: string;
    semanticHash: string | null; completeness: string; accepted: boolean;
    payload: JsonValue; normalizedValue: JsonValue | null;
  }> | null;
  teamLinks: readonly Readonly<{
    contentId: string; leagueSeasonId: string; teamId: string; sourceValue: JsonValue;
    team: Readonly<{
      id: string; leagueSeasonId: string; provider: string; externalLeagueId: string; externalRosterId: string;
    }> | null;
  }>[];
  mapping: Readonly<{
    observationId: string; revisionId: string;
    revision: RetainedMatchupMappingRevision | null;
  }> | null;
  /** Only associations with the exact original observation's provenance; later reacquisitions are separate evidence. */
  mappingCandidates: readonly RetainedMatchupMappingCandidate[];
}>;

export type RetainedMatchupRead = Readonly<{
  status: 'available'; evidence: readonly RetainedMatchupEvidence[];
}> | Readonly<{
  status: 'disabled' | 'unavailable'; reason: string;
}>;

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
export function isRetainedMatchupId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}
export function isRetainedMatchupSelection(value: RetainedMatchupSelection): boolean {
  const scope = value?.scope;
  return isRetainedMatchupId(value?.leagueSeasonId) && !!scope && scope.provider === 'sleeper'
    && [scope.leagueKey, scope.externalLeagueId].every(text => typeof text === 'string'
      && text.length > 0 && text.trim() === text && !/[\x00-\x1f\x7f]/u.test(text))
    && Number.isSafeInteger(scope.season) && scope.season >= 1000 && scope.season <= 9999
    && Array.isArray(value.nativeWeeks) && value.nativeWeeks.length > 0 && value.nativeWeeks.length <= 18
    && value.nativeWeeks.every((week, index) => Number.isSafeInteger(week) && week >= 1 && week <= 18
      && (index === 0 || value.nativeWeeks[index - 1] < week));
}

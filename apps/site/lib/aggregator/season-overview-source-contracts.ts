import type { AcceptedResource, Decimal } from './contracts';
import type { AdministrationProvenance, NormalizedAdministrationObservation } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { SleeperRoster } from '../transform';

/** Data contracts only: accepted roster reads do not depend on the optional projector or normalizer. */
export const SEASON_OVERVIEW_SOURCE_VERSION = 'sleeper-season-overview-source-v1' as const;
export type CurrentRosterCaptureReceipt = {
  id: string; attemptId: string; ordinal: number; provenance: AdministrationProvenance;
  configurationContentId: string; expectedTeamCount: number; legacyObservationId: string;
};
export type SeasonFact<T> = Readonly<{
  state: 'known' | 'absent' | 'null' | 'invalid'; value: T | null; sourcePath: string;
}>;
export type SeasonPointsFact = Readonly<{
  whole: SeasonFact<number>; fraction: SeasonFact<number>; value: Decimal | null;
  state: SeasonFact<number>['state']; policy: 'sleeper-whole-plus-hundredths-v1';
}>;
export type SeasonOverviewTeamFacts = Readonly<{
  seasonTeamId: string; externalRosterId: string;
  record: Readonly<Record<'wins' | 'losses' | 'ties', SeasonFact<number>>>;
  pointsFor: SeasonPointsFact; pointsAgainst: SeasonPointsFact;
  /** Only explicitly supplied native fields, never a rank inferred from response order. */
  providerRank: SeasonFact<number>; providerSeed: SeasonFact<number>; division: SeasonFact<number>;
  waiver: Readonly<{ priority: SeasonFact<number>; budgetUsed: SeasonFact<number> }>;
  /** Native roster display metadata; owner/user fallbacks belong to the compatibility presenter. */
  display: Readonly<{ name: SeasonFact<string>; avatar: SeasonFact<string> }>;
}>;
export type SeasonOverviewSourceInput = Readonly<{
  normalized: NormalizedAdministrationObservation; mapping: AdministrationSourceMapping;
  accepted: AcceptedResource; receipt: CurrentRosterCaptureReceipt;
  seasonTeams: readonly Readonly<{ seasonTeamId: string; externalRosterId: string }>[];
}>;
export type SeasonOverviewSourceRead = Readonly<{
  status: 'available'; kind: 'current-season-overview-source'; version: typeof SEASON_OVERVIEW_SOURCE_VERSION;
  temporalContext: 'season-to-date'; historicalApplicability: 'unverified'; freshness: 'unknown';
  mapping: AdministrationSourceMapping;
  source: Readonly<{ receiptId: string; contentId: string; rawContentHash: string;
    legacyObservationId: string; generation: number; provenance: AdministrationProvenance; expectedTeamCount: number }>;
  teams: readonly SeasonOverviewTeamFacts[];
  /** Completeness of the record/PF/PA group only; optional rank/waiver fields retain their own states. */
  completeness: 'complete' | 'partial'; reasons: readonly string[];
  comparison: Readonly<{ status: 'equal'; fields: readonly string[] }>;
  /** Internal compatibility input only. Shared canonical consumers use the typed fields above. */
  compatibility: Readonly<{ sourceRosters: readonly SleeperRoster[] }>;
}> | Readonly<{ status: 'unavailable'; reason: 'season_overview_source_invalid' }>;

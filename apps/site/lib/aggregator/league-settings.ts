import type { AcceptedResource, ProviderReference, SourceScope } from './contracts';
import type { AdministrationDiagnostic, AdministrationProvenance, JsonValue } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';

export const LEAGUE_SETTINGS_POLICY = Object.freeze({
  audienceId: 'public', coverageSpecId: 'sleeper-league-identity-settings-v1',
  canonicalNormalizerVersion: 'sleeper-league-settings-v1', validationVersion: 'latest-network-attempt-v1',
});
/** Complete covers identity only; each optional field states its own coverage. */
export const LEAGUE_SETTINGS_FIELDS = ['league_id', 'season', 'sport'] as const;
export type SettingField<T> = Readonly<{ sourcePath: string }> & (
  | Readonly<{ state: 'known' | 'empty'; value: T }>
  | Readonly<{ state: 'absent' | 'null' | 'invalid'; value: null; raw?: JsonValue }>);
export type NativeRosterSlot = Readonly<{
  nativeCode: string; count: number; ordinal: number | null;
  /** Ordered Sleeper occurrences and Yahoo counted definitions are different. */
  semantics: 'ordered-occurrence' | 'counted-definition';
}>;
export type NativePeriodReference = Readonly<{
  source: ProviderReference; kind: 'week' | 'date' | 'custom';
  canonicalPeriodId: null;
  /** This field does not select the site's current/default week. */
  purpose: 'current' | 'scoring' | 'last-scored';
}>;
export type LeagueSettingsValue = Readonly<{
  sourceLeague: ProviderReference; season: number; sport: 'nfl';
  name: SettingField<string>; artwork: SettingField<string>;
  predecessor: SettingField<ProviderReference>;
  lifecycle: SettingField<string>; seasonType: SettingField<string>;
  visibility: { sourceAccess: 'public-endpoint' | 'authorized' | 'unknown'; native: SettingField<JsonValue>; grantsPrivateAccess: false };
  teamCount: SettingField<number>; slots: SettingField<readonly NativeRosterSlot[]>;
  scoring: { provider: ProviderReference['provider']; dialect: string; format: 'flat-weights' | 'catalog-modifiers' | 'native';
    rules: SettingField<JsonValue>; statCatalog: SettingField<JsonValue> };
  /** Values are native codes unless named as a count; dialect defines interpretation. */
  competition: Readonly<Record<'startPeriod' | 'playoffStartPeriod' | 'playoffTeamCount' | 'playoffFormat'
    | 'playoffRoundFormat' | 'playoffSeeding' | 'additionalMatch' | 'bestBall' | 'divisionCount' | 'leagueType', SettingField<JsonValue>>>;
  rosterRules: Readonly<Record<'reserveSlotCount' | 'taxiSlotCount' | 'taxiYears' | 'taxiVeterans'
    | 'taxiDeadline' | 'reserveOut' | 'reserveSuspended' | 'reserveDoubtful' | 'maxSubstitutions'
    | 'substitutionLockWhenStarterActive' | 'substitutionStartTimeEligibility', SettingField<JsonValue>>>;
  waivers: Readonly<Record<'budget' | 'type' | 'clearDays' | 'dailyEnabled'
    | 'dailyHour' | 'dailyDays' | 'tradeDeadline', SettingField<JsonValue>>>;
  nativeSettings: { provider: ProviderReference['provider']; dialect: string; fields: SettingField<Readonly<Record<string, JsonValue>>> };
  periods: readonly SettingField<NativePeriodReference>[];
  /** Requires separately verified calendar evidence; a league document alone supplies none. */
  nflWeekMappings: readonly { source: ProviderReference; season: number; seasonType: string; week: number; evidenceRef: string }[];
  interpretation: {
    scoring: 'limited' | 'unavailable' | 'unverified'; unsupportedScoringRules: readonly string[];
    roster: 'limited' | 'unavailable' | 'unverified'; unknownSlots: readonly string[];
    competition: 'limited' | 'unverified'; reasons: readonly string[];
  };
}>;
export type LeagueSettingsNormalization = Readonly<{
  version: typeof LEAGUE_SETTINGS_POLICY.canonicalNormalizerVersion;
  status: 'complete' | 'invalid'; value: LeagueSettingsValue | null;
  diagnostics: readonly AdministrationDiagnostic[];
}>;
export type AcceptedLeagueSettingsRead = Readonly<{
  status: 'available'; accepted: AcceptedResource; leagueId: string; leagueSeasonId: string;
  receipt: { id: string; attemptId: string; ordinal: number; legacyObservationId: string;
    provenance: AdministrationProvenance; sourceUpdatedAt: null; rawContentHash: string;
    configurationVersionId: string | null; configurationSemanticHash: string | null };
  value: LeagueSettingsValue;
  /** Exact retained source is compared in memory, with no additional provider request. */
  comparison: { status: 'equal'; legacyConfiguration: 'equal' | 'rejected'; fields: readonly string[] };
}> | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

export function leagueSettingsScope(mapping: AdministrationSourceMapping): SourceScope {
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
    family: 'league-season', entityId: null, scoringPeriodId: null, audienceId: LEAGUE_SETTINGS_POLICY.audienceId,
    coverageSpecId: LEAGUE_SETTINGS_POLICY.coverageSpecId };
}

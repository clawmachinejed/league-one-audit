/** Source evidence is independent of the internal league/season UUID and app accounts. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export const ADMINISTRATION_SCHEMA_VERSION = 'league-administration-v1' as const;
export const ADMINISTRATION_NORMALIZER_VERSION = 'sleeper-administration-v1' as const;
export const ADMINISTRATION_DIALECT = 'sleeper-nfl-v1' as const;

export type AdministrationFamily = 'league' | 'rosters' | 'users' | 'matchups' | 'transactions'
  | 'drafts' | 'traded_picks' | 'winners_bracket' | 'losers_bracket';
export type ConfigurationComponentName = 'scoring' | 'roster' | 'competition' | 'display' | 'extensions';

export type AdministrationScope = Readonly<{
  leagueKey: string;
  provider: 'sleeper';
  externalLeagueId: string;
  season: number;
}>;

export type AdministrationProvenance = Readonly<{
  origin: 'network' | 'cache' | 'bootstrap';
  requestStartedAt: string | null;
  requestCompletedAt: string | null;
  /** Null when a cache cannot prove when the provider document was observed. */
  sourceObservedAt: string | null;
  checkedAt: string;
}>;

export type AdministrationEnvelope = Readonly<{
  schemaVersion: typeof ADMINISTRATION_SCHEMA_VERSION;
  normalizerVersion: typeof ADMINISTRATION_NORMALIZER_VERSION;
  dialect: typeof ADMINISTRATION_DIALECT;
  scope: AdministrationScope;
  family: AdministrationFamily;
  /** Exact weekly scope for matchups/transactions; null for season-scoped families. */
  week: number | null;
  provenance: AdministrationProvenance;
  /** A partial document can be retained as evidence but cannot replace a complete pointer. */
  completeness: 'complete' | 'partial';
  payload: JsonValue;
}>;

export type AdministrationDiagnostic = Readonly<{ code: string; path: string; message: string }>;

export type ConfigurationComponent = Readonly<{
  name: ConfigurationComponentName;
  hash: string;
  /** Missing source fields are omitted, never filled with defaults. */
  value: JsonObject;
}>;

export type NormalizedLeagueConfiguration = Readonly<{
  family: 'league';
  externalLeagueId: string;
  season: number;
  previousExternalLeagueId: string | null;
  totalRosters: number | null;
  /** Identical algorithm to the existing immutable scoring profile; no rebinding implied. */
  rawScoringRulesHash: string | null;
  components: readonly ConfigurationComponent[];
}>;

export type SourceTeam = Readonly<{
  externalRosterId: string;
  primaryOwnerExternalId: string | null;
  coOwnerExternalIds: readonly string[];
  playerExternalIds: readonly string[] | null;
  starterExternalIds: readonly string[] | null;
  reserveExternalIds: readonly string[] | null;
  taxiExternalIds: readonly string[] | null;
}>;

export type SourceManager = Readonly<{
  externalManagerId: string;
  displayName: string | null;
  username: string | null;
  avatar: string | null;
}>;

export type SourceMembership = Readonly<{
  externalRosterId: string;
  externalManagerId: string;
  role: 'owner' | 'co_owner';
}>;

export type SourceMatchup = Readonly<{
  externalRosterId: string;
  externalMatchupId: string | null;
  playerExternalIds: readonly string[] | null;
  starterExternalIds: readonly string[] | null;
  points: number | null;
  customPoints: number | null;
}>;

export type SourcePlayerMovement = Readonly<{
  externalPlayerId: string;
  externalRosterId: string;
  direction: 'add' | 'drop';
}>;

export type SourceDraftPickMovement = Readonly<{
  season: number;
  round: number;
  originalExternalRosterId: string;
  previousOwnerExternalRosterId: string;
  ownerExternalRosterId: string;
}>;

export type SourceBudgetMovement = Readonly<{
  senderExternalRosterId: string;
  receiverExternalRosterId: string;
  amount: number;
}>;

export type SourceTransaction = Readonly<{
  externalTransactionId: string;
  type: string | null;
  status: string | null;
  createdAtMilliseconds: number | null;
  statusUpdatedAtMilliseconds: number | null;
  externalRosterIds: readonly string[];
  consenterExternalRosterIds: readonly string[];
  playerMovements: readonly SourcePlayerMovement[];
  draftPickMovements: readonly SourceDraftPickMovement[];
  budgetMovements: readonly SourceBudgetMovement[];
}>;

/** Metadata records source relationships without inventing effective league rules. */
export type SourceDraft = Readonly<{
  externalDraftId: string;
  selections: readonly SourceDraftSelection[];
  pickedPlayerExternalIds: readonly string[];
  pickNumbers: readonly number[];
  tradedPicks: readonly SourceDraftPickMovement[];
}>;
export type SourceDraftSelection = Readonly<{
  pickNumber: number; round: number | null; draftSlot: number | null;
  rosterId: string | null; pickedBy: string | null; playerId: string; keeper: boolean | null;
}>;
export type SourceBracketAdvancement = Readonly<{ outcome: 'winner' | 'loser'; externalMatchupId: string }>;
export type SourceBracketMatch = Readonly<{
  externalMatchupId: string; round: number;
  teamOneExternalRosterId: string | null; teamTwoExternalRosterId: string | null;
  winnerExternalRosterId: string | null; loserExternalRosterId: string | null;
  teamOneFrom: SourceBracketAdvancement | null; teamTwoFrom: SourceBracketAdvancement | null;
}>;

export type NormalizedAdministrationValue =
  | NormalizedLeagueConfiguration
  | Readonly<{ family: 'rosters'; teams: readonly SourceTeam[]; memberships: readonly SourceMembership[] }>
  | Readonly<{ family: 'users'; managers: readonly SourceManager[] }>
  | Readonly<{ family: 'matchups'; matchups: readonly SourceMatchup[] }>
  | Readonly<{ family: 'transactions'; transactions: readonly SourceTransaction[] }>
  | Readonly<{ family: 'drafts'; drafts: readonly SourceDraft[] }>
  | Readonly<{ family: 'traded_picks'; picks: readonly SourceDraftPickMovement[] }>
  | Readonly<{ family: 'winners_bracket' | 'losers_bracket'; matches: readonly SourceBracketMatch[] }>;

export type NormalizedAdministrationObservation = Readonly<{
  status: 'accepted' | 'rejected';
  envelope: AdministrationEnvelope;
  /** Canonical JSON content identity, including all retained operational/source fields. */
  contentHash: string;
  /** Material content identity; provenance and known league operational counters are excluded. */
  semanticHash: string | null;
  diagnostics: readonly AdministrationDiagnostic[];
  value: NormalizedAdministrationValue | null;
}>;

export type AdministrationNormalizationExpectations = Readonly<{
  /** Use only a separately validated complete league observation. */
  expectedRosterCount?: number;
}>;

/** An explicit component binding is separate from when its source document was checked. */
export type ConfigurationPeriod = Readonly<{ season: number; seasonType: string; week: number }>;
export type ConfigurationBinding = Readonly<{
  leagueSeasonId: string;
  component: ConfigurationComponentName;
  period: ConfigurationPeriod;
  componentHash: string;
  configurationVersionId: string;
  generation: number;
  recordedAt: string;
  evidence: Readonly<{
    kind: 'owner_confirmed' | 'source_effective';
    reference: string;
  }>;
}>;

export type ConfigurationResolution =
  | Readonly<{ status: 'known'; binding: ConfigurationBinding; component: ConfigurationComponent }>
  | Readonly<{ status: 'unknown'; reason: 'no_binding' | 'missing_version' | 'inconsistent_binding' }>;

export type CanonicalSeasonSourceIdentity = Readonly<{
  leagueId: string;
  leagueSeasonId: string;
  season: number;
  provider: 'sleeper';
  externalLeagueId: string;
}>;

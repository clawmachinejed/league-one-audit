/** Internal contracts only. Parsing a scope proves neither enrollment nor access. */
export type Id = string;
/** UTC ISO 8601, second or millisecond precision (up to three fractional digits). */
export type Instant = string;
/** Finite base-10 text, no exponent; field definitions must declare units/rounding. */
export type Decimal = string;
export type ProviderCode = 'sleeper' | 'yahoo';
export type ResourceFamily = 'league-season' | 'settings' | 'teams' | 'standings'
  | 'matchups' | 'roster-membership' | 'lineup' | 'player-points' | 'transactions' | 'history';

/** Opaque, case-sensitive keys. Provider support here does not enable a connector. */
export type ProviderReference = {
  provider: ProviderCode;
  resourceKind: string;
  nativeNamespace: string;
  nativeId: string;
};

export type SourceScope = {
  kind: 'enrolled-resource';
  connectionId: Id;
  leagueSeasonId: Id;
  family: ResourceFamily;
  entityId: Id | null;
  scoringPeriodId: Id | null;
  audienceId: Id;
  coverageSpecId: Id;
};

export type DiscoveryScope = {
  kind: 'discovery';
  provider: ProviderCode;
  accessContextId: Id;
  sourceLeagueKey: string;
  sourceSeasonNamespace: string;
  sport: 'nfl';
  season: number;
  leagueSeasonId: Id | null;
  audienceId: Id;
  coverageSpecId: Id;
};

export type Completeness = 'complete' | 'partial' | 'unknown';
export type ObservedCoverage = {
  periodIds: Id[];
  interval: { from: Instant; to: Instant } | null;
  entitySet: 'full' | 'subset' | 'unknown';
  fields: string[];
  pagination: 'complete' | 'continuation' | 'unknown';
  /** Protected server state; not a public reader DTO. */
  nextCursor: string | null;
  completeness: Completeness;
  reasons: string[];
};

type ObservationEvidence<T> = {
  /** Version strings record lineage; registry/policy qualification is a separate boundary. */
  schemaVersion: string;
  adapterVersion: string;
  canonicalNormalizerVersion: string;
  observationId: Id;
  captureId: Id;
  pageIdentity: string | null;
  rawContentRef: Id | null;
  normalizedContentRef: Id;
  nativeRevision: string | null;
  sourceUpdatedAt: Instant | null;
  requestStartedAt: Instant | null;
  requestCompletedAt: Instant | null;
  sourceObservedAt: Instant | null;
  checkedAt: Instant;
  normalizedAt: Instant;
  origin: 'network' | 'cache' | 'retained-replay' | 'bootstrap';
  coverage: ObservedCoverage;
  payload: T;
};

export type EnrolledSourceObservation<T> = ObservationEvidence<T> & {
  scope: SourceScope;
  sourceMappingRevisionId: Id;
};
export type DiscoveryObservation<T> = ObservationEvidence<T> & {
  scope: DiscoveryScope;
  sourceMappingRevisionId?: never;
};
export type SourceObservation<T> = EnrolledSourceObservation<T> | DiscoveryObservation<T>;

/** Describes acceptance evidence; a validator never writes or advances a head. */
export type AcceptedResource = {
  scope: SourceScope;
  canonicalNormalizerVersion: string;
  sourceMappingRevisionId: Id;
  contentId: Id;
  observationIds: Id[];
  validationVersion: string;
  acceptedGeneration: number;
  verifiedAt: Instant | null;
  effectiveFrom: Instant | null;
  effectiveTo: Instant | null;
  effectiveEvidence: 'provider' | 'observed' | 'unknown';
};

export type Support = 'full' | 'limited' | 'unavailable' | 'unverified';
export type Availability = 'present' | 'empty' | 'pending' | 'missing' | 'failed' | 'redacted';
export type Freshness = 'fresh' | 'stale' | 'unknown';
export type FieldGroup<T> = {
  value: T | null;
  availability: Availability;
  completeness: Completeness;
  freshness: Freshness;
  authority: 'provider-official' | 'provider-estimate' | 'sports-source'
    | 'presentation-derived' | 'league-one-estimate' | 'curated';
  temporalContext: 'requested-period' | 'current-display' | 'season-to-date';
  sourceRefs: Id[];
  reasons: string[];
};

export type FeatureId = 'official-overview' | 'official-roster' | 'official-lineup'
  | 'official-scores-results' | 'official-standings' | 'official-schedule'
  | 'transaction-detail' | 'waiver-claims' | 'history' | 'box-scores'
  | 'player-projection' | 'team-forecast' | 'win-probability' | 'projected-standings'
  | 'lineup-attention' | 'player-metrics' | 'roster-metrics';
export type FeatureAssessment = {
  feature: FeatureId;
  support: Support;
  scope: SourceScope | DiscoveryScope;
  configurationVersionId: Id | null;
  requiredInputs: string[];
  missingInputs: string[];
  unsupportedRules: string[];
  approximationPolicy: string | null;
  assessmentVersion: string;
  assessedAt: Instant;
};

/** Membership is not a lineup assignment or evidence of historical membership. */
export type RosterMembership = {
  seasonTeamId: Id | null;
  sourceTeam: ProviderReference;
  sourceEntity: ProviderReference;
  canonicalEntityId: Id | null;
  identityState: 'resolved' | 'unresolved';
  nativeSection: string | null;
  /** 'roster' means held, without inventing active/bench placement. */
  section: 'roster' | 'active' | 'bench' | 'reserve' | 'taxi' | 'unknown';
  effectiveFrom: Instant | null;
  effectiveTo: Instant | null;
  effectiveEvidence: 'provider' | 'observed' | 'unknown';
};

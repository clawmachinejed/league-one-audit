import type {
  AcceptedResource, Decimal, DiscoveryScope, FeatureAssessment, FieldGroup, Instant,
  ObservedCoverage, ProviderReference, RosterMembership, SourceObservation, SourceScope,
} from './contracts';

type RecordValue = Record<string, unknown>;
export type PayloadAssertion<T> = (value: unknown) => asserts value is T;

/** Errors identify the contract field, never echo source payloads or protected cursors. */
export class ContractValidationError extends Error {
  constructor(path: string) {
    super(`Invalid aggregator contract: ${path}`);
    this.name = 'ContractValidationError';
  }
}

function requireValue(condition: boolean, path: string): asserts condition {
  if (!condition) throw new ContractValidationError(path);
}
function record(value: unknown, path: string): asserts value is RecordValue {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), path);
}
function text(value: unknown, path: string): asserts value is string {
  requireValue(typeof value === 'string' && value.trim().length > 0, path);
}
function nullableText(value: unknown, path: string): void {
  if (value !== null) text(value, path);
}
function choice(value: unknown, values: readonly string[], path: string): void {
  requireValue(typeof value === 'string' && values.includes(value), path);
}
function texts(value: unknown, path: string, nonempty = false): asserts value is string[] {
  requireValue(Array.isArray(value) && (!nonempty || value.length > 0), path);
  for (const item of value) text(item, path);
  requireValue(new Set(value).size === value.length, path);
}

export function assertDecimal(value: unknown): asserts value is Decimal {
  // Textual validation preserves precision and scale, including values outside IEEE-754.
  requireValue(typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value), 'decimal');
}

export function assertInstant(value: unknown): asserts value is Instant {
  requireValue(typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value), 'instant');
  const parsed = new Date(value);
  requireValue(Number.isFinite(parsed.getTime()), 'instant');
  // Date.parse silently rolls February 30 and 24:00 into a different date.
  const expected = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/u,
    (_, fraction: string) => `.${fraction.padEnd(3, '0')}Z`) : value.replace('Z', '.000Z');
  requireValue(parsed.toISOString() === expected, 'instant');
}

function instant(value: unknown, path: string, nullable = false): void {
  if (nullable && value === null) return;
  try { assertInstant(value); } catch { throw new ContractValidationError(path); }
}
function ordered(from: unknown, to: unknown, path: string, strict = false): void {
  if (typeof from === 'string' && typeof to === 'string') {
    const difference = Date.parse(to) - Date.parse(from);
    requireValue(strict ? difference > 0 : difference >= 0, path);
  }
}
function effective(value: RecordValue): void {
  instant(value.effectiveFrom, 'effectiveFrom', true);
  instant(value.effectiveTo, 'effectiveTo', true);
  ordered(value.effectiveFrom, value.effectiveTo, 'effective interval', true);
  choice(value.effectiveEvidence, ['provider', 'observed', 'unknown'], 'effectiveEvidence');
  if (value.effectiveEvidence === 'unknown') {
    requireValue(value.effectiveFrom === null && value.effectiveTo === null, 'unknown effective interval');
  }
}

export function assertProviderReference(value: unknown): asserts value is ProviderReference {
  record(value, 'provider reference');
  choice(value.provider, ['sleeper', 'yahoo'], 'provider');
  for (const field of ['resourceKind', 'nativeNamespace', 'nativeId']) text(value[field], field);
}

/** Tuple encoding avoids delimiter collisions without changing any native key. */
export function providerReferenceKey(value: ProviderReference): string {
  assertProviderReference(value);
  return JSON.stringify([value.provider, value.resourceKind, value.nativeNamespace, value.nativeId]);
}

export function assertSourceScope(value: unknown): asserts value is SourceScope {
  record(value, 'source scope');
  requireValue(value.kind === 'enrolled-resource', 'scope.kind');
  for (const field of ['connectionId', 'leagueSeasonId', 'audienceId', 'coverageSpecId']) text(value[field], field);
  for (const field of ['entityId', 'scoringPeriodId']) nullableText(value[field], field);
  choice(value.family, ['league-season', 'settings', 'teams', 'standings', 'matchups', 'roster-membership',
    'lineup', 'player-points', 'transactions', 'history'], 'scope.family');
  requireValue(!('accessContextId' in value), 'source scope discovery identity');
}

export function assertDiscoveryScope(value: unknown): asserts value is DiscoveryScope {
  record(value, 'discovery scope');
  requireValue(value.kind === 'discovery', 'scope.kind');
  choice(value.provider, ['sleeper', 'yahoo'], 'scope.provider');
  for (const field of ['accessContextId', 'sourceLeagueKey', 'sourceSeasonNamespace', 'audienceId', 'coverageSpecId']) {
    text(value[field], field);
  }
  nullableText(value.leagueSeasonId, 'leagueSeasonId');
  requireValue(value.sport === 'nfl', 'scope.sport');
  requireValue(typeof value.season === 'number' && Number.isSafeInteger(value.season)
    && value.season >= 1900 && value.season <= 9999, 'scope.season');
  requireValue(!('connectionId' in value) && !('sourceMappingRevisionId' in value), 'discovery enrollment identity');
}

export function assertObservedCoverage(value: unknown): asserts value is ObservedCoverage {
  record(value, 'coverage');
  texts(value.periodIds, 'coverage.periodIds');
  texts(value.fields, 'coverage.fields');
  texts(value.reasons, 'coverage.reasons');
  if (value.interval !== null) {
    record(value.interval, 'coverage.interval');
    instant(value.interval.from, 'coverage.interval.from');
    instant(value.interval.to, 'coverage.interval.to');
    ordered(value.interval.from, value.interval.to, 'coverage.interval order', true);
  }
  choice(value.entitySet, ['full', 'subset', 'unknown'], 'coverage.entitySet');
  choice(value.pagination, ['complete', 'continuation', 'unknown'], 'coverage.pagination');
  choice(value.completeness, ['complete', 'partial', 'unknown'], 'coverage.completeness');
  nullableText(value.nextCursor, 'coverage.nextCursor');
  if (value.pagination === 'complete') requireValue(value.nextCursor === null, 'complete pagination cursor');
  if (value.pagination === 'continuation') text(value.nextCursor, 'continuation cursor');
  if (value.completeness === 'complete') {
    requireValue(value.pagination === 'complete' && value.entitySet !== 'unknown', 'complete coverage evidence');
  }
}

export function assertSourceObservation<T>(value: unknown, assertPayload: PayloadAssertion<T>):
  asserts value is SourceObservation<T> {
  record(value, 'observation');
  record(value.scope, 'scope');
  if (value.scope.kind === 'discovery') {
    assertDiscoveryScope(value.scope);
    requireValue(!('sourceMappingRevisionId' in value), 'discovery sourceMappingRevisionId');
  } else {
    assertSourceScope(value.scope);
    text(value.sourceMappingRevisionId, 'sourceMappingRevisionId');
  }
  for (const field of ['schemaVersion', 'adapterVersion', 'canonicalNormalizerVersion', 'observationId',
    'captureId', 'normalizedContentRef']) text(value[field], field);
  for (const field of ['pageIdentity', 'rawContentRef', 'nativeRevision']) nullableText(value[field], field);
  for (const field of ['sourceUpdatedAt', 'requestStartedAt', 'requestCompletedAt', 'sourceObservedAt']) {
    instant(value[field], field, true);
  }
  instant(value.checkedAt, 'checkedAt');
  instant(value.normalizedAt, 'normalizedAt');
  requireValue((value.requestStartedAt === null) === (value.requestCompletedAt === null), 'request timestamp pair');
  ordered(value.requestStartedAt, value.requestCompletedAt, 'request order');
  ordered(value.requestStartedAt, value.checkedAt, 'request/check order');
  ordered(value.requestCompletedAt, value.checkedAt, 'response/check order');
  ordered(value.sourceObservedAt, value.checkedAt, 'observation/check order');
  ordered(value.checkedAt, value.normalizedAt, 'check/normalization order');
  choice(value.origin, ['network', 'cache', 'retained-replay', 'bootstrap'], 'origin');
  assertObservedCoverage(value.coverage);
  assertPayload(value.payload);
}

export function assertAcceptedResource(value: unknown): asserts value is AcceptedResource {
  record(value, 'accepted resource');
  assertSourceScope(value.scope);
  for (const field of ['canonicalNormalizerVersion', 'sourceMappingRevisionId', 'contentId', 'validationVersion']) {
    text(value[field], field);
  }
  texts(value.observationIds, 'observationIds', true);
  requireValue(typeof value.acceptedGeneration === 'number' && Number.isSafeInteger(value.acceptedGeneration)
    && value.acceptedGeneration > 0, 'acceptedGeneration');
  instant(value.verifiedAt, 'verifiedAt', true);
  effective(value);
}

export function assertFieldGroup<T>(value: unknown, assertPayload: PayloadAssertion<T>): asserts value is FieldGroup<T> {
  record(value, 'field group');
  choice(value.availability, ['present', 'empty', 'pending', 'missing', 'failed', 'redacted'], 'availability');
  choice(value.completeness, ['complete', 'partial', 'unknown'], 'completeness');
  choice(value.freshness, ['fresh', 'stale', 'unknown'], 'freshness');
  choice(value.authority, ['provider-official', 'provider-estimate', 'sports-source', 'presentation-derived',
    'league-one-estimate', 'curated'], 'authority');
  choice(value.temporalContext, ['requested-period', 'current-display', 'season-to-date'], 'temporalContext');
  texts(value.sourceRefs, 'sourceRefs', value.availability === 'present' || value.availability === 'empty');
  texts(value.reasons, 'reasons');
  if (value.availability === 'present') {
    requireValue(value.value !== null && value.value !== undefined, 'present value');
    assertPayload(value.value);
  } else if (value.availability === 'empty') {
    requireValue(value.completeness === 'complete', 'empty completeness');
    requireValue(value.value === null || value.value === ''
      || (Array.isArray(value.value) && value.value.length === 0), 'empty value');
    if (value.value !== null) assertPayload(value.value);
  } else {
    requireValue(value.value === null, 'unavailable value');
  }
}

export function assertFeatureAssessment(value: unknown): asserts value is FeatureAssessment {
  record(value, 'feature assessment');
  choice(value.feature, ['official-overview', 'official-roster', 'official-lineup', 'official-scores-results',
    'official-standings', 'official-schedule', 'transaction-detail', 'waiver-claims', 'history', 'box-scores',
    'player-projection', 'team-forecast', 'win-probability', 'projected-standings', 'lineup-attention',
    'player-metrics', 'roster-metrics'], 'feature');
  choice(value.support, ['full', 'limited', 'unavailable', 'unverified'], 'support');
  record(value.scope, 'scope');
  if (value.scope.kind === 'discovery') assertDiscoveryScope(value.scope);
  else assertSourceScope(value.scope);
  nullableText(value.configurationVersionId, 'configurationVersionId');
  for (const field of ['requiredInputs', 'missingInputs', 'unsupportedRules']) texts(value[field], field);
  const required = value.requiredInputs as string[];
  requireValue((value.missingInputs as string[]).every(input => required.includes(input)), 'missing input dependency');
  if (value.support === 'full') {
    requireValue((value.missingInputs as string[]).length === 0
      && (value.unsupportedRules as string[]).length === 0, 'full support limitations');
  }
  nullableText(value.approximationPolicy, 'approximationPolicy');
  text(value.assessmentVersion, 'assessmentVersion');
  instant(value.assessedAt, 'assessedAt');
}

export function assertRosterMembership(value: unknown): asserts value is RosterMembership {
  record(value, 'roster membership');
  nullableText(value.seasonTeamId, 'seasonTeamId');
  assertProviderReference(value.sourceTeam);
  assertProviderReference(value.sourceEntity);
  requireValue(value.sourceTeam.provider === value.sourceEntity.provider, 'membership provider');
  nullableText(value.canonicalEntityId, 'canonicalEntityId');
  choice(value.identityState, ['resolved', 'unresolved'], 'identityState');
  requireValue((value.identityState === 'resolved') === (value.canonicalEntityId !== null), 'identity evidence');
  nullableText(value.nativeSection, 'nativeSection');
  choice(value.section, ['roster', 'active', 'bench', 'reserve', 'taxi', 'unknown'], 'section');
  effective(value);
}

export function validateRosterMembership(value: unknown): value is RosterMembership {
  try { assertRosterMembership(value); return true; } catch { return false; }
}

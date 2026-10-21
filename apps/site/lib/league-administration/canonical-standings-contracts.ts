import type { ObservedCoverage, SourceScope } from '../aggregator/contracts';
import type { OfficialStandingsRead } from '../aggregator/official-standings';
import type { AdministrationWriteFence, JsonValue, PublicCaptureWitness } from './contracts';
import type { AdministrationWriteResult } from './store-contracts';
import type { CanonicalSourceMappingV1, CanonicalSourceReference } from './canonical-source-contracts';
import { assertCanonicalSourceMapping } from './canonical-source-contracts';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { parsePublicCaptureWitness } from './public-capture-witness';

export const CANONICAL_DELIVERY_VERSION = 'league-one-canonical-delivery-v1' as const;
export const CANONICAL_STANDINGS_VERSION = 'league-one-official-standings-v1' as const;
export const CANONICAL_HASH_VERSION = 'league-one-jsonb-sha256-v1' as const;
export const CANONICAL_STANDINGS_LIMITS = Object.freeze({ teams: 20, bytes: 1_048_576, decimalCharacters: 1_024 });
export const CANONICAL_STANDINGS_REASONS = Object.freeze([
  'standings_identity_invalid', 'standings_team_limit_exceeded', 'standings_byte_limit_exceeded',
  'standings_decimal_limit_exceeded', 'standings_population_unproved', 'standings_population_mismatch',
  'standings_capture_partial', 'standings_record_fields_incomplete',
] as const);
export const CANONICAL_STANDINGS_OUTCOMES = Object.freeze([
  'accepted', 'preserved-stale', 'preserved-conflict', 'preserved-generation', 'invalid', 'capacity',
] as const);
export type CanonicalStandingsOutcome = typeof CANONICAL_STANDINGS_OUTCOMES[number];
export type CanonicalFact<T> = Readonly<{ state: 'known'; value: T } | { state: 'absent' | 'null' | 'invalid'; value: null }>;
export type CanonicalStandingsTeam = Readonly<{
  sourceTeam: CanonicalSourceReference; sourceOrdinal: number;
  record: Readonly<Record<'wins' | 'losses' | 'ties', CanonicalFact<number>>>;
  pointsFor: CanonicalFact<string>; pointsAgainst: CanonicalFact<string>;
  providerRank: CanonicalFact<number>; providerSeed: CanonicalFact<number>;
}>;
export type CanonicalStandingsValue = Readonly<{
  schemaVersion: typeof CANONICAL_STANDINGS_VERSION; status: 'qualified' | 'invalid' | 'capacity';
  teams: readonly CanonicalStandingsTeam[]; reasons: readonly string[];
}>;
export type CanonicalStandingsVersions = Readonly<{
  contractVersion: typeof CANONICAL_DELIVERY_VERSION; canonicalSchemaVersion: typeof CANONICAL_STANDINGS_VERSION;
  adapterVersion: string; nativeVerifierVersion: string; canonicalNormalizerVersion: string;
  hashVersion: typeof CANONICAL_HASH_VERSION;
}>;
export type CanonicalStandingsPolicy = CanonicalStandingsVersions & Readonly<{
  validationVersion: 'canonical-standings-acceptance-v1'; audienceId: 'public';
  coverageSpecId: 'official-season-standings-v1'; provider: string; nativeKind: string;
  teamNamespace: string; originPolicy: 'network-bridge-v1' | 'fixture-v1';
}>;
export type CanonicalResourceAttempt = Readonly<{
  id: string; scopeId: string; ordinal: number; expectedGeneration: number; nonce: string;
}>;
export type CanonicalFixtureAcquisition = Readonly<{
  version: 'canonical-fixture-capture-v1'; jobKey: string; generation: number;
  attemptId: string; nonce: string; sourceDigest: string;
}>;
export type CanonicalStandingsProvenance = Readonly<{
  captureId: string; origin: 'network' | 'fixture'; requestStartedAt: string | null; requestCompletedAt: string | null;
  sourceObservedAt: string | null; checkedAt: string; normalizedAt: string; sourceUpdatedAt: string | null;
  nativeRevision: string | null; acquisition: PublicCaptureWitness | CanonicalFixtureAcquisition;
}>;
export type CanonicalNativeSourceRef = Readonly<{ kind: 'sleeper-roster-bridge-v1'; nativeAttemptId: string }>
  | Readonly<{ kind: 'fixture-standalone-v1'; fixtureId: string; fixtureRevision: string; sourceDigest: string }>;
export type CanonicalStandingsDelivery = CanonicalStandingsVersions & Readonly<{
  mapping: CanonicalSourceMappingV1; scope: SourceScope; policy: CanonicalStandingsPolicy;
  attempt: CanonicalResourceAttempt; fence: AdministrationWriteFence; provenance: CanonicalStandingsProvenance;
  nativePayload: JsonValue; canonicalValue: CanonicalStandingsValue; coverage: ObservedCoverage;
  nativeSourceRef: CanonicalNativeSourceRef; populationEvidence: JsonValue;
  /** Original complete native submission, with its original hashes and witness. */
  legacyInput?: Readonly<Record<string, unknown>>;
}>;
export type CanonicalObservationWriteResult = Readonly<{
  status: 'recorded' | 'replayed'; receiptId: string; contentId: string; attemptId: string;
  acceptanceId: string | null; acceptedGeneration: number | null; outcome: CanonicalStandingsOutcome;
  legacyResult?: AdministrationWriteResult;
}>;
export type CanonicalStandingsSelection = Readonly<{ kind: 'current'; representation: 'canonical-v1' | 'legacy-sleeper-v1' }>
  | Readonly<{ kind: 'receipt'; representation: 'canonical-v1' | 'legacy-sleeper-v1'; receiptId: string }>;
export type CanonicalOfficialStandingsRead = Readonly<{
  status: 'available'; representation: 'canonical-v1'; scope: SourceScope; mapping: CanonicalSourceMappingV1;
  selection: CanonicalStandingsSelection; facts: CanonicalStandingsValue;
  teams: readonly (CanonicalStandingsTeam & Readonly<{ seasonTeamId: string }>)[];
  receipt: Readonly<{ id: string; contentId: string; attemptId: string; ordinal: number; acceptedGeneration: number | null;
    provenance: CanonicalStandingsProvenance; nativeSourceRef: CanonicalNativeSourceRef; legacyRosterReceiptId: string | null;
    outcome: CanonicalStandingsOutcome; reasons: readonly string[] }>;
  coverage: ObservedCoverage; expectedTeamCount: number | null; population: 'proven' | 'unproved' | 'mismatch';
  recordCompleteness: 'complete' | 'partial' | 'unknown'; freshness: 'unknown'; historicalApplicability: 'unverified';
  versions: CanonicalStandingsVersions;
}> | Readonly<{ status: 'available'; representation: 'legacy-sleeper-v1'; legacy: Extract<OfficialStandingsRead, { status: 'available' }> }>
  | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; representation: CanonicalStandingsSelection['representation'];
    reason: string; attemptId: string | null; receiptId: string | null }>;

export function canonicalObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid canonical object.');
  return value as Record<string, unknown>;
}
export function canonicalKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error('Invalid canonical object keys.');
}
export function canonicalUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value)) throw new Error('Invalid canonical UUID.');
  return value;
}
export function canonicalText(value: unknown): string {
  if (typeof value !== 'string' || !value.length || !value.trim().length || /[\x00-\x1f\x7f]/u.test(value)
    || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid canonical text.');
  return value; // Opaque values are never trimmed or case-folded.
}
export function canonicalCounter(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid canonical counter.');
  return value;
}
export const canonicalEqual = (a: unknown, b: unknown): boolean => a === undefined || b === undefined
  ? a === b : compatibleRevision(a) === compatibleRevision(b);
export function canonicalInstant(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u.test(value)) throw new Error('Invalid canonical instant.');
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('Invalid canonical instant.');
  return instant;
}
/** PostgreSQL evidence can retain microseconds; do not collapse an ordering boundary to milliseconds. */
export function canonicalInstantMicros(value: unknown): bigint {
  const milliseconds = canonicalInstant(value);
  const fraction = String(value).match(/\.(\d{1,6})Z$/u)?.[1] ?? '';
  return BigInt(milliseconds) * 1_000n + BigInt(fraction.padEnd(6, '0').slice(3));
}
export function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === 'string' && value.length <= CANONICAL_STANDINGS_LIMITS.decimalCharacters
    && /^(?:0|-?[1-9][0-9]*|-?(?:0|[1-9][0-9]*)\.[0-9]*[1-9])$/u.test(value);
}
/** Canonical facts use only safe integer JSON numbers. Match PostgreSQL jsonb text framing for its 1 MiB bound.
 * This is not a native JSON hash encoder; SQL owns all persisted digest computation. */
export function canonicalStandingsJsonbText(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalStandingsJsonbText).join(', ')}]`;
  const object = canonicalObject(value);
  const keys = Object.keys(object).sort((left, right) => {
    const a = Buffer.from(left, 'utf8'), b = Buffer.from(right, 'utf8');
    return a.byteLength - b.byteLength || Buffer.compare(a, b);
  });
  return `{${keys.map(key => `${JSON.stringify(key)}: ${canonicalStandingsJsonbText(object[key])}`).join(', ')}}`;
}
export const canonicalStandingsBytes = (value: unknown): number => Buffer.byteLength(canonicalStandingsJsonbText(value), 'utf8');
export function assertCanonicalReasons(value: unknown, outcomes = false): asserts value is string[] {
  const allowed: readonly string[] = outcomes ? [...CANONICAL_STANDINGS_REASONS,
    'source-time-stale', 'source-time-conflict', 'generation-or-ordinal-preserved'] : CANONICAL_STANDINGS_REASONS;
  if (!Array.isArray(value) || value.length > 32 || value.some(item => typeof item !== 'string' || !allowed.includes(item))
    || !canonicalEqual(value, [...new Set(value)].sort())) throw new Error('Invalid canonical reasons.');
}
function assertFact(value: unknown, minimum: number | 'decimal'): void {
  const fact = canonicalObject(value); canonicalKeys(fact, ['state', 'value']);
  if (fact.state === 'known') {
    if (minimum === 'decimal' ? !isCanonicalDecimal(fact.value)
      : typeof fact.value !== 'number' || !Number.isSafeInteger(fact.value) || fact.value < minimum) throw new Error('Invalid known canonical fact.');
  } else if (!['absent', 'null', 'invalid'].includes(String(fact.state)) || fact.value !== null) throw new Error('Invalid canonical fact state.');
}
export function assertCanonicalStandingsValue(value: unknown, mapping: CanonicalSourceMappingV1,
  policy: CanonicalStandingsPolicy): asserts value is CanonicalStandingsValue {
  const facts = canonicalObject(value); canonicalKeys(facts, ['schemaVersion', 'status', 'teams', 'reasons']);
  assertCanonicalReasons(facts.reasons);
  if (facts.schemaVersion !== CANONICAL_STANDINGS_VERSION || !['qualified', 'invalid', 'capacity'].includes(String(facts.status))
    || !Array.isArray(facts.teams) || facts.teams.length > 20 || facts.status !== 'qualified' && (!facts.reasons.length || facts.teams.length)
    || facts.status === 'qualified' && facts.reasons.length
    || canonicalStandingsBytes(facts) > CANONICAL_STANDINGS_LIMITS.bytes) throw new Error('Invalid canonical standings bounds.');
  const refs = new Set<string>();
  for (const [index, raw] of facts.teams.entries()) {
    const team = canonicalObject(raw); canonicalKeys(team, ['sourceTeam', 'sourceOrdinal', 'record', 'pointsFor', 'pointsAgainst', 'providerRank', 'providerSeed']);
    const ref = canonicalObject(team.sourceTeam); canonicalKeys(ref, ['provider', 'resourceKind', 'nativeNamespace', 'nativeId']);
    canonicalText(ref.nativeId);
    if (ref.provider !== mapping.scope.provider || ref.provider !== policy.provider || ref.resourceKind !== 'team'
      || ref.nativeNamespace !== policy.teamNamespace || team.sourceOrdinal !== index) throw new Error('Invalid canonical standings identity.');
    const key = JSON.stringify([ref.provider, ref.resourceKind, ref.nativeNamespace, ref.nativeId]);
    if (refs.has(key)) throw new Error('Duplicate canonical standings identity.');
    refs.add(key);
    const record = canonicalObject(team.record); canonicalKeys(record, ['wins', 'losses', 'ties']);
    for (const name of ['wins', 'losses', 'ties']) assertFact(record[name], 0);
    assertFact(team.pointsFor, 'decimal'); assertFact(team.pointsAgainst, 'decimal');
    assertFact(team.providerRank, 1); assertFact(team.providerSeed, 1);
  }
}
export function canonicalStandingsScope(mapping: CanonicalSourceMappingV1): SourceScope {
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
    family: 'standings', entityId: null, scoringPeriodId: null, audienceId: 'public', coverageSpecId: 'official-season-standings-v1' };
}
export function assertCanonicalAttempt(value: unknown): asserts value is CanonicalResourceAttempt {
  const attempt = canonicalObject(value); canonicalKeys(attempt, ['id', 'scopeId', 'ordinal', 'expectedGeneration', 'nonce']);
  canonicalUuid(attempt.id); canonicalUuid(attempt.scopeId); canonicalUuid(attempt.nonce);
  canonicalCounter(attempt.ordinal, 1); canonicalCounter(attempt.expectedGeneration);
}
export function assertCanonicalFence(value: unknown): asserts value is AdministrationWriteFence {
  const fence = canonicalObject(value); canonicalKeys(fence, ['jobKey', 'workerId', 'generation', 'deadlineAt']);
  canonicalText(fence.jobKey); canonicalText(fence.workerId); canonicalCounter(fence.generation, 1); canonicalInstant(fence.deadlineAt);
}
export function assertCanonicalSelection(value: unknown): asserts value is CanonicalStandingsSelection {
  const selection = canonicalObject(value);
  canonicalKeys(selection, selection.kind === 'receipt' ? ['kind', 'representation', 'receiptId'] : ['kind', 'representation']);
  if (!['current', 'receipt'].includes(String(selection.kind)) || !['canonical-v1', 'legacy-sleeper-v1'].includes(String(selection.representation))) throw new Error('Invalid canonical selection.');
  if (selection.kind === 'receipt') canonicalUuid(selection.receiptId);
}
export function assertCanonicalCoverage(value: unknown, facts: CanonicalStandingsValue): asserts value is ObservedCoverage {
  const coverage = canonicalObject(value);
  canonicalKeys(coverage, ['periodIds', 'interval', 'entitySet', 'fields', 'pagination', 'nextCursor', 'completeness', 'reasons']);
  assertCanonicalReasons(coverage.reasons);
  const fields = ['wins', 'losses', 'ties', 'pointsFor', 'pointsAgainst', 'providerRank', 'providerSeed'].filter(key =>
    facts.teams.length > 0 && facts.teams.every(team => (key in team.record
      ? team.record[key as keyof typeof team.record] : team[key as 'pointsFor' | 'pointsAgainst' | 'providerRank' | 'providerSeed']).state === 'known')).sort();
  const completeRecord = facts.teams.length > 0 && ['wins', 'losses', 'ties', 'pointsFor', 'pointsAgainst'].every(key => fields.includes(key));
  const completeness = facts.status !== 'qualified' ? 'unknown' : coverage.entitySet === 'full' && completeRecord ? 'complete' : 'partial';
  if (!canonicalEqual(coverage.periodIds, []) || coverage.interval !== null || coverage.nextCursor !== null
    || !['full', 'subset', 'unknown'].includes(String(coverage.entitySet)) || !['complete', 'unknown'].includes(String(coverage.pagination))
    || !canonicalEqual(coverage.fields, fields) || coverage.completeness !== completeness
    || coverage.entitySet === 'full' && coverage.pagination !== 'complete') throw new Error('Invalid canonical coverage.');
}
export function assertCanonicalProvenance(value: unknown): asserts value is CanonicalStandingsProvenance {
  const provenance = canonicalObject(value);
  canonicalKeys(provenance, ['captureId', 'origin', 'requestStartedAt', 'requestCompletedAt', 'sourceObservedAt', 'checkedAt',
    'normalizedAt', 'sourceUpdatedAt', 'nativeRevision', 'acquisition']);
  canonicalUuid(provenance.captureId);
  const checked = canonicalInstantMicros(provenance.checkedAt), normalized = canonicalInstantMicros(provenance.normalizedAt);
  if (!['network', 'fixture'].includes(String(provenance.origin)) || normalized < checked) throw new Error('Invalid canonical capture time.');
  const start = provenance.requestStartedAt === null ? null : canonicalInstantMicros(provenance.requestStartedAt);
  const end = provenance.requestCompletedAt === null ? null : canonicalInstantMicros(provenance.requestCompletedAt);
  if ((start === null) !== (end === null) || provenance.origin === 'network' && start === null
    || start !== null && end !== null && (start > end || end > checked)) throw new Error('Invalid canonical request time.');
  for (const key of ['sourceObservedAt', 'sourceUpdatedAt']) if (provenance[key] !== null && canonicalInstantMicros(provenance[key]) > checked) throw new Error('Invalid canonical source time.');
  if (provenance.nativeRevision !== null) canonicalText(provenance.nativeRevision);
  const acquisition = canonicalObject(provenance.acquisition);
  if (provenance.origin === 'network') parsePublicCaptureWitness(acquisition);
  else {
    canonicalKeys(acquisition, ['version', 'jobKey', 'generation', 'attemptId', 'nonce', 'sourceDigest']);
    if (acquisition.version !== 'canonical-fixture-capture-v1') throw new Error('Invalid fixture acquisition.');
    canonicalText(acquisition.jobKey); canonicalCounter(acquisition.generation, 1); canonicalUuid(acquisition.attemptId);
    canonicalUuid(acquisition.nonce); assertCanonicalDigest(acquisition.sourceDigest);
  }
}
export function assertCanonicalDigest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error('Invalid canonical digest.');
}
function assertJson(value: unknown): void {
  const pending = [value], seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (item === null || typeof item === 'boolean') continue;
    if (typeof item === 'number' && Number.isFinite(item)) continue;
    if (typeof item === 'string' && !/[\u0000\uD800-\uDFFF]/u.test(item)) continue;
    if (item && typeof item === 'object' && (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
      if (seen.has(item)) continue;
      seen.add(item); pending.push(...Object.values(item)); continue;
    }
    throw new Error('Canonical native evidence must be a parsed JSON value.');
  }
  JSON.stringify(value); // A retained cycle is not a parsed JSON document.
}
/** Structural validation plus exact separately selected deployment policy; SQL proves admission and parity. */
export function assertCanonicalDelivery(value: unknown, selectedPolicy: CanonicalStandingsPolicy): asserts value is CanonicalStandingsDelivery {
  const delivery = canonicalObject(value);
  const keys = ['contractVersion', 'canonicalSchemaVersion', 'adapterVersion', 'nativeVerifierVersion', 'canonicalNormalizerVersion',
    'hashVersion', 'mapping', 'scope', 'policy', 'attempt', 'fence', 'provenance', 'nativePayload', 'canonicalValue', 'coverage', 'nativeSourceRef', 'populationEvidence'];
  canonicalKeys(delivery, Object.hasOwn(delivery, 'legacyInput') ? [...keys, 'legacyInput'] : keys);
  assertCanonicalSourceMapping(delivery.mapping); assertCanonicalAttempt(delivery.attempt); assertCanonicalFence(delivery.fence);
  assertCanonicalProvenance(delivery.provenance);
  assertJson(delivery.nativePayload); assertJson(delivery.populationEvidence);
  if (!canonicalEqual(delivery.policy, selectedPolicy) || !canonicalEqual(delivery.scope, canonicalStandingsScope(delivery.mapping))) throw new Error('Canonical policy or scope disagreement.');
  for (const key of ['contractVersion', 'canonicalSchemaVersion', 'adapterVersion', 'nativeVerifierVersion', 'canonicalNormalizerVersion', 'hashVersion'] as const) {
    if (delivery[key] !== selectedPolicy[key]) throw new Error('Unregistered canonical version.');
  }
  assertCanonicalStandingsValue(delivery.canonicalValue, delivery.mapping, selectedPolicy);
  assertCanonicalCoverage(delivery.coverage, delivery.canonicalValue);
  const ref = canonicalObject(delivery.nativeSourceRef), provenance = delivery.provenance;
  if (ref.kind === 'sleeper-roster-bridge-v1') {
    canonicalKeys(ref, ['kind', 'nativeAttemptId']); canonicalUuid(ref.nativeAttemptId);
    const legacy = canonicalObject(delivery.legacyInput), envelope = canonicalObject(legacy.envelope);
    const acquisition = parsePublicCaptureWitness(provenance.acquisition);
    const { captureId: _captureId, normalizedAt: _normalizedAt, sourceUpdatedAt, nativeRevision, ...nativeProvenance } = provenance;
    void _captureId; void _normalizedAt;
    const mapping = delivery.mapping;
    const legacyMapping = { connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
      revisionId: mapping.revisionId, generation: mapping.generation, scope: { provider: mapping.scope.provider,
        leagueKey: mapping.scope.leagueKey, externalLeagueId: mapping.scope.externalLeagueId, season: mapping.scope.season } };
    if (selectedPolicy.originPolicy !== 'network-bridge-v1' || provenance.origin !== 'network' || acquisition.work.kind !== 'core'
      || acquisition.attempts.players?.id !== ref.nativeAttemptId || !canonicalEqual(acquisition.fence, delivery.fence)
      || !canonicalEqual(envelope.payload, delivery.nativePayload) || !canonicalEqual(canonicalObject(envelope.provenance).acquisition, acquisition)
      || !canonicalEqual(envelope.provenance, nativeProvenance) || sourceUpdatedAt !== null || nativeRevision !== null
      || mapping.scope.provider !== 'sleeper' || mapping.scope.nativeNamespace !== 'nfl' || mapping.sourceNamespace !== `nfl:${mapping.scope.season}`
      || !canonicalEqual(acquisition.mapping, legacyMapping) || !canonicalEqual(envelope.scope, legacyMapping.scope)
      || envelope.family !== 'rosters' || envelope.week !== null
      || canonicalObject(canonicalObject(legacy.rosterAcceptance).attempt).id !== ref.nativeAttemptId
      || !canonicalEqual(legacy.writeFence, delivery.fence) || !canonicalEqual(legacy.sourceMapping, acquisition.mapping)) throw new Error('Invalid canonical legacy bridge.');
  } else if (ref.kind === 'fixture-standalone-v1') {
    canonicalKeys(ref, ['kind', 'fixtureId', 'fixtureRevision', 'sourceDigest']);
    canonicalText(ref.fixtureId); canonicalText(ref.fixtureRevision); assertCanonicalDigest(ref.sourceDigest);
    const acquisition = provenance.acquisition as CanonicalFixtureAcquisition;
    if (selectedPolicy.originPolicy !== 'fixture-v1' || provenance.origin !== 'fixture' || Object.hasOwn(delivery, 'legacyInput')
      || delivery.populationEvidence !== null || acquisition.attemptId !== delivery.attempt.id || acquisition.nonce !== delivery.attempt.nonce
      || acquisition.sourceDigest !== ref.sourceDigest || acquisition.jobKey !== delivery.fence.jobKey
      || acquisition.generation !== delivery.fence.generation) throw new Error('Invalid standalone canonical binding.');
  } else throw new Error('Unregistered canonical source reference.');
}

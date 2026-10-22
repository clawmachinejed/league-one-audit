import 'server-only';
import { projectOfficialStandings } from '../aggregator/official-standings';
import type { RosterPopulationEvidence } from '../aggregator/current-roster';
import type { ObservedCoverage } from '../aggregator/contracts';
import type { NormalizedAdministrationObservation, AdministrationWriteFence, JsonValue } from './contracts';
import type { CanonicalSourceMappingV1 } from './canonical-source-contracts';
import { canonicalStandingsVersions, legacyStandingsMapping, resolveCanonicalStandingsPolicy, parseRegisteredProviderKey } from './canonical-standings-policy';
import { CANONICAL_STANDINGS_VERSION, CANONICAL_STANDINGS_LIMITS, canonicalEqual, canonicalObject, assertCanonicalDelivery,
  canonicalStandingsScope, canonicalInstantMicros, canonicalStandingsBytes, type CanonicalStandingsValue, type CanonicalStandingsPolicy, type CanonicalResourceAttempt,
  type CanonicalStandingsDelivery, type CanonicalFact } from './canonical-standings-contracts';

/** Strip native diagnostic/decomposition fields only after using the unchanged native projector. */
export function projectSleeperCanonicalStandings(normalized: NormalizedAdministrationObservation,
  mapping: CanonicalSourceMappingV1, policy: CanonicalStandingsPolicy): CanonicalStandingsValue {
  resolveCanonicalStandingsPolicy(mapping, policy);
  if (!canonicalEqual(normalized.envelope.scope, legacyStandingsMapping(mapping).scope)
    || normalized.envelope.family !== 'rosters' || normalized.envelope.week !== null) throw new Error('Wrong Sleeper standings source.');
  const projected = projectOfficialStandings(normalized);
  const field = <T>(value: { state: 'known' | 'absent' | 'null' | 'invalid'; value: T | null }): CanonicalFact<T> =>
    value.state === 'known' ? { state: 'known', value: value.value! } : { state: value.state, value: null };
  const value: CanonicalStandingsValue = { schemaVersion: CANONICAL_STANDINGS_VERSION, status: projected.status,
    teams: projected.teams.map(team => ({ sourceTeam: { provider: parseRegisteredProviderKey(mapping.scope.provider, mapping, policy), resourceKind: 'team',
      nativeNamespace: policy.teamNamespace, nativeId: team.externalRosterId }, sourceOrdinal: team.sourceOrdinal,
    record: { wins: field(team.record.wins), losses: field(team.record.losses), ties: field(team.record.ties) },
    pointsFor: field(team.pointsFor), pointsAgainst: field(team.pointsAgainst),
    providerRank: field(team.providerRank), providerSeed: field(team.providerSeed) })),
    reasons: projected.reasons.map(reason => reason === 'invalid_roster_identity' ? 'standings_identity_invalid' : reason).sort() };
  if (value.teams.some(team => [team.pointsFor, team.pointsAgainst].some(point =>
    point.state === 'known' && point.value.length > CANONICAL_STANDINGS_LIMITS.decimalCharacters))) {
    return { schemaVersion: CANONICAL_STANDINGS_VERSION, status: 'capacity', teams: [], reasons: ['standings_decimal_limit_exceeded'] };
  }
  if (canonicalStandingsBytes(value) > CANONICAL_STANDINGS_LIMITS.bytes) {
    return { schemaVersion: CANONICAL_STANDINGS_VERSION, status: 'capacity', teams: [], reasons: ['standings_byte_limit_exceeded'] };
  }
  return value;
}

/** This is an adapter projection, not source authority. The independent SQL verifier rechecks the linked capture. */
export function sleeperCanonicalStandingsCoverage(normalized: NormalizedAdministrationObservation,
  facts: CanonicalStandingsValue, population: RosterPopulationEvidence | null,
  nativeReservedAt?: string): ObservedCoverage {
  let expected: number | null = null;
  if (population) {
    const envelope = population.envelope;
    const payload = envelope.payload && typeof envelope.payload === 'object' && !Array.isArray(envelope.payload)
      ? envelope.payload as Record<string, JsonValue> : null;
    if (envelope.family === 'league' && envelope.week === null && envelope.completeness === 'complete'
      && canonicalEqual(envelope.scope, normalized.envelope.scope)
      && canonicalEqual(envelope.provenance.acquisition, normalized.envelope.provenance.acquisition)
      && (envelope.provenance.acquisition !== undefined || nativeReservedAt !== undefined
        && envelope.provenance.requestStartedAt !== null
        && canonicalInstantMicros(envelope.provenance.requestStartedAt) >= canonicalInstantMicros(nativeReservedAt))
      && payload?.league_id === envelope.scope.externalLeagueId
      && payload?.season === String(envelope.scope.season) && payload?.sport === 'nfl'
      && typeof payload.total_rosters === 'number' && Number.isInteger(payload.total_rosters)
      && payload.total_rosters > 0 && payload.total_rosters <= 2_147_483_647) expected = payload.total_rosters;
  }
  const populationState = expected === null ? 'unproved' : facts.status === 'qualified' && expected === facts.teams.length ? 'proven' : 'mismatch';
  const fields = ['wins', 'losses', 'ties', 'pointsFor', 'pointsAgainst', 'providerRank', 'providerSeed'].filter(key =>
    facts.teams.length > 0 && facts.teams.every(team => (key in team.record
      ? team.record[key as keyof typeof team.record] : team[key as 'pointsFor' | 'pointsAgainst' | 'providerRank' | 'providerSeed']).state === 'known')).sort();
  const completeRecord = facts.status === 'qualified' && facts.teams.length > 0
    && ['wins', 'losses', 'ties', 'pointsFor', 'pointsAgainst'].every(key => fields.includes(key));
  const partial = normalized.envelope.completeness === 'partial';
  const entitySet = facts.status !== 'qualified' ? 'unknown' : !partial && populationState === 'proven' ? 'full'
    : partial || populationState === 'mismatch' ? 'subset' : 'unknown';
  return { periodIds: [], interval: null, entitySet, fields,
    pagination: partial ? 'unknown' : 'complete', nextCursor: null,
    completeness: facts.status !== 'qualified' ? 'unknown' : entitySet === 'full' && completeRecord ? 'complete' : 'partial',
    reasons: [...new Set([...facts.reasons, ...(populationState === 'unproved' ? ['standings_population_unproved']
      : populationState === 'mismatch' ? ['standings_population_mismatch'] : []), ...(partial ? ['standings_capture_partial'] : []),
    ...(!completeRecord ? ['standings_record_fields_incomplete'] : [])])].sort() };
}

/** Runs only beside the original acquisition owner; no HTTP and no retagging of a captured document. */
export function buildSleeperCanonicalStandingsDelivery(input: Readonly<{
  normalized: NormalizedAdministrationObservation; mapping: CanonicalSourceMappingV1; policy: CanonicalStandingsPolicy;
  attempt: CanonicalResourceAttempt; fence: AdministrationWriteFence; captureId: string; normalizedAt: string;
  legacyInput: Readonly<Record<string, unknown>>;
}>): CanonicalStandingsDelivery {
  const { normalized, mapping, policy, attempt, fence, legacyInput } = input;
  resolveCanonicalStandingsPolicy(mapping, policy);
  const original = normalized.envelope.provenance;
  if (original.origin !== 'network' || !original.acquisition || original.acquisition.work.kind !== 'core'
    || !canonicalEqual(legacyInput.sourceMapping, legacyStandingsMapping(mapping))) throw new Error('Missing original standings acquisition.');
  const nativeAcceptance = canonicalObject(legacyInput.rosterAcceptance);
  const nativeAttempt = canonicalObject(nativeAcceptance.attempt);
  const population = nativeAcceptance.population as RosterPopulationEvidence | undefined;
  const canonicalValue = projectSleeperCanonicalStandings(normalized, mapping, policy);
  const delivery: CanonicalStandingsDelivery = { ...canonicalStandingsVersions(policy), mapping, scope: canonicalStandingsScope(mapping),
    policy, attempt, fence, provenance: { ...original, origin: 'network', acquisition: original.acquisition,
      captureId: input.captureId, normalizedAt: input.normalizedAt, sourceUpdatedAt: null, nativeRevision: null },
    nativePayload: normalized.envelope.payload, canonicalValue,
    coverage: sleeperCanonicalStandingsCoverage(normalized, canonicalValue, population ?? null),
    nativeSourceRef: { kind: 'sleeper-roster-bridge-v1', nativeAttemptId: String(nativeAttempt.id) },
    populationEvidence: population as unknown as JsonValue ?? null, legacyInput };
  assertCanonicalDelivery(delivery, policy);
  return delivery;
}

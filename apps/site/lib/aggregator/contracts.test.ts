import { describe, expect, it } from 'vitest';
import yahoo from '../../test-support/fixtures/aggregator-yahoo-roster-synthetic.json';
import type {
  AcceptedResource, DiscoveryObservation, DiscoveryScope, FeatureAssessment, FieldGroup,
  RosterMembership, SourceObservation, SourceScope,
} from './contracts';
import {
  assertAcceptedResource, assertDecimal, assertDiscoveryScope, assertFeatureAssessment, assertFieldGroup,
  assertInstant, assertObservedCoverage, assertProviderReference, assertRosterMembership,
  assertSourceObservation, assertSourceScope, ContractValidationError, providerReferenceKey,
  validateRosterMembership,
} from './validation';

const checkedAt = '2026-09-28T12:00:00.000Z';
const sourceObservedAt = '2026-09-27T10:00:00.000Z';
const discovery: DiscoveryScope = {
  kind: 'discovery', provider: 'yahoo', accessContextId: 'synthetic-public-access',
  sourceLeagueKey: 'G.l.Example', sourceSeasonNamespace: 'G', sport: 'nfl', season: 2026,
  leagueSeasonId: null, audienceId: 'synthetic-public-audience', coverageSpecId: 'current-roster-v1',
};
const enrolled: SourceScope = {
  kind: 'enrolled-resource', connectionId: 'existing-connection', leagueSeasonId: 'existing-season',
  family: 'roster-membership', entityId: null, scoringPeriodId: null,
  audienceId: 'synthetic-public-audience', coverageSpecId: 'current-roster-v1',
};
function assertMemberships(value: unknown): asserts value is RosterMembership[] {
  if (!Array.isArray(value)) throw new ContractValidationError('memberships');
  for (const membership of value) assertRosterMembership(membership);
}
function observation(): DiscoveryObservation<RosterMembership[]> {
  assertMemberships(yahoo.memberships);
  return {
    schemaVersion: 'roster-membership-v1', adapterVersion: 'synthetic-documentation-example-v1',
    canonicalNormalizerVersion: 'synthetic-roster-v1', scope: { ...discovery },
    observationId: 'synthetic-observation', captureId: 'synthetic-capture', pageIdentity: null,
    rawContentRef: 'synthetic-native-content', normalizedContentRef: 'synthetic-normalized-content',
    nativeRevision: null, sourceUpdatedAt: null, requestStartedAt: null, requestCompletedAt: null,
    sourceObservedAt, checkedAt, normalizedAt: checkedAt, origin: 'retained-replay',
    coverage: { periodIds: [], interval: null, entitySet: 'subset', fields: ['membership', 'nativeSection'],
      pagination: 'complete', nextCursor: null, completeness: 'partial', reasons: ['unknown_native_section'] },
    payload: structuredClone(yahoo.memberships),
  };
}
function accepted(): AcceptedResource {
  return { scope: enrolled, canonicalNormalizerVersion: 'roster-v1', sourceMappingRevisionId: 'mapping-v1',
    contentId: 'content-v1', observationIds: ['observation-v1'], validationVersion: 'validation-v1',
    acceptedGeneration: 1, verifiedAt: checkedAt, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' };
}
function officialScore(): FieldGroup<string> {
  return { value: '0', availability: 'present', completeness: 'complete', freshness: 'stale',
    authority: 'provider-official', temporalContext: 'requested-period', sourceRefs: ['source-official'], reasons: [] };
}
function assessment(): FeatureAssessment {
  return { feature: 'official-roster', support: 'limited', scope: discovery, configurationVersionId: null,
    requiredInputs: ['membership'], missingInputs: [], unsupportedRules: ['unknown_native_section'],
    approximationPolicy: null, assessmentVersion: 'synthetic-v1', assessedAt: checkedAt };
}

describe('common contract primitives', () => {
  it.each(['0', '-0', '87.2500', '-0.004', '900719925474099312345678901234567890.123456789'])
  ('retains finite base-10 precision without JavaScript numeric coercion: %s', value => {
    expect(() => assertDecimal(value)).not.toThrow();
  });
  it.each([0, null, undefined, '', ' ', ' 1', '1 ', '+1', '01', '1e2', '0x10', 'NaN', 'Infinity', '-Infinity', '.5', '1.'])
  ('rejects non-decimal serialized values: %j', value => {
    expect(() => assertDecimal(value)).toThrow(ContractValidationError);
  });
  it.each(['2024-02-29T23:59:59Z', '2026-09-28T12:00:00.1Z', '2026-09-28T12:00:00.123Z'])
  ('accepts genuine UTC instants: %s', value => { expect(() => assertInstant(value)).not.toThrow(); });
  it.each(['2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-01-01T24:00:00Z',
    '2026-09-28', '2026-09-28T12:00:00+00:00', '2026-09-28T12:00:00.1234Z', null, 1790593200])
  ('rejects invalid dates and non-UTC or unsupported precision: %j', value => {
    expect(() => assertInstant(value)).toThrow(ContractValidationError);
  });
  it('keeps external keys opaque and distinguishes provider, resource kind, namespace, and case', () => {
    const reference = yahoo.memberships[0].sourceTeam;
    assertProviderReference(reference);
    const keys = [reference, { ...reference, nativeNamespace: 'other-league' },
      { ...reference, nativeId: 'g.l.example.t.7' }, { ...reference, resourceKind: 'manager' },
      { ...reference, provider: 'sleeper' as const }].map(providerReferenceKey);
    expect(new Set(keys).size).toBe(5);
    expect(reference.nativeId).toBe('G.l.Example.t.7');
    expect(providerReferenceKey({ ...reference, nativeNamespace: 'a|b', nativeId: 'c' }))
      .not.toBe(providerReferenceKey({ ...reference, nativeNamespace: 'a', nativeId: 'b|c' }));
    expect(() => assertProviderReference({ ...reference, nativeId: 7 })).toThrow();
    expect(() => assertProviderReference({ ...reference, provider: 'arbitrary-url' })).toThrow();
  });
});

describe('discovery and enrolled observation evidence', () => {
  it('assesses an unenrolled candidate without a fabricated connection, mapping revision, or private entitlement', () => {
    const input = observation();
    assertSourceObservation(input, assertMemberships);
    expect(input.scope.leagueSeasonId).toBeNull();
    expect(input).not.toHaveProperty('sourceMappingRevisionId');
    expect(input.scope).not.toHaveProperty('connectionId');
    expect(input).not.toHaveProperty('authorized');
    assertFeatureAssessment(assessment());
    expect(() => assertAcceptedResource({ ...accepted(), scope: discovery })).toThrow();
  });
  it('requires explicit enrolled identity and mapping lineage when linking the same retained evidence', () => {
    const capture = observation();
    const linked: SourceObservation<RosterMembership[]> = { ...capture, scope: enrolled, sourceMappingRevisionId: 'mapping-v1' };
    assertSourceObservation(linked, assertMemberships);
    expect(linked.captureId).toBe(capture.captureId);
    expect(linked.sourceObservedAt).toBe(sourceObservedAt);
    expect(capture.scope.leagueSeasonId).toBeNull();
    const missingMapping = { ...capture, scope: enrolled };
    expect(() => assertSourceObservation(missingMapping, assertMemberships)).toThrow();
    expect(() => assertSourceObservation({ ...capture, sourceMappingRevisionId: 'invented' }, assertMemberships)).toThrow();
    expect(() => assertDiscoveryScope({ ...discovery, connectionId: 'invented' })).toThrow();
    expect(() => assertSourceScope({ ...enrolled, accessContextId: discovery.accessContextId })).toThrow();
  });
  it('retains replay source age and unknown resource update time instead of borrowing a league timestamp', () => {
    const input = observation();
    const before = structuredClone(input);
    assertSourceObservation(input, assertMemberships);
    expect(input).toEqual(before);
    expect(input.sourceObservedAt).not.toBe(input.checkedAt);
    expect(yahoo.native.league_update_timestamp).toBeTruthy();
    expect(input.sourceUpdatedAt).toBeNull();
    const unknownAge = { ...input, sourceObservedAt: null, origin: 'cache' as const };
    assertSourceObservation(unknownAge, assertMemberships);
    expect(unknownAge.sourceObservedAt).toBeNull();
  });
  it.each([
    { requestStartedAt: checkedAt, requestCompletedAt: sourceObservedAt },
    { requestStartedAt: '2026-09-29T00:00:00Z' },
    { requestCompletedAt: '2026-09-29T00:00:00Z' },
    { requestStartedAt: sourceObservedAt, requestCompletedAt: null },
    { requestStartedAt: null, requestCompletedAt: sourceObservedAt },
    { requestStartedAt: sourceObservedAt, requestCompletedAt: '2026-09-29T00:00:00Z' },
    { sourceObservedAt: '2026-09-29T00:00:00Z' },
    { normalizedAt: sourceObservedAt },
  ])('rejects contradictory internal timestamp ordering: %j', change => {
    expect(() => assertSourceObservation({ ...observation(), ...change }, assertMemberships)).toThrow();
  });
  it('validates payloads and required nullable fields without treating missing as null', () => {
    expect(() => assertSourceObservation({ ...observation(), payload: null }, assertMemberships)).toThrow();
    expect(() => assertSourceObservation({ ...observation(), rawContentRef: undefined }, assertMemberships)).toThrow();
    expect(() => assertDiscoveryScope({ ...discovery, leagueSeasonId: undefined })).toThrow();
    expect(() => assertSourceScope({ ...enrolled, audienceId: '' })).toThrow();
    expect(() => assertSourceScope({ ...enrolled, entityId: undefined })).toThrow();
  });
  it('does not equate a continuation or an unknown inventory with complete replacement evidence', () => {
    const coverage = observation().coverage;
    assertObservedCoverage({ ...coverage, pagination: 'continuation', nextCursor: 'protected-synthetic-cursor' });
    assertObservedCoverage({ ...coverage, completeness: 'complete' });
    for (const change of [
      { completeness: 'complete', pagination: 'continuation', nextCursor: 'protected-synthetic-cursor' },
      { completeness: 'complete', entitySet: 'unknown' },
      { pagination: 'complete', nextCursor: 'protected-synthetic-cursor' },
      { pagination: 'continuation', nextCursor: null },
      { interval: { from: checkedAt, to: sourceObservedAt } },
    ]) expect(() => assertObservedCoverage({ ...coverage, ...change })).toThrow(ContractValidationError);
    expect(() => assertObservedCoverage({ ...coverage, nextCursor: 'protected-synthetic-cursor' }))
      .toThrow('Invalid aggregator contract: complete pagination cursor');
  });
  it('validates acceptance metadata independently without performing acceptance or inventing effective dates', () => {
    assertAcceptedResource(accepted());
    for (const change of [{ acceptedGeneration: 0 }, { acceptedGeneration: 1.5 }, { observationIds: [] },
      { sourceMappingRevisionId: null }, { effectiveFrom: sourceObservedAt },
      { effectiveEvidence: 'provider', effectiveFrom: checkedAt, effectiveTo: sourceObservedAt }]) {
      expect(() => assertAcceptedResource({ ...accepted(), ...change })).toThrow();
    }
    assertAcceptedResource({ ...accepted(), verifiedAt: null });
  });
});

describe('field state and provider-neutral roster fixtures', () => {
  it('keeps official zero present, missing null, and evidenced empty separate from unsupported analytics', () => {
    assertFieldGroup(officialScore(), assertDecimal);
    assertFieldGroup({ ...officialScore(), value: null, availability: 'missing' }, assertDecimal);
    assertFieldGroup({ ...officialScore(), value: [], availability: 'empty' }, assertMemberships);
    for (const change of [{ value: null }, { value: undefined }, { value: '0', availability: 'missing' },
      { value: '0', availability: 'empty' }, { value: [], availability: 'empty', completeness: 'partial' },
      { sourceRefs: [] }]) {
      expect(() => assertFieldGroup({ ...officialScore(), ...change }, assertDecimal)).toThrow();
    }
    const forecast: FeatureAssessment = { ...assessment(), feature: 'team-forecast', support: 'unavailable',
      requiredInputs: ['scoring-profile', 'player-identity'], missingInputs: ['scoring-profile', 'player-identity'],
      unsupportedRules: ['unqualified_native_slot'] };
    assertFeatureAssessment(forecast);
    expect(officialScore().authority).toBe('provider-official');
    expect(officialScore().value).toBe('0');
    expect(() => assertFeatureAssessment({ ...forecast, support: 'full' })).toThrow();
    expect(() => assertFeatureAssessment({ ...forecast, missingInputs: ['undeclared-input'] })).toThrow();
  });
  it('represents Yahoo composite IDs, unresolved entities, native groups, and missing history without Sleeper coercion', () => {
    expect(yahoo.evidence.kind).toBe('documentation-derived-synthetic');
    expect(yahoo.evidence.qualification).toContain('Not an authenticated capture');
    for (const [index, member] of yahoo.memberships.entries()) {
      assertRosterMembership(member);
      expect(member.sourceTeam.nativeId).toBe(yahoo.native.team_key);
      expect(member.sourceEntity.nativeId).toBe(yahoo.native.players[index].player_key);
      expect(member.nativeSection).toBe(yahoo.native.players[index].selected_position.position);
      expect(member.canonicalEntityId).toBeNull();
      expect(member.effectiveFrom).toBeNull();
    }
    expect(yahoo.memberships.map(member => member.section)).toEqual(['bench', 'reserve', 'unknown']);
    expect(yahoo.memberships[2].nativeSection).toBe('FUTURE_GROUP');
  });
  it('preserves harmless additive fields but rejects a required-field format change and invented identity', () => {
    const member = yahoo.memberships[0];
    expect(validateRosterMembership({ ...member, futureNativeEvidence: { opaque: true } })).toBe(true);
    expect(validateRosterMembership({ ...member, sourceEntity: { ...member.sourceEntity, nativeId: 17 } })).toBe(false);
    expect(validateRosterMembership({ ...member, identityState: 'resolved' })).toBe(false);
    expect(validateRosterMembership({ ...member, canonicalEntityId: 'invented' })).toBe(false);
    expect(validateRosterMembership({ ...member, sourceEntity: { ...member.sourceEntity, provider: 'sleeper' } })).toBe(false);
    expect(validateRosterMembership({ ...member, nativeSection: undefined })).toBe(false);
    assertRosterMembership({ ...member, canonicalEntityId: 'proved-canonical-entity', identityState: 'resolved' });
  });
  it('allows overlapping native membership groups without inventing an active lineup', () => {
    const held = { ...yahoo.memberships[1], nativeSection: 'players', section: 'roster' };
    const reserve = { ...yahoo.memberships[1], nativeSection: 'reserve', section: 'reserve' };
    assertMemberships([held, reserve]);
    expect(held.sourceEntity).toEqual(reserve.sourceEntity);
    expect(held).not.toHaveProperty('scoringPeriodId');
    expect(held).not.toHaveProperty('lineupSlot');
  });
});

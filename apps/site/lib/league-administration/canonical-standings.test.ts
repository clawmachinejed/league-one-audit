import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../database';
import type { JsonValue, PublicCaptureWitness } from './contracts';
import { normalizeAdministrationObservation } from './normalize';
import { projectOfficialStandings } from '../aggregator/official-standings';
import { buildLegacyAdministrationInput } from './legacy-administration-input';
import { buildSleeperCanonicalStandingsDelivery, projectSleeperCanonicalStandings, sleeperCanonicalStandingsCoverage } from './sleeper-canonical-standings';
import { assertCanonicalDelivery, assertCanonicalStandingsValue, assertCanonicalProvenance, canonicalEqual,
  canonicalStandingsJsonbText, canonicalStandingsBytes, isCanonicalDecimal, canonicalStandingsScope,
  type CanonicalStandingsValue, type CanonicalStandingsPolicy, type CanonicalStandingsSelection } from './canonical-standings-contracts';
import { legacyStandingsMapping, resolveCanonicalStandingsPolicy, selectCanonicalStandingsCapture, sleeperCanonicalStandingsPolicy } from './canonical-standings-policy';
import { canonicalStandingsMethods, readCanonicalOfficialStandingsRows, CANONICAL_OFFICIAL_STANDINGS_SQL } from './neon/canonical-official-standings';
import { HISTORICAL_OFFICIAL_STANDINGS_SQL, OFFICIAL_STANDINGS_SQL } from './neon/official-standings';
import { createLeagueAdministrationStore } from './store';
import { recordCapturedAdministration } from './runtime';
import { sealPublicCapture } from './public-capture-witness';
import type { LeagueAdministrationStore } from './store-contracts';
import { runPublicIntakeStep, type PublicIntakeDependencies } from './public-intake';
import type { PublicIntakeStore } from './public-intake-contracts';
import * as deploymentPolicy from './canonical-standings-policy';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-11T12:00:00.000Z';
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1, sourceNamespace: 'nfl:2026',
  scope: { leagueKey: 'standings-contract', provider: 'sleeper', externalLeagueId: '9876543210', season: 2026, nativeNamespace: 'nfl' } };
const policy = sleeperCanonicalStandingsPolicy(mapping), legacyMapping = legacyStandingsMapping(mapping);
const fence = { jobKey: 'league-administration-public-intake', workerId: id(11), generation: 2, deadlineAt: '2026-10-11T12:00:20.000Z' };
const attempt = { id: id(21), scopeId: id(22), ordinal: 1, expectedGeneration: 0, nonce: id(23) };
const nativeAttempt = { id: id(6), scopeId: id(7), ordinal: 1, expectedGeneration: 0 };
const witness: PublicCaptureWitness = { version: 'public-network-capture-v1',
  work: { requestId: id(10), revision: 3, kind: 'core', externalLeagueId: mapping.scope.externalLeagueId, season: 2026 },
  fence, dispatchNonce: id(12), mapping: legacyMapping,
  attempts: { players: { id: id(6), nonce: id(16) }, settings: { id: id(17), nonce: id(18) }, managers: { id: id(19), nonce: id(20) } } };
const settings = { wins: 4, losses: 1, ties: 0, fpts: 512, fpts_decimal: 37, fpts_against: 499, fpts_against_decimal: 0 };
function normalized(payload: JsonValue = [{ roster_id: 1, settings }], completeness: 'complete' | 'partial' = 'complete',
  acquisition: PublicCaptureWitness | undefined = witness) {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: legacyMapping.scope, family: 'rosters', week: null, completeness, payload,
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at,
      ...(acquisition ? { acquisition } : {}) } });
}
function population(total: JsonValue, acquisition: PublicCaptureWitness | undefined = witness, start = at) {
  const value = normalizeAdministrationObservation({ ...normalized().envelope, family: 'league', payload: {
    league_id: mapping.scope.externalLeagueId, season: '2026', sport: 'nfl', total_rosters: total,
    roster_positions: ['QB'], scoring_settings: {}, settings: { type: 0 },
  }, provenance: { origin: 'network', requestStartedAt: start, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at,
    ...(acquisition ? { acquisition } : {}) } });
  return { observationId: id(25), contentHash: value.contentHash, envelope: value.envelope };
}
function bridge() {
  const input = normalized(), legacyInput = buildLegacyAdministrationInput(input, fence, legacyMapping, { attempt: nativeAttempt });
  return buildSleeperCanonicalStandingsDelivery({ normalized: input, mapping, policy, attempt, fence,
    captureId: id(24), normalizedAt: at, legacyInput });
}
function database(query: (sql: string, values: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, values: readonly unknown[] = []) {
    return query(sql, values) as readonly Row[];
  } };
}

describe('canonical standings exact contract and native adapter (offline unit evidence)', () => {
  it.each(['0', '-1', '0.0001', '-0.0001', '9007199254740991', '1' + '0'.repeat(308)])('accepts exact canonical decimal %s', value => {
    expect(isCanonicalDecimal(value)).toBe(true);
  });
  it.each(['-0', '-0.0', '+1', '01', '1.0', '.1', '1e3', 'NaN', 'Infinity', '1' + '0'.repeat(1024)])('rejects noncanonical decimal %s', value => {
    expect(isCanonicalDecimal(value)).toBe(false);
  });
  it('preserves the original native projector including tiny/huge decimals and state distinctions', () => {
    const source = normalized([
      { roster_id: 1, settings: { ...settings, fpts: 0, fpts_decimal: 0, fpts_against: -3, fpts_against_decimal: 25, rank: null } },
      { roster_id: 2, settings: { wins: 0, losses: null, ties: '0', fpts: 5e-324, fpts_decimal: 5e-324, fpts_against: Number.MAX_VALUE } },
      { roster_id: 3, settings: { fpts: 1, fpts_decimal: null, fpts_against: 2, fpts_against_decimal: '3', seed: 0 } },
    ]);
    const legacy = projectOfficialStandings(source), common = projectSleeperCanonicalStandings(source, mapping, policy);
    expect(common.status).toBe(legacy.status);
    for (const [index, team] of legacy.teams.entries()) {
      expect(common.teams[index].pointsFor).toEqual({ state: team.pointsFor.state, value: team.pointsFor.value });
      expect(common.teams[index].pointsAgainst).toEqual({ state: team.pointsAgainst.state, value: team.pointsAgainst.value });
      expect(common.teams[index].providerRank).toEqual({ state: team.providerRank.state, value: team.providerRank.value });
      expect(common.teams[index].providerSeed).toEqual({ state: team.providerSeed.state, value: team.providerSeed.value });
    }
    expect(common.teams[0].pointsFor.value).toBe('0'); expect(common.teams[0].pointsAgainst.value).toBe('-2.75');
    expect(common.teams[1].record).toEqual({ wins: { state: 'known', value: 0 }, losses: { state: 'null', value: null }, ties: { state: 'invalid', value: null } });
    expect(() => assertCanonicalStandingsValue(common, mapping, policy)).not.toThrow();
  });
  it.each([
    ['null', null, 'unknown', 'standings_population_unproved'], ['zero', 0, 'unknown', 'standings_population_unproved'],
    ['invalid', '1', 'unknown', 'standings_population_unproved'], ['match', 1, 'full', null],
    ['mismatch', 2, 'subset', 'standings_population_mismatch'],
  ] as const)('keeps %s population explicit without changing facts', (_name, total, entitySet, reason) => {
    const input = normalized(), facts = projectSleeperCanonicalStandings(input, mapping, policy);
    const coverage = sleeperCanonicalStandingsCoverage(input, facts, population(total));
    expect(coverage.entitySet).toBe(entitySet); expect(coverage.fields).toEqual(['losses', 'pointsAgainst', 'pointsFor', 'ties', 'wins']);
    if (reason) expect(coverage.reasons).toContain(reason);
  });
  it('keeps invalid and capacity captures unknown even with partial or mismatched population', () => {
    for (const payload of [[{ roster_id: null }], Array.from({ length: 21 }, (_, index) => ({ roster_id: index + 1 }))]) {
      const input = normalized(payload, 'partial'), facts = projectSleeperCanonicalStandings(input, mapping, policy);
      const coverage = sleeperCanonicalStandingsCoverage(input, facts, population(1));
      expect(facts.teams).toEqual([]); expect(coverage).toMatchObject({ entitySet: 'unknown', fields: [], completeness: 'unknown' });
      expect(coverage.reasons).toContain('standings_capture_partial');
    }
    const empty = normalized([]), facts = projectSleeperCanonicalStandings(empty, mapping, policy);
    expect(sleeperCanonicalStandingsCoverage(empty, facts, population(1))).toMatchObject({ entitySet: 'subset', fields: [], completeness: 'partial' });
  });
  it('keeps the exact microsecond population reservation boundary and rejects unrelated witnesses', () => {
    const input = normalized(undefined, 'complete', undefined);
    const unwitnessed = { ...input, envelope: { ...input.envelope, provenance: { ...input.envelope.provenance, acquisition: undefined } } };
    const facts = projectSleeperCanonicalStandings(unwitnessed, mapping, policy);
    const proof = population(1, undefined, '2026-10-11T12:00:00.000001Z');
    const clean = { ...proof, envelope: { ...proof.envelope, provenance: { ...proof.envelope.provenance, acquisition: undefined } } };
    expect(sleeperCanonicalStandingsCoverage(unwitnessed, facts, clean, '2026-10-11T12:00:00.000001Z').entitySet).toBe('full');
    expect(sleeperCanonicalStandingsCoverage(unwitnessed, facts, clean, '2026-10-11T12:00:00.000002Z').entitySet).toBe('unknown');
    expect(sleeperCanonicalStandingsCoverage(normalized(), facts, population(1, { ...witness, dispatchNonce: id(98) })).entitySet).toBe('unknown');
  });
  it('rejects schema additions, altered states, unsafe integers, fabricated rank, duplicate/source-order identities', () => {
    const original = projectSleeperCanonicalStandings(normalized(), mapping, policy);
    const mutations: ((value: Record<string, unknown>) => void)[] = [
      value => { value.extra = true; }, value => { value.schemaVersion = 'unknown'; },
      value => { (value.teams as Record<string, unknown>[])[0].sourceOrdinal = 1; },
      value => { (value.teams as unknown[]).push((value.teams as unknown[])[0]); },
      value => { ((value.teams as Record<string, unknown>[])[0].sourceTeam as Record<string, unknown>).nativeNamespace = 'other'; },
      value => { (value.teams as Record<string, unknown>[])[0].pointsFor = { state: 'absent', value: '0' }; },
      value => { (value.teams as Record<string, unknown>[])[0].providerRank = { state: 'known', value: 0 }; },
      value => { ((value.teams as Record<string, unknown>[])[0].record as Record<string, unknown>).wins = { state: 'known', value: 9007199254740992 }; },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(original) as unknown as Record<string, unknown>; mutate(value);
      expect(() => assertCanonicalStandingsValue(value, mapping, policy)).toThrow();
    }
  });
  it('matches PostgreSQL JSONB framing for the byte ceiling, preserving opaque text', () => {
    expect(canonicalStandingsJsonbText({ bb: 2, a: ['é', 0], c: null })).toBe('{"a": ["é", 0], "c": null, "bb": 2}');
    const facts = projectSleeperCanonicalStandings(normalized(), mapping, policy);
    const base = canonicalStandingsBytes(facts), remaining = 1_048_576 - base;
    const team = { ...facts.teams[0], sourceTeam: { ...facts.teams[0].sourceTeam, nativeId: '1' + 'a'.repeat(remaining) } };
    const atLimit = { ...facts, teams: [team] };
    expect(canonicalStandingsBytes(atLimit)).toBe(1_048_576); expect(() => assertCanonicalStandingsValue(atLimit, mapping, policy)).not.toThrow();
    expect(() => assertCanonicalStandingsValue({ ...atLimit, teams: [{ ...team, sourceTeam: { ...team.sourceTeam, nativeId: team.sourceTeam.nativeId + 'a' } }] }, mapping, policy)).toThrow();
  });
  it('rejects mixed delivery mode, trust flags, wrong witness scope and submillisecond reversed chronology', () => {
    const delivery = bridge(); expect(() => assertCanonicalDelivery(delivery, policy)).not.toThrow();
    for (const changed of [{ ...delivery, verified: true }, { ...delivery, contractVersion: 'future' },
      { ...delivery, legacyInput: null }, { ...delivery, policy: { ...policy, nativeVerifierVersion: 'arbitrary_function' } },
      { ...delivery, provenance: { ...delivery.provenance, checkedAt: '2026-10-11T12:00:00.000002Z', normalizedAt: '2026-10-11T12:00:00.000001Z' } }]) {
      expect(() => assertCanonicalDelivery(changed, policy)).toThrow();
    }
    expect(() => assertCanonicalProvenance({ ...delivery.provenance, checkedAt: '2026-02-30T12:00:00Z' })).toThrow();
    expect(() => assertCanonicalProvenance({ ...delivery.provenance, captureId: 'ABCDEF00-0000-4000-8000-000000000024' })).toThrow();
    expect(selectCanonicalStandingsCapture(legacyMapping, witness.work)).toBeNull();
  });
  it('submits once through the existing writer and preserves actual native completion IDs', async () => {
    const delivery = bridge(), legacyResult = { status: 'changed', observationId: id(60), rosterAcceptance: { status: 'accepted', receiptId: id(61), acceptedGeneration: 1 } };
    let calls = 0;
    const methods = canonicalStandingsMethods(database((sql, values) => {
      calls++; expect(sql).toContain('public.record_league_administration_observation');
      expect(JSON.parse(String(values[0]))).toEqual(delivery);
      return [{ result: { status: 'recorded', receiptId: id(62), contentId: id(63), attemptId: attempt.id,
        acceptanceId: id(64), acceptedGeneration: 1, outcome: 'accepted', legacyResult } }];
    }));
    const result = await methods.recordCanonicalObservation(delivery, mapping, attempt, fence);
    expect(calls).toBe(1); expect(result.legacyResult).toBe(legacyResult);
  });
  it('uses the original sealed capture and unchanged legacy result in existing runtime composition', async () => {
    const delivery = bridge(), original = sealPublicCapture({ family: 'rosters' as const, week: null, origin: 'network' as const,
      requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, payload: delivery.nativePayload, acquisition: witness }, witness);
    const nativeResult = { status: 'changed' as const, observationId: id(60), rosterAcceptance: { status: 'accepted' as const, receiptId: id(61), acceptedGeneration: 1 } };
    const nativeWrite = vi.fn(), canonicalWrite = vi.fn<NonNullable<LeagueAdministrationStore['recordCanonicalObservation']>>(async () => ({ status: 'recorded' as const, receiptId: id(62), contentId: id(63),
      attemptId: attempt.id, acceptanceId: id(64), acceptedGeneration: 1, outcome: 'accepted' as const, legacyResult: nativeResult }));
    const store = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
      recordObservation: nativeWrite, recordCanonicalObservation: canonicalWrite };
    const options = { store, now: () => new Date(at), fence, mapping: legacyMapping, rosterAttempt: nativeAttempt,
      expectedAcquisition: witness, canonicalStandings: { mapping, policy, attempt, captureId: id(24) } };
    const result = await recordCapturedAdministration(legacyMapping.scope, [original], options);
    expect(nativeWrite).not.toHaveBeenCalled(); expect(canonicalWrite).toHaveBeenCalledTimes(1);
    expect(result.results[0].result).toBe(nativeResult);
    expect(canonicalWrite.mock.calls[0]?.[0]).toBeDefined();
    await expect(recordCapturedAdministration(legacyMapping.scope, [{ ...original }], options)).rejects.toThrow('Original public transport capture');
    expect(Object.keys(witness.attempts).sort()).toEqual(['managers', 'players', 'settings']);
  });
  it('reserves the selected companion before native players without adding requests or checkpoint IDs', async () => {
    const selection = vi.spyOn(deploymentPolicy, 'selectCanonicalStandingsCapture').mockReturnValue(policy);
    const order: string[] = [];
    const completeCore = vi.fn<PublicIntakeStore['completeCore']>();
    const nativeResult = { status: 'changed' as const, observationId: id(60),
      rosterAcceptance: { status: 'accepted' as const, receiptId: id(61), acceptedGeneration: 1 },
      teamManagerAcceptance: { status: 'accepted' as const, receiptId: id(62), acceptedGeneration: 1 } };
    const administration: LeagueAdministrationStore = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
      readSourceMapping: async () => legacyMapping,
      readCanonicalSourceMapping: async () => ({ status: 'available', mapping }),
      beginCanonicalResourceAttempt: async () => { order.push('canonical'); return attempt; },
      beginRosterCapture: async () => { order.push('players'); return { players: nativeAttempt,
        managers: { ...nativeAttempt, id: id(19), scopeId: id(40) } }; },
      beginLeagueSettingsAttempt: async () => ({ ...nativeAttempt, id: id(17), scopeId: id(41) }),
      recordObservation: async () => ({ status: 'changed', observationId: id(70),
        leagueSettingsAcceptance: { status: 'accepted', receiptId: id(71), acceptedGeneration: 1 } }),
      recordCanonicalObservation: async delivery => {
        expect(Object.keys(delivery.provenance.acquisition)).toContain('attempts');
        return { status: 'recorded', receiptId: id(80), contentId: id(81), attemptId: attempt.id,
          acceptanceId: id(82), acceptedGeneration: 1, outcome: 'accepted', legacyResult: nativeResult };
      } };
    const intake: PublicIntakeStore = { submit: vi.fn(), recover: vi.fn(), next: async () => witness.work, admit: async () => true,
      recordIdentity: vi.fn(), recordLeagues: vi.fn(), register: vi.fn(), completeCore, completeExactPeriod: vi.fn(), fail: vi.fn(),
      captureWitness: async (_work, _mapping, actualFence) => ({ ...witness, fence: actualFence }) };
    const core = vi.fn<NonNullable<PublicIntakeDependencies['source']>['core']>(async (_id, family, _signal, actualWitness) => {
      order.push(`request:${family}`);
      return sealPublicCapture({ family, week: null, origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at,
        sourceObservedAt: at, acquisition: actualWitness, payload: family === 'league' ? { league_id: mapping.scope.externalLeagueId,
          name: 'Official test', sport: 'nfl', season: '2026', total_rosters: 1, roster_positions: ['QB'], scoring_settings: {}, settings: {} }
          : [{ roster_id: 1, settings }] }, actualWitness);
    });
    try {
      const result = await runPublicIntakeStep(id(10), { administration, intake, now: () => new Date(at), source: {
        core, identity: vi.fn(async () => { throw new Error('unexpected identity request'); }),
        leagues: vi.fn(async () => { throw new Error('unexpected league list request'); }) }, jobs: {
        acquireJob: async () => ({ kind: 'acquired', attempt: 2, leaseUntil: '2026-10-11T12:00:25.000Z' }),
        completeJob: async () => true, failJob: vi.fn(async () => true) } }, new AbortController().signal);
      expect(result).toEqual({ status: 'progress', resource: 'core', providerRequests: 2 });
      expect(order).toEqual(['canonical', 'players', 'request:league', 'request:rosters']);
      expect(completeCore.mock.calls[0]?.[2]).toEqual({ observations: { league: id(70), rosters: id(60) },
        receipts: { settings: id(71), players: id(61), managers: id(62) } });
      expect(core).toHaveBeenCalledTimes(2);
    } finally { selection.mockRestore(); }
  });
});

/** Hand-built rows test decoder failures only; they are explicitly not PostgreSQL or provider qualification. */
function standaloneRows() {
  const scoped = { ...mapping, scope: { ...mapping.scope, provider: 'fixture-standings', nativeNamespace: 'clubs:2026', externalLeagueId: 'League:A B' }, sourceNamespace: 'season:2026' };
  const fixturePolicy: CanonicalStandingsPolicy = { ...policy, provider: 'fixture-standings', nativeKind: 'fixture-standings', teamNamespace: 'team:opaque',
    adapterVersion: 'fixture-standings-adapter-v1', nativeVerifierVersion: 'fixture-standings-sql-v1', canonicalNormalizerVersion: 'fixture-standings-canonical-v1', originPolicy: 'fixture-v1' };
  const resolve = (candidate: typeof mapping, recorded?: unknown) => {
    if (!canonicalEqual(candidate, scoped) || recorded !== undefined && !canonicalEqual(recorded, fixturePolicy)) throw new Error('Unknown isolated unit policy');
    return fixturePolicy;
  };
  const prototype = projectSleeperCanonicalStandings(normalized(), mapping, policy);
  const facts: CanonicalStandingsValue = { ...prototype, teams: [{ ...prototype.teams[0], sourceTeam: {
    ...prototype.teams[0].sourceTeam, provider: 'fixture-standings' as typeof prototype.teams[0]['sourceTeam']['provider'],
    nativeNamespace: 'team:opaque', nativeId: ' club:ABC-7 ' } }] };
  const sourceDigest = `sha256:${'a'.repeat(64)}`, coverage = { ...sleeperCanonicalStandingsCoverage(normalized(), prototype, population(1)) };
  const sourceRef = { kind: 'fixture-standalone-v1', fixtureId: 'opaque-teams', fixtureRevision: '1', sourceDigest };
  const context = { version: 'canonical-fixture-reservation-v1', jobType: 'canonical-fixture-standings-v1', fixturePolicyVersion: 'isolated-unit-v1',
    policy: fixturePolicy, sourceLeague: { provider: scoped.scope.provider, resourceKind: 'league', nativeNamespace: scoped.scope.nativeNamespace, nativeId: scoped.scope.externalLeagueId },
    intendedLeagueKey: scoped.scope.leagueKey, season: 2026, registrationDigest: sourceDigest, standingsDigest: sourceDigest };
  const row = { scope_row: { id: attempt.scopeId, connection_id: scoped.connectionId, league_season_id: scoped.leagueSeasonId,
      identity: { scope: canonicalStandingsScope(scoped), policy: fixturePolicy } },
    attempt_row: { id: attempt.id, scope_id: attempt.scopeId, ordinal: 1, expected_generation: 0, capture_nonce: attempt.nonce,
      source_mapping: scoped, write_fence: fence, reserved_at: at, canonical_reservation_context: context },
    head_row: { scope_id: attempt.scopeId, latest_ordinal: 1, generation: 1, accepted_id: id(30) },
    receipt_row: { id: id(31), attempt_id: attempt.id, scope_id: attempt.scopeId, connection_id: scoped.connectionId,
      league_season_id: scoped.leagueSeasonId, content_id: id(32), source_mapping: scoped, coverage, expected_team_count: 1,
      population: 'proven', record_completeness: 'complete', qualification: 'qualified', outcome: 'accepted', reasons: [],
      evidence_version: 'league-one-jsonb-sha256-v1', evidence_hash: sourceDigest, capture_transaction: '1',
      legacy_roster_receipt_id: null, population_evidence: null, native_source_ref: sourceRef,
      provenance: { captureId: id(33), origin: 'fixture', requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null,
        checkedAt: at, normalizedAt: at, sourceUpdatedAt: null, nativeRevision: null,
        acquisition: { version: 'canonical-fixture-capture-v1', jobKey: fence.jobKey, generation: fence.generation,
          attemptId: attempt.id, nonce: attempt.nonce, sourceDigest } } },
    content_row: { id: id(32), connection_id: scoped.connectionId, league_season_id: scoped.leagueSeasonId, provider: scoped.scope.provider,
      source_league_namespace: scoped.scope.nativeNamespace, external_league_id: scoped.scope.externalLeagueId, source_namespace: scoped.sourceNamespace,
      family: 'standings', first_receipt_id: id(31), capture_transaction: '1', native_kind: fixturePolicy.nativeKind,
      canonical_schema_version: fixturePolicy.canonicalSchemaVersion, adapter_version: fixturePolicy.adapterVersion,
      native_verifier_version: fixturePolicy.nativeVerifierVersion, canonical_normalizer_version: fixturePolicy.canonicalNormalizerVersion,
      hash_version: fixturePolicy.hashVersion, native_hash: sourceDigest, canonical_hash: sourceDigest, canonical_value: facts,
      native_payload: { leagueKey: 'League:A B', seasonTag: '2026', teamTotal: 1, page: { complete: true, next: null }, entries: [{ clubKey: ' club:ABC-7 ' }] } },
    first_receipt_row: { id: id(31), content_id: id(32), connection_id: scoped.connectionId, league_season_id: scoped.leagueSeasonId, capture_transaction: '1' },
    acceptance_row: { id: id(30), scope_id: attempt.scopeId, receipt_id: null, canonical_receipt_id: id(31), source_mapping_revision_id: scoped.revisionId, generation: 1 },
    revision_row: { id: scoped.revisionId, connection_id: scoped.connectionId, league_season_id: scoped.leagueSeasonId, generation: 1,
      provider: scoped.scope.provider, native_namespace: scoped.scope.nativeNamespace, external_league_id: scoped.scope.externalLeagueId, source_namespace: scoped.sourceNamespace },
    typed_value: facts, native_hash_matches: true, canonical_hash_matches: true, evidence_hash_matches: true, legacy_bridge: null,
    identities: [{ sourceTeam: facts.teams[0].sourceTeam, seasonTeamId: id(34), contentId: id(32), leagueSeasonId: scoped.leagueSeasonId,
      sourceLeagueNamespace: scoped.scope.nativeNamespace, externalLeagueId: scoped.scope.externalLeagueId,
      identity: { id: id(34), league_season_id: scoped.leagueSeasonId, provider: scoped.scope.provider, source_league_namespace: scoped.scope.nativeNamespace,
        external_league_id: scoped.scope.externalLeagueId, native_namespace: facts.teams[0].sourceTeam.nativeNamespace, external_roster_id: facts.teams[0].sourceTeam.nativeId } }] };
  return { row, scoped, resolve };
}
const current: CanonicalStandingsSelection = { kind: 'current', representation: 'canonical-v1' };
describe('common stored standings reader (offline decoder evidence)', () => {
  it('reads standalone opaque teams without a legacy roster receipt or native Sleeper parsing', () => {
    const f = standaloneRows(); const read = readCanonicalOfficialStandingsRows([f.row], f.scoped, current, f.resolve);
    expect(read).toMatchObject({ status: 'available', receipt: { legacyRosterReceiptId: null }, teams: [{ seasonTeamId: id(34), sourceTeam: { nativeId: ' club:ABC-7 ' } }] });
    expect(readCanonicalOfficialStandingsRows([f.row], f.scoped, current)).toMatchObject({ status: 'unavailable' });
    expect(() => resolveCanonicalStandingsPolicy(f.scoped, f.row.scope_row.identity.policy)).toThrow();
  });
  it('never substitutes an old head after a newer pending attempt or a conflicting receipt', () => {
    const f = standaloneRows();
    expect(readCanonicalOfficialStandingsRows([{ ...f.row, receipt_row: null }], f.scoped, current, f.resolve)).toMatchObject({ status: 'unavailable', reason: 'pending' });
    const conflicting = { ...f.row, receipt_row: { ...f.row.receipt_row, outcome: 'preserved-conflict', reasons: ['source-time-conflict'] }, acceptance_row: null };
    expect(readCanonicalOfficialStandingsRows([conflicting], f.scoped, current, f.resolve)).toMatchObject({ status: 'unavailable', reason: 'source-time-conflict' });
    expect(readCanonicalOfficialStandingsRows([conflicting], f.scoped, { kind: 'receipt', representation: 'canonical-v1', receiptId: id(31) }, f.resolve))
      .toMatchObject({ status: 'available', receipt: { acceptedGeneration: null, outcome: 'preserved-conflict' } });
  });
  it('does not turn a matching declared count into independent population proof', () => {
    const f = standaloneRows();
    const coverage = { ...f.row.receipt_row.coverage, entitySet: 'unknown', completeness: 'partial', reasons: ['standings_population_unproved'] };
    const row = { ...f.row, receipt_row: { ...f.row.receipt_row, population: 'unproved', coverage, reasons: coverage.reasons } };
    expect(readCanonicalOfficialStandingsRows([row], f.scoped, current, f.resolve))
      .toMatchObject({ status: 'available', expectedTeamCount: 1, population: 'unproved', coverage: { entitySet: 'unknown', completeness: 'partial' } });
  });
  it('rejects typed mutation, foreign parent/source identities, missing closure and mismatched digests', () => {
    const f = standaloneRows();
    for (const row of [{ ...f.row, typed_value: { ...f.row.typed_value, teams: [] } }, { ...f.row, identities: [] },
      { ...f.row, identities: [{ ...f.row.identities[0], identity: { ...f.row.identities[0].identity, native_namespace: 'wrong' } }] },
      { ...f.row, first_receipt_row: { ...f.row.first_receipt_row, content_id: id(99) } }, { ...f.row, evidence_hash_matches: false },
      { ...f.row, canonical_hash_matches: false }, { ...f.row, native_hash_matches: false },
      { ...f.row, revision_row: { ...f.row.revision_row, external_league_id: 'another' } }]) {
      expect(readCanonicalOfficialStandingsRows([row], f.scoped, current, f.resolve)).toMatchObject({ status: 'unavailable', reason: 'canonical-standings-evidence-unavailable' });
    }
  });
  it('uses a bounded historical legacy revision query without changing the old API query', async () => {
    expect(OFFICIAL_STANDINGS_SQL).toContain('connection.current_mapping_revision_id=$2');
    expect(HISTORICAL_OFFICIAL_STANDINGS_SQL).not.toContain('connection.current_mapping_revision_id=$2');
    expect(HISTORICAL_OFFICIAL_STANDINGS_SQL).toContain("revision.native_namespace='nfl'");
    expect(HISTORICAL_OFFICIAL_STANDINGS_SQL).toContain('LIMIT 2');
    const seen: string[] = [], methods = canonicalStandingsMethods(database(sql => { seen.push(sql); return []; }));
    await methods.readCanonicalOfficialStandings(mapping, { kind: 'receipt', representation: 'legacy-sleeper-v1', receiptId: id(31) });
    await methods.readCanonicalOfficialStandings(mapping, { kind: 'current', representation: 'legacy-sleeper-v1' });
    expect(seen).toEqual([HISTORICAL_OFFICIAL_STANDINGS_SQL, OFFICIAL_STANDINGS_SQL]);
    expect(CANONICAL_OFFICIAL_STANDINGS_SQL).toContain('attempt.ordinal=head.latest_ordinal');
  });
  it('selects registered fixture policy through deployment composition and never falls back across representations', async () => {
    const f = standaloneRows(); let calls = 0;
    const methods = canonicalStandingsMethods(database(sql => { calls++; expect(sql).toBe(CANONICAL_OFFICIAL_STANDINGS_SQL); return [f.row]; }), f.resolve);
    expect(await methods.readCanonicalOfficialStandings(f.scoped, current)).toMatchObject({ status: 'available' });
    expect(calls).toBe(1);
  });
});

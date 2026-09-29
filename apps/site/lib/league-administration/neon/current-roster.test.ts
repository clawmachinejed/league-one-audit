import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../../aggregator/current-roster';
import type { AdministrationEnvelope, JsonObject } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { currentRosterMethods } from './current-roster';

vi.mock('server-only', () => ({}));

const ids = {
  connection: '10000000-0000-4000-8000-000000000001',
  season: '20000000-0000-4000-8000-000000000001',
  revision: '30000000-0000-4000-8000-000000000001',
  scope: '40000000-0000-4000-8000-000000000001',
  attempt: '50000000-0000-4000-8000-000000000001',
  receipt: '60000000-0000-4000-8000-000000000001',
  content: '70000000-0000-4000-8000-000000000001',
  configuration: '80000000-0000-4000-8000-000000000001',
  legacyObservation: '90000000-0000-4000-8000-000000000001',
  teamOne: 'a0000000-0000-4000-8000-000000000001',
  teamTwo: 'a0000000-0000-4000-8000-000000000002',
  different: 'b0000000-0000-4000-8000-000000000001',
};
const mapping: AdministrationSourceMapping = {
  connectionId: ids.connection, leagueSeasonId: ids.season, revisionId: ids.revision, generation: 3,
  scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'fixture-source', season: 2026 },
};
const provenance: AdministrationEnvelope['provenance'] = {
  origin: 'network', requestStartedAt: '2026-09-25T12:00:00.000Z',
  requestCompletedAt: '2026-09-25T12:00:01.000Z', sourceObservedAt: '2026-09-25T12:00:01.000Z',
  checkedAt: '2026-09-25T12:00:02.000Z',
};
const payload: readonly JsonObject[] = [{ roster_id: 7, players: ['001', 'DEF'] }, { roster_id: 12, players: [], reserve: null }];
const coverage = { periodIds: [], interval: null, entitySet: 'full', fields: ['players'],
  pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] };

function storedRow(raw: AdministrationEnvelope['payload'] = payload) {
  const normalized = normalizeAdministrationObservation({
    schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: mapping.scope, family: 'rosters', week: null, completeness: 'complete', provenance, payload: raw,
  }, { expectedRosterCount: 2 });
  return {
    identity: { scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY },
    scope_id: ids.scope, generation: 2, source_mapping_revision_id: ids.revision,
    receipt_id: ids.receipt, attempt_id: ids.attempt, provenance,
    configuration_content_id: ids.configuration, expected_team_count: 2,
    legacy_observation_id: ids.legacyObservation, coverage, ordinal: 5, source_mapping: mapping,
    content_id: ids.content, content_hash: normalized.contentHash, payload: raw, normalized_value: normalized.value,
    normalizer_version: 'sleeper-administration-v1', completeness: 'complete', league_season_id: ids.season,
    provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId,
    identities: [{ seasonTeamId: ids.teamTwo, externalRosterId: '12' }, { seasonTeamId: ids.teamOne, externalRosterId: '7' }],
  };
}

function database(respond: (sql: string, parameters: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) {
    return respond(sql, parameters) as readonly Row[];
  } };
}

function read(row: DatabaseRow, requestedMapping = mapping) {
  return currentRosterMethods(database(() => [row])).readAcceptedCurrentRoster(requestedMapping);
}

describe('current roster shadow Neon adapter', () => {
  it('reads held players using retained team UUIDs and preserves explicit empty membership without reserve or taxi', async () => {
    const result = await read(storedRow());
    expect(result).toMatchObject({ status: 'available', accepted: {
      scope: currentRosterScope(mapping), canonicalNormalizerVersion: 'sleeper-current-players-v1',
      sourceMappingRevisionId: ids.revision, contentId: ids.content, observationIds: [ids.receipt],
      validationVersion: 'latest-network-attempt-v1', acceptedGeneration: 2,
      verifiedAt: provenance.sourceObservedAt, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown',
    }, teams: [
      { seasonTeamId: ids.teamOne, externalRosterId: '7', players: [
        { seasonTeamId: ids.teamOne, sourceTeam: { provider: 'sleeper', resourceKind: 'team',
          nativeNamespace: '["nfl",2026,"fixture-source"]', nativeId: '7' },
        sourceEntity: { provider: 'sleeper', resourceKind: 'scoring-entity', nativeNamespace: 'nfl', nativeId: '001' },
        canonicalEntityId: null, identityState: 'unresolved', nativeSection: 'players', section: 'roster',
        effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' },
        { sourceEntity: { nativeId: 'DEF' } },
      ] },
      { seasonTeamId: ids.teamTwo, externalRosterId: '12', players: [] },
    ] });
  });

  it('returns exact receipt provenance separately from the legacy deduplicated observation and never restamps it', async () => {
    const row = storedRow();
    const first = await read(row);
    const second = await read(row);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ status: 'available', accepted: { observationIds: [ids.receipt],
      verifiedAt: provenance.sourceObservedAt }, receipt: { id: ids.receipt, attemptId: ids.attempt,
      ordinal: 5, provenance, configurationContentId: ids.configuration, expectedTeamCount: 2,
      legacyObservationId: ids.legacyObservation } });
    expect(ids.receipt).not.toBe(ids.legacyObservation);
  });

  it('handles JSONB key ordering and bigint strings without changing captured identity', async () => {
    const reorderedMapping = { scope: { season: 2026, externalLeagueId: 'fixture-source', provider: 'sleeper', leagueKey: 'league1' },
      generation: 3, revisionId: ids.revision, leagueSeasonId: ids.season, connectionId: ids.connection };
    const result = await read({ ...storedRow(), source_mapping: reorderedMapping, generation: '2', ordinal: '5',
      coverage: { reasons: [], completeness: 'complete', nextCursor: null, pagination: 'complete',
        fields: ['players'], entitySet: 'full', interval: null, periodIds: [] } });
    expect(result).toMatchObject({ status: 'available', accepted: { acceptedGeneration: 2 }, receipt: { ordinal: 5 } });
  });

  it.each([
    ['missing network request times', { ...provenance, requestStartedAt: null, requestCompletedAt: null }],
    ['missing source observation time', { ...provenance, sourceObservedAt: null }],
    ['all unknown acquisition times', { ...provenance, requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null }],
    ['cache origin', { ...provenance, origin: 'cache' }],
  ])('refuses to invent exact network evidence for %s', async (_label, receiptProvenance) => {
    expect(await read({ ...storedRow(), provenance: receiptProvenance })).toMatchObject({ status: 'unavailable' });
  });

  it('passes the qualified scope, policy and exact mapping revision to the read query', async () => {
    const query = vi.fn(() => [storedRow()]);
    const methods = currentRosterMethods(database(query));
    expect(await methods.readAcceptedCurrentRoster(mapping)).toMatchObject({ status: 'available' });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(sql).toContain('league-administration:read-accepted-current-roster');
    expect(JSON.parse(String(parameters[0]))).toEqual({ scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY });
    expect(parameters.slice(1)).toEqual([ids.revision, 3]);
  });

  const mappingChanges: { label: string; change: (value: AdministrationSourceMapping) => AdministrationSourceMapping }[] = [
    { label: 'league key', change: value => ({ ...value, scope: { ...value.scope, leagueKey: 'league2' } }) },
    { label: 'season', change: value => ({ ...value, scope: { ...value.scope, season: 2025 } }) },
    { label: 'provider', change: value => ({ ...value, scope: { ...value.scope, provider: 'yahoo' as never } }) },
    { label: 'native league', change: value => ({ ...value, scope: { ...value.scope, externalLeagueId: 'another-source' } }) },
    { label: 'connection UUID', change: value => ({ ...value, connectionId: ids.different }) },
    { label: 'season UUID', change: value => ({ ...value, leagueSeasonId: ids.different }) },
    { label: 'mapping revision', change: value => ({ ...value, revisionId: ids.different }) },
    { label: 'mapping generation', change: value => ({ ...value, generation: 4 }) },
  ];
  it.each(mappingChanges)('refuses caller $label substitution instead of relabeling the receipt', async ({ change }) => {
    expect(await read(storedRow(), change(mapping))).toMatchObject({ status: 'unavailable' });
  });
  it.each(mappingChanges)('refuses contradictory captured $label evidence', async ({ change }) => {
    expect(await read({ ...storedRow(), source_mapping: change(mapping) })).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['public audience', { ...CURRENT_ROSTER_POLICY, audienceId: 'private' }],
    ['coverage specification', { ...CURRENT_ROSTER_POLICY, coverageSpecId: 'players-subset' }],
    ['canonical normalizer', { ...CURRENT_ROSTER_POLICY, canonicalNormalizerVersion: 'unqualified-v2' }],
    ['acceptance policy', { ...CURRENT_ROSTER_POLICY, validationVersion: 'unqualified-v2' }],
  ])('refuses an unqualified stored %s', async (_label, policy) => {
    expect(await read({ ...storedRow(), identity: { scope: currentRosterScope(mapping), policy } }))
      .toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['subset entities', { ...coverage, entitySet: 'subset' }],
    ['other fields', { ...coverage, fields: ['reserve'] }],
    ['partial completeness', { ...coverage, completeness: 'partial' }],
    ['unfinished pagination', { ...coverage, pagination: 'continuation', nextCursor: 'next' }],
    ['period-limited inventory', { ...coverage, periodIds: [ids.different] }],
    ['missing field declaration', { ...coverage, fields: undefined }],
  ])('refuses complete replacement evidence with %s', async (_label, observedCoverage) => {
    expect(await read({ ...storedRow(), coverage: observedCoverage })).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['missing players', [{ roster_id: 7 }, payload[1]]],
    ['null players', [{ roster_id: 7, players: null }, payload[1]]],
    ['partial population', [payload[0]]],
    ['duplicate roster identities', [payload[0], payload[0]]],
    ['duplicate player membership', [{ roster_id: 7, players: ['001', '001'] }, payload[1]]],
  ] as const)('refuses %s even when raw content has a matching hash', async (_label, raw) => {
    expect(await read(storedRow(raw))).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['missing team', [{ seasonTeamId: ids.teamOne, externalRosterId: '7' }]],
    ['repeated roster alias', [{ seasonTeamId: ids.teamOne, externalRosterId: '7' }, { seasonTeamId: ids.teamTwo, externalRosterId: '7' }]],
    ['repeated team UUID', [{ seasonTeamId: ids.teamOne, externalRosterId: '7' }, { seasonTeamId: ids.teamOne, externalRosterId: '12' }]],
    ['unmatched roster alias', [{ seasonTeamId: ids.teamOne, externalRosterId: '7' }, { seasonTeamId: ids.teamTwo, externalRosterId: '99' }]],
  ])('refuses incomplete team lineage: %s', async (_label, identities) => {
    expect(await read({ ...storedRow(), identities })).toMatchObject({ status: 'unavailable' });
  });

  it('refuses content hash corruption and foreign accepted mapping lineage', async () => {
    expect(await read({ ...storedRow(), content_hash: 'sha256:' + '0'.repeat(64) })).toMatchObject({ status: 'unavailable' });
    expect(await read({ ...storedRow(), source_mapping_revision_id: ids.different })).toMatchObject({ status: 'unavailable' });
  });

  it('distinguishes missing acceptance from ambiguous rows and database failure', async () => {
    expect(await currentRosterMethods(database(() => [])).readAcceptedCurrentRoster(mapping)).toEqual({ status: 'missing' });
    expect(await currentRosterMethods(database(() => [storedRow(), storedRow()])).readAcceptedCurrentRoster(mapping))
      .toMatchObject({ status: 'unavailable' });
    expect(await currentRosterMethods(database(() => { throw new Error('offline'); })).readAcceptedCurrentRoster(mapping))
      .toMatchObject({ status: 'unavailable' });
  });

  it('reserves the exact qualified network scope with the worker fence and decodes database ordinals', async () => {
    const fence = { jobKey: 'maintenance', workerId: 'worker-one', generation: 8, deadlineAt: '2026-09-25T12:01:00.000Z' };
    const query = vi.fn(() => [{ result: { id: ids.attempt, scopeId: ids.scope, ordinal: '5', expectedGeneration: '2' } }]);
    const result = await currentRosterMethods(database(query)).beginRosterAttempt(mapping, ids.attempt, CURRENT_ROSTER_POLICY, fence);
    expect(result).toEqual({ id: ids.attempt, scopeId: ids.scope, ordinal: 5, expectedGeneration: 2 });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(sql).toContain('public.begin_current_roster_attempt');
    expect(parameters.map((value, index) => index === 1 ? value : JSON.parse(String(value))))
      .toEqual([mapping, ids.attempt, currentRosterScope(mapping), CURRENT_ROSTER_POLICY, fence]);
  });

  it('sends a null fence for unleased verification and permits initial generation zero', async () => {
    const query = vi.fn(() => [{ result: { id: ids.attempt, scopeId: ids.scope, ordinal: 1, expectedGeneration: 0 } }]);
    expect(await currentRosterMethods(database(query)).beginRosterAttempt(mapping, ids.attempt))
      .toMatchObject({ ordinal: 1, expectedGeneration: 0 });
    expect((query.mock.calls[0] as unknown as [string, readonly unknown[]])[1][4]).toBeNull();
  });

  it('rejects invalid mappings before querying and rejects malformed reservation replies', async () => {
    const query = vi.fn(() => []);
    await expect(currentRosterMethods(database(query)).beginRosterAttempt({ ...mapping, generation: 0 }, ids.attempt)).rejects.toThrow();
    expect(await currentRosterMethods(database(query)).readAcceptedCurrentRoster({ ...mapping, generation: 0 }))
      .toEqual({ status: 'unavailable', reason: 'invalid_mapping' });
    expect(query).not.toHaveBeenCalled();
    for (const rows of [[], [{ result: { id: ids.attempt, scopeId: ids.scope, ordinal: 0, expectedGeneration: 0 } }],
      [{ result: { id: ids.attempt, scopeId: ids.scope, ordinal: 1, expectedGeneration: -1 } }]]) {
      await expect(currentRosterMethods(database(() => rows)).beginRosterAttempt(mapping, ids.attempt)).rejects.toThrow();
    }
  });

  it('keeps disabled persistence from inspecting inputs or fabricating an attempt', async () => {
    const unreadable = new Proxy({} as AdministrationSourceMapping, { get() { throw new Error('must not inspect'); } });
    const store = createLeagueAdministrationStore({ enabled: false, reason: 'preview-persistence-disabled' });
    expect(await store.readAcceptedCurrentRoster(unreadable)).toEqual({ status: 'disabled' });
    await expect(store.beginRosterAttempt(unreadable, ids.attempt)).rejects.toThrow('Administration persistence disabled');
  });
});

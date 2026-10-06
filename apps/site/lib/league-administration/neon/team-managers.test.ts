import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../../aggregator/current-roster';
import { TEAM_MANAGERS_POLICY, teamManagersScope } from '../../aggregator/team-managers';
import type { AdministrationEnvelope, JsonObject } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { teamManagerMethods } from './team-managers';

vi.mock('server-only', () => ({}));

const ids = {
  connection: '10000000-0000-4000-8000-000000000001', season: '20000000-0000-4000-8000-000000000001',
  revision: '30000000-0000-4000-8000-000000000001', playersScope: '40000000-0000-4000-8000-000000000001',
  managersScope: '40000000-0000-4000-8000-000000000002', playersAttempt: '50000000-0000-4000-8000-000000000001',
  managersAttempt: '50000000-0000-4000-8000-000000000002', receipt: '60000000-0000-4000-8000-000000000001',
  content: '70000000-0000-4000-8000-000000000001', configuration: '80000000-0000-4000-8000-000000000001',
  legacyObservation: '90000000-0000-4000-8000-000000000001', teamOne: 'a0000000-0000-4000-8000-000000000001',
  teamTwo: 'a0000000-0000-4000-8000-000000000002', owner: 'b0000000-0000-4000-8000-000000000001',
  coOwner: 'b0000000-0000-4000-8000-000000000002', different: 'c0000000-0000-4000-8000-000000000001',
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
const payload: readonly JsonObject[] = [
  { roster_id: 7, owner_id: 'owner-001', co_owners: ['co-002'], players: [] },
  { roster_id: 12, owner_id: null, co_owners: [] },
];
const coverage = { periodIds: [], interval: null, entitySet: 'full', fields: ['owner_id'],
  pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] };
const ownerMembership = { seasonTeamId: ids.teamOne, providerManagerId: ids.owner, externalManagerId: 'owner-001', role: 'owner' };
const coMembership = { seasonTeamId: ids.teamOne, providerManagerId: ids.coOwner, externalManagerId: 'co-002', role: 'co_owner' };

function storedRow(raw: AdministrationEnvelope['payload'] = payload) {
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
    family: 'rosters', week: null, completeness: 'complete', provenance, payload: raw }, { expectedRosterCount: 2 });
  return {
    identity: { scope: teamManagersScope(mapping), policy: TEAM_MANAGERS_POLICY }, generation: 2,
    source_mapping_revision_id: ids.revision, receipt_id: ids.receipt, attempt_id: ids.managersAttempt, provenance,
    configuration_content_id: ids.configuration, expected_team_count: 2, legacy_observation_id: ids.legacyObservation,
    coverage, ordinal: 5, source_mapping: mapping, content_id: ids.content, content_hash: normalized.contentHash,
    payload: raw, normalizer_version: 'sleeper-administration-v1', completeness: 'complete', league_season_id: ids.season,
    provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId,
    identities: (normalized.teamManagers?.teams ?? []).map(team => ({
      seasonTeamId: team.externalRosterId === '7' ? ids.teamOne : ids.teamTwo, externalRosterId: team.externalRosterId, sourceValue: team,
    })), managers: [ownerMembership, coMembership],
  };
}
function database(respond: (sql: string, parameters: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) {
    return respond(sql, parameters) as readonly Row[];
  } };
}
function read(row: DatabaseRow, requestedMapping = mapping) {
  return teamManagerMethods(database(() => [row])).readAcceptedTeamManagers(requestedMapping);
}
function reservations() {
  return { players: { id: ids.playersAttempt, scopeId: ids.playersScope, ordinal: '5', expectedGeneration: '2' },
    managers: { id: ids.managersAttempt, scopeId: ids.managersScope, ordinal: '3', expectedGeneration: '0' } };
}

describe('team manager Neon reader', () => {
  it('reads source-qualified identities and exact receipt evidence without claiming website accounts or tenure', async () => {
    const result = await read(storedRow());
    expect(result).toEqual({ status: 'available', accepted: {
      scope: teamManagersScope(mapping), canonicalNormalizerVersion: TEAM_MANAGERS_POLICY.canonicalNormalizerVersion,
      sourceMappingRevisionId: ids.revision, contentId: ids.content, observationIds: [ids.receipt],
      validationVersion: 'latest-network-attempt-v1', acceptedGeneration: 2, verifiedAt: provenance.sourceObservedAt,
      effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown',
    }, receipt: { id: ids.receipt, attemptId: ids.managersAttempt, ordinal: 5, provenance,
      configurationContentId: ids.configuration, expectedTeamCount: 2, legacyObservationId: ids.legacyObservation },
    teams: [{ seasonTeamId: ids.teamOne,
      sourceTeam: { provider: 'sleeper', resourceKind: 'team', nativeNamespace: '["nfl",2026,"fixture-source"]', nativeId: '7' },
      primaryOwner: { state: 'owned', manager: { providerManagerId: ids.owner,
        sourceManager: { provider: 'sleeper', resourceKind: 'manager', nativeNamespace: 'account', nativeId: 'owner-001' } } },
      coManagers: { state: 'known', completeness: 'complete', sourceRefs: [ids.receipt], observedAt: provenance.sourceObservedAt,
        managers: [{ providerManagerId: ids.coOwner,
          sourceManager: { provider: 'sleeper', resourceKind: 'manager', nativeNamespace: 'account', nativeId: 'co-002' } }] },
      assurance: 'provider-observed', effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown',
    }, { seasonTeamId: ids.teamTwo,
      sourceTeam: { provider: 'sleeper', resourceKind: 'team', nativeNamespace: '["nfl",2026,"fixture-source"]', nativeId: '12' },
      primaryOwner: { state: 'unowned', manager: null },
      coManagers: { state: 'known', completeness: 'complete', sourceRefs: [ids.receipt], observedAt: provenance.sourceObservedAt, managers: [] },
      assurance: 'provider-observed', effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown',
    }] });
    expect(await read(storedRow())).toEqual(result);
  });

  it.each([
    ['null', { co_owners: null }, 'co_managers_null'],
    ['absent', {}, 'co_managers_absent'],
    ['malformed', { co_owners: {} }, 'co_managers_invalid'],
    ['duplicate', { co_owners: ['co-002', 'co-002'] }, 'co_managers_invalid'],
    ['owner collision', { co_owners: ['owner-001'] }, 'co_managers_invalid'],
  ] as const)('accepts primary ownership with %s co-manager evidence and never substitutes an empty list', async (_label, co, reason) => {
    const row = storedRow([{ roster_id: 7, owner_id: 'owner-001', ...co }, payload[1]]);
    expect(await read({ ...row, managers: [ownerMembership] })).toMatchObject({ status: 'available', teams: [
      { primaryOwner: { state: 'owned' }, coManagers: { state: 'unknown', completeness: 'unknown', managers: null,
        reason, sourceRefs: [ids.receipt], observedAt: provenance.sourceObservedAt } },
      { primaryOwner: { state: 'unowned' } },
    ] });
  });

  it('accepts manager evidence even when the legacy content rejects malformed players', async () => {
    const row = storedRow([{ ...payload[0], players: 'malformed' }, payload[1]]);
    expect(await read(row)).toMatchObject({ status: 'available', teams: [{ primaryOwner: { state: 'owned' } }, { primaryOwner: { state: 'unowned' } }] });
  });

  it('keeps preserved partial co-manager facts outside the complete-primary acceptance contract', async () => {
    const row = storedRow([{ ...payload[0], owner_id: {} }, payload[1]]);
    expect(row.identities[0].sourceValue).toMatchObject({
      primaryOwner: { state: 'unknown', externalManagerId: null },
      coManagers: { state: 'known', externalManagerIds: ['co-002'] },
    });
    // Even an invented receipt with a matching raw hash and only the evidenced
    // co-manager identity cannot claim the complete-primary v1 policy.
    expect(await read({ ...row, managers: [coMembership] })).toEqual({
      status: 'unavailable', reason: 'team_manager_evidence_unavailable',
    });
  });

  it('permits the same provider manager on multiple teams without merging the team identities', async () => {
    const row = storedRow([payload[0], { ...payload[1], owner_id: 'owner-001' }]);
    const result = await read({ ...row, managers: [...row.managers, { ...ownerMembership, seasonTeamId: ids.teamTwo }] });
    expect(result).toMatchObject({ status: 'available', teams: [
      { seasonTeamId: ids.teamOne, primaryOwner: { manager: { providerManagerId: ids.owner } } },
      { seasonTeamId: ids.teamTwo, primaryOwner: { manager: { providerManagerId: ids.owner } } },
    ] });
  });

  it('accepts a fully unowned population without inventing manager identities', async () => {
    const row = storedRow([{ roster_id: 7, owner_id: null, co_owners: [] }, payload[1]]);
    expect(await read({ ...row, managers: null })).toMatchObject({ status: 'available', teams: [
      { primaryOwner: { state: 'unowned', manager: null }, coManagers: { managers: [] } },
      { primaryOwner: { state: 'unowned', manager: null }, coManagers: { managers: [] } },
    ] });
  });

  it('queries only the exact public manager scope and mapping revision without a user-directory dependency', async () => {
    const query = vi.fn(() => [storedRow()]);
    await teamManagerMethods(database(query)).readAcceptedTeamManagers(mapping);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(sql).toContain('league-administration:read-accepted-team-managers');
    expect(sql).not.toMatch(/display_name|avatar|league_administration_managers|account_claim/i);
    expect(JSON.parse(String(parameters[0]))).toEqual({ scope: teamManagersScope(mapping), policy: TEAM_MANAGERS_POLICY });
    expect(parameters.slice(1)).toEqual([ids.revision, 3]);
  });

  const mappingChanges: { label: string; change: (value: AdministrationSourceMapping) => AdministrationSourceMapping }[] = [
    { label: 'league key', change: value => ({ ...value, scope: { ...value.scope, leagueKey: 'league2' } }) },
    { label: 'season', change: value => ({ ...value, scope: { ...value.scope, season: 2025 } }) },
    { label: 'provider', change: value => ({ ...value, scope: { ...value.scope, provider: 'yahoo' as never } }) },
    { label: 'native league', change: value => ({ ...value, scope: { ...value.scope, externalLeagueId: 'foreign' } }) },
    { label: 'connection UUID', change: value => ({ ...value, connectionId: ids.different }) },
    { label: 'season UUID', change: value => ({ ...value, leagueSeasonId: ids.different }) },
    { label: 'mapping revision', change: value => ({ ...value, revisionId: ids.different }) },
    { label: 'mapping generation', change: value => ({ ...value, generation: 4 }) },
  ];
  it.each(mappingChanges)('refuses requested $label substitution', async ({ change }) => {
    expect(await read(storedRow(), change(mapping))).toMatchObject({ status: 'unavailable' });
  });
  it.each(mappingChanges)('refuses contradictory stored $label evidence', async ({ change }) => {
    expect(await read({ ...storedRow(), source_mapping: change(mapping) })).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['wrong hash', { content_hash: '0'.repeat(64) }], ['foreign revision', { source_mapping_revision_id: ids.different }],
    ['foreign season', { league_season_id: ids.different }], ['foreign provider', { provider: 'yahoo' }],
    ['foreign league', { external_league_id: 'foreign' }], ['unknown normalizer', { normalizer_version: 'sleeper-administration-v2' }],
    ['partial raw response', { completeness: 'partial' }], ['invalid content ID', { content_id: 'invalid' }],
    ['invalid receipt ID', { receipt_id: 'invalid' }], ['invalid attempt ID', { attempt_id: 'invalid' }],
    ['invalid generation', { generation: 0 }], ['invalid ordinal', { ordinal: 0 }],
    ['wrong population count', { expected_team_count: 3 }],
    ['player policy', { identity: { scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY } }],
    ['overstated co-owner coverage', { coverage: { ...coverage, fields: ['owner_id', 'co_owners'] } }],
    ['subset inventory', { coverage: { ...coverage, entitySet: 'subset' } }],
    ['unfinished pagination', { coverage: { ...coverage, pagination: 'continuation', nextCursor: 'next' } }],
    ['cache receipt', { provenance: { ...provenance, origin: 'cache' } }],
    ['missing request interval', { provenance: { ...provenance, requestStartedAt: null, requestCompletedAt: null } }],
    ['missing observation time', { provenance: { ...provenance, sourceObservedAt: null } }],
    ['contradictory request interval', { provenance: { ...provenance, requestCompletedAt: '2026-09-25T11:00:00.000Z' } }],
  ])('refuses %s instead of relabeling current relationship evidence', async (_label, changes) => {
    expect(await read({ ...storedRow(), ...changes })).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['absent primary', [{ roster_id: 7, co_owners: ['co-002'] }, payload[1]]],
    ['malformed primary', [{ ...payload[0], owner_id: [] }, payload[1]]],
    ['foreign league', [{ ...payload[0], league_id: 'foreign' }, payload[1]]],
    ['incomplete population', [payload[0]]],
    ['duplicate rosters', [payload[0], payload[0]]],
  ] as const)('refuses %s even with the matching immutable raw hash', async (_label, raw) => {
    expect(await read(storedRow(raw))).toMatchObject({ status: 'unavailable' });
  });

  it('validates projected source fields as well as team UUID and roster aliases', async () => {
    const row = storedRow();
    for (const identities of [null, row.identities.slice(0, 1), [row.identities[0], row.identities[0]],
      [row.identities[0], { ...row.identities[1], seasonTeamId: ids.teamOne }],
      [row.identities[0], { ...row.identities[1], externalRosterId: '99' }],
      [row.identities[0], { ...row.identities[1], seasonTeamId: 'invalid' }],
      [{ ...row.identities[0], sourceValue: { ...row.identities[0].sourceValue, primaryOwner: { state: 'unowned', externalManagerId: null } } }, row.identities[1]],
    ]) expect(await read({ ...row, identities })).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['missing owner', [coMembership]], ['missing co-owner', [ownerMembership]],
    ['duplicate membership', [ownerMembership, coMembership, ownerMembership]],
    ['wrong role', [{ ...ownerMembership, role: 'commissioner' }, coMembership]],
    ['wrong team', [{ ...ownerMembership, seasonTeamId: ids.teamTwo }, coMembership]],
    ['wrong native manager', [{ ...ownerMembership, externalManagerId: 'foreign' }, coMembership]],
    ['invalid manager UUID', [{ ...ownerMembership, providerManagerId: 'invalid' }, coMembership]],
    ['one UUID aliases different managers', [ownerMembership, { ...coMembership, providerManagerId: ids.owner }]],
    ['extra unevidenced owner', [ownerMembership, coMembership, { ...ownerMembership, seasonTeamId: ids.teamTwo }]],
    ['extra unevidenced co-owner', [ownerMembership, coMembership, { ...coMembership, seasonTeamId: ids.teamTwo }]],
  ])('refuses membership corruption: %s', async (_label, managers) => {
    expect(await read({ ...storedRow(), managers })).toMatchObject({ status: 'unavailable' });
  });

  it('refuses one native manager resolving to different provider-manager UUIDs across teams', async () => {
    const row = storedRow([payload[0], { ...payload[1], owner_id: 'owner-001' }]);
    expect(await read({ ...row, managers: [...row.managers,
      { ...ownerMembership, seasonTeamId: ids.teamTwo, providerManagerId: ids.different }] })).toMatchObject({ status: 'unavailable' });
  });

  it('handles reordered JSONB keys and bigint strings without restamping the capture', async () => {
    const row = storedRow();
    expect(await read({ ...row, generation: '2', ordinal: '5', source_mapping: {
      scope: mapping.scope, generation: mapping.generation, revisionId: ids.revision, leagueSeasonId: ids.season, connectionId: ids.connection },
    coverage: { reasons: [], completeness: 'complete', nextCursor: null, pagination: 'complete', fields: ['owner_id'],
      entitySet: 'full', interval: null, periodIds: [] } })).toEqual(await read(row));
  });

  it('distinguishes missing from ambiguous, failed and invalid-mapping reads', async () => {
    expect(await teamManagerMethods(database(() => [])).readAcceptedTeamManagers(mapping)).toEqual({ status: 'missing' });
    expect(await teamManagerMethods(database(() => [storedRow(), storedRow()])).readAcceptedTeamManagers(mapping))
      .toMatchObject({ status: 'unavailable' });
    expect(await teamManagerMethods(database(() => { throw new Error('offline'); })).readAcceptedTeamManagers(mapping))
      .toMatchObject({ status: 'unavailable' });
    const query = vi.fn(() => []);
    expect(await teamManagerMethods(database(query)).readAcceptedTeamManagers({ ...mapping, generation: 0 }))
      .toEqual({ status: 'unavailable', reason: 'invalid_mapping' });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('batched roster capture reservation', () => {
  it('reserves both distinct policies in one statement with one exact mapping and worker fence', async () => {
    const fence = { jobKey: 'maintenance', workerId: 'worker-one', generation: 8, deadlineAt: '2026-09-25T12:01:00.000Z' };
    const query = vi.fn(() => [reservations()]);
    const result = await teamManagerMethods(database(query)).beginRosterCapture(mapping, ids.playersAttempt, ids.managersAttempt, fence);
    expect(result).toEqual({ players: { id: ids.playersAttempt, scopeId: ids.playersScope, ordinal: 5, expectedGeneration: 2 },
      managers: { id: ids.managersAttempt, scopeId: ids.managersScope, ordinal: 3, expectedGeneration: 0 } });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(sql.match(/public\.begin_current_roster_attempt/g)).toHaveLength(2);
    expect(parameters.map((value, index) => index === 1 || index === 5 ? value : JSON.parse(String(value))))
      .toEqual([mapping, ids.playersAttempt, currentRosterScope(mapping), CURRENT_ROSTER_POLICY, fence,
        ids.managersAttempt, teamManagersScope(mapping), TEAM_MANAGERS_POLICY]);
  });

  it('uses null for an absent worker fence and propagates database failures', async () => {
    const query = vi.fn(() => [reservations()]);
    await teamManagerMethods(database(query)).beginRosterCapture(mapping, ids.playersAttempt, ids.managersAttempt);
    expect((query.mock.calls[0] as unknown as [string, readonly unknown[]])[1][4]).toBeNull();
    await expect(teamManagerMethods(database(() => { throw new Error('reservation failed'); }))
      .beginRosterCapture(mapping, ids.playersAttempt, ids.managersAttempt)).rejects.toThrow('reservation failed');
  });

  it('rejects invalid mappings and shared attempt IDs before querying', async () => {
    const query = vi.fn(() => [reservations()]);
    const methods = teamManagerMethods(database(query));
    await expect(methods.beginRosterCapture({ ...mapping, generation: 0 }, ids.playersAttempt, ids.managersAttempt)).rejects.toThrow();
    await expect(methods.beginRosterCapture(mapping, ids.playersAttempt, ids.playersAttempt)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['no reservations', []], ['ambiguous reservations', [reservations(), reservations()]],
    ['missing manager reservation', [{ players: reservations().players }]],
    ['wrong attempt', [{ ...reservations(), managers: { ...reservations().managers, id: ids.different } }]],
    ['same scope', [{ ...reservations(), managers: { ...reservations().managers, scopeId: ids.playersScope } }]],
    ['invalid scope UUID', [{ ...reservations(), managers: { ...reservations().managers, scopeId: 'invalid' } }]],
    ['zero ordinal', [{ ...reservations(), managers: { ...reservations().managers, ordinal: 0 } }]],
    ['unsafe ordinal', [{ ...reservations(), players: { ...reservations().players, ordinal: Number.MAX_SAFE_INTEGER + 1 } }]],
    ['negative generation', [{ ...reservations(), managers: { ...reservations().managers, expectedGeneration: -1 } }]],
  ])('rejects malformed response: %s', async (_label, rows) => {
    await expect(teamManagerMethods(database(() => rows)).beginRosterCapture(mapping, ids.playersAttempt, ids.managersAttempt)).rejects.toThrow();
  });

  it('keeps disabled persistence from inspecting inputs or fabricating accepted evidence', async () => {
    const unreadable = new Proxy({} as AdministrationSourceMapping, { get() { throw new Error('must not inspect'); } });
    const store = createLeagueAdministrationStore({ enabled: false, reason: 'preview-persistence-disabled' });
    expect(await store.readAcceptedTeamManagers(unreadable)).toEqual({ status: 'disabled' });
    await expect(store.beginRosterCapture(unreadable, ids.playersAttempt, ids.managersAttempt)).rejects.toThrow('Administration persistence disabled');
  });
});

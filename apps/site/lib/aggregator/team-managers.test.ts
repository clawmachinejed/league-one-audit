import { describe, expect, it } from 'vitest';
import type { AdministrationEnvelope, JsonObject } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from './current-roster';
import { TEAM_MANAGERS_POLICY, teamManagersScope, TEAM_MANAGER_EVIDENCE_POLICY, teamManagerEvidenceScope, teamManagerEvidenceCoverage } from './team-managers';

const scope = { leagueKey: 'league1', provider: 'sleeper' as const, externalLeagueId: 'fixture-source', season: 2026 };
const provenance: AdministrationEnvelope['provenance'] = {
  origin: 'network', requestStartedAt: '2026-09-25T12:00:00.000Z',
  requestCompletedAt: '2026-09-25T12:00:01.000Z', sourceObservedAt: '2026-09-25T12:00:01.000Z',
  checkedAt: '2026-09-25T12:00:02.000Z',
};
const owned: JsonObject = { roster_id: 7, owner_id: 'manager-001', co_owners: ['manager-002'], players: ['001'] };

function normalize(payload: AdministrationEnvelope['payload'], expectedRosterCount = 1) {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope,
    family: 'rosters', week: null, completeness: 'complete', provenance, payload }, { expectedRosterCount });
}

describe('current team manager resource normalization', () => {
  it('retains the v1 accepted value and hashes while adding an independent projection', () => {
    const result = normalize([owned]);
    expect(result).toMatchObject({ status: 'accepted',
      contentHash: '77ecede9929bdf38e80dc730acd50dbc746bfd7c5eab6a9743b0914b9e40ba5c',
      semanticHash: '4c471fd07779beec882876d55a87fda21444c1bebc330f71aa94fd8ef6830a60',
      value: { family: 'rosters', teams: [{ externalRosterId: '7', primaryOwnerExternalId: 'manager-001',
        coOwnerExternalIds: ['manager-002'], playerExternalIds: ['001'], starterExternalIds: null,
        reserveExternalIds: null, taxiExternalIds: null }], memberships: [
        { externalRosterId: '7', externalManagerId: 'manager-001', role: 'owner' },
        { externalRosterId: '7', externalManagerId: 'manager-002', role: 'co_owner' },
      ] }, teamManagers: { version: 'sleeper-current-team-managers-v1', status: 'complete', teams: [
        { externalRosterId: '7', primaryOwner: { state: 'owned', externalManagerId: 'manager-001' },
          coManagers: { state: 'known', externalManagerIds: ['manager-002'] } },
      ], diagnostics: [] } });
  });

  it('distinguishes explicit unowned from absent owner without changing legacy null behavior', () => {
    const vacant = normalize([{ roster_id: 7, owner_id: null, co_owners: [] }]);
    const unknown = normalize([{ roster_id: 7, co_owners: [] }]);
    expect(vacant).toMatchObject({ status: 'accepted', teamManagers: { status: 'complete', teams: [
      { primaryOwner: { state: 'unowned', externalManagerId: null }, coManagers: { state: 'known', externalManagerIds: [] } },
    ] } });
    expect(unknown).toMatchObject({ status: 'accepted', teamManagers: { status: 'partial', teams: [
      { primaryOwner: { state: 'unknown', externalManagerId: null } },
    ], diagnostics: [{ code: 'owner_absent', path: 'payload[0].owner_id' }] } });
    expect(vacant.value).toEqual(unknown.value);
    expect(vacant.contentHash).not.toBe(unknown.contentHash);
  });

  it.each([
    ['null', { co_owners: null }, 'co_managers_null'],
    ['missing', {}, 'co_managers_absent'],
    ['not an array', { co_owners: 'manager-002' }, 'co_managers_invalid'],
    ['not a string ID', { co_owners: [123] }, 'co_managers_invalid'],
    ['blank ID', { co_owners: [''] }, 'co_managers_invalid'],
    ['trimmed ID', { co_owners: [' manager-002'] }, 'co_managers_invalid'],
    ['duplicate ID', { co_owners: ['manager-002', 'manager-002'] }, 'co_managers_invalid'],
    ['primary owner collision', { co_owners: ['manager-001'] }, 'co_managers_invalid'],
  ] as const)('keeps the primary owner proven when optional co-managers are %s', (_label, coOwners, reason) => {
    const result = normalize([{ roster_id: 7, owner_id: 'manager-001', players: [], ...coOwners }]);
    expect(result.teamManagers).toMatchObject({ status: 'partial', teams: [{
      primaryOwner: { state: 'owned', externalManagerId: 'manager-001' },
      coManagers: { state: 'unknown', externalManagerIds: null, reason },
    }], diagnostics: [{ code: reason, path: 'payload[0].co_owners' }] });
    // Preserve the existing asymmetric boundary: malformed manager fields still reject v1.
    expect(result.status).toBe(reason === 'co_managers_invalid' ? 'rejected' : 'accepted');
  });

  it.each(['', ' manager-001', 'manager-001 ', 'manager\u0000', 123, [], {}])(
    'rejects invalid primary owner %j instead of asserting a vacant team', owner_id => {
      expect(normalize([{ ...owned, owner_id }]).teamManagers).toMatchObject({ status: 'invalid', teams: null,
        diagnostics: [{ code: 'invalid_identifier', path: 'payload[0].owner_id' }] });
    });

  it.each(['players', 'starters', 'reserve', 'taxi'] as const)(
    'qualifies managers despite malformed unrelated %s without accepting the v1 content', field => {
      const result = normalize([{ ...owned, [field]: 'not-a-player-array' }]);
      expect(result).toMatchObject({ status: 'rejected', value: null, semanticHash: null,
        diagnostics: [{ code: 'invalid_array', path: `payload[0].${field}` }],
        teamManagers: { status: 'complete', teams: [{ primaryOwner: { state: 'owned', externalManagerId: 'manager-001' },
          coManagers: { state: 'known', externalManagerIds: ['manager-002'] } }] } });
    });

  it('uses exact opaque manager IDs without a user directory or display metadata', () => {
    const rows: readonly JsonObject[] = [
      { roster_id: 7, owner_id: '0009007199254740993123', co_owners: ['opaque:co/manager'], metadata: { name: 123, avatar: [] } },
      { roster_id: 12, owner_id: '0009007199254740993123', co_owners: ['opaque:co/manager'] },
    ];
    const result = normalize(rows, 2);
    expect(result.teamManagers).toMatchObject({ status: 'complete', teams: [
      { externalRosterId: '7', primaryOwner: { state: 'owned', externalManagerId: '0009007199254740993123' },
        coManagers: { state: 'known', externalManagerIds: ['opaque:co/manager'] } },
      { externalRosterId: '12', primaryOwner: { state: 'owned', externalManagerId: '0009007199254740993123' } },
    ] });
  });

  it.each([
    ['foreign source league', [{ ...owned, league_id: 'foreign-source' }], 1, 'foreign_roster_league'],
    ['null supplied source league', [{ ...owned, league_id: null }], 1, 'foreign_roster_league'],
    ['duplicate roster ID', [owned, owned], 2, 'duplicate_identifier'],
    ['incomplete population', [owned], 2, 'incomplete_roster_set'],
    ['empty population', [], 1, 'incomplete_roster_set'],
    ['invalid roster ID', [{ ...owned, roster_id: '7' }], 1, 'invalid_integer'],
    ['non-roster row', [null], 1, 'invalid_object'],
    ['non-array response', {}, 1, 'invalid_array'],
  ] as const)('refuses primary-owner coverage for %s', (_label, payload, count, code) => {
    expect(normalize(payload, count).teamManagers).toMatchObject({ status: 'invalid', teams: null, diagnostics: [{ code }] });
  });

  it('checks a supplied league ID without changing the historical v1 rule', () => {
    const exact = normalize([{ ...owned, league_id: scope.externalLeagueId }]);
    const foreign = normalize([{ ...owned, league_id: 'foreign-source' }]);
    expect(exact.teamManagers?.status).toBe('complete');
    expect(foreign.status).toBe('accepted');
    expect(foreign.teamManagers?.status).toBe('invalid');
  });

  it('does not mutate source evidence or blend prior co-managers into a later unknown capture', () => {
    const raw = [{ ...owned, co_owners: ['manager-002'] }];
    const first = normalize(raw);
    raw[0].co_owners.push('manager-later');
    const second = normalize([{ ...owned, co_owners: null }]);
    expect(first.teamManagers?.teams?.[0].coManagers).toEqual({ state: 'known', externalManagerIds: ['manager-002'] });
    expect(Object.isFrozen(first.teamManagers?.teams?.[0].coManagers)).toBe(true);
    expect(second.teamManagers?.teams?.[0].coManagers).toEqual({ state: 'unknown', externalManagerIds: null, reason: 'co_managers_null' });
  });

  it('declares primary-owner coverage separately from the held-player policy', () => {
    const mapping = { connectionId: 'connection', leagueSeasonId: 'season', revisionId: 'revision', generation: 1, scope };
    expect(teamManagersScope(mapping)).toEqual({ kind: 'enrolled-resource', connectionId: 'connection', leagueSeasonId: 'season',
      family: 'teams', entityId: null, scoringPeriodId: null, audienceId: 'public',
      coverageSpecId: 'sleeper-current-all-teams-primary-owners-v1' });
    expect(teamManagersScope(mapping)).not.toEqual(currentRosterScope(mapping));
    expect(TEAM_MANAGERS_POLICY.coverageSpecId).not.toBe(CURRENT_ROSTER_POLICY.coverageSpecId);
  });
});

function normalizeEvidence(payload: AdministrationEnvelope['payload'], expectedRosterCount = 1) {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope,
    family: 'rosters', week: null, completeness: 'complete', provenance, payload }, { expectedRosterCount, managerEvidenceVersion: 'v2' });
}

describe('opt-in manager field evidence v2', () => {
  it('reproduces the v1 invalid-primary loss and retains independent co-managers only in v2', () => {
    const payload = [{ ...owned, owner_id: 123 }];
    const historical = normalize(payload);
    const evidence = normalizeEvidence(payload);
    expect(historical.teamManagers).toMatchObject({ status: 'invalid', teams: null });
    expect(evidence.teamManagerEvidence).toMatchObject({ version: TEAM_MANAGER_EVIDENCE_POLICY.canonicalNormalizerVersion,
      status: 'partial', teams: [{ primaryOwner: { state: 'unknown', externalManagerId: null, reason: 'primary_owner_invalid' },
        coManagers: { state: 'known', externalManagerIds: ['manager-002'] } }] });
    const { teamManagerEvidence: projection, ...preserved } = evidence;
    expect(projection).toBeDefined();
    expect(preserved).toEqual(historical);
    expect(historical).not.toHaveProperty('teamManagerEvidence');
  });

  it.each(['', ' owner', 'owner ', 'owner\u0000', 123, [], {}])('preserves valid co-manager evidence for malformed primary %j', owner_id => {
    const result = normalizeEvidence([{ ...owned, owner_id }]);
    expect(result.teamManagerEvidence).toMatchObject({ status: 'partial', teams: [{
      primaryOwner: { state: 'unknown', externalManagerId: null, reason: 'primary_owner_invalid' },
      coManagers: { state: 'known', externalManagerIds: ['manager-002'] } }] });
    expect(result.status).toBe('rejected');
  });

  it('distinguishes absence, explicit vacancy and malformed primary without primary promotion', () => {
    const absent = normalizeEvidence([{ roster_id: 7, co_owners: ['manager-002'] }]);
    const vacancy = normalizeEvidence([{ roster_id: 7, owner_id: null, co_owners: ['manager-002'] }]);
    const invalid = normalizeEvidence([{ roster_id: 7, owner_id: '', co_owners: ['manager-002'] }]);
    expect(absent.teamManagerEvidence?.teams?.[0].primaryOwner).toEqual({ state: 'unknown', externalManagerId: null, reason: 'primary_owner_absent' });
    expect(vacancy.teamManagerEvidence?.teams?.[0].primaryOwner).toEqual({ state: 'unowned', externalManagerId: null });
    expect(invalid.teamManagerEvidence?.teams?.[0].primaryOwner).toEqual({ state: 'unknown', externalManagerId: null, reason: 'primary_owner_invalid' });
    expect(vacancy.teamManagerEvidence?.status).toBe('complete');
    expect(new Set([absent.contentHash, vacancy.contentHash, invalid.contentHash]).size).toBe(3);
  });

  it.each([
    ['mixed malformed', ['co-first', null, '', 7, {}, [], ' co-invalid', 'co-second'], ['co-first', 'co-second']],
    ['duplicates', ['co-first', 'co-first', 'co-second'], ['co-first', 'co-second']],
    ['owner collision', ['co-first', 'manager-001', 'co-second'], ['co-first', 'co-second']],
    ['all invalid', [null, 7, '', 'manager-001'], []],
  ] as const)('retains source-ordered independent IDs for %s with explicit incomplete inventory', (_label, co_owners, ids) => {
    const result = normalizeEvidence([{ ...owned, co_owners }]);
    expect(result.teamManagerEvidence).toMatchObject({ status: 'partial', teams: [{
      primaryOwner: { state: 'owned', externalManagerId: 'manager-001' },
      coManagers: { state: 'partial', externalManagerIds: ids, reason: 'co_managers_invalid_members' } }] });
    expect(result.teamManagers?.teams?.[0].coManagers).toMatchObject({ state: 'unknown', externalManagerIds: null });
  });

  it.each([
    ['missing', {}, 'co_managers_absent'], ['null', { co_owners: null }, 'co_managers_null'],
    ['scalar', { co_owners: 'manager-002' }, 'co_managers_invalid'], ['object', { co_owners: {} }, 'co_managers_invalid'],
  ] as const)('retains %s co-manager evidence as unknown, never an empty complete list', (_label, co, reason) => {
    const result = normalizeEvidence([{ roster_id: 7, owner_id: 'manager-001', ...co }]);
    expect(result.teamManagerEvidence?.teams?.[0].coManagers).toEqual({ state: 'unknown', externalManagerIds: null, reason });
    expect(result.teamManagerEvidence?.status).toBe('partial');
  });

  it('retains opaque provider IDs and never treats case differences or unicode interior whitespace as aliases', () => {
    const result = normalizeEvidence([{ roster_id: 7, owner_id: [], co_owners: ['Co/0007', 'co/0007', 'co\u00a0manager', 'co\u0085manager'] }]);
    expect(result.teamManagerEvidence?.teams?.[0].coManagers).toEqual({ state: 'known',
      externalManagerIds: ['Co/0007', 'co/0007', 'co\u00a0manager', 'co\u0085manager'] });
  });

  it.each([
    ['foreign league', [{ ...owned, league_id: 'foreign' }], 1], ['duplicate roster', [owned, owned], 2],
    ['partial population', [owned], 2], ['no teams', [], 1], ['invalid roster', [{ ...owned, roster_id: '7' }], 1],
    ['invalid row', [null], 1], ['invalid shape', {}, 1],
  ] as const)('refuses a %s resource instead of presenting a partial team population', (_label, raw, count) => {
    expect(normalizeEvidence(raw, count).teamManagerEvidence).toMatchObject({ status: 'invalid', teams: null });
  });

  it('has a separate acceptance identity and reports deduplicated adverse reasons', () => {
    const mapping = { connectionId: 'connection', leagueSeasonId: 'season', revisionId: 'revision', generation: 1, scope };
    expect(teamManagerEvidenceScope(mapping)).not.toEqual(teamManagersScope(mapping));
    expect(TEAM_MANAGERS_POLICY).toEqual({ audienceId: 'public', coverageSpecId: 'sleeper-current-all-teams-primary-owners-v1',
      canonicalNormalizerVersion: 'sleeper-current-team-managers-v1', validationVersion: 'latest-network-attempt-v1' });
    const projection = normalizeEvidence([{ roster_id: 7, owner_id: 0, co_owners: ['co', 0] },
      { roster_id: 8, owner_id: 0, co_owners: null }], 2).teamManagerEvidence!;
    expect(teamManagerEvidenceCoverage(projection)).toEqual({ periodIds: [], interval: null, entitySet: 'full',
      fields: ['owner_id', 'co_owners'], pagination: 'complete', nextCursor: null, completeness: 'partial',
      reasons: ['co_managers_invalid_members', 'co_managers_null', 'primary_owner_invalid'] });
  });

  it('freezes independent evidence and does not carry forward older complete ownership', () => {
    const raw = [{ ...owned, co_owners: ['co-old'] }];
    const before = normalizeEvidence(raw); raw[0].co_owners.push('co-later');
    const after = normalizeEvidence([{ roster_id: 7, owner_id: {}, co_owners: ['co-new', null] }]);
    expect(before.teamManagerEvidence?.teams?.[0].coManagers).toEqual({ state: 'known', externalManagerIds: ['co-old'] });
    expect(Object.isFrozen(before.teamManagerEvidence?.teams?.[0])).toBe(true);
    expect(after.teamManagerEvidence?.teams?.[0]).toEqual({ externalRosterId: '7',
      primaryOwner: { state: 'unknown', externalManagerId: null, reason: 'primary_owner_invalid' },
      coManagers: { state: 'partial', externalManagerIds: ['co-new'], reason: 'co_managers_invalid_members' } });
  });
});

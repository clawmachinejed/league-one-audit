import { describe, expect, it } from 'vitest';
import { MANAGER_DIRECTORY_VERSION } from '../aggregator/team-managers';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import type { AdministrationEnvelope, JsonObject, JsonValue } from './contracts';
import { normalizeAdministrationObservation } from './normalize';

function observation(payload: JsonValue, completeness: AdministrationEnvelope['completeness'] = 'complete') {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: 'unrelated-2026', provider: 'sleeper', externalLeagueId: 'league-2026', season: 2026 },
    family: 'users', week: null, completeness, payload,
    provenance: { origin: 'network', requestStartedAt: '2026-10-01T01:00:00.000Z',
      requestCompletedAt: '2026-10-01T01:00:01.000Z', sourceObservedAt: '2026-10-01T01:00:01.000Z',
      checkedAt: '2026-10-01T01:00:02.000Z' } });
}

describe('independent commissioner directory facts', () => {
  it('retains multiple commissioners, false, absent, null and invalid without manufacturing ownership', () => {
    const payload: readonly JsonObject[] = [
      { user_id: '001', display_name: 'Owner', is_owner: false },
      { user_id: '002', display_name: 'No roster', is_owner: true },
      { user_id: '003', is_owner: true }, { user_id: '004' }, { user_id: '005', is_owner: null },
      { user_id: '006', is_owner: 'true' }, { user_id: '007', is_owner: 0 }, { user_id: '008', is_owner: [] },
    ];
    const result = observation(payload);
    expect(result.status).toBe('accepted');
    expect(result.managerDirectory).toEqual({ version: MANAGER_DIRECTORY_VERSION, status: 'complete', diagnostics: [], managers: [
      { externalManagerId: '001', commissioner: { sourcePath: 'is_owner', state: 'known', value: false } },
      { externalManagerId: '002', commissioner: { sourcePath: 'is_owner', state: 'known', value: true } },
      { externalManagerId: '003', commissioner: { sourcePath: 'is_owner', state: 'known', value: true } },
      { externalManagerId: '004', commissioner: { sourcePath: 'is_owner', state: 'absent', value: null } },
      { externalManagerId: '005', commissioner: { sourcePath: 'is_owner', state: 'null', value: null } },
      { externalManagerId: '006', commissioner: { sourcePath: 'is_owner', state: 'invalid', value: null, raw: 'true' } },
      { externalManagerId: '007', commissioner: { sourcePath: 'is_owner', state: 'invalid', value: null, raw: 0 } },
      { externalManagerId: '008', commissioner: { sourcePath: 'is_owner', state: 'invalid', value: null, raw: [] } },
    ] });
    expect(result.value).toEqual({ family: 'users', managers: payload.map(row => ({ externalManagerId: row.user_id,
      displayName: row.display_name ?? null, username: null, avatar: null })) });
    expect(result.contentHash).toBe(compatibleRevision(payload));
    expect(JSON.stringify(result.managerDirectory)).not.toMatch(/primaryOwner|coManagers|accountId|membership/);
    expect(Object.isFrozen(result.managerDirectory?.managers?.[0].commissioner)).toBe(true);
  });

  it('retains an explicit complete empty directory separately from invalid or partial evidence', () => {
    expect(observation([]).managerDirectory).toEqual({ version: MANAGER_DIRECTORY_VERSION,
      status: 'complete', managers: [], diagnostics: [] });
    expect(observation(null).managerDirectory).toMatchObject({ status: 'invalid', managers: null });
    expect(observation([], 'partial').managerDirectory).toMatchObject({ status: 'invalid', managers: null });
  });

  it.each([
    [{ user_id: 'same', is_owner: true }, { user_id: 'same', is_owner: false }],
    [{ user_id: '', is_owner: true }], [{ user_id: 123, is_owner: true }], [null],
  ].map(payload => ({ payload })))('refuses malformed or duplicated directory identity %j', ({ payload }) => {
    expect(observation(payload as JsonValue).managerDirectory).toMatchObject({ status: 'invalid', managers: null });
  });

  it('does not relax the legacy directory boundary or infer a flag from a manager label', () => {
    const result = observation([{ user_id: '001', display_name: 17, username: 'Commissioner' }]);
    expect(result.status).toBe('rejected');
    expect(result.value).toBeNull();
    expect(result.managerDirectory?.managers).toEqual([{ externalManagerId: '001',
      commissioner: { sourcePath: 'is_owner', state: 'absent', value: null } }]);
  });
});

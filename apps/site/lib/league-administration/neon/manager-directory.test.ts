import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { MANAGER_DIRECTORY_VERSION } from '../../aggregator/team-managers';
import type { AdministrationEnvelope, JsonObject, JsonValue } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { MANAGER_DIRECTORY_CAPTURE_READ_SQL, teamManagerMethods } from './team-managers';

vi.mock('server-only', () => ({}));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping: AdministrationSourceMapping = { connectionId: uuid(1), leagueSeasonId: uuid(2), revisionId: uuid(3), generation: 2,
  scope: { provider: 'sleeper', leagueKey: 'unrelated-2026', externalLeagueId: 'native-2026', season: 2026 } };
const payload: readonly JsonObject[] = [{ user_id: '001', display_name: 'Owner', is_owner: false },
  { user_id: '002', is_owner: true }, { user_id: '003', is_owner: true }, { user_id: '004' },
  { user_id: '005', is_owner: null }, { user_id: '006', is_owner: { unexpected: false } }];
function storedRow(raw: JsonValue = payload) {
  const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
    family: 'users', week: null, completeness: 'complete', payload: raw,
    provenance: { origin: 'network', requestStartedAt: '2026-10-01T01:00:00.000Z',
      requestCompletedAt: '2026-10-01T01:00:01.000Z', sourceObservedAt: '2026-10-01T01:00:01.000Z',
      checkedAt: '2026-10-01T01:00:02.000Z' } };
  const normalized = normalizeAdministrationObservation(envelope);
  const profiles = normalized.value?.family === 'users' ? normalized.value.managers : [];
  return { capture_id: uuid(4), intake_id: uuid(5), source_mapping: mapping, content_id: uuid(6),
    legacy_observation_id: uuid(7), league_season_id: mapping.leagueSeasonId,
    request_started_at: envelope.provenance.requestStartedAt, request_completed_at: envelope.provenance.requestCompletedAt,
    source_observed_at: envelope.provenance.sourceObservedAt, recorded_at: envelope.provenance.checkedAt,
    provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, family: 'users', week: 0,
    accepted: true, normalizer_version: 'sleeper-administration-v1', completeness: 'complete',
    content_hash: normalized.contentHash, payload: raw, directory_version: MANAGER_DIRECTORY_VERSION,
    manager_count: normalized.managerDirectory?.managers?.length ?? 0,
    managers: (normalized.managerDirectory?.managers ?? []).map((entry, index) => ({
      providerManagerId: uuid(20 + index), externalManagerId: entry.externalManagerId, sourceValue: entry,
      commissionerState: entry.commissioner.state, commissionerValue: entry.commissioner.value,
      invalidRaw: entry.commissioner.state === 'invalid' ? entry.commissioner.raw : null,
      legacySourceValue: profiles.find(profile => profile.externalManagerId === entry.externalManagerId),
    })) };
}
function database(respond: (sql: string, parameters: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) {
    return respond(sql, parameters) as readonly Row[];
  } };
}
function read(row: DatabaseRow, requestedMapping = mapping, captureId = uuid(4)) {
  return teamManagerMethods(database(() => [row])).readManagerDirectoryCapture(requestedMapping, captureId);
}

describe('immutable typed manager directory capture reader', () => {
  it('returns the exact capture, stable manager identities and independent commissioner facts', async () => {
    const result = await read(storedRow());
    expect(result).toMatchObject({ status: 'available', version: MANAGER_DIRECTORY_VERSION,
      leagueSeasonId: uuid(2), sourceMapping: mapping, captureBinding: 'intake-directory-capture', assurance: 'provider-observed',
      capture: { id: uuid(4), intakeId: uuid(5), contentId: uuid(6), legacyObservationId: uuid(7),
        sourceObservedAt: '2026-10-01T01:00:01.000Z' },
      managers: [{ providerManagerId: uuid(20), sourceManager: { provider: 'sleeper', resourceKind: 'manager',
        nativeNamespace: 'account', nativeId: '001' }, displayName: 'Owner', commissioner: { state: 'known', value: false } },
      { commissioner: { state: 'known', value: true } }, { commissioner: { state: 'known', value: true } },
      { commissioner: { state: 'absent', value: null } }, { commissioner: { state: 'null', value: null } },
      { commissioner: { state: 'invalid', value: null, raw: { unexpected: false } } }] });
    expect(await read({ ...storedRow(), managers: storedRow().managers.toReversed() })).toEqual(result);
  });

  it('reads an empty typed version and distinguishes never-projected or absent capture evidence', async () => {
    expect(await read(storedRow([]))).toMatchObject({ status: 'available', managers: [] });
    expect(await teamManagerMethods(database(() => [])).readManagerDirectoryCapture(mapping, uuid(4))).toEqual({ status: 'missing' });
    expect(await read({ ...storedRow([]), directory_version: null })).toMatchObject({ status: 'unavailable' });
  });

  it('preserves independent database recording time when the witnessed source clock is ahead', async () => {
    expect(await read({ ...storedRow(), recorded_at: '2026-10-01T01:00:00.900Z' })).toMatchObject({
      status: 'available', capture: { requestCompletedAt: '2026-10-01T01:00:01.000Z',
        sourceObservedAt: '2026-10-01T01:00:01.000Z', recordedAt: '2026-10-01T01:00:00.900Z' },
    });
  });

  it('pins the immutable capture and current mapping without following the latest users head', async () => {
    const query = vi.fn(() => [storedRow()]);
    await teamManagerMethods(database(query)).readManagerDirectoryCapture(mapping, uuid(4));
    expect(query).toHaveBeenCalledExactlyOnceWith(MANAGER_DIRECTORY_CAPTURE_READ_SQL,
      [uuid(4), mapping.connectionId, JSON.stringify(mapping), mapping.revisionId, 2, MANAGER_DIRECTORY_VERSION]);
    expect(MANAGER_DIRECTORY_CAPTURE_READ_SQL).toContain('connection.current_mapping_revision_id=$4');
    expect(MANAGER_DIRECTORY_CAPTURE_READ_SQL).not.toMatch(/league_administration_heads|resource_heads|account_claim|app_accounts/);
    const first = await read(storedRow());
    const correction = storedRow([{ user_id: '001', is_owner: true }]);
    expect(await read({ ...correction, capture_id: uuid(8), content_id: uuid(9) }, mapping, uuid(8)))
      .toMatchObject({ status: 'available', managers: [{ commissioner: { value: true } }] });
    expect(await read(storedRow())).toEqual(first);
  });

  it.each([
    ['capture', { capture_id: uuid(8) }], ['source remap', { source_mapping: { ...mapping, revisionId: uuid(8), generation: 3 } }],
    ['season', { league_season_id: uuid(8) }], ['native league', { external_league_id: 'other' }], ['provider', { provider: 'other' }],
    ['family', { family: 'rosters' }], ['week', { week: 1 }], ['partial', { completeness: 'partial' }],
    ['rejected content', { accepted: false }], ['hash', { content_hash: 'wrong' }], ['version', { directory_version: 'other' }],
    ['normalizer', { normalizer_version: 'other' }], ['count', { manager_count: 5 }], ['invalid capture ID', { intake_id: 'invalid' }],
    ['source clock', { source_observed_at: '2026-10-01T01:00:00.000Z' }],
    ['capture interval', { request_started_at: '2026-10-01T01:00:02.000Z' }],
  ])('refuses contradictory %s evidence', async (_label, patch) => {
    expect(await read({ ...storedRow(), ...patch })).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['flag coercion', { commissionerValue: true }], ['presence coercion', { commissionerState: 'absent' }],
    ['raw substitution', { invalidRaw: 'different' }], ['profile substitution', { legacySourceValue: {} }],
    ['projection substitution', { sourceValue: {} }], ['native identity', { externalManagerId: 'other' }],
    ['canonical identity', { providerManagerId: 'invalid' }],
  ])('refuses typed row %s', async (_label, patch) => {
    const row = storedRow(); row.managers[0] = { ...row.managers[0], ...patch } as typeof row.managers[number];
    expect(await read(row)).toMatchObject({ status: 'unavailable' });
  });

  it('rejects duplicate, missing and extra relational identities', async () => {
    const row = storedRow();
    expect(await read({ ...row, managers: [row.managers[0], ...row.managers.slice(0, -1)] })).toMatchObject({ status: 'unavailable' });
    expect(await read({ ...row, managers: row.managers.slice(1) })).toMatchObject({ status: 'unavailable' });
    expect(await read({ ...row, managers: [...row.managers, row.managers[0]] })).toMatchObject({ status: 'unavailable' });
  });

  it('keeps disabled, malformed input and database failure isolated', async () => {
    const disabled = createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' });
    expect(await disabled.readManagerDirectoryCapture!(mapping, 'ignored')).toEqual({ status: 'disabled' });
    const query = vi.fn(() => [storedRow()]);
    expect(await teamManagerMethods(database(query)).readManagerDirectoryCapture(mapping, 'invalid'))
      .toMatchObject({ status: 'unavailable' });
    expect(query).not.toHaveBeenCalled();
    expect(await teamManagerMethods(database(() => { throw new Error('database unavailable'); }))
      .readManagerDirectoryCapture(mapping, uuid(4))).toMatchObject({ status: 'unavailable' });
    expect(await read(storedRow(), { ...mapping, revisionId: uuid(8), generation: 3 })).toMatchObject({ status: 'unavailable' });
  });
});

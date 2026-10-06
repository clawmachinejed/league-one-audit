import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../../database';
import { createPublicIntakeStore } from './public-intake';
import { normalizeAdministrationObservation } from '../normalize';
import { ADMINISTRATION_DIALECT, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_SCHEMA_VERSION, type JsonValue } from '../contracts';
vi.mock('server-only', () => ({}));
const requestId = '11111111-1111-4111-8111-111111111111';
const work = { requestId, revision: 2, kind: 'bootstrap' as const, externalLeagueId: '98765432109876543210', season: 2026 };
const fence = { jobKey: 'league-administration-public-intake', workerId: 'worker', generation: 1,
  deadlineAt: new Date(Date.now() + 20_000).toISOString() };
const league = { league_id: work.externalLeagueId, season: '2026', sport: 'nfl', name: 'Unrelated division league',
  total_rosters: 2, roster_positions: ['UNKNOWN_NATIVE_SLOT', 'BN'], settings: { divisions: 2 },
  scoring_settings: { rec_yd: 0.1, unsupported_bonus: 2 } };
function fixture(existing = false) {
  const query = vi.fn(async (statement: string, parameters?: readonly unknown[]) => {
    void parameters; // Retain the transport argument for checkpoint assertions.
    return statement.includes('resolve-registration') && existing
      ? [{ league_key: 'league1', season: 2026, league_id: 'existing-league', league_season_id: 'existing-season' }] : [];
  });
  const queryAfterLock = vi.fn(async (_statement: string, parameters: readonly unknown[]) => [[], [{
    league_id: 'league-id', league_season_id: 'season-id', scoring_profile_id: parameters[0] === null ? null : 'profile-id',
  }]]);
  const client = { enabled: true, query, queryAfterLock } as unknown as DatabaseClient;
  const capture = (payload: unknown) => ({ family: 'league' as const, week: null, origin: 'network' as const, payload,
    requestStartedAt: new Date().toISOString(), requestCompletedAt: new Date().toISOString() });
  return { store: createPublicIntakeStore(client), query, queryAfterLock, capture };
}
describe('public-data registration through the existing identity writer', () => {
  it('keeps official unknown scoring/slots and fences shared registration after the response', async () => {
    const f = fixture();
    await f.store.register(work, f.capture(league), fence);
    expect(f.queryAfterLock).toHaveBeenCalledWith(expect.stringContaining('projection-store:register-league-season'),
      expect.arrayContaining([JSON.stringify(league.scoring_settings), `sleeper-${work.externalLeagueId}`]),
      expect.objectContaining({ statement: 'SELECT public.guard_public_data_intake($1::jsonb,$2::jsonb)',
        parameters: [JSON.stringify(work), JSON.stringify({ ...fence, reserveCollection: true })],
        verifyAfter: { statement: 'SELECT public.guard_public_data_intake($1::jsonb,$2::jsonb)',
          parameters: [JSON.stringify(work), JSON.stringify(fence)] } }), undefined);
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining('checkpoint'),
      [JSON.stringify(work), expect.stringContaining('"leagueSeasonId":"season-id"'), JSON.stringify(fence)]);
  });
  it('preserves an existing permanent league identity and immutable scoring profile', async () => {
    const f = fixture(true);
    await f.store.register(work, f.capture(league), fence);
    expect(f.queryAfterLock).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining('checkpoint'),
      [JSON.stringify(work), expect.stringContaining('"leagueId":"existing-league"'), JSON.stringify(fence)]);
  });
  it.each([
    { ...league, league_id: 'other' }, { ...league, season: '2025' }, { ...league, sport: 'nba' },
    { ...league, settings: [] }, { ...league, settings: 'bad' }, { ...league, scoring_settings: { rec: 'bad' } },
    { ...league, scoring_settings: [] }, { ...league, scoring_settings: 'bad' },
    { ...league, roster_positions: {} }, { ...league, roster_positions: [false] }, { ...league, total_rosters: 0 },
  ])('retains malformed official configuration as rejected evidence without registering it', async payload => {
    const f = fixture();
    await f.store.register(work, f.capture(payload), fence);
    expect(f.queryAfterLock).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining('checkpoint'),
      [JSON.stringify(work), expect.stringContaining('"diagnostic":"invalid-source"'), JSON.stringify(fence)]);
  });
  it('retains an over-capacity official league as a distinct deferred candidate', async () => {
    const f = fixture();
    await f.store.register(work, f.capture({ ...league, total_rosters: 21 }), fence);
    expect(f.queryAfterLock).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining('checkpoint'),
      [JSON.stringify(work), expect.stringContaining('"capacity":"roster-count-unqualified"'), JSON.stringify(fence)]);
  });
  it('does not checkpoint registration after the database rejects the expired fence', async () => {
    const f = fixture();
    f.queryAfterLock.mockRejectedValue(new Error('public intake lease lost'));
    await expect(f.store.register(work, f.capture(league), fence)).rejects.toThrow('lease lost');
    expect(f.query).toHaveBeenCalledTimes(1);
  });
});


describe('official preconfiguration registration', () => {
  it.each((['settings', 'scoring_settings', 'roster_positions'] as const).flatMap(field =>
    (['absent', 'null', 'empty'] as const).map(state => ({ field, state }))))('retains $field:$state without invented configuration', async ({ field, state }) => {
      const payload: Record<string, unknown> = { ...league };
      if (state === 'absent') delete payload[field];
      else payload[field] = state === 'null' ? null : field === 'roster_positions' ? [] : {};
      const f = fixture(); const capture = f.capture(payload);
      const normalized = normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
        normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT,
        scope: { leagueKey: 'unrelated', provider: 'sleeper', externalLeagueId: work.externalLeagueId, season: work.season },
        family: 'league', week: null, completeness: 'complete', payload: payload as JsonValue,
        provenance: { origin: 'network', requestStartedAt: capture.requestStartedAt, requestCompletedAt: capture.requestCompletedAt,
          sourceObservedAt: capture.requestCompletedAt, checkedAt: capture.requestCompletedAt } });
      expect(normalized.status, field + ':' + state).toBe('accepted');
      await f.store.register(work, capture, fence);
      expect(f.queryAfterLock, field + ':' + state).toHaveBeenCalledOnce();
      const parameters = f.queryAfterLock.mock.calls[0][1];
      if (field === 'scoring_settings') expect(parameters.slice(0, 2)).toEqual([null, null]);
      else expect(parameters[1]).toBe(JSON.stringify(league.scoring_settings));
      const checkpoint = JSON.parse(String(f.query.mock.calls.at(-1)?.[1]?.[1]));
      expect(checkpoint.payload).toEqual(payload); expect(checkpoint).not.toHaveProperty('diagnostic');
  });
});


it('recovers a committed bootstrap before its checkpoint using the same source identity without another profile write', async () => {
  let committed = false; let loseAcknowledgment = true;
  const query = vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
    if (sql.includes('resolve-registration')) return committed ? [{ league_key: 'permanent-existing-key', season: 2026,
      league_id: 'original-league', league_season_id: 'original-season', scoring_profile_id: null }] : [];
    if (sql.includes('checkpoint')) {
      const captured = JSON.parse(String(parameters[1]));
      expect(captured).toMatchObject({ leagueId: 'original-league', leagueSeasonId: 'original-season' });
      expect(captured).not.toHaveProperty('diagnostic');
    }
    return [];
  });
  const queryAfterLock = vi.fn(async (_sql: string, parameters: readonly unknown[]) => {
    expect(parameters.slice(0, 2)).toEqual([null, null]); committed = true;
    if (loseAcknowledgment) { loseAcknowledgment = false; throw new Error('unknown commit acknowledgment'); }
    return [[], [{ league_id: 'original-league', league_season_id: 'original-season', scoring_profile_id: null }]];
  });
  const store = createPublicIntakeStore({ enabled: true, query, queryAfterLock } as unknown as DatabaseClient);
  const capture = fixture().capture({ ...league, scoring_settings: null, settings: null, roster_positions: [] });
  await expect(store.register(work, capture, fence)).rejects.toThrow('unknown commit acknowledgment');
  expect(query.mock.calls.filter(([sql]) => sql.includes('checkpoint'))).toHaveLength(0);
  await store.register(work, capture, fence);
  await store.register(work, { ...capture, payload: { ...league, scoring_settings: { rec: 1 } } }, fence);
  expect(queryAfterLock).toHaveBeenCalledOnce();
  expect(query.mock.calls.filter(([sql]) => sql.includes('checkpoint'))).toHaveLength(2);
});

it.each([
  { rows: [{ league_key: 'other-year', season: 2025, league_id: 'l', league_season_id: 's' }] },
  { rows: [{ season: 2026 }, { season: 2026 }] },
])('refuses ambiguous or cross-season identity before official registration', async ({ rows }) => {
  const query = vi.fn(async () => rows); const queryAfterLock = vi.fn();
  const store = createPublicIntakeStore({ enabled: true, query, queryAfterLock } as unknown as DatabaseClient);
  await expect(store.register(work, fixture().capture({ ...league, scoring_settings: null }), fence))
    .rejects.toThrow('Ambiguous public source identity');
  expect(queryAfterLock).not.toHaveBeenCalled(); expect(query).toHaveBeenCalledOnce();
});

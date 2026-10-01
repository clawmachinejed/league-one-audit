import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../lib/database';

const mocked = vi.hoisted(() => ({ ownerQuery: vi.fn(), pinnedQuery: vi.fn(), ownerClose: vi.fn(),
  runtimeClose: vi.fn(), register: vi.fn(), mapping: vi.fn() }));
vi.mock('./neon-integration-harness', () => ({ ownerQuery: mocked.ownerQuery,
  createPinnedIntegrationDatabase: async () => ({ database: { enabled: true, query: mocked.pinnedQuery }, close: mocked.ownerClose }) }));
vi.mock('./administration-enrollment-fixture', () => ({ registerEnrolledIntegrationSeason: mocked.register }));
vi.mock('../lib/league-administration/store', () => ({ createLeagueAdministrationStore: () => ({}) }));
vi.mock('../lib/league-administration/runtime', () => ({ captureAdministrationSourceMapping: mocked.mapping,
  recordCapturedAdministration: vi.fn() }));
vi.mock('../lib/sleeper', () => ({ getOfficialAdministrationObservation: vi.fn() }));
import { closeB4Fixture, createB4Fixture } from './b4-acceptance-fixture';

type Enrollment = { league_id: string; provider: string; active: boolean; evidence: string; enrolled_at: string };
type Membership = { league_id: string; season: number; provider: string; evidence: string; recorded_at: string };
type State = { enrollment: Enrollment | null; seasons: Membership[] | null };
const leagueId = '71000000-0000-4000-8000-000000000002';
const recordedAt = '2026-09-30T12:00:00.000Z';
const database: DatabaseClient = { enabled: true, query: async () => [] };
let state: State, transaction: State | null;

function originalState(): State {
  return { enrollment: { league_id: leagueId, provider: 'sleeper', active: true,
    evidence: 'original owner approval', enrolled_at: '2025-01-01T00:00:00.000Z' },
  seasons: [2024, 2025].map(season => ({ league_id: leagueId, season, provider: 'sleeper',
    evidence: `original ${season} approval`, recorded_at: '2025-01-01T00:00:00.000Z' })) };
}

beforeEach(() => {
  vi.resetAllMocks();
  state = { enrollment: null, seasons: null }; transaction = null;
  mocked.ownerClose.mockResolvedValue(undefined); mocked.runtimeClose.mockResolvedValue(undefined);
  mocked.ownerQuery.mockImplementation(async (statement: string) => {
    // This reproduces the old fixture's first DELETE failure without connecting to SQL.
    if (/DELETE FROM league_administration_enrollment_seasons/u.test(statement)) throw new Error('league administration history is immutable');
    if (!/^SELECT\b/u.test(statement.trim()) || /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CALL)\b/iu.test(statement)) {
      throw new Error('Fixture teardown must be read-only.');
    }
    if (statement.includes('to_jsonb(enrollment)')) return [structuredClone(state)];
    // Allows this focused regression to exercise the original fixture's extra pre-registration SELECT as well.
    if (statement.startsWith('SELECT membership.season')) return (state.seasons ?? []).map(row => ({ season: row.season }));
    throw new Error('Unexpected fixture owner query.');
  });
  mocked.pinnedQuery.mockImplementation(async (statement: string) => {
    if (statement === 'BEGIN') transaction = structuredClone(state);
    else if (statement === 'COMMIT') { state = transaction!; transaction = null; }
    else if (statement === 'ROLLBACK') transaction = null;
    else throw new Error('Unexpected fixture transaction statement.');
    return [];
  });
  mocked.register.mockImplementation(async (_query: unknown, input: { season: number }) => {
    if (!transaction) throw new Error('Fixture registration must remain in the pinned owner transaction.');
    transaction.enrollment ??= { league_id: leagueId, provider: 'sleeper', active: true,
      evidence: 'isolated fixture owner approval', enrolled_at: recordedAt };
    transaction.seasons ??= [];
    if (!transaction.seasons.some(row => row.season === input.season)) transaction.seasons.push({ league_id: leagueId,
      season: input.season, provider: 'sleeper', evidence: 'isolated fixture season approval', recorded_at: recordedAt });
    transaction.seasons.sort((a, b) => a.season - b.season);
  });
  mocked.mapping.mockImplementation(async (externalId: string) => ({ leagueSeasonId: `season-${externalId.slice(2, 6)}` }));
});

describe('B4 committed fixture teardown contract without SQL', () => {
  it('retains newly created immutable enrollment for the guarded global schema teardown', async () => {
    const fixture = await createB4Fixture(database), committed = structuredClone(state);
    const readsBeforeCleanup = mocked.ownerQuery.mock.calls.length;
    await fixture.cleanup();
    expect(state).toEqual(committed);
    expect(state.seasons?.map(row => row.season)).toEqual([2025, 2026]);
    expect(mocked.ownerQuery.mock.calls.slice(readsBeforeCleanup).every(([sql]) => /^SELECT\b/u.test(sql))).toBe(true);
    expect(mocked.register.mock.calls.map(([, input]) => input.season)).toEqual([2025, 2026]);
    expect(mocked.pinnedQuery.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(mocked.ownerClose).toHaveBeenCalledOnce();
  });

  it('preserves original enrollment and all historical memberships while validating only the expected additions', async () => {
    state = originalState();
    const original = structuredClone(state), fixture = await createB4Fixture(database);
    await closeB4Fixture(fixture, { close: mocked.runtimeClose });
    expect(state.enrollment).toEqual(original.enrollment);
    expect(state.seasons?.slice(0, 2)).toEqual(original.seasons);
    expect(state.seasons?.map(row => row.season)).toEqual([2024, 2025, 2026]);
    expect(mocked.ownerClose).toHaveBeenCalledOnce();
    expect(mocked.runtimeClose).toHaveBeenCalledOnce();
  });

  it.each([1, 2])('retains committed evidence and closes the runtime after mapping lookup %i fails', async failureAt => {
    const failure = new Error('synthetic post-registration mapping failure');
    if (failureAt === 2) mocked.mapping.mockResolvedValueOnce({ leagueSeasonId: 'season-2025' });
    mocked.mapping.mockRejectedValueOnce(failure);
    await expect(createB4Fixture(database)).rejects.toBe(failure);
    expect(state.seasons?.map(row => row.season)).toEqual([2025, 2026]);
    expect(mocked.ownerQuery).toHaveBeenCalledTimes(3); // before, committed, and failed-setup validation
    expect(mocked.ownerQuery.mock.calls.every(([sql]) => /^SELECT\b/u.test(sql))).toBe(true);
    expect(mocked.ownerClose).toHaveBeenCalledOnce();
    await closeB4Fixture(undefined, { close: mocked.runtimeClose });
    expect(mocked.runtimeClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['changed original enrollment', (value: State) => { value.enrollment!.evidence = 'changed'; }],
    ['changed original season evidence', (value: State) => { value.seasons![0].evidence = 'changed'; }],
    ['missing original membership', (value: State) => { value.seasons!.shift(); }],
    ['missing created membership', (value: State) => { value.seasons!.pop(); }],
    ['unexpected membership', (value: State) => { value.seasons!.push({ ...value.seasons![0], season: 2027 }); }],
    ['changed created timestamp', (value: State) => { value.seasons!.at(-1)!.recorded_at = '2026-09-30T13:00:00.000Z'; }],
  ] as const)('rejects %s and still closes the independent restricted connection', async (_name, corrupt) => {
    state = originalState();
    const fixture = await createB4Fixture(database);
    corrupt(state);
    await expect(closeB4Fixture(fixture, { close: mocked.runtimeClose })).rejects.toThrow();
    expect(mocked.runtimeClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrong enrollment provider', (value: State) => { value.enrollment!.provider = 'other'; }],
    ['wrong membership league', (value: State) => { value.seasons![0].league_id = 'wrong-league'; }],
    ['wrong membership evidence', (value: State) => { value.seasons![0].evidence = 'unapproved'; }],
    ['invalid recorded timestamp', (value: State) => { value.seasons![0].recorded_at = 'invalid'; }],
  ] as const)('does not accept a committed baseline with %s', async (_name, corrupt) => {
    const query = mocked.pinnedQuery.getMockImplementation()!;
    mocked.pinnedQuery.mockImplementation(async (statement: string) => {
      const result = await query(statement);
      if (statement === 'COMMIT') corrupt(state);
      return result;
    });
    await expect(createB4Fixture(database)).rejects.toThrow();
    expect(mocked.mapping).not.toHaveBeenCalled();
    expect(mocked.ownerClose).toHaveBeenCalledOnce();
    await closeB4Fixture(undefined, { close: mocked.runtimeClose });
    expect(mocked.runtimeClose).toHaveBeenCalledOnce();
  });

  it('rolls back failed registration and closes the pinned owner before runtime cleanup', async () => {
    const failure = new Error('synthetic registration conflict');
    mocked.register.mockRejectedValueOnce(failure);
    await expect(createB4Fixture(database)).rejects.toBe(failure);
    expect(state).toEqual({ enrollment: null, seasons: null });
    expect(mocked.pinnedQuery.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(mocked.ownerClose).toHaveBeenCalledOnce();
    await closeB4Fixture(undefined, { close: mocked.runtimeClose });
    expect(mocked.runtimeClose).toHaveBeenCalledOnce();
  });
});

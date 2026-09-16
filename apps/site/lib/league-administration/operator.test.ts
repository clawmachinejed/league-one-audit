import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAdministrationOperatorInput, runAdministrationOperator } from './operator';
import { runAdministrationMaintenance } from './maintenance';
import { createLeagueRegistry } from '../projections/adapters/configuration/league-registry';
import { externalLeagueRef, providerKey } from '../projections/shared/provider-identity';

const mock = vi.hoisted(() => ({
  store: { enabled: true, listEnrollments: vi.fn(), recordObservation: vi.fn() },
  jobs: { enabled: true, readDatabaseIdentity: vi.fn(), readAllPlayerLeagueProfiles: vi.fn(),
    acquireJob: vi.fn(), completeJob: vi.fn(), failJob: vi.fn(), readLeagueLineupAuthorities: vi.fn() },
  core: vi.fn(), matchup: vi.fn(), transactions: vi.fn(), metadata: vi.fn(), capture: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../database', () => ({ getDatabase: () => ({ enabled: true }), withDatabaseAbortSignal: (database: unknown) => database }));
vi.mock('../projection-store', () => ({ createProjectionStore: () => mock.jobs }));
vi.mock('./store', () => ({ createLeagueAdministrationStore: () => mock.store }));
vi.mock('./runtime', () => ({ recordCapturedAdministration: mock.capture }));
vi.mock('../sleeper', () => ({ getOfficialLeagueAdministration: mock.core,
  getOfficialMatchupObservation: mock.matchup, getOfficialTransactionWeek: mock.transactions,
  getOfficialAdministrationMetadata: mock.metadata }));

const scope = { leagueId: 'league', leagueSeasonId: 'season', leagueKey: 'example', displayName: 'Example',
  season: 2026, provider: 'sleeper', externalLeagueId: 'external', scoringProfileId: 'profile' };
const time = '2026-09-16T18:30:00.000Z';
const doc = (family: string, payload: unknown, week: number | null = null) => ({ family, payload, week,
  origin: 'network', sourceObservedAt: time, requestStartedAt: time, requestCompletedAt: time });
const input = { mode: 'shadow' as const, season: 2026, league: 'all', weeks: [1],
  expectedDatabase: 'isolated', expectedRole: 'league_one_runtime' };
const registry = createLeagueRegistry([{ key: 'example', displayName: 'Example',
  leagueRef: externalLeagueRef(providerKey('sleeper'), 'external'), matchupWeekRange: { firstWeek: 1, lastWeek: 18 } }]);

beforeEach(() => {
  vi.resetAllMocks();
  mock.store.listEnrollments.mockResolvedValue([scope]);
  mock.jobs.readDatabaseIdentity.mockResolvedValue({ databaseName: 'isolated', roleName: 'league_one_runtime' });
  mock.jobs.readAllPlayerLeagueProfiles.mockResolvedValue([{ scoringProfileId: 'profile', leagueSeasonId: 'season' }]);
  mock.jobs.acquireJob.mockResolvedValue({ kind: 'acquired', attempt: 1 });
  mock.jobs.completeJob.mockResolvedValue(true); mock.jobs.failJob.mockResolvedValue(true);
  mock.jobs.readLeagueLineupAuthorities.mockResolvedValue([{ kind: 'available', authority: {
    lineupShape: { sourceExternalLeagueId: 'external' }, activeSeason: 2026, activeWeek: 2 } }]);
  mock.core.mockResolvedValue([
    doc('league', { league_id: 'external', season: '2026', sport: 'nfl', total_rosters: 1,
      roster_positions: ['QB', 'BN'], scoring_settings: { pass_yd: 0.04 }, settings: {} }),
    doc('rosters', [{ roster_id: 1, owner_id: 'owner', players: ['player'], starters: ['player'] }]),
    doc('users', [{ user_id: 'owner', display_name: 'Owner' }]),
  ]);
  mock.matchup.mockResolvedValue(doc('matchups', [{ roster_id: 1, matchup_id: 1, players: ['player'],
    starters: ['player'], points: 12 }], 1));
  mock.transactions.mockResolvedValue(doc('transactions', [], 1));
  mock.metadata.mockResolvedValue({ observations: ['drafts', 'traded_picks', 'winners_bracket', 'losers_bracket']
    .map(family => doc(family, [])), providerRequests: 4 });
  mock.capture.mockResolvedValue({ status: 'stored', results: Array.from({ length: 5 }, () => ({})) });
});

describe('administration operator and scheduled boundary', () => {
  it('shadows complete approved data with no job or source-history writes', async () => {
    expect(await runAdministrationOperator(input)).toMatchObject({ status: 'completed', documents: 5,
      accepted: 5, rejected: 0, providerRequests: 5, writes: false });
    expect(mock.store.listEnrollments).toHaveBeenCalledWith(2026);
    expect(mock.capture).not.toHaveBeenCalled(); expect(mock.store.recordObservation).not.toHaveBeenCalled();
    expect(mock.jobs.acquireJob).not.toHaveBeenCalled(); expect(mock.jobs.completeJob).not.toHaveBeenCalled();
  });

  it('does not declare shadow success for incompatible scoring or incomplete weekly population', async () => {
    mock.jobs.readAllPlayerLeagueProfiles.mockResolvedValueOnce([]);
    expect(await runAdministrationOperator(input)).toMatchObject({ status: 'failed', providerRequests: 3 });
    expect(mock.matchup).not.toHaveBeenCalled();
    mock.matchup.mockResolvedValueOnce(doc('matchups', [], 1));
    expect(await runAdministrationOperator(input)).toMatchObject({ status: 'partial', documents: 5, rejected: 1 });
    expect(mock.capture).not.toHaveBeenCalled();
  });

  it('uses the recurring ownership claim, refuses busy work, and passes one live fence through every write', async () => {
    mock.jobs.acquireJob.mockResolvedValueOnce({ kind: 'busy' });
    expect(await runAdministrationOperator({ ...input, mode: 'write' })).toMatchObject({ status: 'busy', providerRequests: 0 });
    expect(mock.core).not.toHaveBeenCalled();
    expect(await runAdministrationOperator({ ...input, mode: 'write' })).toMatchObject({ status: 'completed', writes: true });
    expect(mock.capture).toHaveBeenCalledTimes(2);
    const options = mock.capture.mock.calls.map(call => call[2]);
    expect(options[0].fence).toEqual(options[1].fence);
    expect(options[1]).toMatchObject({ expectedRosterCount: 1, signal: expect.any(AbortSignal),
      fence: { jobKey: 'league-administration-maintenance', generation: 1 } });
  });

  it('fails durably on source errors and lost completion ownership without claiming success', async () => {
    mock.transactions.mockRejectedValueOnce(new Error('private source details'));
    expect(await runAdministrationOperator({ ...input, mode: 'write' })).toMatchObject({ status: 'failed' });
    expect(mock.jobs.failJob).toHaveBeenCalledWith('league-administration-maintenance', expect.any(String), 'administration-operator-failed');
    mock.jobs.completeJob.mockResolvedValueOnce(false);
    expect(await runAdministrationOperator({ ...input, mode: 'write' })).toMatchObject({ status: 'failed' });
  });

  it('checks database identity and request bounds before contacting the source', async () => {
    mock.jobs.readDatabaseIdentity.mockResolvedValueOnce({ databaseName: 'wrong', roleName: 'league_one_runtime' });
    await expect(runAdministrationOperator(input)).rejects.toThrow('identity mismatch');
    mock.store.listEnrollments.mockResolvedValueOnce(Array.from({ length: 50 }, () => scope));
    await expect(runAdministrationOperator(input)).rejects.toThrow('120-request');
    expect(mock.core).not.toHaveBeenCalled();
  });

  it('bounds scheduled work and avoids completion-time drift in the hourly claim', async () => {
    vi.useFakeTimers({ now: new Date(time) });
    try {
      expect(await runAdministrationMaintenance(registry, Date.now() - 34_000)).toEqual({ status: 'not-due' });
      expect(await runAdministrationMaintenance(registry, Date.now())).toMatchObject({ status: 'completed' });
      expect(mock.jobs.acquireJob.mock.calls[0][0]).toMatchObject({ scheduledFor: '2026-09-16T18:00:00.000Z' });
      expect(mock.jobs.acquireJob.mock.calls[0][0]).not.toHaveProperty('minimumIntervalSeconds');
      expect(mock.capture.mock.calls[0][2]).toHaveProperty('signal');
      mock.jobs.acquireJob.mockResolvedValueOnce({ kind: 'busy' });
      expect(await runAdministrationMaintenance(registry, Date.now())).toEqual({ status: 'busy' });
      expect(mock.core).toHaveBeenCalledTimes(1);
      mock.capture.mockResolvedValueOnce({ status: 'unavailable' });
      expect(await runAdministrationMaintenance(registry, Date.now())).toEqual({ status: 'failed' });
      expect(mock.jobs.failJob).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('requires exact environment, TLS, session role, and write-scope authorization', () => {
    const args = ['--mode', 'shadow', '--season', '2026', '--league', 'all', '--weeks', '0-18'];
    const env = { VERCEL_ENV: 'integration', LEAGUE_ADMINISTRATION_TARGET_ENVIRONMENT: 'integration',
      DATABASE_URL: 'postgresql://league_one_runtime:example@isolated.invalid/isolated?sslmode=require',
      LEAGUE_ADMINISTRATION_EXPECTED_DATABASE: 'isolated', LEAGUE_ADMINISTRATION_EXPECTED_ROLE: 'league_one_runtime',
      LEAGUE_ADMINISTRATION_EXPECTED_HOST: 'isolated.invalid' };
    expect(parseAdministrationOperatorInput(args, env).weeks).toHaveLength(19);
    expect(() => parseAdministrationOperatorInput(args, { ...env, VERCEL_ENV: 'production' })).toThrow('environment mismatch');
    expect(() => parseAdministrationOperatorInput(args, { ...env, DATABASE_URL: env.DATABASE_URL.replace('require', 'disable') })).toThrow('target mismatch');
    expect(() => parseAdministrationOperatorInput(args, { ...env, LEAGUE_ADMINISTRATION_WRITE_AUTHORIZATION: '2026:all:0-18' })).toThrow('authority');
    const write = args.map(value => value === 'shadow' ? 'write' : value);
    expect(() => parseAdministrationOperatorInput(write, env)).toThrow('authority');
    expect(parseAdministrationOperatorInput(write, { ...env, LEAGUE_ADMINISTRATION_WRITE_AUTHORIZATION: '2026:all:0-18' }).mode).toBe('write');
    expect(() => parseAdministrationOperatorInput([...write, '--metadata', 'include'],
      { ...env, LEAGUE_ADMINISTRATION_WRITE_AUTHORIZATION: '2026:all:0-18' })).toThrow('authority');
    expect(parseAdministrationOperatorInput([...write, '--metadata', 'include'],
      { ...env, LEAGUE_ADMINISTRATION_WRITE_AUTHORIZATION: '2026:all:0-18:metadata' }).includeMetadata).toBe(true);
  });

  it('includes bounded metadata in shadow and reports incomplete metadata instead of claiming success', async () => {
    expect(await runAdministrationOperator({ ...input, includeMetadata: true })).toMatchObject({ status: 'completed',
      documents: 9, providerRequests: 9, writes: false });
    expect(mock.metadata).toHaveBeenCalledWith('external', 2026, expect.objectContaining({ maxRequests: 115 }));
    mock.metadata.mockResolvedValueOnce({ observations: [doc('drafts', [])], providerRequests: 1,
      reason: 'metadata-request-budget-exceeded' });
    expect(await runAdministrationOperator({ ...input, includeMetadata: true })).toMatchObject({ status: 'failed',
      reason: 'metadata-request-budget-exceeded' });
    expect(mock.capture).not.toHaveBeenCalled();
  });
});

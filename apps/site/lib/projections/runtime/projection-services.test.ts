import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectionServices } from './projection-services';
import { createProductionSharedServices } from './shared-services';
import { externalLeagueRef } from '../shared/provider-identity';
import type { ProjectionSyncInput } from '../../sleeper';

const mocks = vi.hoisted(() => ({ mapping: vi.fn(), reserve: vi.fn(), load: vi.fn(), record: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../sleeper', () => ({ getProjectionSyncInput: mocks.load }));
vi.mock('../../league-administration/runtime', () => ({ captureAdministrationSourceMapping: mocks.mapping,
  beginCalculationSourceCapture: mocks.reserve, recordCapturedAdministration: mocks.record }));

const time = '2026-09-16T18:00:00.000Z';
const period = { season: 2026, seasonType: 'regular' as const, week: 3 };
const configuration = { key: 'league1', displayName: 'League One', leagueRef: externalLeagueRef('sleeper', 'source-2026'),
  matchupWeekRange: { firstWeek: 1, lastWeek: 18 } };
const team = { id: 1, managerName: 'Manager', name: 'Team', avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
  revisionId: '33333333-3333-4333-8333-333333333333', generation: 1,
  scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'source-2026', season: 2026 } };
const reservation = { id: '44444444-4444-4444-8444-444444444444', reservedAt: '2026-09-16T17:59:59.123456+00:00' };
const context = { observationId: 'league-observation', configurationVersionId: 'configuration', generation: 1,
  sourceCapture: { captureId: reservation.id, leagueInputId: 'league-input', matchupInputId: 'matchup-input' } };

function input(): ProjectionSyncInput {
  const teams = [team, { ...team, id: 2 }];
  return { sleeperLeagueId: 'source-2026', leagueName: 'League One', scoringSettings: { pass_td: 6 },
    requestStartedAt: time, requestCompletedAt: time,
    rawMatchups: [{ roster_id: 1, matchup_id: 1, starters: ['0'] }, { roster_id: 2, matchup_id: 1, starters: ['0'] }],
    matchupShape: { rosterIds: [1, 2], expectedRosterCount: 2, expectedStarterSlotCount: 1, starterSlots: ['QB'] },
    rosteredPlayers: [], schedule: {},
    data: { league: { season: '2026', week: 3, maxWeek: 18, rosterPositions: ['QB', 'BN'] }, teams,
      week: 3, updatedAt: time, matchups: [{ id: '1', status: 'upcoming', sides: teams.map(team => ({ team, points: 0,
        projectedPoints: null, starters: [{ id: 'empty-QB-1', name: 'Empty slot', position: 'QB', slot: 'QB',
          nflTeam: null, injuryStatus: null, game: null, points: null, projectedPoints: null }] })) }] },
    administrationObservations: [{ family: 'league', week: null, payload: { league_id: 'source-2026' },
      requestStartedAt: time, requestCompletedAt: time, origin: 'cache', sourceObservedAt: null }] };
}
function services() {
  const shared = createProductionSharedServices('test');
  return createProjectionServices({ ...shared, logger: { write: vi.fn() }, clock: { ...shared.clock, now: () => new Date(time) } });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mapping.mockResolvedValue(mapping); mocks.reserve.mockResolvedValue(reservation);
  mocks.load.mockResolvedValue(input()); mocks.record.mockResolvedValue({ status: 'stored', results: [], context });
});

describe('projection source capture composition', () => {
  it('reserves before the sole source load and carries returned exact input IDs through the actual Sleeper adapter', async () => {
    const result = await services().leagueSource.getLeagueWeek(configuration, period);
    expect(mocks.mapping).toHaveBeenCalledExactlyOnceWith('source-2026');
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(mapping, 3);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith('source-2026', period);
    expect(mocks.mapping.mock.invocationCallOrder[0]).toBeLessThan(mocks.reserve.mock.invocationCallOrder[0]);
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.load.mock.invocationCallOrder[0]);
    expect(mocks.record.mock.calls[0][2]).toMatchObject({ mapping, calculationCapture: { week: 3, reservation } });
    expect(result.administrationContext).toEqual(context);
    expect(result.period).toEqual(period);
    expect(result.matchups[0].sides[0].officialPoints).toBe(0);
  });

  it('does not start provider acquisition after a failed pre-acquisition reservation', async () => {
    mocks.reserve.mockRejectedValue(new Error('source mapping changed'));
    await expect(services().leagueSource.getLeagueWeek(configuration, period)).rejects.toThrow('source mapping changed');
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });

  it('preserves disabled-persistence loading without an invented association', async () => {
    mocks.mapping.mockResolvedValue(null); mocks.record.mockResolvedValue({ status: 'disabled', results: [] });
    const result = await services().leagueSource.getLeagueWeek(configuration, period);
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.record.mock.calls[0][2]).not.toHaveProperty('calculationCapture');
    expect(result.administrationContext).toBeUndefined();
  });
});

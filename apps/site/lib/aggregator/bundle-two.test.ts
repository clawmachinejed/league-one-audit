import { describe, expect, it, vi } from 'vitest';
import { createBundleTwoReadService, type BundleTwoDependencies, type BundleTwoReadInput } from './bundle-two';
import { createBundleTwoReader } from './bundle-two-reader';
import { b2Capture } from './b2-acceptance.fixtures';
import { b1CompatibilityInput, b1Uuid } from './b1-acceptance.fixtures';
import { readAcceptedExactMatchupsRows } from '../league-administration/neon/exact-matchups';
import { buildSeasonOfficialStandings, joinCurrentSeasonMatchupSummary } from './season-overview-standings';
import { buildSeasonRosterSummaries } from './season-overview-rosters';
import { seasonOverviewFixture } from './season-overview-schedules.fixtures';
import { exactMatchupsScope } from './exact-matchups';

vi.mock('server-only', () => ({}));
async function setup() {
  const fixture = await b2Capture();
  const exact = readAcceptedExactMatchupsRows(fixture.b1.accepted_rows, fixture.mapping, 4);
  const input: BundleTwoReadInput = { expectedMapping: fixture.mapping, league: fixture.b1.snapshot_rows[0].payload.league,
    context: b1CompatibilityInput.context, selectedWeek: 4, selectedSeasonTeamId: fixture.source.teams[0].seasonTeamId,
    now: fixture.now, calendar: null, scheduleRange: null, snapshot: null };
  const reads = { enabled: true,
    readSourceMapping: vi.fn(async () => fixture.mapping),
    readAcceptedCurrentRoster: vi.fn(async () => fixture.roster),
    readAcceptedTeamManagers: vi.fn(async () => ({ status: 'missing' as const })),
    readAcceptedLeagueSettings: vi.fn(async () => fixture.settings), readSource: vi.fn(async () => fixture.users),
    readEnrollment: vi.fn(async () => ({ status: 'missing' as const })),
    readAcceptedExactMatchups: vi.fn(async (_mapping, week: number) => week === 4 ? exact : { status: 'missing' as const }),
    readExactMatchupCompatibility: vi.fn(async () => { throw new Error('No snapshot requested.'); }),
    readAllPlayerPlayerMetrics: vi.fn(async () => { throw new Error('No metric cutoff supplied.'); }),
  } satisfies BundleTwoDependencies;
  return { fixture, exact, input, reads, service: createBundleTwoReadService(reads) };
}

describe('B2 composed existing reads', () => {
  it('disabled persistence never examines inputs or creates a source query', async () => {
    const request = new Proxy({}, { get: () => { throw new Error('Inspected disabled input.'); } }) as BundleTwoReadInput;
    expect(await createBundleTwoReader({ enabled: false, reason: 'missing-database-url' }).readBundleTwo(request))
      .toMatchObject({ status: 'disabled', reason: 'persistence_disabled' });
  });

  it('composes exact current facts and independent missing derived resources with bounded lazy reads', async () => {
    const { service, input, reads } = await setup();
    const result = await service.readBundleTwo(input);
    expect(result.status).toBe('read');
    if (result.status !== 'read') throw new Error('Read unavailable.');
    expect(result.source).toMatchObject({ status: 'available', teams: [{ pointsFor: { value: '100.00001' } }, {}] });
    expect(result.standings.status).toBe('available');
    expect(result.matchupSummary).toMatchObject({ status: 'available', temporalContext: 'current-display' });
    expect(result.schedule).toMatchObject({ status: 'unavailable', reason: 'schedule_not_requested' });
    expect(result.playerMetrics.status).toBe('unavailable');
    expect(result.projectedStandings.status).toBe('unavailable');
    expect(reads.readAcceptedExactMatchups.mock.calls.map(call => call[1])).toEqual([4]);
    expect(reads.readAcceptedCurrentRoster).toHaveBeenCalledWith(input.expectedMapping, { includeSeasonOverview: true });
    expect(reads.readAllPlayerPlayerMetrics).not.toHaveBeenCalled();
    expect(reads.readExactMatchupCompatibility).not.toHaveBeenCalled();
    expect(reads.readSourceMapping).toHaveBeenCalledTimes(2);
  });

  it.each([['my-team', 15], ['manager', 14]] as const)('loads the explicit %s schedule horizon once', async (scheduleRange, count) => {
    const { service, input, reads } = await setup();
    const result = await service.readBundleTwo({ ...input, scheduleRange });
    if (result.status !== 'read') throw new Error('Read unavailable.');
    expect(result.schedule).toMatchObject({ status: 'available', range: { fromWeek: 1, throughWeek: count } });
    expect(reads.readAcceptedExactMatchups).toHaveBeenCalledTimes(count);
  });

  it('fences a mapping change before returning joined values', async () => {
    const { service, input, reads, fixture } = await setup();
    reads.readSourceMapping.mockResolvedValueOnce(fixture.mapping).mockResolvedValueOnce({ ...fixture.mapping, generation: 2 });
    expect(await service.readBundleTwo(input)).toEqual({ status: 'unavailable', reason: 'season_overview_mapping_changed' });
  });

  it('keeps current projections available when the requested schedule has missing future weeks', async () => {
    const { reads, input } = await setup();
    const projection = await seasonOverviewFixture();
    if (projection.settings.status !== 'available') throw new Error('Settings unavailable.');
    const fixture = await b2Capture(rows => rows.forEach((row, index) => {
      rows[index] = { ...row, settings: { wins: 0, losses: 0, ties: 3, fpts: 0, fpts_against: 0 } };
    }));
    reads.readAcceptedCurrentRoster.mockResolvedValue(fixture.roster);
    reads.readAcceptedLeagueSettings.mockResolvedValue(projection.settings);
    reads.readAcceptedExactMatchups.mockImplementation(async (_mapping, week) => {
      if (week === 4) return projection.compatibility!.official;
      const capture = projection.captures.find(capture => capture.status === 'available' && capture.value.period.nativeWeek === week);
      return capture?.status === 'available' && 'accepted' in capture ? capture : { status: 'missing' };
    });
    const service = createBundleTwoReadService({ ...reads, readExactMatchupCompatibility: async () => projection.compatibility! });
    const requested = { ...input, now: new Date('2026-09-30T12:03:00.000Z'), calendar: projection.calendar, snapshot: b1CompatibilityInput.request };
    const withoutSchedule = await service.readBundleTwo(requested);
    const withSchedule = await service.readBundleTwo({ ...requested, scheduleRange: 'my-team' });
    if (withoutSchedule.status !== 'read' || withSchedule.status !== 'read') throw new Error('Read unavailable.');
    expect(withoutSchedule.projectedStandings.status).toBe('available');
    expect(withSchedule.projectedStandings).toEqual(withoutSchedule.projectedStandings);
    expect(withSchedule.rosterSummaries).toEqual(withoutSchedule.rosterSummaries);
  });

  it('withholds completed-history averages across a calendar/context rollover disagreement', async () => {
    const { service, input } = await setup();
    const projection = await seasonOverviewFixture();
    const result = await service.readBundleTwo({ ...input, now: new Date('2026-09-30T12:03:00.000Z'),
      calendar: projection.calendar, context: { ...input.context, activeWeek: 5, defaultWeek: 5 } });
    if (result.status !== 'read') throw new Error('Read unavailable.');
    expect(result.source.status).toBe('available');
    expect(result.rosterSummaries).toMatchObject({ status: 'available', history: { throughWeek: null },
      teams: [{ averagePpg: null }, { averagePpg: null }] });
  });

  it.each([
    ['evaluation and retrieval', '2026-09-29T16:59:59.999Z'],
    ['retrieval completion', '2026-09-29T17:00:00.500Z'],
  ])('withholds calendar-dependent derivatives when calendar %s is later than the read', async (_label, now) => {
    const { input, reads, fixture } = await setup();
    const projection = await seasonOverviewFixture();
    if (projection.settings.status !== 'available') throw new Error('Settings unavailable.');
    reads.readAcceptedLeagueSettings.mockResolvedValue(projection.settings);
    reads.readAcceptedExactMatchups.mockImplementation(async (_mapping, week) => {
      if (week === 4) return projection.compatibility!.official;
      const capture = projection.captures.find(capture => capture.status === 'available' && capture.value.period.nativeWeek === week);
      return capture?.status === 'available' && 'accepted' in capture ? capture : { status: 'missing' };
    });
    const service = createBundleTwoReadService({ ...reads,
      readExactMatchupCompatibility: async () => projection.compatibility!,
      readEnrollment: async () => ({ status: 'ready', intended: { leagueId: b1Uuid(81), leagueKey: fixture.mapping.scope.leagueKey,
        provider: 'sleeper', season: 2026 }, enrollment: { leagueId: b1Uuid(81), leagueSeasonId: fixture.mapping.leagueSeasonId,
        leagueKey: fixture.mapping.scope.leagueKey, displayName: 'Synthetic league', season: 2026,
        provider: 'sleeper', externalLeagueId: fixture.mapping.scope.externalLeagueId, scoringProfileId: b1Uuid(16) } }),
    });
    const result = await service.readBundleTwo({ ...input, now: new Date(now), calendar: projection.calendar,
      snapshot: b1CompatibilityInput.request, scheduleRange: 'my-team' });
    if (result.status !== 'read' || result.schedule.status !== 'available') throw new Error('Official read unavailable.');
    expect(result.source.status).toBe('available');
    expect(result.matchupSummary.status).toBe('available');
    expect(result.rosterSummaries).toMatchObject({ status: 'available', history: { throughWeek: null },
      teams: [{ averagePpg: null }, { averagePpg: null }] });
    expect(result.projectedStandings).toMatchObject({ status: 'unavailable', reason: 'completed_history_calendar_unproved' });
    expect(result.schedule.limitations).toContain('calendar_completion_unproved');
    expect(result.playerMetrics.status).toBe('unavailable');
    expect(reads.readAllPlayerPlayerMetrics).not.toHaveBeenCalled();
  });

  it('isolates a failed users read and preserves official records while withholding name-dependent rank', async () => {
    const { service, input, reads } = await setup();
    reads.readSource.mockRejectedValueOnce(new Error('transport'));
    const result = await service.readBundleTwo(input);
    if (result.status !== 'read' || result.standings.status !== 'available') throw new Error('Official facts unavailable.');
    expect(result.standings.teams[0].official.record.wins.value).toBe(1);
    expect(result.standings.teams.map(team => team.leagueOneOrder)).toEqual([null, null]);
    expect(result.managerDirectory.status).toBe('available');
  });
});

describe('B2 current facts and distinct local orders', () => {
  it('keeps exact values, provider rank absence and both local tie-breaks separate', async () => {
    const fixture = await b2Capture();
    const standings = buildSeasonOfficialStandings(fixture);
    const rosters = buildSeasonRosterSummaries({ ...fixture, currentRoster: fixture.roster, history: [],
      boundary: { selectedWeek: 4, activeWeek: 4, lastScoredWeek: 3, lifecycle: 'active' } });
    if (standings.status !== 'available' || rosters.status !== 'available') throw new Error('Read unavailable.');
    expect(standings.teams.map(team => team.leagueOneOrder)).toEqual([1, 2]);
    expect(rosters.teams.map(team => team.standingsRank)).toEqual([2, 1]);
    expect(standings.teams[0].official.pointsFor.value).toBe('100.00001');
    expect(standings.teams[0].official.providerRank.state).toBe('absent');
    expect(standings.teams[0].waiver.budgetRemaining).toBe(110);
    expect(standings.compatibility.status === 'available' && standings.compatibility.teams[0].pointsFor).toBe(100);
  });

  it('keeps current record overlay on historical views and rejects different season teams', async () => {
    const { fixture, exact } = await setup();
    if (exact.status !== 'available') throw new Error('Exact fixture unavailable.');
    const standings = buildSeasonOfficialStandings(fixture);
    const inconsistent = { ...exact, value: { ...exact.value, period: { ...exact.value.period, nativeWeek: 1 } } };
    expect(joinCurrentSeasonMatchupSummary(fixture.mapping, inconsistent, standings).status).toBe('unavailable');
    const historical = { ...inconsistent, accepted: { ...exact.accepted, scope: exactMatchupsScope(fixture.mapping, 1) },
      value: { ...inconsistent.value, period: { ...inconsistent.value.period, source: { ...exact.value.period.source, nativeId: '1' } } } };
    expect(joinCurrentSeasonMatchupSummary(fixture.mapping, historical, standings))
      .toMatchObject({ status: 'available', temporalContext: 'current-display', teams: [{ currentRecord: { wins: { value: 1 } } }, {}] });
    expect(joinCurrentSeasonMatchupSummary({ ...fixture.mapping, scope: { ...fixture.mapping.scope, season: 2027 } }, historical, standings).status)
      .toBe('unavailable');
  });
});

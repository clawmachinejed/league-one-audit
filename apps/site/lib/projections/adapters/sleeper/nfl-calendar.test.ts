import { describe, expect, it, vi } from 'vitest';
import type { ProjectionCadenceInput } from '../../../sleeper';
import { externalLeagueRef, externalRosterRef } from '../../shared/provider-identity';
import { createSleeperNflCalendar, sleeperPeriodAuthority } from './nfl-calendar';

const configuration = {
  key: 'premier',
  displayName: 'Premier League',
  leagueRef: externalLeagueRef('official-source', 'league-001'),
  matchupWeekRange: { firstWeek: 1, lastWeek: 18 },
};

function cadence(
  overrides: Partial<ProjectionCadenceInput> = {},
): ProjectionCadenceInput {
  return {
    sleeperLeagueId: 'league-001',
    matchupShape: { rosterIds: [1, 2], expectedRosterCount: 2, expectedStarterSlotCount: 1, starterSlots: ['QB'] },
    season: '2026',
    defaultDisplayWeek: 1,
    week: 1,
    activeScoringWeek: 1,
    leagueLifecycle: 'active',
    leagueStatus: 'in_season',
    schedule: {
      JAX: {
        kind: 'scheduled',
        opponent: 'KC',
        location: 'home',
        date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
      KC: {
        kind: 'scheduled',
        opponent: 'JAX',
        location: 'away',
        date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
    },
    currentNflSeason: '2026',
    currentNflWeek: 1,
    currentNflSeasonType: 'regular',
    requestStartedAt: '2026-09-13T15:59:58.000Z',
    requestCompletedAt: '2026-09-13T15:59:59.000Z',
    verifiedAt: '2026-09-13T16:00:00.000Z',
    ...overrides,
  };
}

const siteWeekPolicy = {
  version: 'schedule-noon-eastern-v1',
  scheduleRevision: 'fixture-season-schedule',
  nextRolloverAt: '2026-09-15T16:00:00.000Z',
  evaluatedAt: '2026-09-13T15:59:58.000Z',
};

describe('Sleeper NFL calendar adapter', () => {
  it('performs one injected load and translates the cadence without changing timestamps', async () => {
    const load = vi.fn(async () => cadence());
    const calendar = createSleeperNflCalendar(load);

    const result = await calendar.getCadenceState(configuration);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('league-001');
    expect(result).toEqual({
      configuration,
      period: { season: 2026, seasonType: 'regular', week: 1 },
      periodAuthority: expect.objectContaining({
        configuration,
        defaultDisplayPeriod: { season: 2026, seasonType: 'regular', week: 1 },
        activeScoringPeriod: { season: 2026, seasonType: 'regular', week: 1 },
        lifecycle: 'active',
        nflPhase: 'regular',
        source: 'official-source',
        observedAt: '2026-09-13T15:59:59.000Z',
        verifiedAt: '2026-09-13T16:00:00.000Z',
      }),
      currentPeriod: { season: 2026, week: 1, seasonType: 'regular' },
      lineupShape: { expectedRosterCount: 2, expectedStarterSlotCount: 1,
        expectedRosterRefs: [externalRosterRef(configuration.leagueRef, '1'), externalRosterRef(configuration.leagueRef, '2')] },
      defaultPeriodCadence: { isCurrentRegularPeriod: true,
        games: [{ kickoffAt: '2026-09-13T17:00:00.000Z', date: '2026-09-13' },
          { kickoffAt: '2026-09-13T17:00:00.000Z', date: '2026-09-13' }] },
      schedule: cadence().schedule,
    });
  });

  it('preserves unavailable or unknown current-NFL state', async () => {
    const result = await createSleeperNflCalendar(async () => cadence({
      currentNflSeason: null,
      currentNflWeek: null,
      currentNflSeasonType: 'mystery-stage',
    })).getCadenceState(configuration);

    expect(result.currentPeriod).toEqual({
      season: null,
      week: null,
      seasonType: 'mystery-stage',
    });
  });

  it('targets the active scoring week while preserving an advanced display-week default', async () => {
    const activeSchedule = cadence().schedule;
    const result = await createSleeperNflCalendar(async () => cadence({
      defaultDisplayWeek: 2,
      week: 1,
      activeScoringWeek: 1,
      currentNflWeek: 1,
      schedule: activeSchedule,
    })).getCadenceState(configuration);

    expect(result.period).toEqual({ season: 2026, seasonType: 'regular', week: 1 });
    expect(result.schedule).toEqual(activeSchedule);
    expect(result.defaultPeriodCadence).toEqual({ isCurrentRegularPeriod: false, games: [] });
    expect(result.periodAuthority).toMatchObject({
      defaultDisplayPeriod: { season: 2026, seasonType: 'regular', week: 2 },
      activeScoringPeriod: { season: 2026, seasonType: 'regular', week: 1 },
    });
  });

  it.each([
    cadence({ sleeperLeagueId: 'another-league' }),
    cadence({ season: '1999' }),
    cadence({ week: 19 }),
  ])('rejects provider identity or period mismatches', async (source) => {
    await expect(createSleeperNflCalendar(async () => source)
      .getCadenceState(configuration)).rejects.toThrow(/Sleeper returned/u);
  });

  it('rejects ambiguous or invalid schedule identities', async () => {
    await expect(createSleeperNflCalendar(async () => cadence({
      schedule: {
        JAC: { kind: 'bye' },
        JAX: { kind: 'bye' },
      },
    })).getCadenceState(configuration)).rejects.toThrow('Sleeper returned an invalid NFL schedule.');
  });

  it('retains the schedule provider identity and fresh observation times for the site policy', async () => {
    const result = await createSleeperNflCalendar(async () => cadence({ siteWeekPolicy }))
      .getCadenceState(configuration);
    expect(result.periodAuthority).toMatchObject({ source: 'official-source',
      observedAt: '2026-09-13T15:59:59.000Z', verifiedAt: '2026-09-13T16:00:00.000Z' });
    expect(result.periodAuthority.sourceRevision)
      .not.toBe(sleeperPeriodAuthority(configuration, cadence()).sourceRevision);
  });

  it('does not manufacture a new semantic revision merely because unchanged policy was evaluated later', () => {
    const first = sleeperPeriodAuthority(configuration, cadence({ siteWeekPolicy }));
    const later = sleeperPeriodAuthority(configuration, cadence({
      siteWeekPolicy: { ...siteWeekPolicy, evaluatedAt: '2026-09-13T16:00:58.000Z' },
      requestCompletedAt: '2026-09-13T16:00:59.000Z', verifiedAt: '2026-09-13T16:01:00.000Z',
    }));
    expect(later.sourceRevision).toBe(first.sourceRevision);
    expect(later.observedAt).not.toBe(first.observedAt);
  });

  it.each([
    { version: 'schedule-noon-eastern-v2' },
    { scheduleRevision: 'rescheduled-game-evidence' },
    { nextRolloverAt: '2026-09-16T16:00:00.000Z' },
  ])('revises authority when policy or schedule evidence changes: %j', (change) => {
    expect(sleeperPeriodAuthority(configuration, cadence({ siteWeekPolicy: { ...siteWeekPolicy, ...change } })).sourceRevision)
      .not.toBe(sleeperPeriodAuthority(configuration, cadence({ siteWeekPolicy })).sourceRevision);
  });

  it('revises authority at rollover with unchanged underlying season schedule evidence', () => {
    const first = sleeperPeriodAuthority(configuration, cadence({ siteWeekPolicy }));
    const next = sleeperPeriodAuthority(configuration, cadence({
      defaultDisplayWeek: 2, activeScoringWeek: 2, week: 2, currentNflWeek: 2,
      siteWeekPolicy: { ...siteWeekPolicy, nextRolloverAt: '2026-09-22T16:00:00.000Z',
        evaluatedAt: '2026-09-15T16:00:00.000Z' },
      requestCompletedAt: '2026-09-15T16:00:01.000Z', verifiedAt: '2026-09-15T16:00:01.000Z',
    }));
    expect(next.sourceRevision).not.toBe(first.sourceRevision);
    expect(next).toMatchObject({ defaultDisplayPeriod: { week: 2 }, activeScoringPeriod: { week: 2 } });
  });

  it('permits schedule-derived season completion while the raw NFL phase still says regular', async () => {
    const result = await createSleeperNflCalendar(async () => cadence({
      defaultDisplayWeek: 18, activeScoringWeek: null, week: 18, currentNflWeek: null,
      leagueLifecycle: 'complete', siteWeekPolicy: { ...siteWeekPolicy, nextRolloverAt: null },
    })).getCadenceState(configuration);
    expect(result.periodAuthority).toMatchObject({ lifecycle: 'complete', nflPhase: 'regular',
      defaultDisplayPeriod: { week: 18 }, activeScoringPeriod: null });
    expect(result.defaultPeriodCadence.games).toHaveLength(2);
  });

  it.each([
    { siteWeekPolicy: { ...siteWeekPolicy, version: '' } },
    { siteWeekPolicy: { ...siteWeekPolicy, scheduleRevision: ' ' } },
    { siteWeekPolicy: { ...siteWeekPolicy, evaluatedAt: 'invalid' } },
    { siteWeekPolicy: { ...siteWeekPolicy, evaluatedAt: '2026-09-14T00:00:00.000Z' } },
    { siteWeekPolicy: { ...siteWeekPolicy, nextRolloverAt: 'invalid' } },
    { siteWeekPolicy, defaultDisplayWeek: 2 },
    { siteWeekPolicy, activeScoringWeek: 2 },
    { siteWeekPolicy, verifiedAt: '2026-09-13T15:59:58.000Z' },
  ])('rejects contradictory policy provenance before writing authority: %j', (change) => {
    expect(() => sleeperPeriodAuthority(configuration, cadence(change)))
      .toThrow('Sleeper schedule-based period policy is malformed.');
  });
});

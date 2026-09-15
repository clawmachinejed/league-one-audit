import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentMatchupPeriodContext: vi.fn(),
  getSiteWeekRollover: vi.fn(),
  getOfficialMatchups: vi.fn(),
  getOverview: vi.fn(),
  getStandings: vi.fn(),
  readStoredMatchups: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/lib/projection-reader', () => ({ readStoredMatchups: mocks.readStoredMatchups }));
vi.mock('@/lib/sleeper', () => ({
  getCurrentMatchupPeriodContext: mocks.getCurrentMatchupPeriodContext,
  getSiteWeekRollover: mocks.getSiteWeekRollover,
  getOfficialMatchups: mocks.getOfficialMatchups,
  getOverview: mocks.getOverview,
  getStandings: mocks.getStandings,
  getManager: vi.fn(),
  getTransactions: vi.fn(),
}));
vi.mock('./matchups-view', () => ({ MatchupsView: () => null }));
vi.mock('./manager-view', () => ({ ManagerView: () => null }));
vi.mock('./managers-view', () => ({ ManagersView: () => null }));
vi.mock('./standings-view', () => ({ StandingsView: () => null }));
vi.mock('./transactions-view', () => ({ TransactionsView: () => null }));

import type { MatchupsData, StandingsData } from '@/lib/types';
import type { MatchupPeriodContext } from '@/lib/matchup-period';
import type { StandingsProjectionSource } from './projected-standings-live';
import { LeagueMatchupsPage, LeagueStandingsPage } from './league-pages';

function matchups(week: number): MatchupsData {
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    teams: [],
    updatedAt: new Date().toISOString(),
    week,
    matchups: [],
  };
}

describe('LeagueStandingsPage', () => {
  const context = { defaultSeason: 2026, defaultWeek: 3, activeSeason: 2026, activeWeek: 2,
    lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false } as const;
  const standings: StandingsData = { ...matchups(3), teams: [], projectionBasis: { kind: 'ready', week: 2, teams: [] } };
  type Props = { data: StandingsData; projectionSource: StandingsProjectionSource | null };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSiteWeekRollover.mockResolvedValue(null);
    mocks.getStandings.mockResolvedValue(standings);
    mocks.getCurrentMatchupPeriodContext.mockResolvedValue(context);
  });

  it.each(['league1', 'league2'] as const)('uses the %s stored active-week team projections, even when display week is later', async leagueKey => {
    const payload = matchups(2);
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'usable', payload, context,
      snapshotRevision: 'a'.repeat(64), verifiedAt: '2026-09-10T12:00:00.000Z' });
    const rendered = await LeagueStandingsPage({ leagueId: `id-${leagueKey}`, leagueKey }) as ReactElement<Props>;
    expect(mocks.readStoredMatchups).toHaveBeenCalledExactlyOnceWith(leagueKey, 2);
    expect(rendered.key).toBe(leagueKey);
    expect(rendered.props.data).toBe(standings);
    expect(rendered.props.projectionSource?.data).toBe(payload);
    expect(rendered.props.projectionSource?.snapshotRevision).toBe('a'.repeat(64));
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
    expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
  });

  it('keeps an empty recoverable seed when stored projections are unavailable, without inventing scores', async () => {
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'missing' });
    const rendered = await LeagueStandingsPage({ leagueId: 'id-league1', leagueKey: 'league1' }) as ReactElement<Props>;
    expect(rendered.props.projectionSource?.data.matchups).toEqual([]);
    expect(rendered.props.projectionSource?.data.week).toBe(2);
    expect(rendered.props.projectionSource?.snapshotRevision).toBeNull();
    expect(mocks.getCurrentMatchupPeriodContext).toHaveBeenCalledExactlyOnceWith('id-league1', 2);
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
  });

  it('keeps official standings available when period authority fails', async () => {
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'database-error' });
    mocks.getCurrentMatchupPeriodContext.mockRejectedValue(new Error('unavailable'));
    const rendered = await LeagueStandingsPage({ leagueId: 'id-league1', leagueKey: 'league1' }) as ReactElement<Props>;
    expect(rendered.props.data).toBe(standings);
    expect(rendered.props.projectionSource).toBeNull();
  });

  it('does not read projections when a completed-week baseline cannot be proved', async () => {
    mocks.getStandings.mockResolvedValue({ ...standings, projectionBasis: { kind: 'unavailable', reason: 'History unavailable.' } });
    const rendered = await LeagueStandingsPage({ leagueId: 'id-league1', leagueKey: 'league1' }) as ReactElement<Props>;
    expect(rendered.props.projectionSource).toBeNull();
    expect(mocks.readStoredMatchups).not.toHaveBeenCalled();
    expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
  });
});

describe('LeagueMatchupsPage', () => {
  const rolloverContext: MatchupPeriodContext = {
    defaultSeason: 2026, defaultWeek: 1, activeSeason: 2026, activeWeek: 2,
    lifecycle: 'active', nflPhase: 'regular', temporalState: 'past', refreshDue: false,
  };
  type MatchupsProps = {
    data: MatchupsData; periodContext: MatchupPeriodContext;
    snapshotRevision: string | null; verifiedAt: string | null;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSiteWeekRollover.mockResolvedValue(null);
    mocks.getCurrentMatchupPeriodContext.mockResolvedValue({
      defaultSeason: 2026, defaultWeek: 2, activeSeason: 2026, activeWeek: 2,
      lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false,
    });
  });
  it.each(['league1', 'league2'] as const)('uses fresh site Week 2 for %s at noon while stored authority still says Week 1', async leagueKey => {
    const rollover = { week: 2, nextRolloverAt: '2026-09-22T16:00:00.000Z', evaluatedAt: '2026-09-15T16:00:00.000Z' };
    mocks.getSiteWeekRollover.mockResolvedValue(rollover);
    const oldContext = { ...rolloverContext, defaultWeek: 1, activeWeek: 1, temporalState: 'active' };
    mocks.readStoredMatchups
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(1), context: oldContext })
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(2), context: { ...oldContext, temporalState: 'future' } });
    const current = matchups(2);
    mocks.getOfficialMatchups.mockResolvedValue(current);
    const rendered = await LeagueMatchupsPage({ leagueId: `id-${leagueKey}`, leagueKey,
      searchParams: Promise.resolve({}) }) as ReactElement<MatchupsProps & { rollover: typeof rollover; followCurrent: boolean }>;
    expect(mocks.readStoredMatchups.mock.calls).toEqual([[leagueKey, undefined], [leagueKey, 2]]);
    expect(mocks.getCurrentMatchupPeriodContext).toHaveBeenCalledExactlyOnceWith(`id-${leagueKey}`, 2);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith(`id-${leagueKey}`, 2);
    expect(rendered.props).toMatchObject({ data: current, snapshotRevision: null, rollover, followCurrent: true });
    expect(rendered.props.periodContext).toMatchObject({ defaultWeek: 2, activeWeek: 2, temporalState: 'active' });
  });

  it('retains explicit Week 1 at the boundary while updating Current authority', async () => {
    mocks.getSiteWeekRollover.mockResolvedValue({ week: 2, nextRolloverAt: null, evaluatedAt: '2026-09-15T16:00:00.000Z' });
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'missing' });
    mocks.getOfficialMatchups.mockResolvedValue(matchups(1));
    const rendered = await LeagueMatchupsPage({ leagueId: 'id-league1', leagueKey: 'league1',
      searchParams: Promise.resolve({ week: '1' }) }) as ReactElement<MatchupsProps & { followCurrent: boolean }>;
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith('id-league1', 1);
    expect(rendered.props.data.week).toBe(1);
    expect(rendered.props.followCurrent).toBe(false);
    expect(rendered.props.periodContext).toMatchObject({ activeWeek: 2, temporalState: 'past' });
  });
  it('supplies the exact stored revision lineage to the browser without a provider request', async () => {
    const current = matchups(2);
    const snapshotRevision = 'a'.repeat(64);
    const verifiedAt = '2026-09-03T12:01:00.000Z';
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'usable', payload: current, snapshotRevision, verifiedAt,
      context: { defaultSeason: 2026, defaultWeek: 2, activeSeason: 2026, activeWeek: 2,
        lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false } });
    const rendered = await LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'fixture-league', searchParams: Promise.resolve({}) }) as
      ReactElement<{ data: MatchupsData; snapshotRevision: string; verifiedAt: string }>;
    expect(rendered.props.snapshotRevision).toBe(snapshotRevision);
    expect(rendered.props.verifiedAt).toBe(verifiedAt);
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
  });
  it('supplies null lineage for direct Sleeper fallback', async () => {
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'missing' });
    mocks.getOfficialMatchups.mockResolvedValue(matchups(2));
    const rendered = await LeagueMatchupsPage({ leagueKey: 'league2', leagueId: 'fixture-league', searchParams: Promise.resolve({}) }) as
      ReactElement<{ snapshotRevision: string | null; verifiedAt: string | null }>;
    expect(rendered.props.snapshotRevision).toBeNull();
    expect(rendered.props.verifiedAt).toBeNull();
  });

  it.each(['league1', 'league2'] as const)('opens the exact active week for %s when its saved display week lags', async leagueKey => {
    const current = matchups(2);
    mocks.readStoredMatchups
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(1), context: rolloverContext,
        snapshotRevision: 'a'.repeat(64), verifiedAt: '2026-09-15T03:20:00.000Z' })
      .mockResolvedValueOnce({ kind: 'usable', payload: current,
        context: { ...rolloverContext, temporalState: 'active' },
        snapshotRevision: 'b'.repeat(64), verifiedAt: '2026-09-15T14:00:00.000Z' });

    const rendered = await LeagueMatchupsPage({ leagueKey, leagueId: `id-${leagueKey}`,
      searchParams: Promise.resolve({}) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups.mock.calls).toEqual([[leagueKey, undefined], [leagueKey, 2]]);
    expect(rendered.props.data).toBe(current);
    expect(rendered.props.snapshotRevision).toBe('b'.repeat(64));
    expect(rendered.props.verifiedAt).toBe('2026-09-15T14:00:00.000Z');
    expect(rendered.props.periodContext).toMatchObject({ defaultWeek: 1, activeWeek: 2, temporalState: 'active' });
    expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
  });

  it.each(['missing', 'stale', 'database-error'] as const)('uses exact active official fallback when the saved active week is %s', async kind => {
    const current = matchups(2);
    mocks.readStoredMatchups
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(1), context: rolloverContext,
        snapshotRevision: 'a'.repeat(64), verifiedAt: '2026-09-15T03:20:00.000Z' })
      .mockResolvedValueOnce({ kind });
    mocks.getOfficialMatchups.mockResolvedValue(current);

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({}) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups.mock.calls).toEqual([['league1', undefined], ['league1', 2]]);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith('league-id', 2);
    expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
    expect(rendered.props.data).toBe(current);
    expect(rendered.props).toMatchObject({ snapshotRevision: null, verifiedAt: null,
      periodContext: { defaultWeek: 1, activeWeek: 2, temporalState: 'active' } });
  });

  it('does not return saved Week 1 if both active Week 2 sources are unavailable', async () => {
    mocks.readStoredMatchups
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(1), context: rolloverContext })
      .mockResolvedValueOnce({ kind: 'missing' });
    mocks.getOfficialMatchups.mockRejectedValue(new Error('Official Week 2 unavailable'));

    await expect(LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({}) })).rejects.toThrow('Official Week 2 unavailable');
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith('league-id', 2);
  });

  it.each(['usable', 'stale'] as const)('follows authority advancing during a %s exact-week read instead of showing a newly historical week', async kind => {
    const nextContext = { ...rolloverContext, activeWeek: 3, temporalState: 'past' as const };
    const current = matchups(3);
    mocks.readStoredMatchups
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(1), context: rolloverContext })
      .mockResolvedValueOnce({ kind, payload: matchups(2), context: nextContext })
      .mockResolvedValueOnce({ kind: 'usable', payload: current,
        context: { ...nextContext, temporalState: 'active' }, snapshotRevision: 'c'.repeat(64),
        verifiedAt: '2026-09-22T12:00:00.000Z' });
    mocks.getOfficialMatchups.mockResolvedValue(matchups(2));

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({}) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups.mock.calls).toEqual([['league1', undefined], ['league1', 2], ['league1', 3]]);
    expect(rendered.props.data).toBe(current);
    expect(rendered.props.snapshotRevision).toBe('c'.repeat(64));
    expect(rendered.props.periodContext).toMatchObject({ defaultWeek: 1, activeWeek: 3, temporalState: 'active' });
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
    expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
  });

  it('uses the newly active official week if the exact read discovers rollover and its next snapshot is missing', async () => {
    const nextContext = { ...rolloverContext, activeWeek: 3, temporalState: 'past' as const };
    const current = matchups(3);
    mocks.readStoredMatchups
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(1), context: rolloverContext })
      .mockResolvedValueOnce({ kind: 'missing', context: nextContext })
      .mockResolvedValueOnce({ kind: 'missing' });
    mocks.getOfficialMatchups.mockResolvedValue(current);

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league2', leagueId: 'league-id',
      searchParams: Promise.resolve({}) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups.mock.calls).toEqual([['league2', undefined], ['league2', 2], ['league2', 3]]);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith('league-id', 3);
    expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
    expect(rendered.props).toMatchObject({ data: current, snapshotRevision: null, verifiedAt: null,
      periodContext: { defaultWeek: 1, activeWeek: 3, temporalState: 'active' } });
  });

  it('bounds changing authority to two exact rereads and falls back to the latest observed current week', async () => {
    const current = matchups(4);
    mocks.readStoredMatchups
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(1), context: rolloverContext })
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(2), context: { ...rolloverContext, activeWeek: 3 } })
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(3), context: { ...rolloverContext, activeWeek: 4 } });
    mocks.getOfficialMatchups.mockResolvedValue(current);

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({}) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups.mock.calls).toEqual([['league1', undefined], ['league1', 2], ['league1', 3]]);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith('league-id', 4);
    expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
    expect(rendered.props).toMatchObject({ data: current, snapshotRevision: null, verifiedAt: null,
      periodContext: { defaultWeek: 1, activeWeek: 4, temporalState: 'active' } });
  });

  it('does not retarget an explicit week when its read discovers a later active week', async () => {
    const selected = matchups(2);
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'usable', payload: selected,
      context: { ...rolloverContext, activeWeek: 3 }, snapshotRevision: 'b'.repeat(64),
      verifiedAt: '2026-09-21T12:00:00.000Z' });

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({ week: '2' }) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups).toHaveBeenCalledExactlyOnceWith('league1', 2);
    expect(rendered.props.data).toBe(selected);
    expect(rendered.props.periodContext).toMatchObject({ activeWeek: 3, temporalState: 'past' });
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
  });

  it.each(['missing', 'disabled'] as const)('uses the calendar active week with %s database data and a lagging display week', async kind => {
    mocks.readStoredMatchups.mockResolvedValue({ kind });
    mocks.getCurrentMatchupPeriodContext.mockResolvedValue(rolloverContext);
    mocks.getOfficialMatchups.mockResolvedValue(matchups(2));

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league2', leagueId: 'league-id',
      searchParams: Promise.resolve({}) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups).toHaveBeenCalledExactlyOnceWith('league2', undefined);
    expect(mocks.getCurrentMatchupPeriodContext).toHaveBeenCalledExactlyOnceWith('league-id', undefined);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith('league-id', 2);
    expect(rendered.props.periodContext).toMatchObject({ defaultWeek: 1, activeWeek: 2, temporalState: 'active' });
  });

  it('selects the active week when the provider display week leads instead of taking the larger week', async () => {
    const context = { ...rolloverContext, defaultWeek: 3, temporalState: 'future' as const };
    mocks.readStoredMatchups
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(3), context })
      .mockResolvedValueOnce({ kind: 'usable', payload: matchups(2), context: { ...context, temporalState: 'active' } });

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({}) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups.mock.calls).toEqual([['league1', undefined], ['league1', 2]]);
    expect(rendered.props.data.week).toBe(2);
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'preseason', context: { ...rolloverContext, lifecycle: 'preseason' as const,
      activeSeason: null, activeWeek: null, temporalState: 'future' as const }, week: 1, temporalState: 'future' },
    { name: 'completed historical season', context: { ...rolloverContext, defaultSeason: 2025,
      defaultWeek: 17, lifecycle: 'complete' as const, activeSeason: null, activeWeek: null,
      temporalState: 'past' as const }, week: 17, temporalState: 'past' },
  ])('keeps the established $name default when no active period is available', async ({ context, week, temporalState }) => {
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'missing', context });
    const official = matchups(week);
    official.league.season = String(context.defaultSeason);
    mocks.getOfficialMatchups.mockResolvedValue(official);

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({}) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups).toHaveBeenCalledExactlyOnceWith('league1', undefined);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith('league-id', week);
    expect(rendered.props.periodContext).toMatchObject({ defaultSeason: context.defaultSeason,
      defaultWeek: week, activeWeek: null, temporalState });
  });

  it('keeps an explicitly selected Week 1 with active Week 2 in its independent context', async () => {
    const historical = matchups(1);
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'usable', payload: historical, context: rolloverContext,
      snapshotRevision: 'a'.repeat(64), verifiedAt: '2026-09-15T03:20:00.000Z' });

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({ week: '1' }) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups).toHaveBeenCalledExactlyOnceWith('league1', 1);
    expect(rendered.props.data).toBe(historical);
    expect(rendered.props.periodContext).toBe(rolloverContext);
    expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
  });

  it('treats an invalid query as current even when display week lags the scoring week', async () => {
    mocks.readStoredMatchups
      .mockResolvedValueOnce({ kind: 'missing', context: rolloverContext })
      .mockResolvedValueOnce({ kind: 'missing' });
    mocks.getOfficialMatchups.mockResolvedValue(matchups(2));

    const rendered = await LeagueMatchupsPage({ leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({ week: '2<script>' }) }) as ReactElement<MatchupsProps>;

    expect(mocks.readStoredMatchups.mock.calls).toEqual([['league1', undefined], ['league1', 2]]);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith('league-id', 2);
    expect(rendered.props.periodContext.temporalState).toBe('active');
  });

  it('does not serve the prior stored week after Sleeper advances the default week', async () => {
    const current = matchups(2);
    mocks.getOfficialMatchups.mockResolvedValue(current);
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'missing' });

    const rendered = await LeagueMatchupsPage({
      leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getCurrentMatchupPeriodContext).toHaveBeenCalledWith('league-id', undefined);
    expect(mocks.getOverview).not.toHaveBeenCalled();
    expect(mocks.readStoredMatchups).toHaveBeenCalledOnce();
    expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league1', undefined);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledWith('league-id', 2);
    expect(rendered.props.data).toBe(current);
  });

  it('serves a fresh latest snapshot when the lightweight Sleeper calendar is unavailable', async () => {
    const latest = matchups(1);
    mocks.readStoredMatchups.mockResolvedValue({
      kind: 'usable', historical: false, payload: latest,
    });

    const rendered = await LeagueMatchupsPage({
      leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.readStoredMatchups).toHaveBeenCalledOnce();
    expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league1', undefined);
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
    expect(rendered.props.data).toBe(latest);
  });

  it('falls back to full Sleeper data when the calendar and latest stored snapshot are unusable', async () => {
    const current = matchups(2);
    mocks.getCurrentMatchupPeriodContext.mockRejectedValue(new Error('calendar unavailable'));
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'stale' });
    mocks.getOfficialMatchups.mockResolvedValue(current);

    const rendered = await LeagueMatchupsPage({
      leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getOfficialMatchups).toHaveBeenCalledWith('league-id', undefined);
    expect(rendered.props.data).toBe(current);
  });

  it.each(['missing', 'stale', 'disabled', 'malformed', 'database-error'] as const)(
    'safely falls back to official data when the stored snapshot reader reports %s',
    async (kind) => {
      const current = matchups(2);
      mocks.readStoredMatchups.mockResolvedValue({ kind });
      mocks.getOfficialMatchups.mockResolvedValue(current);

      const rendered = await LeagueMatchupsPage({
        leagueKey: 'league1', leagueId: 'league-id',
        searchParams: Promise.resolve({}),
      }) as ReactElement<{ data: MatchupsData }>;

      expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league1', undefined);
      expect(mocks.getOfficialMatchups).toHaveBeenCalledOnce();
      expect(mocks.getOfficialMatchups).toHaveBeenCalledWith('league-id', 2);
      expect(rendered.props.data).toBe(current);
    },
  );

  it.each(['missing', 'stale', 'disabled', 'malformed', 'database-error'] as const)(
    'keeps an explicit historical week when the stored snapshot reader reports %s',
    async (kind) => {
      const requested = matchups(1);
      mocks.readStoredMatchups.mockResolvedValue({ kind });
      mocks.getOfficialMatchups.mockResolvedValue(requested);

      const rendered = await LeagueMatchupsPage({
        leagueKey: 'league1', leagueId: 'league-id',
        searchParams: Promise.resolve({ week: '1' }),
      }) as ReactElement<{ data: MatchupsData }>;

      expect(mocks.getCurrentMatchupPeriodContext).toHaveBeenCalledWith('league-id', 1);
      expect(mocks.readStoredMatchups).toHaveBeenCalledOnce();
      expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league1', 1);
      expect(mocks.getOfficialMatchups).toHaveBeenCalledOnce();
      expect(mocks.getOfficialMatchups).toHaveBeenCalledWith('league-id', 1);
      expect(rendered.props.data).toBe(requested);
    },
  );

  it.each(['2<script>', '0', '19', '99', '-1', '1.5', 'abc', ''])(
    'treats invalid week %s as the current week without passing it to storage',
    async (week) => {
      const current = matchups(2);
      mocks.readStoredMatchups.mockResolvedValue({
        kind: 'usable', historical: false, payload: current,
        context: {
          defaultSeason: 2026, defaultWeek: 2, activeSeason: 2026, activeWeek: 2,
          lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false,
        },
      });

      const rendered = await LeagueMatchupsPage({
        leagueKey: 'league1', leagueId: 'league-id',
        searchParams: Promise.resolve({ week }),
      }) as ReactElement<{ data: MatchupsData }>;

      expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
      expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league1', undefined);
      expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
      expect(rendered.props.data).toBe(current);
    },
  );

  it('keeps an explicit numeric week scoped to that requested week', async () => {
    const requested = matchups(1);
    mocks.readStoredMatchups.mockResolvedValue({
      kind: 'usable', historical: true, payload: requested,
    });

    const rendered = await LeagueMatchupsPage({
      leagueKey: 'league1', leagueId: 'league-id',
      searchParams: Promise.resolve({ week: '1' }),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getCurrentMatchupPeriodContext).not.toHaveBeenCalled();
    expect(mocks.readStoredMatchups).toHaveBeenCalledOnce();
    expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league1', 1);
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
    expect(rendered.props.data).toBe(requested);
  });

  it('has no direct Tank01 import in the current page, Sleeper fallback, or snapshot reader', () => {
    const requestPathModules = [
      ['league page', new URL('./league-pages.tsx', import.meta.url)],
      ['official Sleeper fallback', new URL('../lib/sleeper.ts', import.meta.url)],
      ['stored snapshot reader', new URL('../lib/projection-reader.ts', import.meta.url)],
    ] as const;

    for (const [label, path] of requestPathModules) {
      const source = readFileSync(path, 'utf8');
      const importSpecifiers = [...source.matchAll(
        /(?:from\s+|import\s*)['"]([^'"]+)['"]/gu,
      )].map((match) => match[1]);
      expect(
        importSpecifiers.filter((specifier) => /(?:^|\/)tank01(?:$|[-/])/u.test(specifier)),
        label,
      ).toEqual([]);
    }
  });
});

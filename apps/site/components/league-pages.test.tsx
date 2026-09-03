import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentLeagueWeek: vi.fn(),
  getOfficialMatchups: vi.fn(),
  getOverview: vi.fn(),
  readStoredMatchups: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/lib/projection-reader', () => ({ readStoredMatchups: mocks.readStoredMatchups }));
vi.mock('@/lib/sleeper', () => ({
  getCurrentLeagueWeek: mocks.getCurrentLeagueWeek,
  getOfficialMatchups: mocks.getOfficialMatchups,
  getOverview: mocks.getOverview,
  getManager: vi.fn(),
  getTransactions: vi.fn(),
}));
vi.mock('./matchups-view', () => ({ MatchupsView: () => null }));
vi.mock('./manager-view', () => ({ ManagerView: () => null }));
vi.mock('./managers-view', () => ({ ManagersView: () => null }));
vi.mock('./standings-view', () => ({ StandingsView: () => null }));
vi.mock('./transactions-view', () => ({ TransactionsView: () => null }));

import type { MatchupsData } from '@/lib/types';
import { LeagueMatchupsPage } from './league-pages';

function matchups(week: number): MatchupsData {
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    teams: [],
    updatedAt: new Date().toISOString(),
    week,
    matchups: [],
  };
}

describe('LeagueMatchupsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does not serve the prior stored week after Sleeper advances the default week', async () => {
    const current = matchups(2);
    mocks.getCurrentLeagueWeek.mockResolvedValue(2);
    mocks.getOfficialMatchups.mockResolvedValue(current);
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'missing' });

    const rendered = await LeagueMatchupsPage({
      leagueId: 'league-id',
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getCurrentLeagueWeek).toHaveBeenCalledWith('league-id');
    expect(mocks.getOverview).not.toHaveBeenCalled();
    expect(mocks.readStoredMatchups).toHaveBeenCalledOnce();
    expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league-id', 2);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledWith('league-id', 2);
    expect(rendered.props.data).toBe(current);
  });

  it('serves a fresh latest snapshot when the lightweight Sleeper calendar is unavailable', async () => {
    const latest = matchups(1);
    mocks.getCurrentLeagueWeek.mockRejectedValue(new Error('calendar unavailable'));
    mocks.readStoredMatchups.mockResolvedValue({
      kind: 'usable', historical: false, payload: latest,
    });

    const rendered = await LeagueMatchupsPage({
      leagueId: 'league-id',
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.readStoredMatchups).toHaveBeenCalledOnce();
    expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league-id', undefined);
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
    expect(rendered.props.data).toBe(latest);
  });

  it('falls back to full Sleeper data when the calendar and latest stored snapshot are unusable', async () => {
    const current = matchups(2);
    mocks.getCurrentLeagueWeek.mockRejectedValue(new Error('calendar unavailable'));
    mocks.readStoredMatchups.mockResolvedValue({ kind: 'stale' });
    mocks.getOfficialMatchups.mockResolvedValue(current);

    const rendered = await LeagueMatchupsPage({
      leagueId: 'league-id',
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getOfficialMatchups).toHaveBeenCalledWith('league-id', undefined);
    expect(rendered.props.data).toBe(current);
  });

  it.each(['2<script>', '0', '19', '99'])(
    'treats invalid week %s as the current week without passing it to storage',
    async (week) => {
      const current = matchups(2);
      mocks.getCurrentLeagueWeek.mockResolvedValue(2);
      mocks.readStoredMatchups.mockResolvedValue({
        kind: 'usable', historical: false, payload: current,
      });

      const rendered = await LeagueMatchupsPage({
        leagueId: 'league-id',
        searchParams: Promise.resolve({ week }),
      }) as ReactElement<{ data: MatchupsData }>;

      expect(mocks.getCurrentLeagueWeek).toHaveBeenCalledWith('league-id');
      expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league-id', 2);
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
      leagueId: 'league-id',
      searchParams: Promise.resolve({ week: '1' }),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getCurrentLeagueWeek).not.toHaveBeenCalled();
    expect(mocks.readStoredMatchups).toHaveBeenCalledOnce();
    expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league-id', 1);
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
    expect(rendered.props.data).toBe(requested);
  });
});

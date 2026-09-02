import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentLeagueWeek: vi.fn(),
  getOfficialMatchups: vi.fn(),
  getOverview: vi.fn(),
  readLatestSnapshot: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/lib/projection-store', () => ({
  getProjectionStore: () => ({
    readLatestCurrentSnapshotBySleeperLeagueId: mocks.readLatestSnapshot,
  }),
}));
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

import type { StoredProjectionSnapshot } from '@/lib/projection-store';
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

function snapshot(payload: MatchupsData): StoredProjectionSnapshot {
  return {
    snapshotId: `snapshot-${payload.week}`,
    leagueSeasonId: 'season-id',
    week: payload.week,
    modelVersion: 'clock-v1',
    revisionKey: `revision-${payload.week}`,
    calculatedAt: payload.updatedAt,
    publishedAt: payload.updatedAt,
    verifiedAt: payload.updatedAt,
    activityWindows: [],
    isCurrent: true,
    payload,
  };
}

describe('LeagueMatchupsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does not serve the prior stored week after Sleeper advances the default week', async () => {
    const prior = snapshot(matchups(1));
    const current = matchups(2);
    mocks.getCurrentLeagueWeek.mockResolvedValue(2);
    mocks.getOfficialMatchups.mockResolvedValue(current);
    mocks.readLatestSnapshot.mockImplementation(async (_leagueId: string, week?: number) => (
      week === undefined ? prior : null
    ));

    const rendered = await LeagueMatchupsPage({
      leagueId: 'league-id',
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getCurrentLeagueWeek).toHaveBeenCalledWith('league-id');
    expect(mocks.getOverview).not.toHaveBeenCalled();
    expect(mocks.readLatestSnapshot).toHaveBeenNthCalledWith(1, 'league-id', 2);
    expect(mocks.readLatestSnapshot).toHaveBeenNthCalledWith(2, 'league-id');
    expect(mocks.getOfficialMatchups).toHaveBeenCalledWith(2, 'league-id');
    expect(rendered.props.data).toBe(current);
  });

  it('serves a fresh latest snapshot when the lightweight Sleeper calendar is unavailable', async () => {
    const latest = snapshot(matchups(1));
    mocks.getCurrentLeagueWeek.mockRejectedValue(new Error('calendar unavailable'));
    mocks.readLatestSnapshot.mockResolvedValue(latest);

    const rendered = await LeagueMatchupsPage({
      leagueId: 'league-id',
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.readLatestSnapshot).toHaveBeenCalledOnce();
    expect(mocks.readLatestSnapshot).toHaveBeenCalledWith('league-id');
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
    expect(rendered.props.data).toBe(latest.payload);
  });

  it('falls back to full Sleeper data when the calendar and latest stored snapshot are unusable', async () => {
    const current = matchups(2);
    const stale = {
      ...snapshot(matchups(1)),
      verifiedAt: '2026-01-01T00:00:00.000Z',
    };
    mocks.getCurrentLeagueWeek.mockRejectedValue(new Error('calendar unavailable'));
    mocks.readLatestSnapshot.mockResolvedValue(stale);
    mocks.getOfficialMatchups.mockResolvedValue(current);

    const rendered = await LeagueMatchupsPage({
      leagueId: 'league-id',
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getOfficialMatchups).toHaveBeenCalledWith(undefined, 'league-id');
    expect(rendered.props.data).toBe(current);
  });

  it('treats a malformed week as the current week without passing it to storage', async () => {
    const current = snapshot(matchups(2));
    mocks.getCurrentLeagueWeek.mockResolvedValue(2);
    mocks.readLatestSnapshot.mockResolvedValue(current);

    const rendered = await LeagueMatchupsPage({
      leagueId: 'league-id',
      searchParams: Promise.resolve({ week: '2<script>' }),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getCurrentLeagueWeek).toHaveBeenCalledWith('league-id');
    expect(mocks.readLatestSnapshot).toHaveBeenNthCalledWith(1, 'league-id', 2);
    expect(mocks.readLatestSnapshot).toHaveBeenNthCalledWith(2, 'league-id');
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
    expect(rendered.props.data).toBe(current.payload);
  });

  it('keeps an explicit numeric week scoped to that requested week', async () => {
    const requested = snapshot(matchups(1));
    mocks.readLatestSnapshot.mockResolvedValue(requested);

    const rendered = await LeagueMatchupsPage({
      leagueId: 'league-id',
      searchParams: Promise.resolve({ week: '1' }),
    }) as ReactElement<{ data: MatchupsData }>;

    expect(mocks.getCurrentLeagueWeek).not.toHaveBeenCalled();
    expect(mocks.readLatestSnapshot).toHaveBeenNthCalledWith(1, 'league-id', 1);
    expect(mocks.readLatestSnapshot).toHaveBeenNthCalledWith(2, 'league-id');
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
    expect(rendered.props.data).toBe(requested.payload);
  });
});

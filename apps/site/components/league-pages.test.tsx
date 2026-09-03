import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentMatchupPeriodContext: vi.fn(),
  getOfficialMatchups: vi.fn(),
  getOverview: vi.fn(),
  readStoredMatchups: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/lib/projection-reader', () => ({ readStoredMatchups: mocks.readStoredMatchups }));
vi.mock('@/lib/sleeper', () => ({
  getCurrentMatchupPeriodContext: mocks.getCurrentMatchupPeriodContext,
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
    mocks.getCurrentMatchupPeriodContext.mockResolvedValue({
      defaultSeason: 2026, defaultWeek: 2, activeSeason: 2026, activeWeek: 2,
      lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false,
    });
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

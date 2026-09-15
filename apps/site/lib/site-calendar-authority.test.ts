import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_IDS } from './config';
import type { StoredLeagueAuthorityRead, StoredLeagueLineupAuthority } from './projection-store';

const fake = vi.hoisted(() => ({
  enabled: true,
  read: vi.fn<() => Promise<readonly StoredLeagueAuthorityRead[]>>(),
}));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: <T>(fn: T) => fn }));
vi.mock('./projection-store', () => ({
  getProjectionStore: () => ({ enabled: fake.enabled, readLeagueLineupAuthorities: fake.read }),
}));

import { assertSiteCalendarNotRegressed } from './site-calendar-authority';

const proposal = { leagueId: LEAGUE_IDS.league1, season: 2026, week: 2, lifecycle: 'active' as const };

function stored(overrides: Partial<StoredLeagueLineupAuthority> = {}): StoredLeagueLineupAuthority {
  return {
    leagueKey: 'league1', defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: 2,
    activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 2,
    leagueLifecycle: 'active', nflPhase: 'regular', sourceProvider: 'sleeper',
    sourceRevision: 'accepted-policy', sourceObservedAt: '2026-09-15T16:00:00.000Z',
    verifiedAt: '2026-09-15T16:00:00.000Z', authorityGeneration: 2,
    lineupShape: { sourceExternalLeagueId: LEAGUE_IDS.league1, expectedRosterCount: 2,
      expectedStarterSlotCount: 1, expectedRosterIds: ['1', '2'] },
    defaultPeriodCadence: { isCurrentRegularPeriod: true, games: [] },
    ...overrides,
  };
}

function available(authority: StoredLeagueLineupAuthority = stored()): StoredLeagueAuthorityRead {
  return { kind: 'available', leagueKey: 'league1', authority };
}

beforeEach(() => {
  fake.enabled = true;
  fake.read.mockReset().mockResolvedValue([available()]);
});

describe('site calendar monotonic read guard', () => {
  it('does no authority query when persistence is disabled', async () => {
    fake.enabled = false;
    await expect(assertSiteCalendarNotRegressed(proposal)).resolves.toBeUndefined();
    expect(fake.read).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [{ kind: 'missing', leagueKey: 'league1' }] }] as const)(
    'preserves source fallback when no calendar authority is stored', async ({ rows }) => {
      fake.read.mockResolvedValue(rows);
      await expect(assertSiteCalendarNotRegressed(proposal)).resolves.toBeUndefined();
    },
  );

  it('preserves source fallback for a database transport failure', async () => {
    fake.read.mockRejectedValue(new Error('database transport unavailable'));
    await expect(assertSiteCalendarNotRegressed(proposal)).resolves.toBeUndefined();
  });

  it('uses only the registered league key for one compact read', async () => {
    await expect(assertSiteCalendarNotRegressed(proposal)).resolves.toBeUndefined();
    expect(fake.read).toHaveBeenCalledExactlyOnceWith(['league1']);
  });

  it('accepts a forward schedule week without changing stored authority', async () => {
    const authority = stored();
    fake.read.mockResolvedValue([available(authority)]);
    await expect(assertSiteCalendarNotRegressed({ ...proposal, week: 3 })).resolves.toBeUndefined();
    expect(authority.defaultWeek).toBe(2);
  });

  it.each([
    { defaultWeek: 3 },
    { defaultWeek: 1, activeWeek: 3 },
    { defaultSeason: 2027, activeSeason: 2027, defaultWeek: 1, activeWeek: 1 },
    { leagueLifecycle: 'complete', activeSeason: null, activeSeasonType: null, activeWeek: null },
    { sourceObservedAt: '2026-09-01T00:00:00Z', verifiedAt: '2026-09-01T00:00:00Z', defaultWeek: 3 },
  ] as const)('rejects backward movement against the stored floor %j', async (changes) => {
    fake.read.mockResolvedValue([available(stored(changes))]);
    await expect(assertSiteCalendarNotRegressed(proposal)).rejects.toThrow('backward week change was rejected');
  });

  it('rejects active-to-preseason lifecycle regression', async () => {
    await expect(assertSiteCalendarNotRegressed({ ...proposal, lifecycle: 'preseason' }))
      .rejects.toThrow('backward week change was rejected');
  });

  it('permits a new season after the same registered league completed its previous season', async () => {
    fake.read.mockResolvedValue([available(stored({ defaultSeason: 2025, defaultWeek: 18,
      activeSeason: null, activeSeasonType: null, activeWeek: null, leagueLifecycle: 'complete' }))]);
    await expect(assertSiteCalendarNotRegressed({ ...proposal, week: 1, lifecycle: 'preseason' })).resolves.toBeUndefined();
  });

  it('accepts terminal lifecycle progression at the same week', async () => {
    fake.read.mockResolvedValue([available(stored({ defaultWeek: 18, activeWeek: 18 }))]);
    await expect(assertSiteCalendarNotRegressed({ ...proposal, week: 18, lifecycle: 'complete' })).resolves.toBeUndefined();
  });

  it.each([
    { sourceProvider: 'tank01' },
    { leagueKey: 'league2' },
    { lineupShape: { ...stored().lineupShape, sourceExternalLeagueId: LEAGUE_IDS.league2 } },
  ])('rejects conflicting stored service identity %j', async (changes) => {
    fake.read.mockResolvedValue([available(stored(changes))]);
    await expect(assertSiteCalendarNotRegressed(proposal)).rejects.toThrow('selected league identity');
  });

  it.each([
    { rows: [{ kind: 'malformed', leagueKey: 'league1' }] },
    { rows: [{ kind: 'missing', leagueKey: 'league2' }] },
    { rows: [available(), available()] },
  ] as const)('rejects malformed result shape instead of treating it as an outage', async ({ rows }) => {
    fake.read.mockResolvedValue(rows);
    await expect(assertSiteCalendarNotRegressed(proposal)).rejects.toThrow('authority is malformed');
  });

  it.each([
    { defaultWeek: 0 }, { activeWeek: 19 }, { activeWeek: null },
    { activeSeason: 2025 }, { defaultSeasonType: 'post' },
    { leagueLifecycle: 'complete' },
  ] as const)('rejects malformed stored period %j', async (changes) => {
    fake.read.mockResolvedValue([available(stored(changes))]);
    await expect(assertSiteCalendarNotRegressed(proposal)).rejects.toThrow('invalid period');
  });

  it('rejects an unknown league without querying persistence', async () => {
    await expect(assertSiteCalendarNotRegressed({ ...proposal, leagueId: 'not-a-registered-league' }))
      .rejects.toThrow('invalid league or period');
    expect(fake.read).not.toHaveBeenCalled();
  });

  it('isolates League Two using its registry key and service identity', async () => {
    fake.read.mockResolvedValue([{ kind: 'available', leagueKey: 'league2', authority: stored({ leagueKey: 'league2',
      lineupShape: { ...stored().lineupShape, sourceExternalLeagueId: LEAGUE_IDS.league2 } }) }]);
    await expect(assertSiteCalendarNotRegressed({ ...proposal, leagueId: LEAGUE_IDS.league2 })).resolves.toBeUndefined();
    expect(fake.read).toHaveBeenCalledExactlyOnceWith(['league2']);
  });
});

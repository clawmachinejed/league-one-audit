import { describe, expect, it } from 'vitest';
import type { AccountView, LibraryLeague, SleeperLeagueDiscovery, TeamParticipation } from './accounts/contracts';
import { LEAGUE_IDS } from './config';
import { LEAGUE_SITES, type LeagueKey } from './leagues';
import type { MyFantasyLeague } from './my-fantasy-source';
import { currentMyFantasyMemberships, selectedBrowserMyFantasyMemberships } from './my-fantasy-membership';

function source(key: LeagueKey, season = '2026', teamIds: number[] = []): MyFantasyLeague {
  const sourceData = { data: { league: { season }, teams: teamIds.map(id => ({ id })) } };
  return { status: 'available', site: LEAGUE_SITES[key], leagueId: LEAGUE_IDS[key], standingsData: null, honors: null,
    source: sourceData as Extract<MyFantasyLeague, { status: 'available' }>['source'] };
}

function team(rosterId: string, freshness: TeamParticipation['freshness'] = 'current'): TeamParticipation {
  return { id: `team-${rosterId}`, rosterId, roles: ['owner'], sourceManagerAccountIds: ['linked-profile'],
    assurance: 'user_asserted', freshness, observedAt: '2026-09-24T04:00:00Z' };
}

function league(key: LeagueKey, teams: TeamParticipation[], overrides: Partial<LibraryLeague> = {}): LibraryLeague {
  return { id: `league-${key}`, key, name: LEAGUE_SITES[key].name, season: 2026, url: `${LEAGUE_SITES[key].prefix}/matchups`,
    logo: LEAGUE_SITES[key].logo, saved: null, teams, affiliations: [], linkedFromLeagueIds: [],
    sourceState: 'current', sourceObservedAt: '2026-09-24T04:00:00Z', ...overrides };
}

function account(leagues: LibraryLeague[]): AccountView {
  return { profile: { id: 'account-a', displayName: 'Member', revision: 1 },
    links: [{ id: 'link-a', sourceManagerAccountId: 'linked-profile', displayName: 'Member', provider: 'sleeper',
      assurance: 'user_asserted', revision: 1 }], library: { leagues, availableProviderAccounts: [] } };
}

function discovery(keys: LeagueKey[], sourceManagerAccountIds = ['linked-profile']): SleeperLeagueDiscovery {
  return { accountId: 'account-a', season: '2026', status: 'complete',
    profiles: [{ sourceManagerAccountId: 'linked-profile', displayName: 'Member', status: 'complete' }],
    leagues: keys.map(key => ({ id: LEAGUE_IDS[key], name: LEAGUE_SITES[key].name, season: '2026',
      url: `https://sleeper.com/leagues/${LEAGUE_IDS[key]}`, sourceManagerAccountIds })) };
}

describe('My Fantasy account membership', () => {
  it('excludes follows, affiliated peers and old memberships absent from current Sleeper discovery', () => {
    const entries = [source('league1'), source('league2'), source('dynasty')];
    const view = account([league('league1', [team('3')]),
      league('league2', [], { saved: { favorite: true, sortPosition: 0, preferredSeasonTeamId: null, revision: 1 },
        linkedFromLeagueIds: ['league-league1'] }),
      league('dynasty', [team('7')], { sourceState: 'stale' })]);
    expect(currentMyFantasyMemberships(entries, view, discovery(['league1']))).toEqual([{ entry: entries[0], teamIds: [3] }]);
  });

  it('uses last-known roster IDs only after current league/profile confirmation and checks the season', () => {
    const entries = [source('league1'), source('league2')];
    const view = account([league('league1', [team('1'), team('2'), team('2'), team('0'),
      team('9007199254740992'), team('4', 'stale')]), league('league2', [team('5')])]);
    expect(currentMyFantasyMemberships(entries, view, discovery(['league1', 'league2']))).toEqual([
      { entry: entries[0], teamIds: [1, 2, 4] }, { entry: entries[1], teamIds: [5] },
    ]);
    expect(currentMyFantasyMemberships([source('league1', '2027'), entries[1]], view, discovery(['league1', 'league2'])))
      .toEqual([{ entry: entries[1], teamIds: [5] }]);
    expect(currentMyFantasyMemberships(entries, view, { ...discovery(['league1', 'league2']), accountId: 'account-b' }))
      .toEqual([]);
  });

  it('keeps a confirmed member’s card visible when that league’s matchup source fails', () => {
    const unavailable: MyFantasyLeague = { status: 'unavailable', site: LEAGUE_SITES.league1, leagueId: LEAGUE_IDS.league1 };
    expect(currentMyFantasyMemberships([unavailable, source('league2')], account([
      league('league1', [team('3')]), league('league2', []),
    ]), discovery(['league1']))).toEqual([{ entry: unavailable, teamIds: [3] }]);
  });

  it('retains an unavailable card for a confirmed member after the league renews its Sleeper ID', () => {
    const unavailable: MyFantasyLeague = { status: 'unavailable', site: LEAGUE_SITES.league1, leagueId: 'renewed-league-one' };
    const current = discovery(['league1']);
    current.leagues[0].id = 'renewed-league-one';
    expect(currentMyFantasyMemberships([unavailable], account([league('league1', [team('3')])]), current))
      .toEqual([{ entry: unavailable, teamIds: [3] }]);
    expect(currentMyFantasyMemberships([{ ...unavailable, leagueId: null }], account([league('league1', [team('3')])]), current))
      .toEqual([]);
  });

  it('shows a stale stored team only for the exact profile still in that Sleeper league', () => {
    const entry = source('league1');
    const view = account([league('league1', [team('3', 'stale')], { sourceState: 'stale' })]);
    expect(currentMyFantasyMemberships([entry], view, discovery(['league1']))).toEqual([{ entry, teamIds: [3] }]);
    expect(currentMyFantasyMemberships([entry], view, discovery(['league1'], ['other-profile']))).toEqual([]);
    expect(currentMyFantasyMemberships([entry], view, { ...discovery(['league1']), status: 'unavailable' })).toEqual([]);
  });
});

describe('My Fantasy preview browser selections', () => {
  it('shows only explicitly selected teams that belong to their current available league', () => {
    const entries: MyFantasyLeague[] = [source('league1', '2026', [1, 2]), source('league2', '2026', [3]),
      { status: 'unavailable', site: LEAGUE_SITES.dynasty, leagueId: LEAGUE_IDS.dynasty }];
    expect(selectedBrowserMyFantasyMemberships(entries, [2, null, 4])).toEqual([
      { entry: entries[0], teamIds: [2] },
    ]);
    expect(selectedBrowserMyFantasyMemberships(entries, [3, 3, 4])).toEqual([
      { entry: entries[1], teamIds: [3] },
    ]);
    expect(selectedBrowserMyFantasyMemberships(entries, [])).toEqual([]);
  });
});

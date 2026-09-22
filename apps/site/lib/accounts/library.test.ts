import { describe, expect, it } from 'vitest';
import type { AccountLibraryInput, SourceLeague } from './contracts';
import { accountTeams, buildAccountView, sourceState } from './library';
import { deleteInput, profileInput, providerLinkInput, savedLeagueInput } from './validation';

const now = Date.parse('2026-09-22T18:00:00Z');
const time = new Date(now - 10_000).toISOString();
const manager = '10000000-0000-4000-8000-000000000001';
const secondManager = '10000000-0000-4000-8000-000000000002';
const team = '20000000-0000-4000-8000-000000000001';
function source(id: string, key: string): SourceLeague {
  return { id, key, name: key, season: 2026, valid: true, checkedAt: time, verifiedAt: time, observedAt: time,
    memberships: [{ teamId: team, rosterId: '1', sourceManagerAccountId: manager, role: 'owner' }] };
}
function input(): AccountLibraryInput {
  return { profile: { id: 'profile', displayName: 'Member', revision: 1 },
    links: [{ id: 'link', sourceManagerAccountId: manager, displayName: 'clawmachinejedi', provider: 'sleeper', assurance: 'user_asserted', revision: 1 }],
    saved: [], sources: [source('one', 'league1'), { ...source('two', 'league2'), memberships: [] }, source('dynasty', 'dynasty')],
    providerAccounts: [], groups: [{ id: 'group', name: 'League One / Two', leagueIds: ['one', 'two'] }] };
}
describe('personal league library and future all-teams contract', () => {
  it('retains all teams across independent leagues and suggests the direct linked league', () => {
    const view = buildAccountView(input(), now);
    expect(accountTeams(view).map(value => value.leagueKey)).toEqual(['league1', 'dynasty']);
    expect(view.library.leagues[1].linkedFromLeagueIds).toEqual(['one']);
    expect(view.library.leagues[2].affiliations).toEqual([]);
    expect(view.library.leagues[0].teams[0].assurance).toBe('user_asserted');
  });
  it('deduplicates one team through multiple linked identities but preserves every distinct team', () => {
    const data = input();
    data.links.push({ ...data.links[0], id: 'other-link', sourceManagerAccountId: secondManager });
    data.sources[0].memberships.push({ teamId: team, rosterId: '1', sourceManagerAccountId: secondManager, role: 'co_owner' },
      { teamId: 'team-two', rosterId: '2', sourceManagerAccountId: manager, role: 'owner' });
    data.saved.push({ leagueId: 'one', favorite: true, sortPosition: 1, preferredSeasonTeamId: team, revision: 1 });
    const teams = buildAccountView(data, now).library.leagues[0].teams;
    expect(teams).toHaveLength(2);
    expect(teams[0].roles).toEqual(['owner', 'co_owner']);
    expect(teams[0].sourceManagerAccountIds).toEqual([manager, secondManager]);
  });
  it('does not treat matching display names or manager overrides as identity', () => {
    const data = input();
    data.links[0].displayName = 'eneerg';
    data.sources[1].memberships = [{ teamId: 'two', rosterId: '1', sourceManagerAccountId: secondManager, role: 'owner' }];
    expect(buildAccountView(data, now).library.leagues[1].teams).toEqual([]);
  });
  it('does not expand groups transitively or through a saved follow', () => {
    const data = input();
    data.sources[2].memberships = [];
    data.groups.push({ id: 'workplace', name: 'Workplace', leagueIds: ['two', 'dynasty'] });
    data.saved.push({ leagueId: 'two', favorite: false, sortPosition: 1, preferredSeasonTeamId: null, revision: 1 });
    const view = buildAccountView(data, now);
    expect(view.library.leagues.find(league => league.key === 'league2')!.linkedFromLeagueIds).toEqual(['one']);
    expect(view.library.leagues.find(league => league.key === 'dynasty')!.linkedFromLeagueIds).toEqual([]);
  });
  it('retains saved follows and last-known evidence independently of membership refresh', () => {
    const data = input();
    data.sources[0].checkedAt = data.sources[0].verifiedAt = new Date(now - 3_600_000).toISOString();
    data.saved.push({ leagueId: 'one', favorite: true, sortPosition: 0, preferredSeasonTeamId: team, revision: 2 });
    let league = buildAccountView(data, now).library.leagues[0];
    expect(league.sourceState).toBe('stale');
    expect(league.teams[0].freshness).toBe('stale');
    data.sources[0].valid = false;
    league = buildAccountView(data, now).library.leagues[0];
    expect(league.teams).toEqual([]);
    expect(league.saved?.favorite).toBe(true);
    expect(league.sourceState).toBe('unavailable');
  });
  it('does not claim current participation with missing, future or contradictory freshness evidence', () => {
    const record = source('one', 'league1');
    for (const changed of [{ verifiedAt: null }, { observedAt: null }, { valid: false }, { season: null },
      { checkedAt: new Date(now + 1).toISOString() }, { checkedAt: new Date(now - 20_000).toISOString() }]) {
      expect(sourceState({ ...record, ...changed }, now)).toBe('unavailable');
    }
  });
  it('refuses ambiguous sources and conflicting team IDs instead of choosing an arbitrary one', () => {
    const data = input();
    data.sources.push(source('other', 'league1'));
    expect(() => buildAccountView(data, now)).toThrow('Ambiguous');
    data.sources.pop();
    data.sources[0].memberships.push({ teamId: team, rosterId: 'wrong', sourceManagerAccountId: manager, role: 'owner' });
    expect(() => buildAccountView(data, now)).toThrow('Conflicting');
  });
  it('does not turn unrelated enrollment into a supported public route', () => {
    const data = input();
    data.sources.push(source('new', 'liberty'));
    expect(buildAccountView(data, now).library.leagues).toHaveLength(3);
  });
  it('applies private favorites and ordering without changing source participation', () => {
    const data = input();
    data.saved.push({ leagueId: 'dynasty', favorite: true, sortPosition: 4, preferredSeasonTeamId: null, revision: 1 });
    data.saved.push({ leagueId: 'two', favorite: false, sortPosition: 1, preferredSeasonTeamId: null, revision: 1 });
    const view = buildAccountView(data, now);
    expect(view.library.leagues.map(league => league.id)).toEqual(['dynasty', 'two', 'one']);
    expect(accountTeams(view).map(value => value.leagueKey).sort()).toEqual(['dynasty', 'league1']);
  });
});
describe('account mutation boundary', () => {
  it('requires revisions and rejects injected actor, role and assurance properties', () => {
    expect(() => profileInput({ displayName: 'Test', revision: 1, appUserId: manager })).toThrow();
    expect(() => providerLinkInput({ sourceManagerAccountId: manager, assurance: 'verified' })).toThrow();
    expect(() => providerLinkInput({ sourceManagerAccountId: manager, role: 'admin' })).toThrow();
    expect(() => deleteInput({ revision: 0 })).toThrow();
    expect(() => profileInput({ displayName: 'Test' })).toThrow();
    expect(profileInput({ displayName: ' Test ', revision: 2 })).toEqual({ displayName: 'Test', revision: 2 });
  });
  it('bounds inputs and distinguishes first save from a revisioned update', () => {
    expect(() => profileInput({ displayName: 'bad\nname', revision: 1 })).toThrow();
    expect(() => profileInput({ displayName: 'a'.repeat(101), revision: 1 })).toThrow();
    expect(() => providerLinkInput({ sourceManagerAccountId: '123' })).toThrow();
    const save = { favorite: false, sortPosition: 0, preferredSeasonTeamId: null, revision: null };
    expect(savedLeagueInput(save)).toEqual(save);
    expect(() => savedLeagueInput({ ...save, sortPosition: -1 })).toThrow();
    expect(() => savedLeagueInput({ ...save, revision: '1' })).toThrow();
  });
});

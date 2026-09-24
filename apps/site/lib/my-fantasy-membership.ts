import type { AccountView, SleeperLeagueDiscovery } from './accounts/contracts';
import { LEAGUE_IDS } from './config';
import type { MyFantasyLeague } from './my-fantasy-source';

export type MyFantasyMembership = { entry: MyFantasyLeague; teamIds: number[] };

/** Current-season provider membership must confirm a stored account roster link. */
export function currentMyFantasyMemberships(
  leagues: readonly MyFantasyLeague[], account: AccountView, discovery: SleeperLeagueDiscovery,
): MyFantasyMembership[] {
  if (discovery.accountId !== account.profile.id || !discovery.season || discovery.status === 'unavailable') return [];
  const linked = new Set(account.links.map(link => link.sourceManagerAccountId));
  const complete = new Set(discovery.profiles.filter(profile => profile.status === 'complete')
    .map(profile => profile.sourceManagerAccountId));
  return leagues.flatMap(entry => {
    const leagueId = entry.status === 'available' ? entry.leagueId : LEAGUE_IDS[entry.site.key];
    const discovered = discovery.leagues.find(candidate => candidate.id === leagueId && candidate.season === discovery.season);
    if (!discovered) return [];
    const confirmedProfiles = new Set(discovered.sourceManagerAccountIds.filter(id => linked.has(id) && complete.has(id)));
    if (!confirmedProfiles.size) return [];
    const league = account.library.leagues.find(candidate => candidate.key === entry.site.key
      && candidate.sourceState !== 'unavailable' && String(candidate.season) === discovery.season
      && (entry.status === 'unavailable' || String(candidate.season) === entry.source.data.league.season));
    if (!league) return [];
    const teamIds = [...new Set(league.teams.flatMap(team => {
      if (!team.sourceManagerAccountIds.some(id => confirmedProfiles.has(id)) || !/^[1-9]\d*$/u.test(team.rosterId)) return [];
      const id = Number(team.rosterId);
      return Number.isSafeInteger(id) ? [id] : [];
    }))];
    return teamIds.length > 0 ? [{ entry, teamIds }] : [];
  });
}

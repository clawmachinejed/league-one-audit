import 'server-only';
import { LEAGUE_IDS } from './config';

import { getCurrentLeagueId } from './league-administration/registry';
import { loadLeagueMatchups, type LeagueMatchupsSource } from './league-matchups-source';
import { LEAGUE_SITES, type LeagueSite, type LeagueKey, type LeagueRouteKey } from './leagues';
import type { ManagerHonors } from './manager-honors';
import { getManagerHonors, getStandings } from './sleeper';
import type { StandingsData } from './types';
import { getLeagueSite } from './league-sites';

export type MyFantasyLeague<K extends LeagueRouteKey = LeagueRouteKey> = {
  status: 'available';
  site: LeagueSite & { key: K };
  leagueId: string;
  source: LeagueMatchupsSource;
  standingsData: StandingsData | null;
  honors: ManagerHonors | null;
} | {
  status: 'unavailable';
  site: LeagueSite & { key: K };
  leagueId: string | null;
};

/** Public, enrolled site leagues only; account discovery never imports a league here. */
export async function loadMyFantasyLeagues(requestedWeek?: number): Promise<MyFantasyLeague<LeagueKey>[]> {
  return Promise.all(Object.values(LEAGUE_SITES).map(async (fallbackSite): Promise<MyFantasyLeague<LeagueKey>> => {
    const site = { ...await getLeagueSite(fallbackSite.key).catch(() => fallbackSite), key: fallbackSite.key };
    try {
      const source = await loadLeagueMatchups(LEAGUE_IDS[fallbackSite.key], site.key, requestedWeek);
      const [standingsData, honors] = await Promise.all([
        getStandings(source.leagueId).catch(() => null),
        getManagerHonors(source.leagueId).catch(() => null),
      ]);
      return { status: 'available', site, leagueId: source.leagueId, source, standingsData, honors };
    } catch {
      // A registration or matchup failure belongs to this league, not the page.
      // The registration read is request-cached. Keep its exact ID when only
      // matchup data failed; an unproved ID must never fall back to bootstrap.
      const leagueId = await getCurrentLeagueId(site.key).catch(() => null);
      return { status: 'unavailable', site, leagueId };
    }
  }));
}

import 'server-only';

import { LEAGUE_IDS } from './config';
import { getCurrentLeagueId } from './league-administration/registry';
import { loadLeagueMatchups, type LeagueMatchupsSource } from './league-matchups-source';
import { LEAGUE_SITES, type LeagueSite } from './leagues';
import type { ManagerHonors } from './manager-honors';
import { getManagerHonors, getStandings } from './sleeper';
import type { StandingsData } from './types';

export type MyFantasyLeague = {
  status: 'available';
  site: LeagueSite;
  leagueId: string;
  source: LeagueMatchupsSource;
  standingsData: StandingsData | null;
  honors: ManagerHonors | null;
} | {
  status: 'unavailable';
  site: LeagueSite;
  leagueId: string | null;
};

/** Public, enrolled site leagues only; account discovery never imports a league here. */
export async function loadMyFantasyLeagues(): Promise<MyFantasyLeague[]> {
  return Promise.all(Object.values(LEAGUE_SITES).map(async (site): Promise<MyFantasyLeague> => {
    try {
      const source = await loadLeagueMatchups(LEAGUE_IDS[site.key], site.key);
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

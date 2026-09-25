import 'server-only';
import { cache } from 'react';
import { getCurrentLeagueId } from './league-administration/registry';
import { getOfficialAdministrationObservation } from './sleeper';
import { getLeagueAdministrationStore } from './league-administration/store';
import { LEAGUE_SITES, siteForLeague, sleeperLeagueLogo, type LeagueSite } from './leagues';

/** Artwork is public Sleeper metadata, independent of the website brand. */
export const getLeagueSite = cache(async (key: string): Promise<LeagueSite> => {
  const id = await getCurrentLeagueId(key);
  const stored = await getLeagueAdministrationStore().readSourceByConnection({
    provider: 'sleeper', externalLeagueId: id, family: 'league', week: null,
  });
  const payload = stored.status === 'available' ? stored.envelope.payload
    : (await getOfficialAdministrationObservation(id, 'league', null, 300)).payload;
  const raw = payload as { name?: unknown; avatar?: unknown };
  const site = siteForLeague(key, typeof raw.name === 'string' ? raw.name : 'Sleeper league',
    sleeperLeagueLogo(raw.avatar) ?? '/league-placeholder.svg');
  if (!site) throw new Error('Unknown league route.');
  return site;
});

export async function getPublicLeagueSites(): Promise<LeagueSite[]> {
  return Promise.all(Object.values(LEAGUE_SITES).map(site => getLeagueSite(site.key).catch(() => site)));
}

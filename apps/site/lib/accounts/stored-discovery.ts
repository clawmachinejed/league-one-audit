import 'server-only';
import type { SleeperLeagueDiscovery } from './contracts';
import type { StoredDiscoveryResult } from './neon/discovery';
import { AccountStoreUnavailableError } from './database';
import { unverifiedLeagueCapabilities } from '../league-capabilities';

/** Adapter to the existing account-library consumer DTO. Retained candidate
 * metadata is not a membership, selected team, enrolled league or official
 * roster. Full current-team completion needs the separately qualified path. */
export function storedSleeperDiscovery(actor: string, stored: StoredDiscoveryResult): SleeperLeagueDiscovery {
  if (stored.status !== 'available') throw new AccountStoreUnavailableError();
  if (!Number.isInteger(stored.currentSeason) || stored.currentSeason < 1002 || stored.currentSeason > 9999
    || !['pending', 'partial', 'complete', 'failed'].includes(stored.coverage)
    || !Array.isArray(stored.candidates) || !Array.isArray(stored.completedSeasons)) throw new AccountStoreUnavailableError();
  const seen = new Set<string>();
  const leagues = stored.candidates.map(candidate => {
    if (typeof candidate.id !== 'string' || !/^[1-9]\d{0,31}$/.test(candidate.id)
      || typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 200
      || typeof candidate.season !== 'string' || !/^\d{4}$/.test(candidate.season)
      || !stored.completedSeasons.includes(Number(candidate.season)) || seen.has(candidate.id)) throw new AccountStoreUnavailableError();
    seen.add(candidate.id);
    return { id: candidate.id, name: candidate.name, season: candidate.season,
      url: `https://sleeper.com/leagues/${candidate.id}`, sourceManagerAccountIds: [stored.providerAccountId],
      capabilities: unverifiedLeagueCapabilities('Stored discovery candidates do not establish league access or derived-feature coverage.') };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { accountId: actor, season: String(stored.currentSeason),
    status: stored.completedSeasons.length ? 'partial' : 'unavailable',
    profiles: [{ sourceManagerAccountId: stored.providerAccountId, displayName: stored.displayName,
      status: stored.coverage === 'complete' ? 'complete' : 'unavailable' }], leagues };
}

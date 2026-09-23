import 'server-only';
import { getSleeperDiscoverySeason, getSleeperUserLeagues } from '../sleeper';
import type { LinkedSleeperProfile, SleeperLeagueDiscovery } from './contracts';
import { unverifiedLeagueCapabilities } from '../league-capabilities';

type DiscoveryResult = Omit<SleeperLeagueDiscovery, 'accountId'>;

/** Discovery reads public provider metadata; it never enrolls or saves a league. */
export async function discoverSleeperLeagues(
  profiles: readonly LinkedSleeperProfile[], requestSignal?: AbortSignal,
): Promise<DiscoveryResult> {
  requestSignal?.throwIfAborted();
  if (profiles.length > 20) throw new Error('Too many associated profiles.');
  const result: DiscoveryResult = {
    season: null, status: 'complete',
    profiles: profiles.map(profile => ({ sourceManagerAccountId: profile.sourceManagerAccountId,
      displayName: profile.displayName, status: 'unavailable' })),
    leagues: [],
  };
  if (!profiles.length) return result;
  const deadline = AbortSignal.timeout(15_000);
  const signal = requestSignal ? AbortSignal.any([requestSignal, deadline]) : deadline;
  try {
    result.season = await getSleeperDiscoverySeason(signal);
  } catch {
    requestSignal?.throwIfAborted();
    return { ...result, status: 'unavailable' };
  }
  const feeds: (Awaited<ReturnType<typeof getSleeperUserLeagues>> | null)[] = profiles.map(() => null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, profiles.length) }, async () => {
    while (next < profiles.length) {
      const index = next++;
      try {
        signal.throwIfAborted();
        feeds[index] = await getSleeperUserLeagues(profiles[index].externalId, result.season!, signal);
      } catch {
        requestSignal?.throwIfAborted();
      }
    }
  }));
  // Contradictory metadata across profile responses cannot establish a complete list.
  const names = new Map<string, string>();
  const conflicts = new Set<string>();
  const revisions = new Map<string, string | null | undefined>();
  const settingsConflicts = new Set<string>();
  for (const feed of feeds) for (const league of feed ?? []) {
    const existing = names.get(league.id);
    if (existing !== undefined && existing !== league.name) conflicts.add(league.id);
    names.set(league.id, league.name);
    const revision = league.capabilities?.configurationRevision;
    if (revisions.has(league.id) && (revisions.get(league.id) !== revision || revision === null)) settingsConflicts.add(league.id);
    revisions.set(league.id, revision);
  }
  const leagues = new Map<string, SleeperLeagueDiscovery['leagues'][number]>();
  for (let index = 0; index < profiles.length; index += 1) {
    const feed = feeds[index];
    if (!feed || feed.some(league => conflicts.has(league.id))) continue;
    result.profiles[index].status = 'complete';
    for (const league of feed) {
      let discovered = leagues.get(league.id);
      if (!discovered) {
        discovered = { ...league, url: `https://sleeper.com/leagues/${league.id}`, sourceManagerAccountIds: [] };
        if (settingsConflicts.has(league.id)) discovered.capabilities = unverifiedLeagueCapabilities(
          'Associated profiles returned conflicting settings for this league.');
        leagues.set(league.id, discovered);
      }
      if (!discovered.sourceManagerAccountIds.includes(profiles[index].sourceManagerAccountId)) {
        discovered.sourceManagerAccountIds.push(profiles[index].sourceManagerAccountId);
      }
    }
  }
  const complete = result.profiles.filter(profile => profile.status === 'complete').length;
  result.status = complete === profiles.length ? 'complete' : complete ? 'partial' : 'unavailable';
  result.leagues = [...leagues.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return result;
}

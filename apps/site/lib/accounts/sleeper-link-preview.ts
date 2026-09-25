import 'server-only';
import { getFantasyPlayerCatalog, getOfficialAdministrationObservation, getSleeperDiscoverySeason,
  getSleeperUserIdentity, getSleeperUserLeagues } from '../sleeper';
import { normalizeTeams, type SleeperUser } from '../transform';
import type { ProviderAccount, SleeperLinkPreview } from './contracts';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type RosterMatch = { leagueId: string; leagueName: string; rosterId: number; teamName: string; playerIds: string[] };

export async function matchingRoster(league: { id: string; name: string }, userId: string, signal: AbortSignal): Promise<RosterMatch | null> {
  const observation = await getOfficialAdministrationObservation(league.id, 'rosters', null, 60, signal);
  if (!Array.isArray(observation.payload) || observation.payload.length > 100) return null;
  for (const row of observation.payload) {
    if (!record(row) || !Number.isSafeInteger(row.roster_id) || Number(row.roster_id) < 1) continue;
    if (row.co_owners != null && (!Array.isArray(row.co_owners)
      || !row.co_owners.every(id => typeof id === 'string'))) continue;
    const coOwners = Array.isArray(row.co_owners) && row.co_owners.every(id => typeof id === 'string')
      ? row.co_owners as string[] : [];
    if (row.owner_id !== userId && !coOwners.includes(userId)) continue;
    const usersObservation = await getOfficialAdministrationObservation(league.id, 'users', null, 60, signal).catch(() => null);
    const users: SleeperUser[] = usersObservation && Array.isArray(usersObservation.payload) && usersObservation.payload.length <= 100
      ? usersObservation.payload.filter((user): user is Record<string, unknown> => record(user)
          && typeof user.user_id === 'string')
        .map(user => ({ user_id: String(user.user_id),
          display_name: typeof user.display_name === 'string' ? user.display_name : undefined,
          username: typeof user.username === 'string' ? user.username : undefined,
          metadata: record(user.metadata) ? user.metadata : null })) : [];
    const teamName = normalizeTeams([{ roster_id: Number(row.roster_id),
      owner_id: typeof row.owner_id === 'string' ? row.owner_id : null,
      metadata: record(row.metadata) ? row.metadata : null }], users)[0].name;
    const ids = Array.isArray(row.starters) && row.starters.length ? row.starters : row.players;
    const playerIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length <= 40).slice(0, 12) : [];
    return { leagueId: league.id, leagueName: league.name, rosterId: Number(row.roster_id), teamName, playerIds };
  }
  return null;
}

/** Read-only recognition evidence. This is never proof that the website actor controls Sleeper. */
export async function previewSleeperLink(account: ProviderAccount, requestSignal?: AbortSignal): Promise<SleeperLinkPreview> {
  if (account.provider !== 'sleeper' || !/^[1-9]\d{0,31}$/u.test(account.externalId)) throw new Error('Invalid link preview source.');
  const timeout = AbortSignal.timeout(15_000);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  const [identity, season] = await Promise.all([
    getSleeperUserIdentity(account.externalId, signal), getSleeperDiscoverySeason(signal),
  ]);
  const leagues = await getSleeperUserLeagues(account.externalId, season, signal);
  signal.throwIfAborted();
  const matches: RosterMatch[] = [];
  // A few examples make the account recognizable without loading every roster in a large league library.
  for (let start = 0; start < Math.min(leagues.length, 8) && matches.length < 3; start += 4) {
    const batch = await Promise.allSettled(leagues.slice(start, start + 4).map(league => matchingRoster(league, identity.userId, signal)));
    signal.throwIfAborted();
    for (const result of batch) if (result.status === 'fulfilled' && result.value) matches.push(result.value);
  }
  const catalog = matches.length ? await getFantasyPlayerCatalog().catch(() => null) : null;
  signal.throwIfAborted();
  return {
    sourceManagerAccountId: account.id,
    userId: identity.userId,
    username: identity.username,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    season,
    leagues: leagues.map(league => ({ id: league.id, name: league.name })),
    teams: matches.slice(0, 3).map(match => ({
      leagueId: match.leagueId, leagueName: match.leagueName, rosterId: match.rosterId, teamName: match.teamName,
      players: match.playerIds.map(id => catalog?.catalog[id])
        .filter((player): player is NonNullable<typeof player> => Boolean(player))
        .map(player => player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' '))
        .filter((name): name is string => Boolean(name)).slice(0, 3),
    })),
  };
}

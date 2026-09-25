import { LEAGUE_SITES, siteForLeague } from '../leagues';
import type { AccountLibraryInput, AccountTeam, AccountView, LibraryLeague, SourceLeague, TeamParticipation } from './contracts';

// Match the existing core-source freshness threshold without starting a second
// collector. Older valid evidence remains explicitly last known, never ownership proof.
export const ACCOUNT_SOURCE_FRESHNESS_MS = 60_000;

function validTime(value: string | null, now: number): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now ? time : null;
}

export function sourceState(source: SourceLeague, now: number): LibraryLeague['sourceState'] {
  if (!source.valid || source.season === null || validTime(source.observedAt, now) === null) return 'unavailable';
  const checked = validTime(source.checkedAt, now);
  const verified = validTime(source.verifiedAt, now);
  if (checked === null || verified === null || verified > checked) return 'unavailable';
  return now - checked <= ACCOUNT_SOURCE_FRESHNESS_MS && now - verified <= ACCOUNT_SOURCE_FRESHNESS_MS ? 'current' : 'stale';
}

export function buildAccountView(input: AccountLibraryInput, now = Date.now()): AccountView {
  const linkedAccounts = new Set(input.links.map(link => link.sourceManagerAccountId));
  const ids = new Set<string>();
  const keys = new Set<string>();
  const leagues: LibraryLeague[] = [];
  for (const source of input.sources) {
    const site = siteForLeague(source.key, source.name);
    if (!site) continue;
    if (ids.has(source.id) || keys.has(source.key)) throw new Error('Ambiguous account league source.');
    ids.add(source.id);
    keys.add(source.key);
    const key = site.key;
    const state = sourceState(source, now);
    const teams = new Map<string, TeamParticipation>();
    if (state !== 'unavailable') {
      for (const member of source.memberships) {
        if (!linkedAccounts.has(member.sourceManagerAccountId)) continue;
        let team = teams.get(member.teamId);
        if (team && team.rosterId !== member.rosterId) throw new Error('Conflicting account team identity.');
        if (!team) {
          team = { id: member.teamId, rosterId: member.rosterId, roles: [], sourceManagerAccountIds: [],
            assurance: 'user_asserted', freshness: state, observedAt: source.observedAt! };
          teams.set(team.id, team);
        }
        if (!team.roles.includes(member.role)) team.roles.push(member.role);
        if (!team.sourceManagerAccountIds.includes(member.sourceManagerAccountId)) team.sourceManagerAccountIds.push(member.sourceManagerAccountId);
      }
    }
    const saved = input.saved.find(value => value.leagueId === source.id);
    leagues.push({ id: source.id, key, name: source.name, season: source.season, url: `${site.prefix}/matchups`, logo: site.logo,
      saved: saved ? { favorite: saved.favorite, sortPosition: saved.sortPosition, preferredSeasonTeamId: saved.preferredSeasonTeamId, revision: saved.revision } : null,
      teams: [...teams.values()].sort((a, b) => a.rosterId.localeCompare(b.rosterId, 'en', { numeric: true })),
      affiliations: input.groups.filter(group => group.leagueIds.includes(source.id)).map(({ id, name }) => ({ id, name })),
      linkedFromLeagueIds: [], sourceState: state, sourceObservedAt: state === 'unavailable' ? null : source.observedAt });
  }
  // Only direct affiliation from observed participation. A follow, shared group,
  // historical membership or suggested league never recursively grants discovery.
  const participating = new Set(leagues.filter(league => league.teams.length > 0).map(league => league.id));
  for (const league of leagues) {
    league.linkedFromLeagueIds = [...new Set(input.groups.filter(group => group.leagueIds.includes(league.id))
      .flatMap(group => group.leagueIds.filter(id => id !== league.id && participating.has(id))))].sort();
  }
  leagues.sort((a, b) => Number(Boolean(b.saved?.favorite)) - Number(Boolean(a.saved?.favorite))
    || (a.saved?.sortPosition ?? 1_000_001) - (b.saved?.sortPosition ?? 1_000_001)
    || Object.keys(LEAGUE_SITES).indexOf(a.key) - Object.keys(LEAGUE_SITES).indexOf(b.key));
  return { profile: input.profile, links: input.links, library: { leagues, availableProviderAccounts: input.providerAccounts } };
}

/** Future account-wide My Teams contract; the existing My Team screen does not use it yet. */
export function accountTeams(view: AccountView): AccountTeam[] {
  return view.library.leagues.flatMap(league => league.season === null ? [] : league.teams.map(team => ({
    ...team, leagueId: league.id, leagueKey: league.key, leagueName: league.name, season: league.season!,
  })));
}

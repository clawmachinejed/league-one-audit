import 'server-only';
import { getAccountPrincipal } from './auth';
import { createAccountDatabase } from './database';
import { createAccountStore } from './store';
import { accountErrorResponse, requireAccountOrigin } from './http';
import { accountUuid, AccountInputError } from './validation';
import { getCurrentLeagueId } from '../league-administration/registry';
import { getLeagueSite } from '../league-sites';
import { loadLeagueMatchups } from '../league-matchups-source';
import { getSleeperDiscoverySeason, getStandings } from '../sleeper';
import { siteForLeague } from '../leagues';
import { parseMatchupWeek } from '../matchup-week';
import type { AccountView } from './contracts';
import type { MyFantasyMembership } from '../my-fantasy-membership';

export async function loadAccountFantasy(account: AccountView, requestedWeek?: number): Promise<MyFantasyMembership[]> {
  const season = await getSleeperDiscoverySeason();
  const candidates = account.library.leagues.filter(league => league.teams.length > 0 && String(league.season) === season);
  return Promise.all(candidates.map(async league => {
    const site = await getLeagueSite(league.key).catch(() => siteForLeague(league.key, league.name, league.logo)!);
    const teamIds = [...new Set(league.teams.map(team => Number(team.rosterId)).filter(id => Number.isSafeInteger(id) && id > 0))];
    let leagueId: string | null = null;
    try {
      leagueId = await getCurrentLeagueId(league.key);
      const source = await loadLeagueMatchups(leagueId, league.key, requestedWeek);
      if (source.data.league.season !== season) throw new Error('Season changed.');
      const standingsData = await getStandings(leagueId).catch(() => null);
      return { teamIds: teamIds.filter(id => source.data.teams.some(team => team.id === id)),
        entry: { status: 'available' as const, site, leagueId, source, standingsData, honors: null } };
    } catch { return { teamIds, entry: { status: 'unavailable' as const, site, leagueId } }; }
  }));
}

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
const defaults = { principal: getAccountPrincipal, store: () => createAccountStore(createAccountDatabase()), load: loadAccountFantasy };
export async function accountFantasyResponse(request: Request, dependencies = defaults): Promise<Response> {
  try {
    const expected = accountUuid(request.headers.get('x-expected-account-id'));
    if (request.headers.get('origin') || request.headers.get('sec-fetch-site') === 'cross-site') requireAccountOrigin(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'week') || params.getAll('week').length > 1) throw new AccountInputError();
    const week = params.has('week') ? parseMatchupWeek(params.get('week')) : undefined;
    if (week === null) throw new AccountInputError();
    const principal = await dependencies.principal();
    if (!principal) return Response.json({ error: 'unauthenticated' }, { status: 401, headers });
    const store = dependencies.store();
    const actor = await store.resolve(principal);
    if (actor !== expected) return Response.json({ error: 'account_changed' }, { status: 409, headers });
    const account = await store.read(actor);
    const members = await dependencies.load(account, week);
    request.signal.throwIfAborted();
    const latest = await dependencies.principal();
    if (!latest || latest.issuer !== principal.issuer || latest.subject !== principal.subject
      || JSON.stringify((await store.read(actor)).links) !== JSON.stringify(account.links)) {
      return Response.json({ error: 'account_changed' }, { status: 409, headers });
    }
    return Response.json({ accountId: actor, memberships: members, evaluatedAt: new Date().toISOString() }, { headers });
  } catch (error) { return accountErrorResponse(error); }
}

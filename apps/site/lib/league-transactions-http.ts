import 'server-only';

import { getCurrentLeagueId } from './league-administration/registry';
import { LEAGUE_SITES, type LeagueKey } from './leagues';
import { getLeagueTransactions } from './sleeper';

const responseHeaders = { 'Cache-Control': 'private, no-store' };

function isLeagueKey(value: string): value is LeagueKey {
  return Object.hasOwn(LEAGUE_SITES, value);
}

export async function handleLeagueTransactionsRequest(
  league: string,
  loadTransactions = getLeagueTransactions,
): Promise<Response> {
  if (!isLeagueKey(league)) {
    return Response.json({ error: 'Unknown league.' }, { status: 404, headers: responseHeaders });
  }
  let data;
  try {
    data = await loadTransactions(await getCurrentLeagueId(league), league);
  } catch {
    return Response.json(
      { error: 'League transaction history is temporarily unavailable. Please try again.' },
      { status: 503, headers: responseHeaders },
    );
  }
  return Response.json(data, { headers: responseHeaders });
}

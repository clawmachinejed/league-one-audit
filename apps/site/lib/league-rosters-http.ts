import 'server-only';

import { LEAGUE_IDS } from './config';
import { LEAGUE_SITES, type LeagueKey } from './leagues';
import { getRosters } from './sleeper';

const responseHeaders = { 'Cache-Control': 'private, no-store' };

function isLeagueKey(value: string): value is LeagueKey {
  return Object.hasOwn(LEAGUE_SITES, value);
}

export async function handleLeagueRostersRequest(
  request: Request,
  league: string,
  loadRosters = getRosters,
): Promise<Response> {
  if (!isLeagueKey(league)) {
    return Response.json({ error: 'Unknown league.' }, { status: 404, headers: responseHeaders });
  }
  const rawWeek = new URL(request.url).searchParams.get('week');
  if (rawWeek === null || !/^\d{1,2}$/u.test(rawWeek)) {
    return Response.json({ error: 'A valid roster week is required.' }, { status: 400, headers: responseHeaders });
  }
  const week = Number(rawWeek);
  if (!Number.isInteger(week) || week < 1 || week > 18) {
    return Response.json({ error: 'A valid roster week is required.' }, { status: 400, headers: responseHeaders });
  }
  try {
    return Response.json(await loadRosters(LEAGUE_IDS[league], week), { headers: responseHeaders });
  } catch {
    return Response.json(
      { error: 'League rosters are temporarily unavailable. Please try again.' },
      { status: 503, headers: responseHeaders },
    );
  }
}

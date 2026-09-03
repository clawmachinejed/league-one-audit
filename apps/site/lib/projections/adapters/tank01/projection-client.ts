import {
  copyToNullRecord,
  REQUEST_TIMEOUT_MS,
  Tank01ProviderFailure,
  type NormalizedCrosswalk,
  type NormalizedProjectionSlate,
} from './projection-internals';
import { startProviderHttp } from '../../../provider-request-telemetry';

const RAPID_API_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const RAPID_API_ORIGIN = `https://${RAPID_API_HOST}`;

export async function fetchTank01Envelope(
  request: typeof fetch,
  path: string,
  apiKey: string,
): Promise<unknown> {
  const finished = startProviderHttp('tank01', path.startsWith('/getNFLPlayerList') ? 'player-crosswalk' : 'projection-slate', 'bypass');
  let response: Response;
  try {
    response = await request(`${RAPID_API_ORIGIN}${path}`, {
      method: 'GET',
      cache: 'no-store',
      // Refuse redirects so custom authentication headers cannot be forwarded elsewhere.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'x-rapidapi-host': RAPID_API_HOST,
        'x-rapidapi-key': apiKey,
      },
    });
  } catch {
    finished('unavailable');
    throw new Tank01ProviderFailure('provider-error');
  }
  if (!response.ok) { finished('unavailable'); throw new Tank01ProviderFailure('provider-error'); }
  try {
    const result: unknown = await response.json();
    finished('available');
    return result;
  } catch {
    finished('invalid');
    throw new Tank01ProviderFailure('invalid-response');
  }
}

export async function waitForBoth<First, Second>(
  first: Promise<First>,
  second: Promise<Second>,
): Promise<[First, Second]> {
  const [firstResult, secondResult] = await Promise.allSettled([first, second]);
  if (firstResult.status === 'rejected') throw firstResult.reason;
  if (secondResult.status === 'rejected') throw secondResult.reason;
  return [firstResult.value, secondResult.value];
}

export function projectionPath(season: string, week: number, nowMs: number): string {
  const query = new URLSearchParams({ week: String(week), itemFormat: 'map' });
  const now = new Date(nowMs);
  // January and February still belong to the preceding NFL kickoff season.
  const currentNflSeason = now.getUTCMonth() < 2
    ? now.getUTCFullYear() - 1
    : now.getUTCFullYear();
  if (Number(season) < currentNflSeason) query.set('archiveSeason', season);
  return `/getNFLProjections?${query.toString()}`;
}

export function rehydrateProjectionSlate(
  slate: NormalizedProjectionSlate,
): NormalizedProjectionSlate {
  return {
    ...slate,
    playersByTank01Id: copyToNullRecord(slate.playersByTank01Id),
    defensesByTeam: copyToNullRecord(slate.defensesByTeam),
  };
}

export function rehydrateCrosswalk(
  crosswalk: NormalizedCrosswalk,
): NormalizedCrosswalk {
  return {
    ...crosswalk,
    sleeperIdByTank01Id: copyToNullRecord(crosswalk.sleeperIdByTank01Id),
  };
}

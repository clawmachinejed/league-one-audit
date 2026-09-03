import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { LEAGUE_IDS } from './config';
import type { LeagueKey } from './leagues';
import { parseMatchupWeek } from './matchup-week';
import { matchupPeriodHeaders } from './matchup-period';
import { SNAPSHOT_REVISION_HEADER, SNAPSHOT_VERIFIED_AT_HEADER, validSnapshotRevision } from './matchup-snapshot-metadata';
import { readStoredMatchups, readStoredMatchupRevision } from './projection-reader';
import { getProjectionStore, type ProjectionStore } from './projection-store';
import { runLiveProjectionSync, type LiveProjectionSyncResult } from './live-projection-worker';

type CronRunner = (options?: Readonly<{ force?: boolean }>) => Promise<LiveProjectionSyncResult>;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;
const CURRENT_SNAPSHOT_HEADERS = {
  'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
} as const;
const HISTORICAL_SNAPSHOT_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
} as const;
const FUTURE_SNAPSHOT_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300',
} as const;

function response(
  body: Readonly<Record<string, unknown>>,
  status: number,
  headers: HeadersInit = NO_STORE_HEADERS,
): Response {
  return Response.json(body, { status, headers });
}

function validLeagueKey(value: string): value is LeagueKey {
  return Object.prototype.hasOwnProperty.call(LEAGUE_IDS, value);
}

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(header ?? '', 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function handleProjectionCronRequest(
  request: Request,
  options: Readonly<{
    secret?: string;
    run?: CronRunner;
  }> = {},
): Promise<Response> {
  const secret = options.secret ?? process.env.CRON_SECRET;
  if (!secret) return response({ status: 'unavailable' }, 503);
  if (!authorized(request.headers.get('authorization'), secret)) {
    return response({ status: 'unauthorized' }, 401);
  }

  const force = new URL(request.url).searchParams.get('force') === '1';
  let result: LiveProjectionSyncResult;
  try {
    result = await (options.run ?? runLiveProjectionSync)({ force });
  } catch {
    return response({ status: 'failed' }, 500);
  }

  if (result.status === 'disabled') return response({ status: 'unavailable' }, 503);
  if (result.status === 'failed') return response({ status: 'failed' }, 500);
  if (result.status === 'skipped') {
    return response({ status: 'skipped', reason: result.reason, cadence: result.cadence }, 200);
  }
  return response({
    status: 'completed',
    cadence: result.cadence,
    publishedLeagues: result.publishedLeagues,
    failedLeagues: result.failedLeagues,
    providerGroups: result.providerGroups,
  // Keep successfully published leagues, but surface any partial fleet failure
  // to Vercel's function health and logs instead of reporting a silent success.
  }, result.failedLeagues > 0 ? 503 : 200);
}

export async function handleMatchupsSnapshotRequest(
  request: Request,
  leagueKey: string,
  store: ProjectionStore = getProjectionStore(),
  now = new Date(),
): Promise<Response> {
  if (!validLeagueKey(leagueKey)) return response({ status: 'not-found' }, 404);
  const query = new URL(request.url).searchParams;
  const week = parseMatchupWeek(query.get('week'));
  if (week === null) return response({ status: 'invalid-week' }, 400);
  const revision = query.get('rev');
  if (revision !== null && !validSnapshotRevision(revision)) {
    return response({ status: 'invalid-revision' }, 400);
  }

  const selected = await readStoredMatchups(leagueKey, week, { store, now });
  if (selected.kind === 'missing') return response({ status: 'not-found' }, 404);
  if (selected.kind !== 'usable') return response({ status: 'unavailable' }, 503);
  if (revision !== null && revision !== selected.snapshotRevision) {
    return response({ status: 'revision-mismatch' }, 409);
  }
  const headers = matchupPeriodHeaders(selected.context);
  headers.set(SNAPSHOT_REVISION_HEADER, selected.snapshotRevision);
  const verificationTime = Date.parse(selected.verifiedAt);
  headers.set(SNAPSHOT_VERIFIED_AT_HEADER, Number.isFinite(verificationTime)
    ? new Date(verificationTime).toISOString() : selected.verifiedAt);
  const cache = selected.context.temporalState === 'past'
    ? HISTORICAL_SNAPSHOT_HEADERS
    : selected.context.temporalState === 'future'
      ? FUTURE_SNAPSHOT_HEADERS
      : CURRENT_SNAPSHOT_HEADERS;
  headers.set('Cache-Control', cache['Cache-Control']);
  return Response.json(selected.payload, {
    status: 200,
    headers,
  });
}

export async function handleMatchupsRevisionRequest(
  request: Request,
  leagueKey: string,
  store: ProjectionStore = getProjectionStore(),
  now = new Date(),
): Promise<Response> {
  if (!validLeagueKey(leagueKey)) return response({ status: 'not-found' }, 404);
  const week = parseMatchupWeek(new URL(request.url).searchParams.get('week'));
  if (week === null) return response({ status: 'invalid-week' }, 400);
  const selected = await readStoredMatchupRevision(leagueKey, week, { store, now });
  if (selected.kind === 'missing') return response({ status: 'not-found' }, 404);
  if (selected.kind !== 'usable' || !validSnapshotRevision(selected.snapshotRevision)
    || !Number.isFinite(Date.parse(selected.verifiedAt))) {
    return response({ status: 'unavailable' }, 503);
  }
  const headers = matchupPeriodHeaders(selected.context);
  headers.set('Cache-Control', 'no-store');
  return response({
    status: 'ok', revision: selected.snapshotRevision,
    verifiedAt: new Date(selected.verifiedAt).toISOString(),
  }, 200, headers);
}

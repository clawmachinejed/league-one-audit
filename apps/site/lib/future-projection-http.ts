import 'server-only';

import { cronAuthorizationResponse, cronResponse } from './cron-http';
import { runFutureProjectionSync, type FutureProjectionSyncResult } from './future-projection-worker';

type FutureRunner = () => Promise<FutureProjectionSyncResult>;

export async function handleFutureProjectionCronRequest(
  request: Request,
  options: Readonly<{ secret?: string; run?: FutureRunner }> = {},
): Promise<Response> {
  const denied = cronAuthorizationResponse(request, options.secret);
  if (denied) return denied;
  let result: FutureProjectionSyncResult;
  try {
    result = await (options.run ?? runFutureProjectionSync)();
  } catch {
    return cronResponse({ status: 'failed' }, 500);
  }
  if (result.status === 'disabled') return cronResponse({ status: 'unavailable' }, 503);
  if (result.status === 'failed') return cronResponse({ status: 'failed' }, 500);
  if (result.status === 'skipped') return cronResponse({ status: 'skipped', reason: result.reason }, 200);
  return cronResponse({
    status: 'completed',
    action: result.action,
    season: result.period.season,
    seasonType: result.period.seasonType,
    week: result.period.week,
    publishedLeagues: result.publishedLeagues,
    unchangedLeagues: result.unchangedLeagues,
    failedLeagues: result.failedLeagues,
  }, result.failedLeagues > 0 ? 503 : 200);
}

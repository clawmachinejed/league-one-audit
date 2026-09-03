import 'server-only';

import { cronAuthorizationResponse, cronResponse } from './cron-http';
import { runLiveProjectionSync, type LiveProjectionSyncResult } from './live-projection-worker';

type CronRunner = (options?: Readonly<{ force?: boolean }>) => Promise<LiveProjectionSyncResult>;

export async function handleProjectionCronRequest(
  request: Request,
  options: Readonly<{
    secret?: string;
    run?: CronRunner;
  }> = {},
): Promise<Response> {
  const denied = cronAuthorizationResponse(request, options.secret);
  if (denied) return denied;

  const force = new URL(request.url).searchParams.get('force') === '1';
  let result: LiveProjectionSyncResult;
  try {
    result = await (options.run ?? runLiveProjectionSync)({ force });
  } catch {
    return cronResponse({ status: 'failed' }, 500);
  }

  if (result.status === 'disabled') return cronResponse({ status: 'unavailable' }, 503);
  if (result.status === 'failed') return cronResponse({ status: 'failed' }, 500);
  if (result.status === 'skipped') {
    return cronResponse({ status: 'skipped', reason: result.reason, cadence: result.cadence }, 200);
  }
  return cronResponse({
    status: 'completed',
    cadence: result.cadence,
    publishedLeagues: result.publishedLeagues,
    failedLeagues: result.failedLeagues,
    providerGroups: result.providerGroups,
  // Keep successfully published leagues, but surface any partial fleet failure
  // to Vercel's function health and logs instead of reporting a silent success.
  }, result.failedLeagues > 0 ? 503 : 200);
}



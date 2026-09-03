import 'server-only';

import { cronAuthorizationResponse, cronResponse } from './cron-http';
import { runLineupObservationSync, type LineupObservationSyncResult } from './lineup-observation-worker';

type LineupRunner = () => Promise<LineupObservationSyncResult>;

export async function handleLineupObservationCronRequest(
  request: Request,
  options: Readonly<{ secret?: string; run?: LineupRunner }> = {},
): Promise<Response> {
  const denied = cronAuthorizationResponse(request, options.secret);
  if (denied) return denied;
  let result: LineupObservationSyncResult;
  try {
    result = await (options.run ?? runLineupObservationSync)();
  } catch {
    return cronResponse({ status: 'failed' }, 500);
  }
  if (result.status === 'unavailable') return cronResponse({ status: 'unavailable' }, 503);
  if (result.status === 'failed') return cronResponse({ status: 'failed' }, 500);
  if (result.status === 'skipped') return cronResponse({ status: 'skipped', reason: result.reason }, 200);
  return cronResponse({
    status: result.failed > 0 ? 'partial' : 'completed',
    checked: result.checked,
    changed: result.changed,
    unchanged: result.unchanged,
    notReady: result.notReady,
    skipped: result.skipped,
    failed: result.failed,
    pending: result.pending,
  }, result.failed > 0 ? 503 : 200);
}

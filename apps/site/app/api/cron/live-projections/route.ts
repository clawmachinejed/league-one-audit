import { after } from 'next/server';
import { handleProjectionCronRequest } from '@/lib/projection-cron-http';
import { runProductionAllPlayerRecurring } from '@/lib/projections/runtime/all-player-composition';
import { createLiveDefenseStatCoordinator } from '@/lib/projections/runtime/live-defense-stats';
import { runProductionProjectionSync } from '@/lib/projections/runtime/projection-dispatch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const invocationStartedAt = Date.now();
  const defenseStats = createLiveDefenseStatCoordinator(invocationStartedAt);
  return handleProjectionCronRequest(request, {
    run: (options) => runProductionProjectionSync({ ...options, invocationStartedAt, defenseStats }),
    afterAuthorizedRun: () => after(async () => {
      try {
        await runProductionAllPlayerRecurring(invocationStartedAt, defenseStats.getCapture);
      } catch {
        // The durable all-player job records its own sanitized failure evidence.
      }
    }),
  });
}

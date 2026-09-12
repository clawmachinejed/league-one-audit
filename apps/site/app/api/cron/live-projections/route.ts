import { after } from 'next/server';
import { handleProjectionCronRequest } from '@/lib/projection-cron-http';
import { runProductionAllPlayerRecurring } from '@/lib/projections/runtime/all-player-composition';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return handleProjectionCronRequest(request, {
    afterAuthorizedRun: () => after(async () => {
      try {
        await runProductionAllPlayerRecurring();
      } catch {
        // The durable all-player job records its own sanitized failure evidence.
      }
    }),
  });
}

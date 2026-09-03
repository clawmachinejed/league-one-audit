import { handleLineupObservationCronRequest } from '@/lib/lineup-observation-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return handleLineupObservationCronRequest(request);
}

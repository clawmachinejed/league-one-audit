import { handleFutureProjectionCronRequest } from '@/lib/future-projection-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return handleFutureProjectionCronRequest(request);
}

import 'server-only';

import { timingSafeEqual } from 'node:crypto';

export function cronResponse(body: Readonly<Record<string, unknown>>, status: number): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Every cron authenticates before worker construction or provider/database work. */
export function cronAuthorizationResponse(
  request: Request,
  secret: string | undefined = process.env.CRON_SECRET,
): Response | null {
  if (!secret) return cronResponse({ status: 'unavailable' }, 503);
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(request.headers.get('authorization') ?? '', 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    ? null : cronResponse({ status: 'unauthorized' }, 401);
}

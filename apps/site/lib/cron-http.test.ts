import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { cronAuthorizationResponse } from './cron-http';

function request(authorization?: string): Request {
  return new Request('https://example.test/api/cron/lineup-observations', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

afterEach(() => vi.unstubAllEnvs());

describe('shared cron authorization', () => {
  it.each([undefined, '', 'Bearer wrong', 'Bearer private-longer', 'Basic private', 'bearer private', 'Bearer privaté'])
    ('rejects missing, incorrect, differently sized or differently encoded credentials: %s', async (header) => {
      const denied = cronAuthorizationResponse(request(header), 'private');
      expect(denied?.status).toBe(401);
      expect(denied?.headers.get('Cache-Control')).toBe('no-store');
      expect(await denied?.json()).toEqual({ status: 'unauthorized' });
    });

  it('uses the configured secret only when no explicit value was supplied', async () => {
    vi.stubEnv('CRON_SECRET', 'environment-secret');
    expect(cronAuthorizationResponse(request('Bearer environment-secret'))).toBeNull();
    expect(cronAuthorizationResponse(request('Bearer explicit'), 'explicit')).toBeNull();
    const disabled = cronAuthorizationResponse(request('Bearer environment-secret'), '');
    expect(disabled?.status).toBe(503);
    expect(disabled?.headers.get('Cache-Control')).toBe('no-store');
    expect(await disabled?.json()).toEqual({ status: 'unavailable' });
    vi.stubEnv('CRON_SECRET', '');
    expect(cronAuthorizationResponse(request())?.status).toBe(503);
  });
});

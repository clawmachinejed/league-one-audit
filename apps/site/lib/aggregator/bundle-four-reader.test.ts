import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../database';
import { createBundleFourReader } from './bundle-four-reader';
import type { BundleFourReadInput } from './bundle-four';
import { b4Fixture } from './b4-acceptance.fixtures';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('optional B4 factory boundary', () => {
  it('keeps Preview persistence disabled before input access or network traffic', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic:synthetic@fixture.invalid/synthetic?sslmode=require');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access.'));
    const input = new Proxy({}, { get() { throw new Error('Inspected disabled request.'); } }) as BundleFourReadInput;
    expect(await createBundleFourReader().readBundleFour(input)).toEqual({ status: 'disabled', reason: 'persistence_disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allocates an independent bounded signal per query and fails closed for an absent mapping', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const query: DatabaseClient['query'] = async (_statement, _parameters, options) => {
      signals.push(options?.signal); options?.signal?.throwIfAborted(); return [];
    };
    const reader = createBundleFourReader({ enabled: true, query }), { request } = b4Fixture();
    expect(await reader.readBundleFour(request)).toEqual({ status: 'unavailable', reason: 'historical_mapping_changed' });
    expect(await reader.readBundleFour(request)).toEqual({ status: 'unavailable', reason: 'historical_mapping_changed' });
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal instanceof AbortSignal)).toBe(true);
    expect(signals[0]).not.toBe(signals[1]);
  });
});

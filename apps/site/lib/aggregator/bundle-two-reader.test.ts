import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../database';
import { createBundleTwoReader } from './bundle-two-reader';
import type { BundleTwoReadInput } from './bundle-two';
import { b1CompatibilityInput, b1Mapping } from './b1-acceptance.fixtures';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('optional B2 factory boundary', () => {
  it('keeps default Preview persistence inert before examining the request or issuing network traffic', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic:synthetic@fixture.invalid/synthetic?sslmode=require');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access.'));
    const input = new Proxy({}, { get() { throw new Error('Inspected disabled request.'); } }) as BundleTwoReadInput;
    expect(await createBundleTwoReader().readBundleTwo(input))
      .toEqual({ kind: 'bundle-two-season-overview', status: 'disabled', reason: 'persistence_disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allocates a fresh bounded query signal on each request and fails closed when the mapping is absent', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const query: DatabaseClient['query'] = async (_statement, _parameters, options) => {
      signals.push(options?.signal);
      options?.signal?.throwIfAborted();
      return [];
    };
    const reader = createBundleTwoReader({ enabled: true, query });
    const input: BundleTwoReadInput = { expectedMapping: b1Mapping,
      league: { season: '2026', rosterPositions: ['QB', 'RB'], week: 4, maxWeek: 18 },
      context: b1CompatibilityInput.context, selectedWeek: 4, selectedSeasonTeamId: null,
      now: b1CompatibilityInput.now, calendar: null, scheduleRange: null, snapshot: null };
    expect(await reader.readBundleTwo(input)).toEqual({ status: 'unavailable', reason: 'season_overview_mapping_changed' });
    expect(await reader.readBundleTwo(input)).toEqual({ status: 'unavailable', reason: 'season_overview_mapping_changed' });
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal instanceof AbortSignal)).toBe(true);
    expect(signals[0]).not.toBe(signals[1]);
  });
});

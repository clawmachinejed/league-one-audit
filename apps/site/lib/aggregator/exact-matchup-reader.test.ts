import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createExactMatchupCompatibilityReader, type ExactMatchupCompatibilityReadInput } from './exact-matchup-reader';
import type { DatabaseClient } from '../database';

afterEach(() => vi.unstubAllEnvs());

describe('internal exact-matchup compatibility composition', () => {
  it('starts an independent deadline on each read, including reuse after a prior timeout', async () => {
    const first = new AbortController(), second = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValueOnce(first.signal).mockReturnValueOnce(second.signal);
    const signals: (AbortSignal | undefined)[] = [];
    const query: DatabaseClient['query'] = async (_statement, _parameters, options) => {
      signals.push(options?.signal);
      options?.signal?.throwIfAborted();
      return [];
    };
    const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
    const input: ExactMatchupCompatibilityReadInput = {
      request: { snapshotId: uuid(4), leagueSeasonId: uuid(2), season: 2026, week: 4, modelVersion: 'clock-v1' },
      expectedMapping: { connectionId: uuid(1), leagueSeasonId: uuid(2), revisionId: uuid(3), generation: 1,
        scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'fixture-source', season: 2026 } },
      now: new Date('2026-09-29T12:01:00.000Z'),
      context: { defaultSeason: 2026, defaultWeek: 4, activeSeason: 2026, activeWeek: 4,
        lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false },
    };
    try {
      const reader = createExactMatchupCompatibilityReader({ enabled: true, query });
      expect(timeout).not.toHaveBeenCalled();
      await reader.readExactMatchupCompatibility(input);
      first.abort();
      await reader.readExactMatchupCompatibility(input);
      expect(timeout.mock.calls).toEqual([[3_000], [3_000]]);
      expect(signals).toEqual([first.signal, second.signal]);
      expect(second.signal.aborted).toBe(false);
    } finally { timeout.mockRestore(); }
  });

  it('keeps the disabled path inert even for a request with throwing accessors', async () => {
    const input = new Proxy({}, { get() { throw new Error('Disabled reader inspected input.'); } });
    const result = await createExactMatchupCompatibilityReader({ enabled: false, reason: 'missing-database-url' })
      .readExactMatchupCompatibility(input as ExactMatchupCompatibilityReadInput);
    expect(result.official).toEqual({ status: 'disabled' });
    expect(result.sourceHistory).toEqual({ status: 'unavailable', reason: 'persistence_disabled' });
    for (const value of [result.forecast, result.gameState, result.probability]) {
      expect(value).toEqual({ status: 'unavailable', reason: 'persistence_disabled' });
    }
  });

  it('uses the existing Preview persistence guard even when a database URL is configured', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic:synthetic@fixture.invalid/synthetic?sslmode=require');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Preview reader made a network request.');
    });
    try {
      const result = await createExactMatchupCompatibilityReader()
        .readExactMatchupCompatibility({} as ExactMatchupCompatibilityReadInput);
      expect(result.official).toEqual({ status: 'disabled' });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});

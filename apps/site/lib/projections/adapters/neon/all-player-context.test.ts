import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { createAllPlayerContextMethods } from './all-player-context';

const sourceId = '11111111-1111-4111-8111-111111111111';
const request = { provider: 'Sleeper', season: 2026, seasonType: 'reg' as const, week: 1 };
const row = { provider_external_id: '12523', nfl_team: 'CAR', source_observation_id: sourceId,
  observed_at: '2026-09-15 04:01:25.903+00', has_unresolved_conflict: false };

describe('exact-period historical team context reader', () => {
  it('returns stable source provenance and quarantines a previously reported conflict', async () => {
    const fake = createFakeProjectionDatabase(() => [row, { ...row,
      provider_external_id: '8207', nfl_team: 'ATL', has_unresolved_conflict: true }]);
    expect(await createAllPlayerContextMethods(fake.database).readAllPlayerHistoricalTeamContexts(request))
      .toEqual([{ providerExternalId: '12523', nflTeam: 'CAR', sourceObservationId: sourceId,
        observedAt: '2026-09-15T04:01:25.903Z', effectivePeriod: { season: 2026, seasonType: 'reg', week: 1 },
        hasUnresolvedConflict: false }, { providerExternalId: '8207', nflTeam: 'ATL', sourceObservationId: sourceId,
        observedAt: '2026-09-15T04:01:25.903Z', effectivePeriod: { season: 2026, seasonType: 'reg', week: 1 },
        hasUnresolvedConflict: true }]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toEqual(['sleeper', 2026, 'reg', 1]);
    // A caller cannot silently get a truncated latest-only subset.
    expect(fake.calls[0].statement).toContain('LIMIT 10001');
    expect(fake.calls[0].statement).toContain('DISTINCT ON (entry.provider_external_id,entry.nfl_team)');
  });

  it('fails closed instead of trimming an oversized or malformed history', async () => {
    const tooMany = createFakeProjectionDatabase(() => Array.from({ length: 10_001 }, () => row));
    await expect(createAllPlayerContextMethods(tooMany.database).readAllPlayerHistoricalTeamContexts(request))
      .rejects.toThrow('exceeds its bound');
    for (const patch of [{ nfl_team: 'UNKNOWN' }, { source_observation_id: 'not-an-id' },
      { has_unresolved_conflict: 'false' }, { observed_at: 'not-a-date' }]) {
      const bad = createFakeProjectionDatabase(() => [{ ...row, ...patch }]);
      await expect(createAllPlayerContextMethods(bad.database).readAllPlayerHistoricalTeamContexts(request))
        .rejects.toThrow();
    }
  });

  it('rejects wrong periods before touching the database', async () => {
    const fake = createFakeProjectionDatabase();
    const reader = createAllPlayerContextMethods(fake.database);
    await expect(reader.readAllPlayerHistoricalTeamContexts({ ...request, week: 19 })).rejects.toThrow();
    await expect(reader.readAllPlayerHistoricalTeamContexts({ ...request, seasonType: 'post' as 'reg' })).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });
});

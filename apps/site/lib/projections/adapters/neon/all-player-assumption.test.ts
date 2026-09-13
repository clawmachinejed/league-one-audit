import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { AllPlayerStatObservation } from '../../domain/all-player-statistics';
import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { allPlayerStatSemanticHash, createAllPlayerStatisticMethods, prepareAllPlayerBatch } from './all-player-statistics';

const fingerprint = `sha256:${'a'.repeat(64)}`;
const period = { season: 2026, seasonType: 'reg' as const, week: 1 };
const effectivePeriod = period;
const policy = 'missing-participation-as-zero-v1' as const;
const observedAt = '2026-09-15T00:00:01.000Z';

/** Synthetic writer boundary: raw inputs mirror the two distinct missing cases. */
function assumedObservation(): AllPlayerStatObservation {
  return {
    provider: 'sleeper', ...period, normalizerVersion: 'sleeper-weekly-stats-v4',
    sourceRevision: 'retained-weekly-response', requestStartedAt: '2026-09-15T00:00:00.000Z',
    requestCompletedAt: observedAt, observedAt, quality: 'partial', warnings: [],
    coverage: { complete: false, providerPresentEntityCount: 1, providerMissingEntityCount: 1,
      unknownEligibilityCount: 1, unknownAppearanceCount: 0, assumedNonParticipationCount: 2,
      participationAssumptionPolicy: policy },
    entries: [
      { entityKind: 'player', providerExternalId: '7527', position: 'QB', nflTeam: 'SF',
        nflGameId: '11111111-1111-4111-8111-111111111111', gamePhase: 'final',
        stats: { gms_active: 1 }, eligibleGameCount: 1, appearanceGameCount: 0,
        eligibilityEvidence: { kind: 'assumed-nonparticipation', policy, source: 'product-policy',
          effectivePeriod, basis: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 } } },
      { entityKind: 'player', providerExternalId: '12529', position: 'RB', nflTeam: 'NE',
        nflGameId: '22222222-2222-4222-8222-222222222222', gamePhase: 'final',
        stats: {}, eligibleGameCount: null, appearanceGameCount: 0,
        eligibilityEvidence: { kind: 'assumed-nonparticipation', policy, source: 'product-policy',
          effectivePeriod, basis: { kind: 'missing-provider-row', inventoryFingerprint: fingerprint } } },
    ],
  };
}

describe('assumed participation at the immutable writer boundary', () => {
  it('preserves unknown availability separately from assumed zero appearances and unchanged raw fields', () => {
    const source = assumedObservation();
    const prepared = prepareAllPlayerBatch({ observation: source, scoreSets: [], verifiedAt: observedAt });
    expect(prepared.entries.find((entry) => entry.providerExternalId === '12529'))
      .toMatchObject({ eligibleGameCount: null, appearanceGameCount: 0, stats: {} });
    expect(prepared.entries.find((entry) => entry.providerExternalId === '7527'))
      .toMatchObject({ eligibleGameCount: 1, appearanceGameCount: 0, stats: { gms_active: 1 } });
    expect(prepared.scoreSets).toEqual([]);
    expect(prepared.scoreRows).toEqual([]);
  });

  it('serializes a valid partial batch without any score or pointer targets', async () => {
    const source = assumedObservation();
    const fake = createFakeProjectionDatabase(({ parameters }) => [{
      observation_id: parameters[12], content_id: parameters[0], semantic_hash: parameters[6],
      entries_stored: 2, entry_count: 2, pointers: [],
    }]);
    const result = await createAllPlayerStatisticMethods(fake.database).recordAllPlayerBatch({
      observation: source, scoreSets: [], verifiedAt: observedAt,
      fence: { jobKey: 'all-player-ingestion:sleeper', workerId: 'fixture-worker', generation: 1,
        leaseUntil: '2026-09-15T00:05:00.000Z', deadlineAt: '2026-09-15T00:04:00.000Z' },
    });
    expect(result).toMatchObject({ kind: 'stored', value: { entriesStored: 2, scoreSets: [] } });
    expect(fake.calls).toHaveLength(2);
    expect(fake.lockedTransactions).toEqual([[fake.calls[0], fake.calls[1]]]);
    expect(fake.calls[0].statement).toContain('lock-all-player-batch');
    expect(fake.calls[1].statement).toContain('record-all-player-batch');
    expect(JSON.parse(String(fake.calls[1].parameters[17]))).toEqual([]);
    expect(JSON.parse(String(fake.calls[1].parameters[18]))).toEqual([]);
  });

  it('does not permit a complete observation while availability remains unknown', () => {
    const partial = assumedObservation();
    const source = { ...partial, quality: 'complete' as const,
      coverage: { ...partial.coverage, complete: true } };
    expect(() => prepareAllPlayerBatch({ observation: source, scoreSets: [], verifiedAt: observedAt }))
      .toThrow('requires complete eligibility');
  });

  it.each(['sleeper-weekly-stats-v2', 'sleeper-weekly-stats-v3'])(
    'rejects assumption evidence spliced into immutable %s semantics before database access', async (normalizerVersion) => {
      const source = { ...assumedObservation(), normalizerVersion };
      const fake = createFakeProjectionDatabase();
      await expect(createAllPlayerStatisticMethods(fake.database).recordAllPlayerBatch({
        observation: source, scoreSets: [], verifiedAt: observedAt,
      })).rejects.toThrow('invalid-assumption-context');
      expect(fake.calls).toHaveLength(0);
    },
  );

  it('reuses raw content when the same assumption is observed again and keeps the older policy distinct', () => {
    const first = assumedObservation();
    const later = { ...first, sourceRevision: 'later-unchanged-retrieval',
      requestStartedAt: '2026-09-16T00:00:00.000Z', requestCompletedAt: '2026-09-16T00:00:01.000Z',
      observedAt: '2026-09-16T00:00:01.000Z' };
    expect(allPlayerStatSemanticHash(later)).toBe(allPlayerStatSemanticHash(first));
    const legacy: AllPlayerStatObservation = { ...first, normalizerVersion: 'sleeper-weekly-stats-v3',
      coverage: { complete: false }, entries: first.entries.map((entry) => ({
        ...entry, eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: entry.eligibilityEvidence.kind === 'assumed-nonparticipation'
          ? entry.eligibilityEvidence.basis : entry.eligibilityEvidence,
      })) };
    expect(allPlayerStatSemanticHash(legacy)).not.toBe(allPlayerStatSemanticHash(first));
    expect(prepareAllPlayerBatch({ observation: legacy, scoreSets: [], verifiedAt: observedAt }).entries)
      .toEqual(expect.arrayContaining([expect.objectContaining({ eligibleGameCount: null, appearanceGameCount: null })]));
  });

  it('rejects hiding actual statistics inside a missing-row assumption', () => {
    const original = assumedObservation();
    const source = { ...original, entries: original.entries.map((entry) => entry.providerExternalId === '12529'
      ? { ...entry, stats: { rush_yd: 10 } } : entry) };
    expect(() => prepareAllPlayerBatch({ observation: source, scoreSets: [], verifiedAt: observedAt }))
      .toThrow('assumed-missing-row-has-statistics');
  });
});

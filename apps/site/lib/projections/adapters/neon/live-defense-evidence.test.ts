import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { createObservationMethods, prepareLeagueWeekObservation } from './observations';

const at = '2026-09-21T18:00:00.000Z';
const evidence = () => ({
  version: 'defense-components-v1', status: 'available',
  period: { season: 2026, seasonType: 'regular', week: 2 },
  requestStartedAt: at, requestCompletedAt: at, observedAt: at,
  sourceRevision: 'sha256:weekly-detail',
  entries: [{ team: 'SEA', stats: { sack: 3, pts_allow: 10, pts_allow_7_13: 1 } }],
  calculations: [{ team: 'SEA', quality: 'defense-estimated' }],
});
const input = (liveDefense?: unknown) => ({
  leagueSeasonId: '11111111-1111-4111-8111-111111111111', week: 2,
  sourceRevision: 'official-plus-defense-source',
  requestStartedAt: at, requestCompletedAt: at, observedAt: at, quality: 'complete' as const,
  sourceData: { season: '2026', ...(liveDefense === undefined ? {} : { liveDefense }) },
  expectedTank01GameIds: [], playerPoints: [], rosterPoints: [],
});

describe('private live defense observation evidence', () => {
  it('preserves applied raw inputs and their timestamps through the real observation serializer', () => {
    const value = evidence();
    const prepared = prepareLeagueWeekObservation(input(value));
    expect(prepared.sourceData).toMatchObject({ liveDefense: value });
  });

  it('keeps old callers and explicit unavailable detail compatible without claiming freshness', () => {
    expect(() => prepareLeagueWeekObservation(input())).not.toThrow();
    const fallback = { version: 'defense-components-v1', status: 'unavailable', reason: 'parity-mismatch' };
    expect(prepareLeagueWeekObservation(input(fallback)).sourceData).toMatchObject({ liveDefense: fallback });
  });

  it.each([
    ['null envelope', null],
    ['array envelope', []],
    ['unknown version', { ...evidence(), version: 'defense-clock-v0' }],
    ['unknown status', { ...evidence(), status: 'fresh' }],
    ['missing status', { ...evidence(), status: undefined }],
    ['wrong week', { ...evidence(), period: { season: 2026, seasonType: 'regular', week: 1 } }],
    ['wrong season', { ...evidence(), period: { season: 2025, seasonType: 'regular', week: 2 } }],
    ['wrong season type', { ...evidence(), period: { season: 2026, seasonType: 'postseason', week: 2 } }],
    ['string season', { ...evidence(), period: { season: '2026', seasonType: 'regular', week: 2 } }],
    ['empty source revision', { ...evidence(), sourceRevision: ' ' }],
    ['numeric source revision', { ...evidence(), sourceRevision: 123 }],
    ['missing completion', { ...evidence(), requestCompletedAt: undefined }],
    ['invalid date', { ...evidence(), requestStartedAt: '2026-02-30T18:00:00.000Z' }],
    ['noncanonical hour', { ...evidence(), requestCompletedAt: '2026-09-21T24:00:00.000Z' }],
    ['noncanonical timezone', { ...evidence(), observedAt: '2026-09-21T18:00:00.000+00:00' }],
    ['nonstring completion', { ...evidence(), requestCompletedAt: {} }],
    ['reversed request', { ...evidence(), requestStartedAt: '2026-09-21T18:00:01.000Z' }],
    ['observation after completion', { ...evidence(), observedAt: '2026-09-21T18:00:01.000Z' }],
    ['observation before request', { ...evidence(), observedAt: '2026-09-21T17:59:59.000Z' }],
  ])('rejects %s before any observation database write', async (_, liveDefense) => {
    const fake = createFakeProjectionDatabase();
    await expect(createObservationMethods(fake.database).recordLeagueWeekObservation(input(liveDefense)))
      .rejects.toThrow('official-observation-live-defense-invalid');
    expect(fake.calls).toHaveLength(0);
  });
});

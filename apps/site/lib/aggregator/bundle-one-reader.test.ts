import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createBundleOneReader } from './bundle-one-reader';
import { createBundleOneReadService, type BundleOneReadInput } from './bundle-one';
import { b1CompatibilityFixture, b1CompatibilityInput, b1Uuid } from './b1-acceptance.fixtures';
import { readAcceptedExactMatchupsRows } from '../league-administration/neon/exact-matchups';
import type { DatabaseClient, DatabaseRow } from '../database';

const input = (): BundleOneReadInput => ({ expectedMapping: b1CompatibilityInput.expectedMapping,
  nativeWeek: 4, snapshot: { snapshotId: b1CompatibilityInput.request.snapshotId, modelVersion: 'clock-v1' },
  selectedSeasonTeamId: b1Uuid(10), context: b1CompatibilityInput.context, now: b1CompatibilityInput.now });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('B1 internal facade and resource failure isolation', () => {
  it('keeps disabled and Preview reads inert before inspecting input', async () => {
    const request = new Proxy({}, { get() { throw new Error('Disabled read inspected request'); } }) as BundleOneReadInput;
    expect(await createBundleOneReader({ enabled: false, reason: 'missing-database-url' }).readBundleOne(request))
      .toEqual({ kind: 'bundle-one-matchup-read', status: 'disabled', reason: 'persistence_disabled' });
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic:synthetic@fixture.invalid/synthetic?sslmode=require');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider access'));
    expect(await createBundleOneReader().readBundleOne(request)).toMatchObject({ status: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses fresh deadlines through existing readers on repeated requests', async () => {
    const evidence = b1CompatibilityFixture();
    const signals: (AbortSignal | undefined)[] = [];
    const query: DatabaseClient['query'] = async <Row extends DatabaseRow>(statement: string, _parameters?: readonly unknown[], options?: { signal?: AbortSignal }) => {
      signals.push(options?.signal);
      options?.signal?.throwIfAborted();
      return (statement.includes('WITH accepted_evidence') ? [evidence] : []) as unknown as readonly Row[];
    };
    const reader = createBundleOneReader({ enabled: true, query });
    const first = await reader.readBundleOne(input());
    const split = signals.length;
    const second = await reader.readBundleOne(input());
    expect(first.status).toBe('read'); expect(second.status).toBe('read');
    expect(split).toBeGreaterThan(0);
    expect(signals.every(signal => signal instanceof AbortSignal)).toBe(true);
    expect(signals.slice(split).some(signal => signals.slice(0, split).includes(signal))).toBe(false);
  });

  it('retains accepted facts and confirmed vacancy when optional readers fail', async () => {
    const evidence = b1CompatibilityFixture();
    const official = readAcceptedExactMatchupsRows(evidence.accepted_rows, b1CompatibilityInput.expectedMapping, 4);
    const officialRead = vi.fn(async () => official);
    const service = createBundleOneReadService({ readAcceptedExactMatchups: officialRead,
      readExactMatchupCompatibility: vi.fn().mockRejectedValue(new Error('Stored analytics unavailable')),
      readAcceptedCurrentRoster: vi.fn().mockRejectedValue(new Error('Current roster unavailable')),
      readAllPlayerBoxScores: vi.fn().mockRejectedValue(new Error('Stats unavailable')) });
    const result = await service.readBundleOne(input());
    if (result.status !== 'read') throw new Error('Expected B1 result');
    expect(result.official).toBe(official);
    expect(result.forecast).toEqual({ status: 'unavailable', reason: 'stored_reference_read_failed' });
    expect(result.currentRoster.value).toEqual({ status: 'unavailable', reason: 'current_roster_read_failed' });
    expect(officialRead).toHaveBeenCalledExactlyOnceWith(input().expectedMapping, 4);
    expect(result.dependencies.official?.sourceObservedAt).toBe(evidence.accepted_rows[0].provenance.sourceObservedAt);
  });

  it('recovers official facts when the actual analytics adapter returns unavailable after a query error', async () => {
    const evidence = b1CompatibilityFixture();
    const calls: string[] = [];
    const query: DatabaseClient['query'] = async <Row extends DatabaseRow>(statement: string) => {
      calls.push(statement);
      if (statement.includes('projection-store:read-exact-matchup-compatibility')) throw new Error('Synthetic analytics failure');
      return (statement.includes('league-administration:read-accepted-exact-matchups')
        ? evidence.accepted_rows : []) as unknown as readonly Row[];
    };
    const result = await createBundleOneReader({ enabled: true, query }).readBundleOne(input());
    if (result.status !== 'read' || result.official.status !== 'available') throw new Error('Official fallback lost.');
    expect(result.official.value.teams[0].officialTeamPoints.effective).toBe('0');
    expect(result.forecast.status).toBe('unavailable');
    expect(result.sourceHistory.status).toBe('unavailable');
    expect(calls.filter(sql => sql.includes('projection-store:read-exact-matchup-compatibility'))).toHaveLength(1);
    expect(calls.filter(sql => !sql.includes('projection-store:read-exact-matchup-compatibility')
      && sql.includes('league-administration:read-accepted-exact-matchups'))).toHaveLength(1);
  });
  it('supports official-only reads without fabricating a snapshot identifier', async () => {
    const evidence = b1CompatibilityFixture();
    const official = readAcceptedExactMatchupsRows(evidence.accepted_rows, b1CompatibilityInput.expectedMapping, 4);
    const derived = vi.fn();
    const service = createBundleOneReadService({ readAcceptedExactMatchups: async () => official,
      readExactMatchupCompatibility: derived, readAcceptedCurrentRoster: async () => ({ status: 'missing' }),
      readAllPlayerBoxScores: async () => ({ status: 'unavailable', observedAt: null, revision: null, players: {} }) });
    const result = await service.readBundleOne({ ...input(), snapshot: null });
    if (result.status !== 'read') throw new Error('Expected B1 result');
    expect(result.official).toBe(official);
    expect(result.forecast).toEqual({ status: 'unavailable', reason: 'snapshot_reference_missing' });
    expect(derived).not.toHaveBeenCalled();
  });
});

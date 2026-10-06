import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
import { createSleeperDiscoveryScan, sleeperDiscoverySeasons, SLEEPER_DISCOVERY_STRATEGY,
  type DiscoveryScanPort, type DiscoveryScanWork } from './discovery-scan';
import { createSleeperPermitTransport, type SleeperPermitPort } from '../projections/adapters/sleeper/permit-transport';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const native = '79600000000000000001';
const league = (year: number) => ({ league_id: `1290000000000000${year}`, name: 'Same display name', sport: 'nfl', season: String(year) });
function work(): DiscoveryScanWork {
  return { scanId: id(1), associationId: id(2), associationRevision: '3', providerAccountId: id(3), nativeAccountId: native,
    accessContextId: id(4), accessRevision: '2', audienceId: 'public', leagueSeasonAtStart: 2026,
    retainedSelectionSeasons: [2021, 2026], strategyVersion: SLEEPER_DISCOVERY_STRATEGY,
    requiredSeasons: [2021, 2024, 2025, 2026], completed: [] };
}
function fixture() {
  let persisted = work(); let attempt = 0;
  const dispatch = vi.fn(async (url: string) => Response.json([league(Number(url.split('/').at(-1)))]));
  const finish = vi.fn(async () => true);
  const permits: SleeperPermitPort = { reserveCommitted: vi.fn<SleeperPermitPort['reserveCommitted']>(async request => ({ commit: 'confirmed',
    result: { status: 'granted', permitId: id(100 + attempt), dbSampleAt: '2026-10-06T10:00:00.000Z',
      dispatchBefore: '2026-10-06T10:00:01.000Z', remainingDispatchMs: 1000, httpDeadlineMs: 5000 },
    endpoint: request.kind === 'target' ? request.endpoint : null })), finish };
  const scans: DiscoveryScanPort = {
    load: vi.fn(async () => persisted),
    reserve: vi.fn<DiscoveryScanPort['reserve']>(async ({ season, scan }) => {
      attempt += 1;
      return { kind: 'target', requestId: id(10 + attempt), demandId: id(5),
        source: { kind: 'pre-enrollment', attemptId: id(20 + attempt), policyQualificationId: id(6), policyRevision: '1' },
        fence: { jobKey: 'discovery:one', workerId: 'worker-one', attemptCount: 1, leaseUntil: '2026-10-06T10:05:00.000Z' },
        endpoint: { family: 'account-leagues', nativeAccountId: scan.nativeAccountId, season } };
    }),
    recordCapture: vi.fn<DiscoveryScanPort['recordCapture']>(async ({ season }) => {
      const captureId = id(200 + season);
      persisted = { ...persisted, completed: [...persisted.completed, { season, captureId }] };
      return { commit: 'confirmed', captureId };
    }),
  };
  const transport = createSleeperPermitTransport({ permits, reserveLocalCapacity: async () => ({ dispatch,
    terminateLocal: async () => 'terminated', release: () => undefined }), monotonicNow: () => 1 });
  return { scans, permits, dispatch, finish, run: createSleeperDiscoveryScan({ scans, transport }),
    setWork: (value: DiscoveryScanWork) => { persisted = value; } };
}
afterEach(() => vi.restoreAllMocks());

describe('internal admitted finite discovery scan', () => {
  it('derives sorted unique current + prior two + every retained selection, without a global-year filter', () => {
    expect(sleeperDiscoverySeasons(2026, [2021, 2026, 2025, 2021, 2028])).toEqual([2021, 2024, 2025, 2026, 2028]);
  });
  it.each([NaN, 0, 999, 1000, 1001, 10000, 2026.5])('fails closed for unrepresentable finite plans (%s)', year => {
    expect(() => sleeperDiscoverySeasons(year, [])).toThrow();
  });
  it('refuses malformed retained seasons instead of silently dropping a current selection', () => {
    expect(() => sleeperDiscoverySeasons(2026, [NaN])).toThrow();
  });
  it('composes the existing admitted transport, shared normalizer and acknowledged capture checkpoint', async () => {
    const f = fixture();
    const first = await f.run(id(1));
    expect(first).toMatchObject({ status: 'partial', completed: [{ season: 2021, captureId: id(2221) }],
      continuation: { remainingSeasons: [2024, 2025, 2026] } });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.dispatch.mock.calls[0][0]).toBe(`https://api.sleeper.app/v1/user/${native}/leagues/nfl/2021`);
    expect(f.scans.recordCapture).toHaveBeenCalledWith(expect.objectContaining({ season: 2021,
      rawValue: [league(2021)], candidates: [expect.objectContaining({ id: league(2021).league_id,
        season: '2021', capabilities: expect.objectContaining({ status: 'unverified' }) })] }));
    await f.run(id(1)); await f.run(id(1));
    expect(await f.run(id(1))).toMatchObject({ status: 'complete', reason: null, continuation: null,
      completed: [2021, 2024, 2025, 2026].map(season => ({ season, captureId: id(200 + season) })) });
    expect(await f.run(id(1))).toMatchObject({ status: 'complete' });
    expect(f.dispatch).toHaveBeenCalledTimes(4);
    expect(f.scans.reserve).toHaveBeenCalledTimes(4);
    expect(f.finish).toHaveBeenCalledTimes(4);
    // Same display name never merges different annual native identities.
    expect(vi.mocked(f.scans.recordCapture).mock.calls.map(([value]) => value.candidates[0].id))
      .toEqual([2021, 2024, 2025, 2026].map(year => league(year).league_id));
  });
  it('reuses only retained completed coverage; a failed scope is resumable and never an empty success', async () => {
    const f = fixture(); await f.run(id(1));
    f.dispatch.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    expect(await f.run(id(1))).toMatchObject({ status: 'partial', reason: 'transport',
      completed: [{ season: 2021 }], continuation: { remainingSeasons: [2024, 2025, 2026] } });
    expect(f.scans.recordCapture).toHaveBeenCalledTimes(1);
    expect(await f.run(id(1))).toMatchObject({ status: 'partial', completed: [{ season: 2021 }, { season: 2024 }] });
    expect(f.dispatch).toHaveBeenCalledTimes(3);
  });
  it('distinguishes an acknowledged successful empty scope from acquisition failure', async () => {
    const f = fixture(); f.dispatch.mockResolvedValueOnce(Response.json([]));
    expect(await f.run(id(1))).toMatchObject({ status: 'partial', completed: [{ season: 2021 }] });
    expect(f.scans.recordCapture).toHaveBeenCalledWith(expect.objectContaining({ candidates: [] }));
  });
  it.each([
    [{ ...league(2021), season: '2026' }], [{ ...league(2021), league_id: 12900000000000002021 }],
    [{ ...league(2021), sport: 'nba' }], [{ ...league(2021) }, { ...league(2021), name: 'Conflict' }], null,
  ])('rejects malformed/contradictory source scope before checkpointing (%j)', async payload => {
    const f = fixture(); f.dispatch.mockResolvedValueOnce(Response.json(payload));
    expect(await f.run(id(1))).toMatchObject({ status: 'pending', reason: 'invalid_source', completed: [],
      continuation: { remainingSeasons: [2021, 2024, 2025, 2026] } });
    expect(f.scans.recordCapture).not.toHaveBeenCalled();
  });
  it('does not fabricate coverage after an unknown capture commit, and reconciles on the next explicit invocation', async () => {
    const f = fixture();
    vi.mocked(f.scans.recordCapture).mockImplementationOnce(async ({ season }) => {
      f.setWork({ ...work(), completed: [{ season, captureId: id(2221) }] });
      return { commit: 'unknown' };
    });
    expect(await f.run(id(1))).toMatchObject({ status: 'pending', reason: 'capture_unconfirmed', completed: [] });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(await f.run(id(1))).toMatchObject({ status: 'partial', completed: [{ season: 2021 }, { season: 2024 }] });
    expect(f.dispatch.mock.calls[1][0]).toContain('/2024');
  });
  it('does not dispatch after missing admission or use another identity/season endpoint', async () => {
    const f = fixture(); vi.mocked(f.scans.reserve).mockResolvedValueOnce(null);
    expect(await f.run(id(1))).toMatchObject({ status: 'pending', reason: 'admission' });
    const original = vi.mocked(f.scans.reserve).getMockImplementation()!;
    vi.mocked(f.scans.reserve).mockImplementationOnce(async scope => ({ ...(await original(scope))!,
      endpoint: { family: 'account-leagues', nativeAccountId: '123', season: scope.season } }));
    expect(await f.run(id(1))).toMatchObject({ status: 'pending', reason: 'admission' });
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('fails without an authoritative retained scan instead of accepting a caller continuation', async () => {
    const f = fixture(); vi.mocked(f.scans.load).mockResolvedValueOnce(null);
    expect(await f.run(id(1))).toEqual({ status: 'unavailable', reason: 'authority_unavailable' });
    expect(f.scans.reserve).not.toHaveBeenCalled();
  });
  it.each([
    { requiredSeasons: [2024, 2025, 2026] }, { associationRevision: '0' }, { strategyVersion: 'latest-only' },
    { nativeAccountId: 79600000000000000001 }, { audienceId: 'private' }, { scanId: id(9) },
    { completed: [{ season: 2021, captureId: id(7) }, { season: 2021, captureId: id(8) }] },
    { completed: [{ season: 2021, captureId: id(7) }, { season: 2024, captureId: id(7) }] },
    { completed: [{ season: 2020, captureId: id(7) }] }, { callerActor: id(7) },
  ])('rejects incompatible or ambiguous retained checkpoints (%j)', async delta => {
    const f = fixture(); f.setWork({ ...work(), ...delta } as DiscoveryScanWork);
    expect(await f.run(id(1))).toEqual({ status: 'unavailable', reason: 'authority_unavailable' });
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('cancellation after network work does not acknowledge or expose candidates', async () => {
    const f = fixture(); const controller = new AbortController();
    f.dispatch.mockImplementationOnce(async () => { controller.abort(); return Response.json([league(2021)]); });
    await expect(f.run(id(1), controller.signal)).rejects.toThrow();
    expect(f.scans.recordCapture).not.toHaveBeenCalled();
  });
  it('does not let an adapter mutate the pinned scope across an await', async () => {
    const f = fixture();
    const original = vi.mocked(f.scans.reserve).getMockImplementation()!;
    vi.mocked(f.scans.reserve).mockImplementationOnce(async scope => {
      const request = await original(scope);
      (scope.scan as { nativeAccountId: string }).nativeAccountId = '999';
      return request;
    });
    expect(await f.run(id(1))).toMatchObject({ status: 'partial' });
    expect(f.scans.recordCapture).toHaveBeenCalledWith(expect.objectContaining({ scan: expect.objectContaining({ nativeAccountId: native }) }));
  });
});

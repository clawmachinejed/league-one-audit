import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
import { runAccountAcquisitionStep } from './account-acquisition-composition';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { SLEEPER_DISCOVERY_STRATEGY, type DiscoveryScanWork } from '../../accounts/discovery-scan';
import type { SleeperPermitRequest } from '../adapters/sleeper/permit-transport';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const native = '99999999999999999999';
function fixture(kind: 'identify' | 'calendar-state' | 'discover' = 'discover') {
  let generation = 0; let sqlActive = false; let attempt = 0;
  let revoked = false; let unknownClaim = false; let unknownCapture = false; let mismatch = false;
  let limited = false; let capacity = true;
  const events: string[] = [];
  const captures: Record<string, unknown>[] = [];
  const scan: DiscoveryScanWork = { scanId: id(1), associationId: id(2), associationRevision: '1', providerAccountId: id(3),
    nativeAccountId: native, accessContextId: id(4), accessRevision: '1', audienceId: 'public', leagueSeasonAtStart: 2026,
    retainedSelectionSeasons: [2021], strategyVersion: SLEEPER_DISCOVERY_STRATEGY,
    requiredSeasons: [2021, 2024, 2025, 2026], completed: [] };
  const completed: { season: number; captureId: string }[] = [];
  let request: Extract<SleeperPermitRequest, { kind: 'target' }>;
  const fence = () => ({ jobKey: `acquisition:${id(5)}`, workerId: 'worker-a', attemptCount: generation,
    leaseUntil: '2026-10-06T18:00:00.000Z' });
  const work = () => kind === 'identify' ? { kind, username: 'alice' } : kind === 'calendar-state' ? { kind }
    : { kind, nativeAccountId: native, scanId: id(1), requiredSeasons: [...scan.requiredSeasons] };
  const query = vi.fn(async (statement: string, parameters: readonly unknown[] = []): Promise<readonly DatabaseRow[]> => {
    expect(sqlActive).toBe(false); sqlActive = true;
    try {
      if (statement.includes('claim_account_acquisition_v1')) {
        events.push('claim'); generation++;
        if (unknownClaim) throw new Error('Unknown claim acknowledgement');
        return [{ result: { status: 'claimed', demandId: id(5), fence: fence(), work: work() } }];
      }
      if (statement.includes('account_discovery_work_v1')) {
        events.push('load'); return [{ value: revoked ? null : { ...scan, completed: [...completed] } }];
      }
      if (statement.includes('begin_provider_request_v2') || statement.includes('prepare_account_acquisition')) {
        events.push('reserve-attempt'); attempt++;
        const input = JSON.parse(String(parameters[0]));
        request = { kind: 'target', requestId: id(10 + attempt), demandId: id(5),
          source: { kind: 'pre-enrollment', attemptId: id(30 + attempt), policyQualificationId: id(6), policyRevision: '1' },
          fence: { ...fence(), ...(mismatch ? { attemptCount: generation + 1 } : {}) },
          endpoint: kind === 'discover' ? { family: 'account-leagues', nativeAccountId: native, season: input.season }
            : kind === 'identify' ? { family: 'identity', username: 'alice' } : { family: 'nfl-state' } };
        return [{ value: revoked ? null : request }];
      }
      if (statement.includes('reserve_account_provider_http_v1')) {
        events.push('permit');
        if (limited) return [{ value: { result: { status: 'limited', reason: 'budget_exhausted' }, endpoint: request.endpoint } }];
        return [{ value: revoked ? { result: { status: 'denied', reason: 'authority_unavailable' }, endpoint: request.endpoint }
          : { result: { status: 'granted', permitId: id(100 + attempt), dbSampleAt: '2026-10-06T18:00:00.000Z',
            dispatchBefore: '2026-10-06T18:00:01.000Z', remainingDispatchMs: 1000, httpDeadlineMs: 5000 }, endpoint: request.endpoint } }];
      }
      if (statement.includes('finish_provider_http_v1')) { events.push('finish-permit'); return [{ value: true }]; }
      if (statement.includes('record_provider_capture_v2') || statement.includes('capture_account_acquisition')) {
        events.push('capture'); const input = JSON.parse(String(parameters[0]));
        if (revoked) throw new Error('Revoked before capture');
        captures.push(input);
        const captureId = id(200 + attempt);
        if (kind === 'discover' && request.endpoint.family === 'account-leagues') completed.push({ season: request.endpoint.season, captureId });
        if (unknownCapture) { unknownCapture = false; throw new Error('Commit completed but acknowledgement lost'); }
        return [{ value: { captureId } }];
      }
      if (statement.includes('fail_account_acquisition_v1')) { events.push('fail'); return [{ value: true }]; }
      throw new Error(`Unexpected SQL: ${statement}`);
    } finally { sqlActive = false; }
  });
  const dispatch = vi.fn(async (url: string) => {
    expect(sqlActive).toBe(false); events.push('http');
    return Response.json(kind === 'identify' ? { user_id: native, username: 'alice' }
      : kind === 'calendar-state' ? { season: '2025', league_season: '2026', season_type: 'regular', week: 10 }
        : [{ league_id: '123', name: 'League', sport: 'nfl', season: url.split('/').at(-1) }]);
  });
  const run = () => runAccountAcquisitionStep('worker-a', { database: { enabled: true, query } as DatabaseClient,
    monotonicNow: () => 1, reserveLocalCapacity: async () => capacity ? ({ dispatch, terminateLocal: async () => 'terminated', release() {} }) : null });
  return { run, dispatch, captures, events, query, completed,
    revoke: () => { revoked = true; }, mismatch: () => { mismatch = true; },
    limit: (value: boolean) => { limited = value; }, capacity: (value: boolean) => { capacity = value; },
    unknownClaim: () => { unknownClaim = true; }, unknownCapture: () => { unknownCapture = true; } };
}

describe('internal real-port acquisition composition (simulated SQL, no qualification claim)', () => {
  it.each(['identify', 'calendar-state', 'discover'] as const)('retains %s durable intent on admission throttling and resumes a later invocation', async kind => {
    const f = fixture(kind); f.limit(true);
    const result = await f.run();
    expect(result).toMatchObject(kind === 'discover' ? { status: 'discovery', progress: { status: 'pending', reason: 'admission' } }
      : { status: 'unavailable', reason: 'transport' });
    expect(f.events).not.toContain('fail'); expect(f.dispatch).not.toHaveBeenCalled(); expect(f.captures).toHaveLength(0);
    f.limit(false); await f.run(); expect(f.dispatch).toHaveBeenCalledTimes(1); expect(f.captures).toHaveLength(1);
  });
  it('does not terminate or immediately retry an accepted demand when local capacity is unavailable', async () => {
    const f = fixture('identify'); f.capacity(false);
    expect(await f.run()).toEqual({ status: 'unavailable', reason: 'transport' });
    expect(f.events).not.toContain('fail'); expect(f.events).not.toContain('permit'); expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.events.filter(event => event === 'claim')).toHaveLength(1);
  });
  it('retains accepted work after a provider503 without acknowledging capture or retrying HTTP', async () => {
    const f = fixture('identify'); f.dispatch.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    expect(await f.run()).toEqual({ status: 'unavailable', reason: 'transport' });
    expect(f.events).not.toContain('fail'); expect(f.captures).toHaveLength(0); expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it('runs concrete Neon adapters, existing job claim, permit, normalizer and atomic capture port with HTTP outside SQL', async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({ status: 'discovery', progress: { status: 'partial', completed: [{ season: 2021 }] } });
    expect(f.events).toEqual(['claim', 'load', 'reserve-attempt', 'permit', 'http', 'finish-permit', 'capture']);
    expect(f.captures[0]).toMatchObject({ normalizedValue: [expect.objectContaining({ id: '123', season: '2021' })],
      requestStartedAt: expect.any(String), requestCompletedAt: expect.any(String) });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it('reconstructs the composition on restart and resumes the frozen retained plan without acquiring completed scopes', async () => {
    const f = fixture(); await f.run(); await f.run(); await f.run();
    expect(await f.run()).toMatchObject({ status: 'discovery', progress: { status: 'complete', requiredSeasons: [2021, 2024, 2025, 2026] } });
    await f.run(); expect(f.dispatch).toHaveBeenCalledTimes(4);
    expect(f.dispatch.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual(['2021', '2024', '2025', '2026']);
  });
  it('does not acknowledge an unknown commit, then reconciles committed progress instead of duplicating the capture', async () => {
    const f = fixture(); f.unknownCapture();
    expect(await f.run()).toMatchObject({ status: 'discovery', progress: { status: 'pending', reason: 'capture_unconfirmed', completed: [] } });
    expect(f.events).not.toContain('fail');
    expect(await f.run()).toMatchObject({ status: 'discovery', progress: { completed: [{ season: 2021 }, { season: 2024 }] } });
    expect(f.captures).toHaveLength(2);
  });
  it('does not send a request after unknown claim acknowledgement or mismatched generation', async () => {
    const f = fixture(); f.unknownClaim(); expect(await f.run()).toEqual({ status: 'unavailable', reason: 'claim' });
    expect(f.dispatch).not.toHaveBeenCalled(); expect(f.query).toHaveBeenCalledTimes(1);
    const stale = fixture(); stale.mismatch();
    expect(await stale.run()).toMatchObject({ status: 'discovery', progress: { reason: 'admission' } });
    expect(stale.dispatch).not.toHaveBeenCalled();
  });
  it('rejects revoked retained authority before networking and suppresses a capture revoked during networking', async () => {
    const f = fixture(); f.revoke();
    expect(await f.run()).toMatchObject({ status: 'discovery', progress: { status: 'unavailable' } });
    expect(f.dispatch).not.toHaveBeenCalled();
    const g = fixture(); g.dispatch.mockImplementationOnce(async () => {
      g.revoke(); return Response.json([{ league_id: '123', name: 'League', sport: 'nfl', season: '2021' }]);
    });
    expect(await g.run()).toMatchObject({ status: 'discovery', progress: { reason: 'capture_unconfirmed' } });
    expect(g.captures).toHaveLength(0);
  });
  it.each(['identify', 'calendar-state'] as const)('executes %s prerequisites through the same transport and retained source owner', async kind => {
    const f = fixture(kind); expect(await f.run()).toEqual({ status: 'captured', kind });
    expect(f.captures[0]).toMatchObject({ normalizedValue: kind === 'identify'
      ? { kind: 'identity', nativeAccountId: native, username: { state: 'known', value: 'alice' } }
      : { leagueSeason: 2026 } });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it('records malformed source failure without a capture, selection or enrollment command', async () => {
    const f = fixture('identify'); f.dispatch.mockResolvedValueOnce(Response.json({ user_id: 123 }));
    expect(await f.run()).toEqual({ status: 'unavailable', reason: 'source' });
    expect(f.captures).toHaveLength(0); expect(f.events.at(-1)).toBe('fail');
  });
  it('does not claim jobs when persistence is disabled', async () => {
    expect(await runAccountAcquisitionStep('worker-a', { database: { enabled: false, reason: 'preview-persistence-disabled' } }))
      .toEqual({ status: 'unavailable', reason: 'persistence' });
  });
});

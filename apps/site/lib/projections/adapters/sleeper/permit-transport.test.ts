import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createSleeperPermitTransport, sleeperEndpointUrl, sleeperRetryAfter,
  type SleeperPermitPort, type SleeperPermitRequest } from './permit-transport';

const id = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const dbSampleAt = '2026-10-06T12:00:00.000Z';
const endpoint = { family: 'nfl-state' } as const;
const request: SleeperPermitRequest = { kind: 'existing', requestId: id, endpoint,
  purpose: 'metadata', connectionId: null, source: null, fence: null };
const permit = { status: 'granted', permitId: id, dbSampleAt,
  dispatchBefore: '2026-10-06T12:00:01.000Z', remainingDispatchMs: 1000, httpDeadlineMs: 5000 };

function setup() {
  const reserveCommitted = vi.fn<SleeperPermitPort['reserveCommitted']>().mockResolvedValue({ commit: 'confirmed', result: permit, endpoint });
  const finish = vi.fn<SleeperPermitPort['finish']>().mockResolvedValue(true);
  const dispatch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>().mockImplementation(async () => new Response('{"season":"2026"}'));
  const release = vi.fn();
  const terminateLocal = vi.fn<() => Promise<'terminated' | 'unconfirmed'>>().mockResolvedValue('terminated');
  const reserveLocalCapacity = vi.fn().mockResolvedValue({ dispatch, release, terminateLocal });
  const monotonicNow = vi.fn().mockReturnValue(100);
  const send = createSleeperPermitTransport({ permits: { reserveCommitted, finish }, reserveLocalCapacity, monotonicNow });
  return { send, reserveCommitted, finish, dispatch, release, terminateLocal, reserveLocalCapacity, monotonicNow };
}
afterEach(() => vi.useRealTimers());

describe('permit-bound Sleeper HTTP boundary', () => {
  it('records dispatch/body chronology separately from permit accounting and delayed closure', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-06T12:00:00.000Z');
    const s = setup();
    s.dispatch.mockImplementationOnce(async () => {
      vi.setSystemTime('2026-10-06T12:00:00.250Z');
      return new Response('{"season":"2026"}');
    });
    s.terminateLocal.mockImplementationOnce(async () => {
      vi.setSystemTime('2026-10-06T12:00:00.500Z'); return 'terminated';
    });
    expect(await s.send(request)).toMatchObject({ status: 'received',
      requestStartedAt: '2026-10-06T12:00:00.000Z', requestCompletedAt: '2026-10-06T12:00:00.250Z' });
    expect(s.dispatch).toHaveBeenCalledTimes(1);
  });
  it.each(['dispatch', 'body'])('terminates a never-settling %s after exactly 60 seconds of quarantine', async (kind) => {
    vi.useFakeTimers();
    const s = setup();
    s.dispatch.mockImplementation(() => kind === 'dispatch'
      ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ start() {} }))));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toEqual({ status: 'unavailable', reason: 'deadline' });
    await vi.advanceTimersByTimeAsync(59999);
    expect(s.terminateLocal).not.toHaveBeenCalled();
    expect(s.release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.terminateLocal).toHaveBeenCalledTimes(1);
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.terminateLocal.mock.invocationCallOrder[0]).toBeLessThan(s.release.mock.invocationCallOrder[0]);
    expect(s.reserveCommitted).toHaveBeenCalledTimes(1);
    expect(s.dispatch).toHaveBeenCalledTimes(1);
    expect(s.finish.mock.calls).toContainEqual([id, 'unknown', null]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['unconfirmed', 'throws', 'hangs'])('permanently retires capacity when teardown %s, even after late settlement', async (failure) => {
    vi.useFakeTimers();
    const s = setup();
    let respond!: (response: Response) => void;
    s.dispatch.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    if (failure === 'unconfirmed') s.terminateLocal.mockResolvedValue('unconfirmed');
    if (failure === 'throws') s.terminateLocal.mockImplementation(() => { throw new Error('close failed'); });
    if (failure === 'hangs') s.terminateLocal.mockImplementation(() => new Promise(() => {}));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(66_000);
    expect(await result).toEqual({ status: 'unavailable', reason: 'deadline' });
    expect(s.terminateLocal).toHaveBeenCalledTimes(1);
    expect(s.release).not.toHaveBeenCalled();
    respond(new Response('late source data', { status: 503, headers: { 'Retry-After': '60' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.finish).toHaveBeenCalledWith(id, 'http503', 60);
    expect(s.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not revive retired capacity when closure proof itself arrives after its deadline', async () => {
    vi.useFakeTimers();
    const s = setup();
    let confirm!: (result: 'terminated') => void;
    s.terminateLocal.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
    s.dispatch.mockImplementation(() => new Promise(() => {}));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(66_000);
    expect(await result).toEqual({ status: 'unavailable', reason: 'deadline' });
    confirm('terminated');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.release).not.toHaveBeenCalled();
  });

  it.each([429, 503])('records late %s after terminal teardown without double release or accepting data', async (status) => {
    vi.useFakeTimers();
    const s = setup();
    let respond!: (response: Response) => void;
    s.dispatch.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(65_000);
    expect(await result).toEqual({ status: 'unavailable', reason: 'deadline' });
    const response = new Response('late', { status, headers: { 'Retry-After': '20' } });
    const read = vi.spyOn(response, 'text');
    respond(response);
    respond(new Response('conflicting later settle'));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.finish.mock.calls).toEqual([[id, 'unknown', null], [id, `http${status}`, 20]]);
    expect(read).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.terminateLocal).toHaveBeenCalledTimes(1);
    expect(s.reserveCommitted).toHaveBeenCalledTimes(1);
  });

  it('quarantine teardown does not depend on a stalled accounting acknowledgment', async () => {
    vi.useFakeTimers();
    const s = setup();
    let confirmAccounting!: (result: boolean) => void;
    s.finish.mockImplementation(() => new Promise((resolve) => { confirmAccounting = resolve; }));
    s.dispatch.mockImplementation(() => new Promise(() => {}));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(65_000);
    expect(s.terminateLocal).toHaveBeenCalledTimes(1);
    expect(s.release).toHaveBeenCalledTimes(1);
    confirmAccounting(false);
    expect(await result).toEqual({ status: 'unavailable', reason: 'deadline' });
  });

  it('late body settlement cannot release twice or return timed-out bytes', async () => {
    vi.useFakeTimers();
    const s = setup();
    let body!: ReadableStreamDefaultController<Uint8Array>;
    s.dispatch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } })));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(65_000);
    expect(await result).toEqual({ status: 'unavailable', reason: 'deadline' });
    body.enqueue(new TextEncoder().encode('late source bytes'));
    body.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.terminateLocal).toHaveBeenCalledTimes(1);
    expect(s.reserveCommitted).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed when even an otherwise complete response cannot prove local teardown', async () => {
    const s = setup();
    s.terminateLocal.mockResolvedValue('unconfirmed');
    expect(await s.send(request)).toEqual({ status: 'unavailable', reason: 'transport' });
    expect(s.release).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith(id, 'network', null);
  });

  it.each([429, 503])('preserves known %s cooldown even if completed-body teardown fails', async (status) => {
    const s = setup();
    s.dispatch.mockResolvedValue(new Response('overloaded', { status, headers: { 'Retry-After': '60' } }));
    s.terminateLocal.mockResolvedValue('unconfirmed');
    expect(await s.send(request)).toEqual({ status: 'unavailable', reason: 'transport' });
    expect(s.release).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith(id, `http${status}`, 60);
  });

  it('releases only after observed local closure and leaves no quarantine timer on an early late completion', async () => {
    vi.useFakeTimers();
    const s = setup();
    let respond!: (response: Response) => void;
    let confirm!: (result: 'terminated') => void;
    s.dispatch.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    s.terminateLocal.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    respond(new Response('late'));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.release).not.toHaveBeenCalled();
    confirm('terminated');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.terminateLocal).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reserves local capacity before SQL and makes exactly one uncached manual-redirect GET', async () => {
    const s = setup();
    expect(await s.send(request)).toEqual({ status: 'received', permitId: id, httpStatus: 200, body: '{"season":"2026"}',
      requestStartedAt: expect.any(String), requestCompletedAt: expect.any(String) });
    expect(s.reserveLocalCapacity.mock.invocationCallOrder[0]).toBeLessThan(s.reserveCommitted.mock.invocationCallOrder[0]);
    expect(s.dispatch).toHaveBeenCalledExactlyOnceWith('https://api.sleeper.app/v1/state/nfl', {
      method: 'GET', cache: 'no-store', redirect: 'manual', headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal),
    });
    expect(s.finish).toHaveBeenCalledExactlyOnceWith(id, 'success', null);
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it.each([999.1, 1000, 1001, -1, NaN, Infinity])('refuses a stalled, backwards or unknown timer delta %s', async (elapsed) => {
    const s = setup();
    s.monotonicNow.mockReturnValueOnce(100).mockReturnValueOnce(100 + elapsed);
    expect(await s.send(request)).toEqual({ status: 'unavailable', reason: 'deadline' });
    expect(s.dispatch).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith(id, 'cancelled', null);
  });

  it('can dispatch strictly before the conservatively rounded boundary', async () => {
    const s = setup();
    s.monotonicNow.mockReturnValueOnce(100).mockReturnValue(1099);
    expect((await s.send(request)).status).toBe('received');
  });

  it.each([{ commit: 'unknown' }, { commit: 'confirmed', result: { status: 'indeterminate', reason: 'authority_unavailable' }, endpoint },
    { commit: 'confirmed', result: { status: 'limited', reason: 'cooldown' }, endpoint },
    { commit: 'confirmed', result: { ...permit, remainingDispatchMs: 1001 }, endpoint },
    { commit: 'confirmed', result: { ...permit, extra: true }, endpoint }])('fails closed for uncertain, repeated, limited or malformed grant %#', async (result) => {
    const s = setup();
    s.reserveCommitted.mockResolvedValue(result as Awaited<ReturnType<SleeperPermitPort['reserveCommitted']>>);
    expect(await s.send(request)).toEqual({ status: 'unavailable', reason: 'admission' });
    expect(s.dispatch).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a grant on requestId replay when SQL returns indeterminate', async () => {
    const s = setup();
    s.reserveCommitted.mockResolvedValueOnce({ commit: 'confirmed', result: permit, endpoint })
      .mockResolvedValue({ commit: 'confirmed', result: { status: 'indeterminate', reason: 'authority_unavailable' }, endpoint });
    await s.send(request);
    await s.send(request);
    expect(s.dispatch).toHaveBeenCalledTimes(1);
  });

  it('never sends when capacity or SQL is unavailable', async () => {
    const s = setup();
    s.reserveLocalCapacity.mockResolvedValueOnce(null);
    expect((await s.send(request)).status).toBe('unavailable');
    expect(s.reserveCommitted).not.toHaveBeenCalled();
    s.reserveCommitted.mockRejectedValue(new Error('private diagnostic'));
    expect(await s.send(request)).toEqual({ status: 'unavailable', reason: 'admission' });
    expect(s.dispatch).not.toHaveBeenCalled();
  });

  it('refuses a changed endpoint and extra caller authority fields before sending', async () => {
    const s = setup();
    expect(await s.send({ ...request, lane: 'live-score' } as SleeperPermitRequest)).toEqual({ status: 'unavailable', reason: 'scope' });
    expect(s.reserveCommitted).not.toHaveBeenCalled();
    s.reserveCommitted.mockResolvedValue({ commit: 'confirmed', result: permit, endpoint: { family: 'players' } });
    expect(await s.send(request)).toEqual({ status: 'unavailable', reason: 'scope' });
    expect(s.dispatch).not.toHaveBeenCalled();
  });

  it('snapshots input before an awaited local-capacity reservation', async () => {
    const s = setup();
    const mutable = structuredClone(request);
    const result = s.send(mutable);
    if (mutable.kind === 'existing') mutable.endpoint = { family: 'players' };
    await result;
    expect(s.reserveCommitted).toHaveBeenCalledWith(request);
  });

  it('derives retry routing solely from trusted SQL context and requests a fresh grant', async () => {
    const s = setup();
    const retry: SleeperPermitRequest = { kind: 'retry', requestId: secondId, previousPermitId: id, source: null, fence: null };
    s.reserveCommitted.mockResolvedValue({ commit: 'confirmed', result: { ...permit, permitId: secondId }, endpoint: { family: 'players' } });
    await s.send(retry);
    expect(s.reserveCommitted).toHaveBeenCalledWith(retry);
    expect(s.dispatch.mock.calls[0][0]).toBe('https://api.sleeper.app/v1/players/nfl');
    expect(await s.send({ ...retry, endpoint } as SleeperPermitRequest)).toEqual({ status: 'unavailable', reason: 'scope' });
  });

  it.each([[429, 'http429'], [503, 'http503'], [500, 'http5xx'], [403, 'http4xx']] as const)('records HTTP %s without an application retry', async (status, outcome) => {
    const s = setup();
    s.dispatch.mockResolvedValue(new Response('unavailable', { status, headers: { 'Retry-After': '120' } }));
    expect((await s.send(request)).status).toBe('received');
    expect(s.finish).toHaveBeenCalledWith(id, outcome, status === 429 || status === 503 ? 120 : null);
    expect(s.dispatch).toHaveBeenCalledTimes(1);
  });

  it('never follows a redirect, and refuses its body as source data', async () => {
    const s = setup();
    s.dispatch.mockResolvedValue(new Response('redirect', { status: 302, headers: { location: 'https://example.com' } }));
    expect(await s.send(request)).toEqual({ status: 'unavailable', reason: 'transport' });
    expect(s.dispatch).toHaveBeenCalledTimes(1);
    expect(s.finish).toHaveBeenCalledWith(id, 'invalid', null);
  });

  it('suppresses data when finish acknowledgement is unavailable', async () => {
    const s = setup();
    s.finish.mockRejectedValue(new Error('database disconnected'));
    expect(await s.send(request)).toEqual({ status: 'unavailable', reason: 'completion' });
  });

  it('rejects a response after a monotonic stall even before the timeout callback runs', async () => {
    const s = setup();
    s.monotonicNow.mockReturnValueOnce(100).mockReturnValueOnce(100).mockReturnValue(5100);
    expect(await s.send(request)).toEqual({ status: 'unavailable', reason: 'deadline' });
  });

  it('quarantines an unconfirmed teardown and records late 429 without returning source data', async () => {
    vi.useFakeTimers();
    const s = setup();
    let respond!: (response: Response) => void;
    s.dispatch.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toEqual({ status: 'unavailable', reason: 'deadline' });
    expect(s.dispatch.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(s.finish).toHaveBeenCalledWith(id, 'unknown', null);
    expect(s.release).not.toHaveBeenCalled();
    respond(new Response('late', { status: 429, headers: { 'Retry-After': '90000' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.finish).toHaveBeenCalledWith(id, 'http429', -1);
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.dispatch).toHaveBeenCalledTimes(1);
  });

  it('times out response-body consumption as well as response headers', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.dispatch.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toEqual({ status: 'unavailable', reason: 'deadline' });
    expect(s.finish).toHaveBeenCalledWith(id, 'unknown', null);
    expect(s.release).not.toHaveBeenCalled();
  });

  it('retains quarantine but records known cooldown when a 429 body never completes', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.dispatch.mockResolvedValue(new Response(new ReadableStream({ start() {} }), {
      status: 429, headers: { 'Retry-After': '120' },
    }));
    const result = s.send(request);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toEqual({ status: 'unavailable', reason: 'deadline' });
    expect(s.finish.mock.calls).toEqual([[id, 'unknown', null], [id, 'http429', 120]]);
    expect(s.release).not.toHaveBeenCalled();
  });
});

describe('closed endpoint routing and conservative cooldown evidence', () => {
  it.each([
    [{ family: 'identity', username: 'Robert_1' }, '/v1/user/Robert_1'],
    [{ family: 'account-leagues', nativeAccountId: '900719925474099312345', season: 2026 }, '/v1/user/900719925474099312345/leagues/nfl/2026'],
    [{ family: 'rosters', externalLeagueId: 'opaque/a?b' }, '/v1/league/opaque%2Fa%3Fb/rosters'],
    [{ family: 'weekly-stats', season: 2026, week: 1 }, '/v1/stats/nfl/regular/2026/1'],
    [{ family: 'schedule', season: 2026 }, '/schedule/nfl/regular/2026'],
  ])('encodes known endpoint %# without numeric ID rounding', (input, path) => {
    expect(new URL(sleeperEndpointUrl(input)!).pathname).toBe(path);
  });
  it.each([{ family: 'identity', username: '../admin' }, { family: 'nfl-state', host: 'evil' },
    { family: 'scores', season: 2026, week: null }, { family: 'rosters', externalLeagueId: '..' },
    { family: 'other' }, { family: 'players', method: 'POST' },
    { family: 'rosters', externalLeagueId: '\ud800' }])('refuses unqualified route shape %#', (input) => {
    expect(sleeperEndpointUrl(input)).toBeNull();
  });
  it.each([[null, null], ['0', 0], ['86400', 86400], ['86401', -1], ['-1', -1], ['1.5', -1],
    ['soon', -1], ['999999999999999999999999', -1], ['Tue, 06 Oct 2026 12:01:00 GMT', 60],
    ['Tue, 06 Oct 2026 11:00:00 GMT', 0], ['Wed, 07 Oct 2026 12:00:01 GMT', -1],
    ['Mon, 06 Oct 2026 12:01:00 GMT', -1]] as const)('converts Retry-After %s without application wall time', (input, expected) => {
    expect(sleeperRetryAfter(input, dbSampleAt)).toBe(expected);
  });
});

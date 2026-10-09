import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import { capturePublicSleeperCore, capturePublicSleeperIdentity, capturePublicSleeperLeagueList,
  getSleeperUserIdentity, getSleeperUserLeagues } from '../sleeper';
import { assertOriginalPublicCapture, type PublicCaptureWitness } from './public-capture-witness';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_VALUES = 250_000;
const MAX_DEPTH = 64;
const native = '9876543210';
const encoder = new TextEncoder();
const league = { league_id: native, season: '2026', sport: 'nfl', name: 'Response bounds fixture',
  total_rosters: 1, roster_positions: ['QB', 'BN'], scoring_settings: { pass_yd: 0.04 },
  settings: { divisions: 3 } };
const identity = { user_id: '55', username: 'manager_55', display_name: 'Manager' };
const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function coreWitness() {
  return {
    version: 'public-network-capture-v1',
    work: { requestId: uuid(1), revision: 3, kind: 'core', externalLeagueId: native, season: 2026 },
    fence: { jobKey: 'league-administration-public-intake', workerId: uuid(2), generation: 4,
      deadlineAt: new Date(Date.now() + 20_000).toISOString() },
    dispatchNonce: uuid(3),
    mapping: { connectionId: uuid(4), leagueSeasonId: uuid(5), revisionId: uuid(6), generation: 1,
      scope: { leagueKey: 'response-bounds-fixture', provider: 'sleeper', externalLeagueId: native, season: 2026 } },
    attempts: { settings: { id: uuid(10), nonce: uuid(20) }, players: { id: uuid(11), nonce: uuid(21) },
      managers: { id: uuid(12), nonce: uuid(22) }, managersV2: { id: uuid(13), nonce: uuid(23) } },
  } satisfies PublicCaptureWitness;
}
function dispatchWitness(kind: 'identity' | 'leagues' | 'bootstrap' | 'users' | 'exact-matchups'): PublicCaptureWitness {
  const witness = coreWitness(), common = { requestId: uuid(1), revision: 3 };
  if (kind === 'identity') return { ...witness, mapping: null, attempts: {},
    work: { ...common, kind, username: 'manager_55' } };
  if (kind === 'leagues') return { ...witness, mapping: null, attempts: {},
    work: { ...common, kind, userId: '55', season: 2026 } };
  if (kind === 'exact-matchups') return { ...witness, work: { ...witness.work, kind, nativeWeek: 4 },
    attempts: { settings: witness.attempts.settings, matchups: { id: uuid(14), nonce: uuid(24) } } };
  return { ...witness, work: { ...witness.work, kind }, mapping: kind === 'bootstrap' ? null : witness.mapping, attempts: {} };
}
type CaptureEntry = Readonly<{
  label: string; path: string; witness: () => PublicCaptureWitness;
  capture: (signal: AbortSignal, witness?: PublicCaptureWitness) => Promise<{
    payload: unknown; acquisition?: PublicCaptureWitness; requestStartedAt: string; requestCompletedAt: string;
  }>;
}>;
const entries: readonly CaptureEntry[] = [
  { label: 'identity', path: '/user/manager_55', witness: () => dispatchWitness('identity'),
    capture: (signal, witness) => capturePublicSleeperIdentity('manager_55', signal, witness) },
  { label: 'league list', path: '/user/55/leagues/nfl/2026', witness: () => dispatchWitness('leagues'),
    capture: (signal, witness) => capturePublicSleeperLeagueList('55', 2026, signal, witness) },
  { label: 'bootstrap league', path: `/league/${native}`, witness: () => dispatchWitness('bootstrap'),
    capture: (signal, witness) => capturePublicSleeperCore(native, 'league', signal, undefined, witness) },
  { label: 'core league', path: `/league/${native}`, witness: coreWitness,
    capture: (signal, witness) => capturePublicSleeperCore(native, 'league', signal, undefined, witness) },
  { label: 'rosters', path: `/league/${native}/rosters`, witness: coreWitness,
    capture: (signal, witness) => capturePublicSleeperCore(native, 'rosters', signal, undefined, witness) },
  { label: 'users', path: `/league/${native}/users`, witness: () => dispatchWitness('users'),
    capture: (signal, witness) => capturePublicSleeperCore(native, 'users', signal, undefined, witness) },
  { label: 'exact matchups', path: `/league/${native}/matchups/4`, witness: () => dispatchWitness('exact-matchups'),
    capture: (signal, witness) => capturePublicSleeperCore(native, 'matchups', signal, 4, witness) },
];
// Only fixture HTTP and framework modules are replaced. The production reader,
// JSON parser, normalizers, witness binding and capture sealing execute normally.
function fixtureFetch(response: Response) {
  const request = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal('fetch', request);
  return request;
}
function streamedResponse(chunks: readonly Uint8Array[], init?: ResponseInit,
  cancelResult?: () => void | PromiseLike<void>) {
  let pulls = 0;
  const cancel = vi.fn(() => cancelResult?.());
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls++];
      if (chunk) controller.enqueue(chunk);
      if (pulls === chunks.length) controller.close();
    }, cancel,
  }, { highWaterMark: 0 });
  return { response: new Response(body, init), cancel, pulls: () => pulls };
}
function fixtureResponse(body: string): Response {
  return streamedResponse([encoder.encode(body)]).response;
}
function captureResponse(response: Response, witness: PublicCaptureWitness | undefined = coreWitness(),
  signal: AbortSignal = new AbortController().signal) {
  fixtureFetch(response);
  return capturePublicSleeperCore(native, 'league', signal, undefined, witness);
}
function captureBody(body: string) {
  return captureResponse(fixtureResponse(body));
}

beforeEach(() => {
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { throw new Error('Unexpected outbound connection.'); });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected fixture HTTP request.'); }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('public DATA response limits through the maintained transport', () => {
  it('rejects a response one byte above 8 MiB before capture', async () => {
    const body = '"' + 'x'.repeat(MAX_BYTES - 1) + '"';
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_BYTES + 1);
    await expect(captureBody(body).then(() => 'accepted')).rejects.toThrow(/byte.*limit|limit.*byte/i);
  });

  it('rejects a response with JSON value depth 65 before capture', async () => {
    const body = '['.repeat(MAX_DEPTH) + '0' + ']'.repeat(MAX_DEPTH);
    await expect(captureBody(body).then(() => 'accepted')).rejects.toThrow(/depth.*limit|limit.*depth/i);
  });

  it('rejects a response with 250001 JSON values before capture', async () => {
    const body = '[' + '0,'.repeat(MAX_VALUES - 1) + '0]';
    await expect(captureBody(body).then(() => 'accepted')).rejects.toThrow(/(?:node|value).*limit|limit.*(?:node|value)/i);
  });

  it('accepts exactly 8 MiB of decoded bytes including a split multibyte sequence', async () => {
    const value = 'x'.repeat(MAX_BYTES - 8) + 'é😀';
    const bytes = encoder.encode(JSON.stringify(value));
    expect(bytes.byteLength).toBe(MAX_BYTES);
    const fixture = streamedResponse([bytes.subarray(0, MAX_BYTES - 4), bytes.subarray(MAX_BYTES - 4, MAX_BYTES - 3),
      bytes.subarray(MAX_BYTES - 3)]);
    const witness = coreWitness(), capture = await captureResponse(fixture.response, witness);
    expect(capture.payload).toBe(value);
    expect(() => assertOriginalPublicCapture(capture, witness)).not.toThrow();
    expect(fixture.response.body?.locked).toBe(false);
    expect(fixture.cancel).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes rather than JavaScript string length at one byte above the limit', async () => {
    const body = JSON.stringify('é'.repeat((MAX_BYTES - 2) / 2) + 'x');
    expect(body.length).toBeLessThan(MAX_BYTES);
    expect(encoder.encode(body).byteLength).toBe(MAX_BYTES + 1);
    await expect(captureBody(body).then(() => 'accepted')).rejects.toThrow(/byte.*limit|limit.*byte/i);
  });

  it('accepts exactly 250000 JSON values counting containers and primitive leaves', async () => {
    // Root + five initial values + remaining numeric leaves = exactly MAX_VALUES.
    const body = '[0,true,null,"x",{}' + ',0'.repeat(MAX_VALUES - 6) + ']';
    const capture = await captureBody(body);
    expect(Array.isArray(capture.payload)).toBe(true);
    expect(capture.payload).toHaveLength(MAX_VALUES - 1);
    expect((capture.payload as unknown[]).slice(0, 5)).toEqual([0, true, null, 'x', {}]);
  });

  it('counts object member values without charging keys as extra JSON values', async () => {
    const value = Object.fromEntries(Array.from({ length: MAX_VALUES - 1 }, (_, n) => [String(n), null]));
    const capture = await captureBody(JSON.stringify(value));
    expect(Object.keys(capture.payload as object)).toHaveLength(MAX_VALUES - 1);
  });

  it.each(['array', 'object'] as const)('accepts %s nesting at depth 64 with root value at depth one', async kind => {
    const prefix = kind === 'array' ? '[' : '{"child":', suffix = kind === 'array' ? ']' : '}';
    const capture = await captureBody(prefix.repeat(MAX_DEPTH - 1) + 'null' + suffix.repeat(MAX_DEPTH - 1));
    let leaf: unknown = capture.payload;
    for (let depth = 1; depth < MAX_DEPTH; depth++) leaf = kind === 'array'
      ? (leaf as unknown[])[0] : (leaf as { child: unknown }).child;
    expect(leaf).toBeNull();
  });

  it.each(['array', 'object'] as const)('rejects extremely deep %s JSON without a call-stack failure', async kind => {
    const prefix = kind === 'array' ? '[' : '{"child":', suffix = kind === 'array' ? ']' : '}';
    await expect(captureBody(prefix.repeat(20_000) + '0' + suffix.repeat(20_000)).then(() => 'accepted'))
      .rejects.toThrow(/depth.*limit|limit.*depth/i);
  });

  it.each(entries)('applies DATA bounds at the $label entry while preserving request policy', async entry => {
    const request = fixtureFetch(fixtureResponse('['.repeat(MAX_DEPTH) + '0' + ']'.repeat(MAX_DEPTH)));
    await expect(entry.capture(new AbortController().signal, entry.witness()).then(() => 'accepted'))
      .rejects.toThrow(/depth.*limit|limit.*depth/i);
    expect(request).toHaveBeenCalledExactlyOnceWith(`https://api.sleeper.app/v1${entry.path}`,
      expect.objectContaining({ cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' },
        signal: expect.any(AbortSignal) }));
    expect(request.mock.calls[0][1]).not.toHaveProperty('next');
  });

  it.each(entries)('does not disable DATA bounds when the $label entry omits its optional witness', async entry => {
    fixtureFetch(fixtureResponse('['.repeat(MAX_DEPTH) + '0' + ']'.repeat(MAX_DEPTH)));
    await expect(entry.capture(new AbortController().signal).then(() => 'accepted'))
      .rejects.toThrow(/depth.*limit|limit.*depth/i);
  });

  it.each([
    { label: 'missing', headers: {} },
    { label: 'understated', headers: { 'Content-Length': '1' } },
    { label: 'invalid', headers: { 'Content-Length': 'not-a-size' } },
    { label: 'compressed', headers: { 'Content-Length': '32', 'Content-Encoding': 'gzip' } },
  ] as { label: string; headers: Record<string, string> }[])('enforces streamed bytes with $label Content-Length, cancels and leaves the tail unread', async ({ headers }) => {
    // fetch exposes decoded body bytes even when Content-Length describes a compressed wire body.
    const fixture = streamedResponse([encoder.encode('"' + 'x'.repeat(MAX_BYTES - 1)), encoder.encode('x'),
      encoder.encode('unread tail"')], { headers });
    await expect(captureResponse(fixture.response).then(() => 'accepted')).rejects.toThrow(/byte.*limit|limit.*byte/i);
    expect(fixture.pulls()).toBe(2);
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.response.body?.locked).toBe(false);
  });

  it.each([undefined, 'gzip'])('accepts small delivered JSON despite an overstated length: %j', async encoding => {
    const headers = new Headers({ 'Content-Length': String(MAX_BYTES + 1) });
    if (encoding) headers.set('Content-Encoding', encoding);
    const response = new Response('{"ok":true}', { headers });
    expect((await captureResponse(response)).payload).toEqual({ ok: true });
    expect(response.body?.locked).toBe(false);
  });

  it.each(['rejects', 'never settles'] as const)('does not let a cancel operation that %s hide the byte error or retain the lock', async behavior => {
    const fixture = streamedResponse([encoder.encode('"' + 'x'.repeat(MAX_BYTES)), encoder.encode('"')], undefined,
      () => behavior === 'rejects' ? Promise.reject(new Error('fixture cancellation failed')) : new Promise<void>(() => {}));
    await expect(captureResponse(fixture.response).then(() => 'accepted')).rejects.toThrow(/byte.*limit|limit.*byte/i);
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.pulls()).toBe(1);
    expect(fixture.response.body?.locked).toBe(false);
  });

  it.each(['caller abort', 'request timeout'] as const)('cancels a stalled read and releases its lock on %s', async source => {
    const controller = new AbortController(), timeout = new AbortController();
    const timeoutFactory = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const reading = Promise.withResolvers<void>(), cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() { reading.resolve(); return new Promise<void>(() => {}); }, cancel,
    }, { highWaterMark: 0 }));
    const error = new DOMException(source, source === 'request timeout' ? 'TimeoutError' : 'AbortError');
    const capture = captureResponse(response, coreWitness(), controller.signal);
    const rejected = expect(capture).rejects.toBe(error);
    await reading.promise;
    expect(response.body?.locked).toBe(true);
    (source === 'request timeout' ? timeout : controller).abort(error);
    await rejected;
    expect(timeoutFactory).toHaveBeenCalledExactlyOnceWith(12_000);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('releases a failed stream reader and preserves the source error', async () => {
    const error = new Error('fixture body read failed');
    const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) { controller.error(error); } },
      { highWaterMark: 0 }));
    await expect(captureResponse(response)).rejects.toBe(error);
    expect(response.body?.locked).toBe(false);
  });

  it('keeps the existing core pre-abort check ahead of HTTP dispatch', async () => {
    const controller = new AbortController(), reason = new DOMException('fixture pre-abort', 'AbortError');
    controller.abort(reason);
    const request = fixtureFetch(fixtureResponse('{}'));
    await expect(capturePublicSleeperCore(native, 'league', controller.signal, undefined, coreWitness())).rejects.toBe(reason);
    expect(request).not.toHaveBeenCalled();
  });

  it('cleans up a response delivered after the caller aborts while awaiting headers', async () => {
    const headers = Promise.withResolvers<Response>(), controller = new AbortController();
    const reason = new DOMException('fixture header wait abort', 'AbortError');
    const fixture = streamedResponse([encoder.encode('{"unread":true}')]);
    const request = vi.fn<typeof fetch>(() => headers.promise);
    vi.stubGlobal('fetch', request);
    const capture = capturePublicSleeperCore(native, 'league', controller.signal, undefined, coreWitness());
    const rejected = expect(capture).rejects.toBe(reason);
    expect(request).toHaveBeenCalledOnce();
    controller.abort(reason);
    headers.resolve(fixture.response);
    await rejected;
    expect(fixture.pulls()).toBe(0);
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.response.body?.locked).toBe(false);
  });

  it('cancels an unread HTTP error body without reading or retrying it', async () => {
    const fixture = streamedResponse([encoder.encode('unread error body')], { status: 503 });
    const request = fixtureFetch(fixture.response);
    await expect(capturePublicSleeperCore(native, 'league', new AbortController().signal, undefined, coreWitness()))
      .rejects.toThrow(`Sleeper could not load /league/${native} (HTTP 503).`);
    expect(request).toHaveBeenCalledOnce();
    expect(fixture.pulls()).toBe(0);
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.response.body?.locked).toBe(false);
  });

  it.each(['{"missing":', '{"trailing":1,}', 'not json', ''])('rejects malformed JSON %j with its reader unlocked', async body => {
    const response = fixtureResponse(body);
    await expect(captureResponse(response)).rejects.toBeInstanceOf(SyntaxError);
    expect(response.body?.locked).toBe(false);
  });

  it('retains the JSON syntax failure for a successful response without a body', async () => {
    const response = new Response(null, { status: 204 });
    expect(response.body).toBeNull();
    await expect(captureResponse(response)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('matches Response.json UTF-8 replacement and BOM behavior across chunk boundaries', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('{"value":"'), 0xc3, 0x28,
      ...encoder.encode('é😀'), 0xff, ...encoder.encode('"}')]);
    const expected = await new Response(bytes).json();
    const fixture = streamedResponse(Array.from(bytes, byte => new Uint8Array([byte])));
    const witness = coreWitness(), capture = await captureResponse(fixture.response, witness);
    expect(capture.payload).toEqual(expected);
    expect(capture.payload).toEqual({ value: '\uFFFD(é😀\uFFFD' });
    expect(() => assertOriginalPublicCapture(capture, witness)).not.toThrow();
    expect(fixture.response.body?.locked).toBe(false);
  });

  it('preserves successful metadata, raw payload, normalized values and the original witness seal', async () => {
    const started = Date.parse('2026-10-09T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(started);
    const witness = coreWitness(), expectedWitness = structuredClone(witness);
    vi.stubGlobal('fetch', vi.fn(async () => {
      vi.setSystemTime(started + 17);
      return fixtureResponse(JSON.stringify(league));
    }));
    const capture = await capturePublicSleeperCore(native, 'league', new AbortController().signal, undefined, witness);
    expect(capture).toEqual({ family: 'league', week: null, payload: league,
      requestStartedAt: new Date(started).toISOString(), requestCompletedAt: new Date(started + 17).toISOString(),
      origin: 'network', sourceObservedAt: new Date(started + 17).toISOString(), acquisition: expectedWitness });
    expect('acquisition' in capture ? capture.acquisition : undefined).not.toBe(witness);
    expect(Object.isFrozen(capture)).toBe(true);
    expect(Object.isFrozen((capture.payload as typeof league).settings)).toBe(true);
    expect(() => assertOriginalPublicCapture(capture, expectedWitness)).not.toThrow();
    expect(() => assertOriginalPublicCapture({ ...capture }, expectedWitness)).toThrow(/Original public transport/);

    fixtureFetch(fixtureResponse(JSON.stringify(identity)));
    const identityWitness = dispatchWitness('identity');
    const user = await capturePublicSleeperIdentity('manager_55', new AbortController().signal, identityWitness);
    expect(user.payload).toEqual(identity);
    expect(user.value).toEqual({ userId: '55', username: 'manager_55', displayName: 'Manager', avatarUrl: null });
    expect(() => assertOriginalPublicCapture(user, identityWitness)).not.toThrow();

    fixtureFetch(fixtureResponse(JSON.stringify([league])));
    const listWitness = dispatchWitness('leagues');
    const list = await capturePublicSleeperLeagueList('55', 2026, new AbortController().signal, listWitness);
    expect(list.payload).toEqual([league]);
    expect(list.value).toEqual([expect.objectContaining({ id: native, name: league.name, season: '2026' })]);
    expect(() => assertOriginalPublicCapture(list, listWitness)).not.toThrow();
  });

  it('accepts the existing 1000-league discovery maximum with representative official settings', async () => {
    const leagues = Array.from({ length: 1_000 }, (_, n) => ({ ...league, league_id: String(9_876_500_000 + n),
      name: `Discovery league ${n + 1}`, total_rosters: 12, status: 'in_season', season_type: 'regular',
      previous_league_id: String(8_765_400_000 + n), roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
      settings: { playoff_week_start: 15, playoff_teams: 6, type: n % 3 },
      scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec: n % 2 },
      metadata: { latest_league_invite_message: null },
    }));
    const body = JSON.stringify(leagues);
    expect(encoder.encode(body).byteLength).toBeLessThan(MAX_BYTES);
    const request = fixtureFetch(fixtureResponse(body)), witness = dispatchWitness('leagues');
    const result = await capturePublicSleeperLeagueList('55', 2026, new AbortController().signal, witness);
    expect(result.payload).toEqual(leagues);
    expect(result.value).toHaveLength(1_000);
    expect(result.value?.[0]).toEqual(expect.objectContaining({ id: leagues[0].league_id, name: leagues[0].name }));
    expect(result.value?.[999]).toEqual(expect.objectContaining({ id: leagues[999].league_id, name: leagues[999].name }));
    expect(() => assertOriginalPublicCapture(result, witness)).not.toThrow();
    expect(request).toHaveBeenCalledOnce();
  });

  it('reads many tiny and empty chunks without accumulating pending promise subscribers', async () => {
    const value = { text: 'é😀'.repeat(1_024) }, bytes = encoder.encode(JSON.stringify(value));
    const chunks = Array.from(bytes, byte => [new Uint8Array(), new Uint8Array([byte])]).flat();
    const fixture = streamedResponse(chunks), witness = coreWitness();
    // Observe pending asynchronous work, not elapsed time or environment-sensitive
    // heap size. A response of tiny chunks must not retain one subscriber per read.
    const originalThen = Promise.prototype.then;
    let pending = 0, peakPending = 0;
    const observeThen: typeof Promise.prototype.then = function<TResult1 = unknown, TResult2 = never>(
      this: Promise<unknown>,
      onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      peakPending = Math.max(peakPending, ++pending);
      return originalThen.call(this, (value: unknown) => {
        pending--;
        return onFulfilled ? onFulfilled(value) : value;
      }, (reason: unknown) => {
        pending--;
        if (onRejected) return onRejected(reason);
        throw reason;
      }) as Promise<TResult1 | TResult2>;
    };
    Promise.prototype.then = observeThen;
    let result: Awaited<ReturnType<typeof captureResponse>>;
    try { result = await captureResponse(fixture.response, witness); }
    finally { Promise.prototype.then = originalThen; }
    expect(chunks.length).toBeGreaterThan(4_096);
    expect(peakPending).toBeLessThan(128);
    expect(result.payload).toEqual(value);
    expect(fixture.pulls()).toBe(chunks.length);
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.response.body?.locked).toBe(false);
    expect(() => assertOriginalPublicCapture(result, witness)).not.toThrow();
  });

  it.each(['identity', 'leagues'] as const)('preserves the existing page %s path above the DATA byte limit', async kind => {
    const extra = 'x'.repeat(MAX_BYTES);
    const payload = kind === 'identity' ? { ...identity, extra } : [{ ...league, extra }];
    const request = fixtureFetch(fixtureResponse(JSON.stringify(payload)));
    if (kind === 'identity') expect(await getSleeperUserIdentity('manager_55')).toEqual({
      userId: '55', username: 'manager_55', displayName: 'Manager', avatarUrl: null,
    });
    else expect(await getSleeperUserLeagues('55', '2026')).toEqual([
      expect.objectContaining({ id: native, name: league.name, season: '2026' }),
    ]);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][1]).toEqual(expect.objectContaining({ next: { revalidate: 60 },
      headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) }));
    expect(request.mock.calls[0][1]).not.toHaveProperty('redirect');
    expect(request.mock.calls[0][1]).not.toHaveProperty('cache');
  });
});

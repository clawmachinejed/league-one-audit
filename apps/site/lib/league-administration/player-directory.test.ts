import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { classifyPlayerDirectoryRow, normalizePlayerDirectoryCapture, normalizePlayerDirectoryRow,
  playerDirectoryDuplicateMembers } from './player-directory';
import type { PlayerDirectoryAttempt } from './player-directory-contracts';
vi.mock('server-only', () => ({}));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = '2026-10-09T12:00:00.000Z';
const attempt = (n = 1): PlayerDirectoryAttempt => ({ id: uuid(n), nonce: uuid(n + 100), ordinal: n,
  expectedGeneration: n - 1, reservedAt: time });
const normalize = (rawJson: string, observedAt = time) => normalizePlayerDirectoryCapture({ attempt: attempt(), rawJson,
  requestStartedAt: time, requestCompletedAt: observedAt, sourceObservedAt: observedAt, providerRequests: 1 });
const native = { '8063': { player_id: '8063', full_name: ' George Silvanic ', position: 'DT',
  fantasy_positions: ['DL'], team: null, active: false, status: '', injury_status: null, years_exp: 0 } };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('shared native player directory evidence', () => {
  it('preserves whitespace, null, empty, false, zero, absent fields and unfamiliar positions separately', () => {
    const source = normalize(JSON.stringify(native));
    expect(source.status).toBe('complete');
    expect(source.rows[0]).toMatchObject({ externalPlayerId: '8063', fullName: ' George Silvanic ', position: 'DT',
      active: false, status: '', team: null, injuryStatus: null, fantasyPositions: ['DL'], identityStatus: 'valid',
      fieldStates: { full_name: 'supplied', status: 'supplied', active: 'supplied', team: 'null', injury_status: 'null', first_name: 'missing' },
      source: native['8063'] });
    expect(classifyPlayerDirectoryRow(source.rows[0]).status).toBe('out-of-scope');
    expect(normalize('{"opaque":{}}')).toMatchObject({ status: 'complete', rows: [{ externalPlayerId: 'opaque', identityStatus: 'valid' }] });
  });
  it('retains invalid and conflicting native rows without dropping an ID or selecting a canonical link', () => {
    const result = normalize('{"good":{"player_id":"good"},"wrong":{"player_id":"good"},"bad":{"position":0,"active":"false"},"row":null," padded ":{}}');
    expect(result.status).toBe('partial');
    expect(result.rows).toHaveLength(5);
    expect(result.rows.find(row => row.externalPlayerId === 'wrong')).toMatchObject({ identityStatus: 'conflict', reasons: ['player-id-conflict'] });
    expect(result.rows.find(row => row.externalPlayerId === 'bad')).toMatchObject({ position: null, active: null,
      identityStatus: 'invalid', reasons: ['invalid-field:position', 'invalid-field:active'], fieldStates: { position: 'invalid', active: 'invalid' } });
    expect(result.sourceSlices[0]).toMatchObject({ complete: false, rowCount: 5, validRowCount: 1, invalidRowCount: 3, conflictRowCount: 1 });
    expect(result.rows[0]).not.toHaveProperty('canonicalEntityId');
  });
  it('does not confuse null or empty memberships with missing or invalid membership fields', () => {
    expect(normalizePlayerDirectoryRow('x', { fantasy_positions: [] })).toMatchObject({ fantasyPositions: [], fieldStates: { fantasy_positions: 'supplied' } });
    expect(normalizePlayerDirectoryRow('x', { fantasy_positions: null })).toMatchObject({ fantasyPositions: null, fieldStates: { fantasy_positions: 'null' } });
    expect(normalizePlayerDirectoryRow('x', {})).toMatchObject({ fantasyPositions: null, fieldStates: { fantasy_positions: 'missing' } });
    expect(normalizePlayerDirectoryRow('x', { fantasy_positions: ['QB', null] })).toMatchObject({ fantasyPositions: null, fieldStates: { fantasy_positions: 'invalid' } });
  });
  it('retains duplicate root and nested JSON members, including escaped aliases, as invalid original evidence', () => {
    const raw = '{"a":{"full_name":"One","full_name":"Two"},"\\u0061":{"extension":[{"x":1,"x":2}]}}';
    expect(playerDirectoryDuplicateMembers(raw)).toEqual({ count: 3, paths: ['/a/full_name', '/a', '/a/extension/0/x'], truncated: false });
    const result = normalize(raw);
    expect(result).toMatchObject({ status: 'invalid', rawJson: raw, duplicateMemberCount: 3, reasons: ['duplicate-json-members'] });
    expect(result.sourceSlices[0].complete).toBe(false);
  });
  it('bounds duplicate diagnostics before concatenating long ancestors and preserves exact duplicate counts', () => {
    const duplicates = Array.from({ length: 300 }, (_, index) => `"x${index}":0,"x${index}":1`).join(',');
    const longAncestor = '{"' + 'a'.repeat(4096) + '":{' + duplicates + '}}';
    expect(playerDirectoryDuplicateMembers(longAncestor, true)).toEqual({ count: 300, paths: [], truncated: true });
    const many = playerDirectoryDuplicateMembers('{' + duplicates + '}', true);
    expect(many.count).toBe(300); expect(many.paths).toHaveLength(128); expect(many.truncated).toBe(true);
    expect(many.paths.every(path => path.length <= 256 && Buffer.byteLength(path, 'utf8') <= 512)).toBe(true);
    expect(normalize(longAncestor)).toMatchObject({ status: 'invalid', rawJson: longAncestor,
      duplicateMemberCount: 300, duplicateMemberPathsTruncated: true });
  });
  it('keeps unchanged raw content identity separate from fresh capture time and records corrections', () => {
    const raw = JSON.stringify(native), first = normalize(raw), refreshed = normalize(raw, '2026-10-10T12:00:00.000Z');
    expect(refreshed.sourceRevision).toBe(first.sourceRevision);
    expect(refreshed.sourceObservedAt).not.toBe(first.sourceObservedAt);
    expect(first.sourceRevision).toBe(`sha256:${createHash('sha256').update(raw).digest('hex')}`);
    const corrected = normalize(JSON.stringify({ '8063': { ...native['8063'], injury_status: 'Out' } }));
    expect(corrected.sourceRevision).not.toBe(first.sourceRevision);
    expect(first.rows[0].injuryStatus).toBeNull();
  });
  it.each(['{}', '[]', 'null', '"invalid"', '{'])('keeps invalid or empty full directory %s explicit', raw => {
    expect(normalize(raw)).toMatchObject({ status: 'invalid', rawJson: raw });
  });
  it('retains failure without manufacturing a successful observation', () => {
    expect(normalizePlayerDirectoryCapture({ attempt: attempt(), rawJson: null, requestStartedAt: time,
      requestCompletedAt: time, sourceObservedAt: null, providerRequests: 1, failureReason: 'catalog-http-error' }))
      .toMatchObject({ status: 'unavailable', sourceRevision: null, rows: [], sourceObservedAt: null,
        sourceSlices: [{ observedAt: null, complete: false, status: 'unavailable' }] });
  });
});

describe('strict full-directory capture through the existing catalog loader', () => {
  beforeEach(() => vi.resetModules());
  const load = async () => (await import('../sleeper-player-catalog')).loadCompletePlayerCatalog;
  it('uses one bounded uncached nonredirecting GET and seals the pre-HTTP reservation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(native)));
    vi.stubGlobal('fetch', fetcher);
    const loader = await load();
    const [first, joined] = await Promise.all([loader({ attempt: attempt(), signal: new AbortController().signal }),
      loader({ attempt: attempt(), signal: new AbortController().signal })]);
    expect(first).toBe(joined); expect(first.status).toBe('complete');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.sleeper.app/v1/players/nfl', expect.objectContaining({
      cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
    const owner = await import('./player-directory');
    expect(() => owner.assertOriginalPlayerDirectoryCapture(first, attempt())).not.toThrow();
    expect(() => owner.assertOriginalPlayerDirectoryCapture({ ...first }, attempt())).toThrow(/Original/);
    expect(() => owner.assertOriginalPlayerDirectoryCapture(first, attempt(2))).toThrow(/Original/);
    expect(Object.isFrozen(first.rows[0].source)).toBe(true);
  });
  it('does not join an older legacy request or another reservation', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    const loader = await load(), legacy = loader();
    const strict = await loader({ attempt: attempt(), signal: new AbortController().signal });
    expect(strict).toMatchObject({ status: 'unavailable', providerRequests: 0, requestStartedAt: null, reasons: ['catalog-request-in-flight'] });
    resolve(new Response(JSON.stringify(native))); await legacy;
    const first = loader({ attempt: attempt(), signal: new AbortController().signal });
    const later = await loader({ attempt: attempt(2), signal: new AbortController().signal });
    expect(later.providerRequests).toBe(0); expect(fetcher).toHaveBeenCalledTimes(2);
    resolve(new Response(JSON.stringify(native))); await first;
  });
  it('does not let strict owner cancellation abort an unrelated legacy catalog consumer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    })).mockResolvedValueOnce(new Response(JSON.stringify(native)));
    vi.stubGlobal('fetch', fetcher);
    const loader = await load(), controller = new AbortController();
    const strict = loader({ attempt: attempt(), signal: controller.signal }), legacy = loader();
    controller.abort(new Error('Strict owner finished.'));
    expect(await strict).toMatchObject({ status: 'unavailable', providerRequests: 1, reasons: ['catalog-cancelled'] });
    expect(await legacy).toMatchObject({ complete: true, catalog: { '8063': { full_name: 'George Silvanic' } } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('retains malformed JSON and duplicate members without accepting a last value', async () => {
    const loader = await load();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"x":{"player_id":"x"},"x":{"player_id":"x"}}')));
    expect(await loader({ attempt: attempt(), signal: new AbortController().signal })).toMatchObject({ status: 'invalid', duplicateMemberCount: 1 });
  });
  it('records HTTP failure once and reports a cooldown as zero additional requests', async () => {
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 503 })); vi.stubGlobal('fetch', fetcher);
    const loader = await load();
    expect(await loader({ attempt: attempt(), signal: new AbortController().signal })).toMatchObject({ status: 'unavailable', providerRequests: 1 });
    expect(await loader({ attempt: attempt(2), signal: new AbortController().signal })).toMatchObject({ status: 'unavailable', providerRequests: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a full response above 16 MiB and cancels the underlying stream without awaiting acknowledgment', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1)); }, cancel });
    const response = new Response(body); vi.stubGlobal('fetch', vi.fn(async () => response));
    const loader = await load();
    expect(await loader({ attempt: attempt(), signal: new AbortController().signal })).toMatchObject({ status: 'unavailable', providerRequests: 1, reasons: ['catalog-response-invalid'] });
    expect(cancel).toHaveBeenCalledTimes(1); expect(response.body?.locked).toBe(false);
  });
  it('rejects depth before typed acceptance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"x":{"extension":' + '['.repeat(64) + '0' + ']'.repeat(64) + '}}')));
    const loader = await load();
    expect(await loader({ attempt: attempt(), signal: new AbortController().signal })).toMatchObject({ status: 'unavailable', providerRequests: 1 });
  });
  it.each(['{"x":{"unknown":1e400}}', '{"x":{"unknown":9007199254740993}}', '{"x":{"unknown":0.100000000000000001}}',
    '{"x":{"name":"\\u0000"}}'.replace('\\\\', '\\'), '{"x":{"name":"\\ud800"}}'.replace('\\\\', '\\')])(
    'retains nonrepresentable JSON as raw-only failure: %s', async raw => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(raw))); const loader = await load();
      expect(await loader({ attempt: attempt(), signal: new AbortController().signal }))
        .toMatchObject({ status: 'unavailable', rawJson: raw, rows: [], sourceObservedAt: null, providerRequests: 1 });
    });
  it.each([
    '{"x":{"name":"' + String.fromCharCode(0) + '"}}',
    '{"x":' + String.fromCharCode(0),
  ])('omits literal NUL response text before parsing or capturing malformed JSON', async raw => {
    const fetcher = vi.fn(async () => new Response(raw)); vi.stubGlobal('fetch', fetcher);
    const loader = await load();
    expect(await loader({ attempt: attempt(), signal: new AbortController().signal }))
      .toMatchObject({ status: 'unavailable', reasons: ['catalog-response-invalid'], rawJson: null,
        rows: [], sourceObservedAt: null, providerRequests: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed UTF-8 without expanding replacement text beyond the stored byte limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]))));
    const loader = await load();
    expect(await loader({ attempt: attempt(), signal: new AbortController().signal }))
      .toMatchObject({ status: 'unavailable', rawJson: null, providerRequests: 1, sourceObservedAt: null });
  });
  it('accepts valid UTF-8 split between chunks in strict mode', async () => {
    const raw = '{"x":{"full_name":"José 😀"}}', bytes = new TextEncoder().encode(raw);
    const split = bytes.indexOf(0xc3) + 1;
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, split)); controller.enqueue(bytes.subarray(split)); controller.close();
    } }));
    vi.stubGlobal('fetch', vi.fn(async () => response)); const loader = await load();
    expect(await loader({ attempt: attempt(), signal: new AbortController().signal }))
      .toMatchObject({ status: 'complete', rawJson: raw, rows: [{ fullName: 'José 😀' }] });
  });
  it.each([
    '{"x":' + '['.repeat(63) + '0' + ']'.repeat(63) + ',"x":{}}',
    '{"x":{"name":"\\u0000"},"x":{}}'.replace('\\\\', '\\'),
    '{"x":{"number":1e400},"x":{}}',
  ])('rejects unsupported evidence hidden by a later duplicate member', async raw => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(raw))); const loader = await load();
    expect(await loader({ attempt: attempt(), signal: new AbortController().signal }))
      .toMatchObject({ status: 'unavailable', rawJson: raw, rows: [], sourceObservedAt: null, providerRequests: 1 });
  });
  it('accepts equivalent decimal spellings without rounding official unknown values', async () => {
    const raw = '{"x":{"decimals":[0.1,1.00,1e3,1.25e-2,-0.0,2.220446049250313e-16]}}';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(raw))); const loader = await load();
    expect(await loader({ attempt: attempt(), signal: new AbortController().signal })).toMatchObject({ status: 'complete', rawJson: raw });
  });
  it('does not start HTTP for a cancelled owner or malformed reservation', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const loader = await load();
    await expect(loader({ attempt: attempt(), signal: AbortSignal.abort(new Error('done')) })).rejects.toThrow('done');
    await expect(loader({ attempt: { ...attempt(), nonce: '' }, signal: new AbortController().signal })).rejects.toThrow(/reservation/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

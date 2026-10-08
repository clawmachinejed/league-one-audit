import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { assertLiveJson, createLiveCaptures, LIVE_CAPTURE_FAMILIES, LIVE_LEAGUE_ID, LIVE_RESPONSE_BYTES, liveRawOracle, normalizeLiveCapture } from './live-league-two';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
afterEach(() => { vi.restoreAllMocks(); });
const league = { league_id: LIVE_LEAGUE_ID, season: '2026', name: 'Synthetic live shape', sport: 'nfl', total_rosters: 2,
  scoring_settings: { rec: 0.5, int: -2, zero: 0 }, roster_positions: ['QB', 'RB', 'RB', 'DEF', 'BN'] };
const rosters = [{ roster_id: 1, owner_id: '123', co_owners: null, players: ['12', 'BAL'] },
  { roster_id: 2, owner_id: null, co_owners: ['456'], players: ['34', 'PHI'] }];
const users = [{ user_id: '123' }, { user_id: '456' }, { user_id: '789' }];
const scope = { provider: 'sleeper' as const, leagueKey: 'sleeper-' + LIVE_LEAGUE_ID, externalLeagueId: LIVE_LEAGUE_ID, season: 2026 };
it('forwards exactly four declared GETs through the real adapter, restores fetch and retains only bounded hashes', async () => {
  const original = globalThis.fetch;
  const transport = vi.fn<typeof fetch>(async (_url, options) => {
    expect(options).toMatchObject({ redirect: 'error', cache: 'no-store' });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    return new Response(JSON.stringify({ marker: 'private-test-value' }));
  });
  const source = createLiveCaptures(transport);
  for (const family of LIVE_CAPTURE_FAMILIES) {
    const capture = await source.capture(family);
    expect(capture).toMatchObject({ family, origin: 'network', week: null });
    expect(capture.acquisition).toBeUndefined();
    expect(capture.sourceObservedAt).toBe(capture.requestCompletedAt);
    expect(globalThis.fetch).toBe(original);
  }
  expect(transport.mock.calls.map(([url]) => url)).toEqual(['', '', '/rosters', '/users'].map(path => 'https://api.sleeper.app/v1/league/' + LIVE_LEAGUE_ID + path));
  expect(source.snapshot()).toMatchObject({ attempts: 4, receipts: LIVE_CAPTURE_FAMILIES.map(family => ({ family, sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) })) });
  expect(JSON.stringify(source.snapshot())).not.toContain('private-test-value');
  await expect(source.capture('users')).rejects.toThrow('boundary rejected');
  expect(transport).toHaveBeenCalledTimes(4);
});
it.each(['http', 'json', 'body', 'redirect', 'oversize'] as const)('consumes a failed %s attempt and never permits the duplicate league slot as a retry', async failure => {
  const original = globalThis.fetch;
  const transport = vi.fn<typeof fetch>(async () => {
    if (failure === 'http') return new Response('secret error', { status: 429 });
    if (failure === 'json') return new Response('not-json');
    if (failure === 'redirect') { const value = new Response('{}'); Object.defineProperty(value, 'redirected', { value: true }); return value; }
    if (failure === 'body') return new Response(new ReadableStream({ pull() { throw new Error('private stream failure'); } }));
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(LIVE_RESPONSE_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } }), { headers: { 'content-length': '1' } });
  });
  const source = createLiveCaptures(transport);
  await expect(source.capture('league')).rejects.toThrow('Live League Two capture boundary rejected.');
  await expect(source.capture('league')).rejects.toThrow('Live League Two capture boundary rejected.');
  expect(transport).toHaveBeenCalledTimes(1); expect(source.snapshot().attempts).toBe(1);
  expect(source.snapshot().failure).toMatchObject({ family: 'league', attempt: 1, reason: failure === 'oversize' ? 'body-limit' : failure });
  expect(JSON.stringify(source.snapshot())).not.toContain('secret');
  expect(globalThis.fetch).toBe(original);
});
it('rejects wrong ordering, extra endpoint forwarding without an alternative request', async () => {
  const transport = vi.fn<typeof fetch>(async () => new Response('{}'));
  const source = createLiveCaptures(transport);
  await expect(source.capture('users')).rejects.toThrow(); await expect(source.capture('league')).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  const recursive = vi.fn<typeof fetch>(async () => fetch('https://api.sleeper.app/v1/league/999'));
  await expect(createLiveCaptures(recursive).capture('league')).rejects.toThrow(); expect(recursive).toHaveBeenCalledTimes(1);
});
it('bounds body waiting using the same adapter signal and restores transport after abort', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const transport = vi.fn<typeof fetch>(async () => {
    queueMicrotask(() => controller.abort());
    return new Response(new ReadableStream({ pull() { return new Promise(() => undefined); } }));
  });
  const source = createLiveCaptures(transport);
  await expect(source.capture('league')).rejects.toThrow();
  expect(globalThis.fetch).toBe(original); await expect(source.capture('league')).rejects.toThrow(); expect(transport).toHaveBeenCalledTimes(1);
});
it('preserves independent user population, defense IDs, exact negative/zero scoring, ordered repeated slots and null co-owner states', () => {
  const raw = liveRawOracle(league, rosters, users);
  expect(raw.directory).toHaveLength(3); expect(raw.teams).toHaveLength(2);
  expect(raw.teams[0]).toMatchObject({ players: ['12', 'BAL'], coOwners: { state: 'unknown', reason: 'co_managers_null', ids: null } });
  expect(raw.teams[1]).toMatchObject({ owner: null, coOwners: { state: 'known', ids: ['456'] } });
  const at = '2026-10-08T19:39:00.123Z';
  const normalized = [league, rosters, users].map((payload, index) => normalizeLiveCapture(scope,
    { family: (['league', 'rosters', 'users'] as const)[index], week: null, payload, origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at }, at, 2));
  expect(normalized.map(value => value.status)).toEqual(['accepted', 'accepted', 'accepted']);
  expect(normalized[0].leagueSettings?.value?.scoring.rules.value).toEqual(raw.rules);
  expect(normalized[0].leagueSettings?.value?.slots.value).toEqual(raw.slots.map((nativeCode, ordinal) => ({ nativeCode, count: 1, ordinal, semantics: 'ordered-occurrence' })));
  expect(normalized[1].teamManagers?.status).toBe('partial'); expect(normalized[1].teamManagerEvidence?.status).toBe('partial');
  expect(normalized[1].teamManagerEvidence?.teams?.[0].coManagers).toEqual({ state: 'unknown', externalManagerIds: null, reason: 'co_managers_null' });
  expect(normalized[1].value?.family === 'rosters' && normalized[1].value.teams[0].playerExternalIds).toEqual(['12', 'BAL']);
});
it('rejects source identity drift, inferred roster population, duplicate users/players and invalid scoring instead of silently qualifying', () => {
  for (const change of [{ league_id: '1' }, { season: '2025' }, { total_rosters: 3 }, { scoring_settings: { rec: null } }, { scoring_settings: { rec: Infinity } }]) {
    expect(() => liveRawOracle({ ...league, ...change }, rosters, users)).toThrow();
  }
  expect(() => liveRawOracle(league, rosters, [...users, users[0]])).toThrow();
  expect(() => liveRawOracle(league, [{ ...rosters[0], players: ['BAL', 'BAL'] }, rosters[1]], users)).toThrow();
  const absent = { roster_id: 1, owner_id: '123', players: ['BAL'] };
  expect(liveRawOracle(league, [absent, rosters[1]], users).teams[0].coOwners).toEqual({ state: 'unknown', reason: 'co_managers_absent', ids: null });
});
it('keeps the actual live assertion wiring on retained raw operands and the existing writer/readers', async () => {
  const source = await readFile(new URL('./league-two.live-integration-case.ts', import.meta.url), 'utf8');
  expect(source.indexOf('requireLiveQualification()')).toBeLessThan(source.indexOf('beforeAll('));
  for (const label of ['live.settings.scoring-keys', 'live.settings.scoring-value', 'live.settings.slots', 'live.players.ids', 'live.managers.primary', 'live.managers.coowners', 'live.directory.ids']) expect(source).toContain("equal('" + label + "'");
  expect(source).toContain('recordCapturedAdministration(mapping.scope');
  expect(source).not.toMatch(/setTimeout|runPublicIntakeStep|capturePublicSleeperIdentity|capturePublicSleeperLeagueList/u);
});
it('keeps per-field evidence distinguishable beyond projection array caps and dynamic key redaction', () => {
  const expected = { nativeSettings: { fields: { custom_unknown: 3 } }, tail: Array.from({ length: 20 }, (_, index) => index) };
  for (const mutate of [(value: typeof expected) => { value.nativeSettings.fields.custom_unknown = 4; },
    (value: typeof expected) => { value.tail[19] = 123; },
    (value: typeof expected) => { delete (value.nativeSettings.fields as Partial<typeof expected.nativeSettings.fields>).custom_unknown; }]) {
    const actual = structuredClone(expected); mutate(actual);
    const failed: unknown[] = [];
    expect(() => assertLiveJson(actual, expected, (id, a, e) => {
      try { expect(a).toEqual(e); } catch (error) { failed.push({ id, a, e }); throw error; }
    }, 'settings')).toThrow();
    expect(failed).toHaveLength(1); expect(JSON.stringify(failed)).not.toContain('truncated');
  }
  expect(() => assertLiveJson({ value: null }, { value: undefined }, (_id, a, e) => expect(a).toEqual(e), 'settings')).toThrow();
  const getter = vi.fn(() => 'secret'); const hostile = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
  expect(() => assertLiveJson(hostile, { value: 1 }, (_id, a, e) => expect(a).toEqual(e), 'settings')).toThrow('accessor'); expect(getter).not.toHaveBeenCalled();
});
it('fails explicit assertion bounds instead of silently discarding deep or oversized expected values', () => {
  const deep: Record<string, unknown> = {}; let current = deep;
  for (let i = 0; i < 17; i++) { const next = {}; current.value = next; current = next; }
  expect(() => assertLiveJson(deep, deep, (_id, a, e) => expect(a).toEqual(e), 'settings')).toThrow('bound exceeded');
  const long = Array(4_097).fill(1);
  expect(() => assertLiveJson(long, long, (_id, a, e) => expect(a).toEqual(e), 'settings')).toThrow('bound exceeded');
});
it('blocks overlap and makes its source session unusable even if the first response later completes', async () => {
  const pending = Promise.withResolvers<Response>(); const transport = vi.fn<typeof fetch>(() => pending.promise);
  const source = createLiveCaptures(transport), first = source.capture('league');
  await expect(source.capture('league')).rejects.toThrow(); pending.resolve(new Response('{}')); await first;
  await expect(source.capture('league')).rejects.toThrow(); expect(transport).toHaveBeenCalledTimes(1);
});

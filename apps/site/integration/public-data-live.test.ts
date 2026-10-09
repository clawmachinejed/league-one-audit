import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createLiveJourney, JOURNEY_STEPS, JOURNEY_LEAGUES, JOURNEY_MANAGER, JOURNEY_USERNAME, JOURNEY_SEASON,
  JOURNEY_BODY_BYTES, JOURNEY_MAX_GETS, JOURNEY_CASE_MS, JOURNEY_LOOP_MS, JOURNEY_CADENCE_SECONDS } from './public-data-live';
import { recordCapturedAdministration } from '../lib/league-administration/runtime';
import type { LeagueAdministrationStore } from '../lib/league-administration/store-contracts';
import { assertOriginalPublicCapture, type PublicCaptureWitness } from '../lib/league-administration/public-capture-witness';
import { liveLeagueMetadata, liveRawOracle, normalizeLiveCapture, LIVE_LEAGUE_ID } from './live-league-two';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
beforeEach(() => { vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { throw new Error('Offline network forbidden.'); }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const league = (id: string) => ({ league_id: id, season: '2026', sport: 'nfl', name: 'Retained source shape', total_rosters: 1,
  settings: { divisions: 1 }, scoring_settings: { rec: 0.5, zero: 0, int: -2 }, roster_positions: ['QB', 'DEF', 'BN'] });
const rosters = [{ roster_id: 1, owner_id: JOURNEY_MANAGER, co_owners: null, players: ['123', 'BUF'] }];
const users = [{ user_id: JOURNEY_MANAGER }];
const payload = (url: string) => url.includes('/leagues/nfl/') ? JOURNEY_LEAGUES.map(league)
  : url.includes('/user/') ? { user_id: JOURNEY_MANAGER, username: 'dannypak', display_name: 'Live source shape' }
    : url.endsWith('/rosters') ? rosters : url.endsWith('/users') ? users : league(url.split('/').at(-1)!);
function witness(index: number): PublicCaptureWitness {
  const step = JOURNEY_STEPS[index], common = { requestId: uuid(step.cycle), revision: index % 14 };
  const work = step.kind === 'identity' ? { ...common, kind: step.kind, username: step.cycle === 1 ? JOURNEY_USERNAME : JOURNEY_MANAGER }
    : step.kind === 'leagues' ? { ...common, kind: step.kind, userId: JOURNEY_MANAGER, season: JOURNEY_SEASON }
      : { ...common, kind: step.kind, externalLeagueId: step.leagueId!, season: JOURNEY_SEASON };
  return { version: 'public-network-capture-v1', work, fence: { jobKey: 'league-administration-public-intake', workerId: uuid(50 + index),
    generation: index + 1, deadlineAt: new Date(Date.now() + 20_000).toISOString() }, dispatchNonce: uuid(100 + index),
    mapping: step.kind === 'core' || step.kind === 'users' ? { connectionId: uuid(200), leagueSeasonId: uuid(201), revisionId: uuid(202), generation: 1,
      scope: { leagueKey: 'sleeper-' + step.leagueId!, provider: 'sleeper', externalLeagueId: step.leagueId!, season: JOURNEY_SEASON } } : null,
    attempts: step.kind === 'core' ? { settings: { id: uuid(300), nonce: uuid(400) }, players: { id: uuid(301), nonce: uuid(401) },
      managers: { id: uuid(302), nonce: uuid(402) }, managersV2: { id: uuid(303), nonce: uuid(403) } } : {},
  };
}
async function stepCapture(source: ReturnType<typeof createLiveJourney>, index: number) {
  const step = source.beginStep(uuid(JOURNEY_STEPS[index].cycle)), w = witness(index), signal = new AbortController().signal;
  const values = step.kind === 'identity' ? [await source.source.identity(step.cycle === 1 ? JOURNEY_USERNAME : JOURNEY_MANAGER, signal, w)]
    : step.kind === 'leagues' ? [await source.source.leagues(JOURNEY_MANAGER, JOURNEY_SEASON, signal, w)]
      : step.kind === 'core' ? await Promise.all(['league', 'rosters'].map(family => source.source.core(step.leagueId!, family as 'league' | 'rosters', signal, w)))
        : [await source.source.core(step.leagueId!, step.kind === 'bootstrap' ? 'league' : 'users', signal, w)];
  source.finishStep(true); return { values, w };
}
it('passes exactly all36 planned GETs through real adapters and returns unchanged sealed captures, including concurrent core pairs', async () => {
  let live = 0, max = 0;
  const transport = vi.fn<typeof fetch>(async url => {
    live++; max = Math.max(max, live); await Promise.resolve(); live--; return new Response(JSON.stringify(payload(String(url))));
  });
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch);
  for (let i = 0; i < JOURNEY_STEPS.length; i++) {
    const { values, w } = await stepCapture(source, i);
    for (const capture of values) {
      expect(source.captures.some(row => row.capture === capture)).toBe(true);
      expect(() => assertOriginalPublicCapture(capture, w)).not.toThrow();
      expect(() => assertOriginalPublicCapture({ ...capture }, w)).toThrow('Original public transport');
      expect(capture.acquisition).toEqual(w); expect(Object.isFrozen(capture)).toBe(true);
      expect(Object.isFrozen(capture.payload)).toBe(true);
    }
    expect(globalThis.fetch).toBe(source.fetch);
  }
  source.assertComplete(); expect(max).toBe(2); expect(transport).toHaveBeenCalledTimes(36);
  expect(source.snapshot()).toMatchObject({ steps: 28, attempts: 36, failure: null });
  expect(source.snapshot().receipts).toHaveLength(36);
  expect(source.captures.filter(row => row.family === 'leagues').every(row => (row.capture.payload as unknown[]).length === 4)).toBe(true);
  expect(JSON.stringify(source.snapshot())).not.toContain('Live source shape');
  expect(() => source.beginStep()).toThrow('ordering'); expect(transport).toHaveBeenCalledTimes(36);
});
it('allows busy polling without admitting an HTTP window twice', async () => {
  const transport = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(payload(String(url)))));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch);
  source.beginStep(uuid(1)); source.finishStep(false); expect(source.snapshot().attempts).toBe(0);
  await stepCapture(source, 0); expect(transport).toHaveBeenCalledOnce();
});
it.each(['missing', 'foreign-request', 'wrong-kind'] as const)('rejects %s witness before transport', async mode => {
  const transport = vi.fn<typeof fetch>(); const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch); source.beginStep(uuid(1));
  const original = witness(mode === 'wrong-kind' ? 1 : 0);
  const w = mode === 'foreign-request' ? { ...original, work: { ...original.work, requestId: uuid(999) } } : original;
  await expect(source.source.identity(JOURNEY_USERNAME, new AbortController().signal, mode === 'missing' ? undefined : w)).rejects.toThrow('witness');
  expect(transport).not.toHaveBeenCalled(); expect(source.snapshot().failure?.reason).toBe('witness');
});
it.each(['http', 'redirect', 'body', 'json', 'oversize', 'network', 'stream'] as const)('seals a failed %s capture and forbids retry', async mode => {
  const transport = vi.fn<typeof fetch>(async () => {
    if (mode === 'network') throw new Error('untrusted provider detail');
    if (mode === 'http') return new Response('untrusted provider detail', { status: 429 });
    if (mode === 'redirect') { const r = new Response('{}'); Object.defineProperty(r, 'redirected', { value: true }); return r; }
    if (mode === 'body') return new Response(null);
    if (mode === 'json') return new Response('invalid-json');
    if (mode === 'oversize') return new Response('x'.repeat(JOURNEY_BODY_BYTES + 1));
    return new Response(new ReadableStream({ start(c) { c.error(new Error('untrusted stream')); } }));
  });
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch); source.beginStep(uuid(1));
  await expect(source.source.identity(JOURNEY_USERNAME, new AbortController().signal, witness(0))).rejects.toThrow('boundary rejected');
  await expect(source.source.identity(JOURNEY_USERNAME, new AbortController().signal, witness(0))).rejects.toThrow('boundary rejected');
  expect(transport).toHaveBeenCalledOnce(); expect(source.snapshot().attempts).toBe(1);
  expect(JSON.stringify(source.snapshot())).not.toContain('untrusted');
});
it.each(['method', 'headers', 'redirect', 'cache', 'body', 'url', 'no-signal'] as const)('refuses undeclared request %s before dispatch', async mode => {
  const transport = vi.fn<typeof fetch>(); const source = createLiveJourney(transport); source.beginStep(uuid(1));
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init: RequestInit) => source.fetch(mode === 'url' ? 'https://example.test' : input,
    { ...init, ...(mode === 'method' ? { method: 'POST' } : mode === 'headers' ? { headers: { authorization: 'private' } }
      : mode === 'redirect' ? { redirect: 'follow' } : mode === 'cache' ? { cache: 'default' } : mode === 'body' ? { body: 'private' }
        : mode === 'no-signal' ? { signal: undefined } : {}) }));
  await expect(source.source.identity(JOURNEY_USERNAME, new AbortController().signal, witness(0))).rejects.toThrow('request');
  expect(transport).not.toHaveBeenCalled();
});
it.each(['missing', 'extra', 'duplicate'] as const)('rejects a %s associated member before any core request, without rewriting the real list', async mode => {
  const rows = JOURNEY_LEAGUES.map(league);
  if (mode === 'missing') rows.pop(); else if (mode === 'extra') rows.push(league('999')); else rows.push(rows[0]);
  const transport = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).includes('/leagues/') ? rows : payload(String(url)))));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch); await stepCapture(source, 0);
  await expect(stepCapture(source, 1)).rejects.toThrow('scope');
  expect(transport).toHaveBeenCalledTimes(2); expect(source.captures).toHaveLength(1); expect(source.snapshot().steps).toBe(1);
});
it('wrong season is a sticky scope failure', async () => {
  const source = createLiveJourney(vi.fn()); source.beginStep(uuid(1));
  expect(() => source.source.leagues(JOURNEY_MANAGER, 2025, new AbortController().signal, witness(1))).toThrow('scope');
  expect(() => source.beginStep()).toThrow('scope');
});
it('aborts a stalled response body and retains the original bounded failure', async () => {
  const controller = new AbortController(); let opened!: () => void; const ready = new Promise<void>(r => { opened = r; });
  const transport = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start() { opened(); } })));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch); source.beginStep(uuid(1));
  const pending = source.source.identity(JOURNEY_USERNAME, controller.signal, witness(0)); await ready; controller.abort();
  await expect(pending).rejects.toThrow('abort'); expect(source.snapshot().failure?.reason).toBe('abort');
});
it('uses declared league identity for raw oracles and preserves the prior League Two default', () => {
  expect(() => liveLeagueMetadata(league(LIVE_LEAGUE_ID))).not.toThrow();
  expect(() => liveLeagueMetadata(league(JOURNEY_LEAGUES[0]))).toThrow('boundary rejected');
  for (const id of JOURNEY_LEAGUES) {
    const raw = liveRawOracle(league(id), rosters, users, { leagueId: id, season: 2026 });
    expect(raw).toMatchObject({ rules: { zero: 0, int: -2 }, teams: [{ players: ['123', 'BUF'], owner: JOURNEY_MANAGER, coOwners: { state: 'unknown' } }] });
    expect(() => liveRawOracle(league(id), rosters, users, { leagueId: id, season: 2025 })).toThrow('boundary rejected');
  }
});
it('keeps the authored case on one shared owner with fixed acquisition/finalization budgets and no owner seeding', async () => {
  expect(JOURNEY_STEPS).toHaveLength(28); expect(JOURNEY_MAX_GETS).toBe(36);
  expect(JOURNEY_LOOP_MS).toBe(1_725_000); expect(JOURNEY_CASE_MS).toBe(1_740_000); expect(JOURNEY_CADENCE_SECONDS).toBe(3600);
  const text = await readFile(new URL('./public-data.live-integration-case.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('case.ts', text, ts.ScriptTarget.Latest, true);
  const calls: string[] = []; const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) calls.push(node.expression.getText(tree)); ts.forEachChild(node, visit); }; visit(tree);
  expect(calls.filter(x => x === 'runPublicIntakeStep')).toHaveLength(1);
  expect(calls.filter(x => x === 'runPublicDataRefreshStep')).toHaveLength(2);
  expect(calls).not.toContain('ownerQuery'); expect(calls).not.toContain('registerLeagueSeason');
  expect(text).not.toMatch(/vi\.|setSystemTime|minimumIntervalSeconds\s*:/u);
});

it('normalizes the actual witnessed writer input with its original acquisition and unchanged legacy behavior', async () => {
  const transport = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(payload(String(url)))));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch);
  for (let i = 0; i < 3; i++) await stepCapture(source, i);
  source.beginStep(uuid(1)); const w = witness(3); const signal = new AbortController().signal;
  const document = await source.source.core(JOURNEY_LEAGUES[0], 'league', signal, w);
  const recordObservation = vi.fn<LeagueAdministrationStore['recordObservation']>(async () => ({ status: 'changed', observationId: uuid(800) }));
  const store = { enabled: true, recordObservation } as unknown as LeagueAdministrationStore;
  const checkedAt = document.requestCompletedAt;
  await recordCapturedAdministration(w.mapping!.scope, [document], { store, mapping: w.mapping!, fence: w.fence,
    leagueSettingsAttempt: { id: w.attempts.settings.id, scopeId: uuid(801), ordinal: 1, expectedGeneration: 0 },
    expectedAcquisition: w, now: () => new Date(checkedAt) });
  expect(recordObservation).toHaveBeenCalledOnce();
  const expected = normalizeLiveCapture(w.mapping!.scope, document, checkedAt, 1);
  expect(recordObservation.mock.calls[0][0].envelope).toEqual(expected.envelope);
  expect(expected.envelope.provenance.acquisition).toEqual(w);
});

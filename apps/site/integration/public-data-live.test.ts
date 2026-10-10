import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createLiveJourney, JOURNEY_MAX_LEAGUES, JOURNEY_MANAGER, JOURNEY_USERNAME, JOURNEY_SEASON,
  JOURNEY_BODY_BYTES, JOURNEY_MAX_GETS, JOURNEY_CASE_MS, JOURNEY_LOOP_MS, JOURNEY_CADENCE_SECONDS } from './public-data-live';
import * as sleeper from '../lib/sleeper';
import { runPublicIntakeStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { qualificationDigest } from './qualification-profile';
import { recordCapturedAdministration } from '../lib/league-administration/runtime';
import type { LeagueAdministrationStore } from '../lib/league-administration/store-contracts';
import { assertOriginalPublicCapture, sealPublicCapture, type PublicCaptureWitness } from '../lib/league-administration/public-capture-witness';
import { liveLeagueMetadata, liveRawOracle, normalizeLiveCapture, LIVE_LEAGUE_ID } from './live-league-two';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
beforeEach(() => { vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { throw new Error('Offline network forbidden.'); }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const JOURNEY_LEAGUES = ['2003', '2009', '2017', '2081'];
const initialSteps = [{ cycle: 1 as const, kind: 'identity' as const }, { cycle: 1 as const, kind: 'leagues' as const }];
const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const league = (id: string) => ({ league_id: id, season: '2026', sport: 'nfl', name: 'Retained source shape', total_rosters: 1,
  settings: { divisions: 1 }, scoring_settings: { rec: 0.5, zero: 0, int: -2 }, roster_positions: ['QB', 'DEF', 'BN'] });
const rosters = [{ roster_id: 1, owner_id: JOURNEY_MANAGER, co_owners: null, players: ['123', 'BUF'] }];
const users = [{ user_id: JOURNEY_MANAGER }];
const payload = (url: string, leagueIds: readonly string[] = JOURNEY_LEAGUES) => url.includes('/leagues/nfl/') ? leagueIds.map(league)
  : url.includes('/user/') ? { user_id: JOURNEY_MANAGER, username: 'dannypak', display_name: 'Live source shape' }
    : url.endsWith('/rosters') ? rosters : url.endsWith('/users') ? users : league(url.split('/').at(-1)!);
function witness(index: number, step: ReturnType<typeof createLiveJourney>['steps'][number] = initialSteps[index]): PublicCaptureWitness {
  const common = { requestId: uuid(step.cycle), revision: index };
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
  const step = source.beginStep(uuid(source.steps[index].cycle)), w = witness(index, step), signal = new AbortController().signal;
  const values = step.kind === 'identity' ? [await source.source.identity(step.cycle === 1 ? JOURNEY_USERNAME : JOURNEY_MANAGER, signal, w)]
    : step.kind === 'leagues' ? [await source.source.leagues(JOURNEY_MANAGER, JOURNEY_SEASON, signal, w)]
      : step.kind === 'core' ? await Promise.all(['league', 'rosters'].map(family => source.source.core(step.leagueId!, family as 'league' | 'rosters', signal, w)))
        : [await source.source.core(step.leagueId!, step.kind === 'bootstrap' ? 'league' : 'users', signal, w)];
  source.finishStep(true); return { values, w };
}
it.each([1, 2, 4])('discovers %i unrelated leagues in shuffled order and preserves every original seal through both collections', async count => {
  const ids = JOURNEY_LEAGUES.slice(0, count), shuffled = [...ids].reverse();
  let live = 0, max = 0, lists = 0;
  const transport = vi.fn<typeof fetch>(async url => {
    live++; max = Math.max(max, live); await Promise.resolve(); live--; return new Response(JSON.stringify(payload(String(url), String(url).includes('/leagues/') && ++lists === 2 ? ids : shuffled)));
  });
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch);
  for (let i = 0; i < source.steps.length; i++) {
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
  source.assertComplete(); expect(max).toBe(2); expect(transport).toHaveBeenCalledTimes(4 + 8 * count);
  expect(source.leagueIds).toEqual(ids); expect(Object.isFrozen(source.leagueIds)).toBe(true);
  expect(source.expected).toEqual({ perCycle: 2 + 3 * count, admissions: 4 + 6 * count, claims: 5 + 6 * count,
    gets: 4 + 8 * count, typedReceipts: 4 * count });
  for (const cycle of [1, 2]) expect(source.steps.filter(step => step.cycle === cycle)).toEqual([
    { cycle, kind: 'identity' }, { cycle, kind: 'leagues' },
    ...ids.flatMap(leagueId => [{ cycle, kind: 'bootstrap', leagueId }, { cycle, kind: 'core', leagueId }]),
    ...ids.map(leagueId => ({ cycle, kind: 'users', leagueId })),
  ]);
  expect(source.snapshot()).toMatchObject({ steps: 4 + 6 * count, attempts: 4 + 8 * count, failure: null });
  expect(source.snapshot().receipts).toHaveLength(4 + 8 * count);
  expect(source.captures.filter(row => row.family === 'leagues').map(row => row.capture.payload)).toEqual([shuffled.map(league), ids.map(league)]);
  expect(JSON.stringify(source.snapshot())).not.toContain('Live source shape');
  expect(() => source.beginStep()).toThrow('ordering'); expect(transport).toHaveBeenCalledTimes(4 + 8 * count);
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
async function checkpointList(source: ReturnType<typeof createLiveJourney>, index: number) {
  const selected = source.steps[index], template = witness(index, selected);
  source.beginStep(template.work.requestId);
  const recordLeagues = vi.fn(), register = vi.fn(), recordObservation = vi.fn();
  const dependencies = { source: source.source,
    intake: { recover: vi.fn(), next: vi.fn(async () => template.work), admit: vi.fn(async () => true), recordLeagues, register,
      captureWitness: vi.fn<NonNullable<PublicIntakeDependencies['intake']['captureWitness']>>(async (work, mapping, fence) => ({ ...template, work, mapping, fence })), fail: vi.fn(async () => undefined) },
    administration: { recordObservation },
    jobs: { acquireJob: vi.fn(async () => ({ kind: 'acquired', attempt: 1 })), completeJob: vi.fn(async () => true), failJob: vi.fn(async () => true) },
  } as unknown as PublicIntakeDependencies;
  const result = await runPublicIntakeStep(template.work.requestId, dependencies, new AbortController().signal);
  expect(result).toEqual({ status: 'unavailable', resource: 'leagues', providerRequests: 1 });
  expect(recordLeagues).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled(); expect(recordObservation).not.toHaveBeenCalled();
}
it.each(['empty', 'five', 'duplicate', 'malformed', 'wrong-season'] as const)('refuses %s original discovery before its SQL list checkpoint or core work', async mode => {
  const reason = mode === 'empty' ? 'discovery-empty' : mode === 'five' ? 'discovery-limit' : 'discovery-invalid';
  const rows: unknown[] = JOURNEY_LEAGUES.map(league);
  if (mode === 'empty') rows.length = 0;
  if (mode === 'five') rows.push(league('2099'));
  if (mode === 'duplicate') rows[1] = rows[0];
  if (mode === 'malformed') rows[0] = { ...league('2003'), league_id: 'invalid-private-value' };
  if (mode === 'wrong-season') rows[0] = { ...league('2003'), season: '2025' };
  const transport = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).includes('/leagues/') ? rows : payload(String(url)))));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch); await stepCapture(source, 0);
  await checkpointList(source, 1);
  expect(transport.mock.calls.map(([url]) => url)).toEqual([
    'https://api.sleeper.app/v1/user/' + JOURNEY_USERNAME,
    'https://api.sleeper.app/v1/user/' + JOURNEY_MANAGER + '/leagues/nfl/2026',
  ]);
  expect(source.captures).toHaveLength(2); const original = source.captures[1].capture;
  expect(original.payload).toEqual(rows); expect(() => assertOriginalPublicCapture(original, original.acquisition!)).not.toThrow();
  expect(source.leagueIds).toEqual([]); expect(source.snapshot()).toMatchObject({ steps: 1, failure: { reason, attempt: 2 },
    discovery: [{ cycle: 1, rawCount: rows.length, accepted: false, payloadDigest: qualificationDigest(rows) }] });
  expect(JSON.stringify(source.snapshot())).not.toContain('invalid-private-value');
  expect(() => source.beginStep()).toThrow(reason); expect(() => source.finishStep(true)).toThrow(reason);
  expect(transport).toHaveBeenCalledTimes(2);
});
it.each(['added', 'removed', 'replaced'] as const)('retains but refuses a %s second discovery before recordLeagues and makes refusal sticky', async mode => {
  const ids = JOURNEY_LEAGUES.slice(0, 2), changed = mode === 'added' ? [...ids, '2099'] : mode === 'removed' ? ids.slice(0, 1) : [ids[0], '2099'];
  let lists = 0;
  const transport = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).includes('/leagues/')
    ? (++lists === 1 ? [...ids].reverse() : changed).map(league) : payload(String(url), ids))));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch);
  for (let i = 0; i < 9; i++) await stepCapture(source, i);
  const first = source.captures.find(row => row.family === 'leagues')!.capture;
  await checkpointList(source, 9);
  const second = source.captures.at(-1)!.capture;
  expect(first.payload).toEqual([...ids].reverse().map(league)); expect(second.payload).toEqual(changed.map(league));
  for (const capture of [first, second]) expect(() => assertOriginalPublicCapture(capture, capture.acquisition!)).not.toThrow();
  expect(source.leagueIds).toEqual(ids);
  expect(source.snapshot()).toMatchObject({ steps: 9, attempts: 12, failure: { reason: 'discovery-drift', attempt: 12 },
    discovery: [{ cycle: 1, rawCount: 2, accepted: true, idsDigest: qualificationDigest(ids) },
      { cycle: 2, rawCount: changed.length, accepted: false, idsDigest: qualificationDigest(changed) }] });
  expect(() => source.beginStep()).toThrow('discovery-drift'); expect(() => source.assertComplete()).toThrow('discovery-drift');
  expect(transport).toHaveBeenCalledTimes(12);
});
it('refuses same-count raw/normalized ID disagreement in an originally sealed adapter result', async () => {
  const realCapture = sleeper.capturePublicSleeperLeagueList;
  vi.spyOn(sleeper, 'capturePublicSleeperLeagueList').mockImplementation(async (...args) => {
    const original = await realCapture(...args);
    // Fault injection in the adapter result; production seals and the forwarding boundary still execute.
    return sealPublicCapture({ ...original, value: original.value!.map((row, i) => i ? row : { ...row, id: '2099' }) }, args[3]);
  });
  const transport = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(payload(String(url)))));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch); await stepCapture(source, 0);
  await checkpointList(source, 1);
  expect(source.snapshot()).toMatchObject({ failure: { reason: 'discovery-invalid', attempt: 2 }, discovery: [{ rawCount: 4, normalizedCount: 4, accepted: false }] });
  expect(transport).toHaveBeenCalledTimes(2);
});
it.each([1, 2, 4].flatMap(count => ['missing-step', 'missing-capture', 'extra-capture'].map(mode => ({ count, mode }))))('requires exact steps/GETs/captures with $mode at $count discoveries', async ({ count, mode }) => {
  const transport = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(payload(String(url), JOURNEY_LEAGUES.slice(0, count)))));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch);
  for (let i = 0; i < source.steps.length; i++) {
    if (mode === 'missing-step' && source.leagueIds.length && i === source.steps.length - 1) break;
    await stepCapture(source, i);
  }
  if (mode !== 'missing-step') {
    source.assertComplete();
    if (mode === 'missing-capture') source.captures.pop(); else source.captures.push(source.captures[0]);
  }
  expect(() => source.assertComplete()).toThrow('ordering');
  expect(transport).toHaveBeenCalledTimes(4 + 8 * count - (mode === 'missing-step' ? 1 : 0));
});
it('rejects unauthorized extra GETs without dispatch', async () => {
  const transport = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(payload(String(url), JOURNEY_LEAGUES.slice(0, 1)))));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch);
  await stepCapture(source, 0); await stepCapture(source, 1);
  await expect(source.fetch('https://api.sleeper.app/v1/user/' + JOURNEY_MANAGER)).rejects.toThrow('request');
  expect(transport).toHaveBeenCalledTimes(2); expect(() => source.assertComplete()).toThrow('request');
});
it.each(['manager', 'username'])('refuses a changed stable %s before discovery', async field => {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ user_id: field === 'manager' ? '8888' : JOURNEY_MANAGER,
    username: field === 'username' ? 'DifferentManager' : JOURNEY_USERNAME })));
  const source = createLiveJourney(transport); vi.stubGlobal('fetch', source.fetch);
  await expect(stepCapture(source, 0)).rejects.toThrow('source');
  expect(() => source.beginStep()).toThrow('source'); expect(transport).toHaveBeenCalledOnce();
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
  expect(JOURNEY_MAX_LEAGUES).toBe(4); expect(JOURNEY_MAX_GETS).toBe(36);
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
  source.beginStep(uuid(1)); const w = witness(3, source.steps[3]); const signal = new AbortController().signal;
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

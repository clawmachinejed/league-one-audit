import { readFile } from 'node:fs/promises';
import { neonConfig } from '@neondatabase/serverless';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../lib/database';
import { createBackendControlsDatabaseFetchGuard } from './backend-controls-fetch';

vi.mock('server-only', () => ({}));
const runtimeUrl = 'postgresql://league_one_runtime:offline-fixture@ep-cp24-example.us-east-2.aws.neon.tech/integration_test?sslmode=require';
const originalOptions = { ...neonConfig.opts };
beforeEach(() => { vi.stubEnv('VERCEL_ENV', 'development'); });
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const key of ['fetchEndpoint', 'fetchFunction'] as const) {
    if (Object.hasOwn(originalOptions, key)) Object.assign(neonConfig.opts, { [key]: originalOptions[key] });
    else delete neonConfig.opts[key];
  }
});
const endpoint = () => {
  const runtime = new URL(runtimeUrl), resolver = neonConfig.fetchEndpoint;
  return typeof resolver === 'function' ? resolver(runtime.hostname, runtime.port || 5432, { jwtAuth: false }) : resolver;
};
const sqlResponse = () => new Response(JSON.stringify({ fields: [{ name: 'answer', dataTypeID: 23 }], rows: [['1']], command: 'SELECT', rowCount: 1 }));

/** Execute the actual fixture interception expression, without importing its
 * qualification suite, opening SQL or replacing the installed driver. */
async function fixtureFetch(originalFetch: typeof fetch, mode: 'none' | 'prerequisite' | 'failure' = 'none') {
  const source = await readFile(new URL('./backend-controls.qualification-case.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('backend-controls.qualification-case.ts', source, ts.ScriptTarget.Latest, true);
  const callbacks: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "vi.spyOn(globalThis,'fetch').mockImplementation"
      && ts.isArrowFunction(node.arguments[0])) callbacks.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(callbacks).toHaveLength(1);
  const script = ts.transpileModule('const callback = ' + callbacks[0].getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const build = new Function('isDatabaseFetch', 'originalFetch', 'providerMode',
    `let prerequisiteGets=0,measuredGets=0,forbiddenGets=0;
     const username='cp24_offline',native='800000000000000001';
     ${script}
     return {fetch:callback,counts:()=>({prerequisiteGets,measuredGets,forbiddenGets})};`) as
    (guard: ReturnType<typeof createBackendControlsDatabaseFetchGuard>, transport: typeof fetch, mode: string) => {
      fetch: typeof fetch; counts: () => { prerequisiteGets: number; measuredGets: number; forbiddenGets: number };
    };
  return build(createBackendControlsDatabaseFetchGuard(runtimeUrl), originalFetch, mode);
}

it('routes the installed Neon HTTP request through the actual fixture callback with its original abort signal', async () => {
  const transport = vi.fn<typeof fetch>(async () => sqlResponse());
  const fixture = await fixtureFetch(transport);
  const interception = vi.spyOn(globalThis, 'fetch').mockImplementation(fixture.fetch);
  const database = createDatabase(runtimeUrl); expect(database.enabled).toBe(true);
  if (!database.enabled) throw new Error('Missing offline client.');
  const controller = new AbortController();
  await expect(database.query('select 1 as answer', [], { signal: controller.signal })).resolves.toEqual([{ answer: 1 }]);
  expect(transport).toHaveBeenCalledOnce();
  const [input, init] = interception.mock.calls[0];
  expect(String(input)).toBe(endpoint());
  expect(new URL(String(input)).hostname).not.toBe(new URL(runtimeUrl).hostname); // Original predicate rejected the real regional API host.
  expect(transport.mock.calls[0][0]).toBe(input); expect(transport.mock.calls[0][1]).toBe(init);
  expect(init?.method).toBe('POST'); expect(init?.signal).toBe(controller.signal);
  expect(new Headers(init?.headers).get('Neon-Connection-String')).toBe(runtimeUrl);
  expect(fixture.counts()).toEqual({ prerequisiteGets: 0, measuredGets: 0, forbiddenGets: 0 });
  controller.abort(); expect(init?.signal?.aborted).toBe(true);
});

it('preserves an in-flight driver abort through the original fixture transport without retry', async () => {
  const controller = new AbortController();
  const transport = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.signal).toBe(controller.signal);
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      queueMicrotask(() => controller.abort(new Error('offline-cancel')));
    });
  });
  const fixture = await fixtureFetch(transport); vi.spyOn(globalThis, 'fetch').mockImplementation(fixture.fetch);
  const database = createDatabase(runtimeUrl); if (!database.enabled) throw new Error('Missing offline client.');
  await expect(database.query('select 1', [], { signal: controller.signal })).rejects.toThrow('offline-cancel');
  expect(transport).toHaveBeenCalledOnce(); expect(controller.signal.aborted).toBe(true);
  expect(fixture.counts()).toEqual({ prerequisiteGets: 0, measuredGets: 0, forbiddenGets: 0 });
});

it('denies changed database endpoints methods and connection identities before the offline transport', async () => {
  const transport = vi.fn<typeof fetch>(async () => sqlResponse()), fixture = await fixtureFetch(transport);
  const original = new URL(endpoint()), valid = { method: 'POST', headers: { 'Neon-Connection-String': runtimeUrl } };
  const probes: [string, RequestInit][] = [
    [original.href, { ...valid, method: 'GET' }], [original.href, { ...valid, method: 'DELETE' }],
    [original.href, { method: 'POST' }], [original.href, { ...valid, headers: { 'Neon-Connection-String': runtimeUrl.replace('integration_test', 'foreign_test') } }],
    [original.href, { ...valid, headers: { 'Neon-Connection-String': runtimeUrl.replace('league_one_runtime', 'league_one_auth') } }],
    [original.href.replace('/sql', '/other'), valid], [original.href + '?foreign=1', valid], [original.href + '#foreign', valid],
    [original.href.replace('https:', 'http:'), valid], [original.href.replace(original.hostname, 'api.foreign.invalid'), valid],
    ['https://' + new URL(runtimeUrl).hostname + '/sql', valid], ['https://api.sleeper.app/v1/user/cp24_offline', {}],
    ['https://example.invalid/', {}],
  ];
  for (const [input, init] of probes) await expect(fixture.fetch(input, init)).rejects.toThrow('Unapproved control fixture acquisition.');
  expect(transport).not.toHaveBeenCalled();
  expect(fixture.counts()).toEqual({ prerequisiteGets: 0, measuredGets: 0, forbiddenGets: probes.length });
});

it('matches Request inputs using effective method and headers while retaining the existing synthetic Sleeper path', async () => {
  const transport = vi.fn<typeof fetch>(async () => sqlResponse()), fixture = await fixtureFetch(transport, 'prerequisite');
  const signal = new AbortController().signal;
  const request = new Request(endpoint(), { method: 'POST', headers: { 'Neon-Connection-String': runtimeUrl }, signal });
  await fixture.fetch(request); expect(transport.mock.calls[0][0]).toBe(request); expect(transport.mock.calls[0][1]).toBeUndefined();
  await expect(fixture.fetch(request, { method: 'GET' })).rejects.toThrow('Unapproved control fixture acquisition.');
  await expect(fixture.fetch(request, { headers: {} })).rejects.toThrow('Unapproved control fixture acquisition.');
  const response = await fixture.fetch('https://api.sleeper.app/v1/user/cp24_offline');
  expect(await response.json()).toMatchObject({ user_id: '800000000000000001', username: 'cp24_offline' });
  expect(transport).toHaveBeenCalledOnce();
  expect(fixture.counts()).toEqual({ prerequisiteGets: 1, measuredGets: 0, forbiddenGets: 2 });
});

it('rejects custom driver endpoint and fetch overrides without forwarding credentials or mutating driver settings', () => {
  const originalEndpoint = neonConfig.fetchEndpoint;
  for (const override of ['https://custom.invalid/sql', () => 'https://custom.invalid/sql']) {
    neonConfig.fetchEndpoint = override;
    expect(() => createBackendControlsDatabaseFetchGuard(runtimeUrl)).toThrow('Unsupported control database transport.');
    expect(neonConfig.fetchEndpoint).toBe(override);
  }
  neonConfig.fetchEndpoint = originalEndpoint;
  neonConfig.fetchFunction = vi.fn();
  expect(() => createBackendControlsDatabaseFetchGuard(runtimeUrl)).toThrow('Unsupported control database transport.');
});

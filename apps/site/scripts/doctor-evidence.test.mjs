import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectRouteEvidence,
  evaluateRouteEvidence,
  evaluateWorkflowEvidence,
  redactDoctorDetail,
} from './doctor-evidence.mjs';

const intendedSha = '430718053b905cde87d88a7c51af3e74cfa53b5c';
const otherSha = 'b'.repeat(40);
const productionOrigin = 'https://www.league1fantasy.com';
const expectedUrl = `${productionOrigin}/matchups`;
const servers = [];

function workflow(overrides = {}) {
  return {
    workflowName: 'verify', headSha: intendedSha, status: 'completed',
    conclusion: 'success', databaseId: 10, ...overrides,
  };
}

function command(runs, overrides = {}) {
  return { ok: true, stdout: JSON.stringify(runs), stderr: '', ...overrides };
}

// These are existing shell attributes, with no application fixture route or flag.
function page(leagueName = 'League One', path = '/matchups') {
  return `<!doctype html><html><head><title>Matchups · League One</title></head><body>
    <header><a class="brand" href="${path}" aria-label="${leagueName} home">Home</a>
      <button type="button" aria-label="Choose league, current ${leagueName}">Choose league</button>
      <nav><a href="${path}" aria-current="page">Matchups</a></nav></header>
    <main><h1>Matchups</h1></main></body></html>`;
}

function route(overrides = {}) {
  return {
    available: true, url: expectedUrl, status: 200, redirected: false,
    contentType: 'text/html; charset=utf-8', body: page(), ...overrides,
  };
}

async function serve(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture listener has no port.');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('Doctor workflow evidence', () => {
  it('requires a completed successful verify workflow for the exact intended SHA', () => {
    expect(evaluateWorkflowEvidence(command([workflow()]), intendedSha))
      .toMatchObject({ status: 'Healthy', reason: 'success' });
  });

  it.each(['failure', 'cancelled', 'timed_out', 'skipped', 'action_required', 'stale', 'neutral'])(
    'rejects an exact-SHA %s conclusion', (conclusion) => {
      expect(evaluateWorkflowEvidence(command([workflow({ conclusion })]), intendedSha))
        .toMatchObject({ status: 'Unhealthy', reason: 'failure' });
    },
  );

  it('does not treat successful verification of another commit as current evidence', () => {
    expect(evaluateWorkflowEvidence(command([workflow({ headSha: otherSha })]), intendedSha))
      .toMatchObject({ status: 'Unhealthy', reason: 'wrong-commit' });
  });

  it.each(['queued', 'in_progress', 'waiting', 'pending', 'requested'])(
    'reports %s exact-SHA evidence as still running, not healthy', (status) => {
      expect(evaluateWorkflowEvidence(command([workflow({ status, conclusion: '' })]), intendedSha))
        .toMatchObject({ status: 'Unverified', reason: 'running' });
    },
  );

  it('does not allow an older success to mask a newer failed run, regardless of array order', () => {
    const latest = workflow({ databaseId: 12, conclusion: 'failure' });
    const previous = workflow({ databaseId: 11 });
    for (const runs of [[previous, latest], [latest, previous]]) {
      expect(evaluateWorkflowEvidence(command(runs), intendedSha))
        .toMatchObject({ status: 'Unhealthy', reason: 'failure' });
    }
  });

  it('reports a newer exact-SHA rerun as running despite an older success', () => {
    expect(evaluateWorkflowEvidence(command([
      workflow(), workflow({ databaseId: 11, status: 'in_progress', conclusion: '' }),
    ]), intendedSha)).toMatchObject({ status: 'Unverified', reason: 'running' });
  });

  it('uses the intended commit and workflow even when unrelated runs have larger IDs', () => {
    expect(evaluateWorkflowEvidence(command([
      workflow({ databaseId: 30, headSha: otherSha, conclusion: 'failure' }),
      workflow({ databaseId: 29, workflowName: 'unrelated', conclusion: 'failure' }),
      workflow(),
    ]), intendedSha)).toMatchObject({ status: 'Healthy', reason: 'success' });
  });

  it.each([{ runs: [] }, { runs: [workflow({ workflowName: 'unrelated' })] }])(
    'reports absent intended-workflow evidence', ({ runs }) => {
      expect(evaluateWorkflowEvidence(command(runs), intendedSha))
        .toMatchObject({ status: 'Unverified', reason: 'absent' });
    },
  );

  it('rejects failed CLI/API requests even when stdout contains a successful run', () => {
    expect(evaluateWorkflowEvidence(command([workflow()], { ok: false }), intendedSha))
      .toMatchObject({ status: 'Unverified', reason: 'unavailable' });
  });

  it.each(['', 'not JSON', '{}', 'null', '[null]'])(
    'keeps malformed or missing API payload %j unverified', (stdout) => {
      expect(evaluateWorkflowEvidence({ ok: true, stdout }, intendedSha))
        .toMatchObject({ status: 'Unverified', reason: 'unavailable' });
    },
  );

  it.each([
    ['missing SHA', { headSha: undefined }],
    ['short SHA', { headSha: intendedSha.slice(0, 7) }],
    ['unknown status', { status: 'invented' }],
    ['missing conclusion', { conclusion: undefined }],
    ['unknown conclusion', { conclusion: 'invented' }],
    ['missing run ID', { databaseId: undefined }],
    ['non-numeric run ID', { databaseId: '10' }],
    ['fractional run ID', { databaseId: 10.5 }],
  ])('does not claim health with %s metadata', (_label, overrides) => {
    expect(evaluateWorkflowEvidence(command([workflow(overrides)]), intendedSha))
      .toMatchObject({ status: 'Unverified', reason: 'unavailable' });
  });

  it.each(['', intendedSha.slice(0, 7)])('requires an available full intended SHA', (sha) => {
    expect(evaluateWorkflowEvidence(command([workflow()]), sha))
      .toMatchObject({ status: 'Unverified', reason: 'unavailable' });
  });
});

describe('Doctor public-route evidence', () => {
  it.each([
    ['League One', '/matchups'], ['League Two', '/league2/matchups'],
  ])('accepts the exact %s route with its existing active shell markers', (leagueName, path) => {
    const url = `${productionOrigin}${path}`;
    expect(evaluateRouteEvidence(route({ url, body: page(leagueName, path) }), url, leagueName))
      .toMatchObject({ status: 'Healthy', reason: 'success' });
  });

  it.each([301, 302, 303, 307, 308])('rejects HTTP %s without accepting a marker-bearing body', (status) => {
    expect(evaluateRouteEvidence(route({ status }), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Unhealthy', reason: 'redirect' });
  });

  it('rejects a redirect that eventually returns to the expected URL', () => {
    expect(evaluateRouteEvidence(route({ redirected: true }), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Unhealthy', reason: 'redirect' });
  });

  it.each([
    ['origin', 'https://unrelated.example.invalid/matchups'],
    ['scheme', 'http://www.league1fantasy.com/matchups'],
    ['port', 'https://www.league1fantasy.com:444/matchups'],
    ['path', `${productionOrigin}/league2/matchups`],
    ['path prefix', `${productionOrigin}/matchups/unrelated`],
    ['trailing slash', `${productionOrigin}/matchups/`],
    ['query', `${expectedUrl}?week=2`],
    ['fragment', `${expectedUrl}#unrelated`],
  ])('rejects a wrong final %s even with correct markers', (_label, url) => {
    expect(evaluateRouteEvidence(route({ url }), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Unhealthy', reason: 'wrong-url' });
  });

  it.each([400, 401, 403, 404])('rejects HTTP %s instead of accepting its body markers', (status) => {
    expect(evaluateRouteEvidence(route({ status }), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Unhealthy', reason: 'failure' });
  });

  it('keeps service unavailability distinct from a failed route', () => {
    expect(evaluateRouteEvidence(route({ status: 503 }), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Unverified', reason: 'unavailable' });
  });

  it.each([
    ['unavailable request', { available: false }],
    ['missing URL', { url: undefined }],
    ['malformed URL', { url: 'not a URL' }],
    ['missing status', { status: undefined }],
    ['missing redirect flag', { redirected: undefined }],
    ['missing content type', { contentType: undefined }],
    ['missing body', { body: undefined }],
  ])('keeps %s unverified', (_label, overrides) => {
    expect(evaluateRouteEvidence(route(overrides), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Unverified', reason: 'unavailable' });
  });

  it('does not interpret JSON containing copied HTML as a healthy page', () => {
    expect(evaluateRouteEvidence(route({ contentType: 'application/json' }), expectedUrl, 'League One').status)
      .not.toBe('Healthy');
  });

  it.each([
    ['plain text', '<html><body>League One</body></html>'],
    ['shared title', '<html><head><title>Matchups · League One</title></head><body>Unrelated page</body></html>'],
    ['other league', page('League Two', '/league2/matchups')],
    ['wrong brand href', page().replace('class="brand" href="/matchups"', 'class="brand" href="/league2/matchups"')],
    ['missing active navigation', page().replace('aria-current="page"', 'aria-current="false"')],
    ['wrong selected league', page().replace('Choose league, current League One', 'Choose league, current League Two')],
    ['comment', `<!-- ${page()} -->`],
    ['script', `<script type="text/javascript">${JSON.stringify(page())}</script>`],
    ['style', `<style>${page()}</style>`],
    ['template', `<template>${page()}</template>`],
    ['nested template', `<template><template>Placeholder</template>${page()}</template>`],
    ['hidden subtree', `<div hidden>${page()}</div>`],
    ['inert subtree', `<div inert>${page()}</div>`],
    ['aria-hidden subtree', `<div aria-hidden="true">${page()}</div>`],
    ['display-none subtree', `<div style="display:none">${page()}</div>`],
    ['visibility-hidden subtree', `<div style="visibility:hidden">${page()}</div>`],
    ['content-visibility-hidden subtree', `<div style="content-visibility:hidden">${page()}</div>`],
    ['textarea', `<textarea>${page()}</textarea>`],
    ['plaintext with a fake closing tag', `<plaintext></plaintext>${page()}`],
    ['title contents', `<title>${page().replace(/<title>[^<]*<\/title>/, '')}</title>`],
    ['attribute contents', `<div data-example='${page()}'>Unrelated page</div>`],
    ['unclosed attribute', `<div data-example='${page()}`],
    ['unclosed script attribute', `<script title='${page()}`],
  ])('rejects a %s marker collision', (_label, body) => {
    expect(evaluateRouteEvidence(route({ body }), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Unhealthy', reason: 'marker-mismatch' });
  });

  it('recognizes real markers after unrelated inert content', () => {
    const body = `<script>${JSON.stringify(page('League Two', '/league2/matchups'))}</script>
      <!-- irrelevant League Two -->${page()}`;
    expect(evaluateRouteEvidence(route({ body }), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Healthy', reason: 'success' });
  });

  it.each([
    ['deep nesting', `<div hidden>${'<i>'.repeat(100_000)}${page()}${'</i>'.repeat(100_000)}</div>`],
    ['unmatched closing tags', `<div hidden>${'<i>'.repeat(40_000)}${'</unmatched>'.repeat(40_000)}${page()}</div>`],
  ])('bounds evaluation of %s without losing inherited hidden state', (_label, body) => {
    expect(body.length).toBeLessThan(1_000_000);
    const start = performance.now();
    const evidence = evaluateRouteEvidence(route({ body }), expectedUrl, 'League One');
    const elapsed = performance.now() - start;
    expect(evidence).toMatchObject({ status: 'Unhealthy', reason: 'marker-mismatch' });
    // A generous diagnostic budget catches the reproduced multi-second quadratic scan.
    expect(elapsed).toBeLessThan(2_500);
  });

  it('restores the correct inherited state after closing repeated and mismatched tags', () => {
    const body = `<div hidden><div><i>hidden</div>${page()}</div>${page()}`;
    expect(evaluateRouteEvidence(route({ body }), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Healthy', reason: 'success' });
  });

  it.each([
    ['healthy route', route(), 'Healthy', 'success'],
    ['redirected route', route({ redirected: true }), 'Unhealthy', 'redirect'],
    ['colliding marker', route({ body: '<title>League One</title>' }), 'Unhealthy', 'marker-mismatch'],
    ['unavailable route', { available: false }, 'Unverified', 'unavailable'],
  ])('uses the evaluators in the actual Doctor checkRoute function for %s', async (_label, evidence, status, reason) => {
    const source = readFileSync(new URL('./doctor.mjs', import.meta.url), 'utf8');
    const start = source.indexOf('async function checkRoute(');
    const end = source.indexOf("\nawait checkRoute('League One", start);
    expect(start >= 0 && end > start).toBe(true);
    const collector = vi.fn(async () => evidence);
    const reports = [];

    await runInNewContext(`${source.slice(start, end)}\ncheckRoute('Fixture route', '/matchups', 'League One')`, {
      productionUrl: productionOrigin,
      collectRouteEvidence: collector,
      evaluateRouteEvidence,
      add: (observedStatus, area, detail) => reports.push({ status: observedStatus, area, detail }),
    });

    expect(collector).toHaveBeenCalledExactlyOnceWith(expectedUrl);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ status, area: 'Fixture route' });
    expect(reports[0].detail.startsWith(`${reason}:`)).toBe(true);
  });
});

describe('Doctor read-only route collection', () => {
  it('makes one credential-free GET and passes final response metadata to the evaluator', async () => {
    const fetchImpl = vi.fn(async () => ({
      url: expectedUrl, status: 200, redirected: false,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => page(),
    }));

    const evidence = await collectRouteEvidence(expectedUrl, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(expectedUrl);
    expect(options).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
    expect(options.body).toBeUndefined();
    expect(new Headers(options.headers).has('authorization')).toBe(false);
    expect(new Headers(options.headers).has('x-rapidapi-key')).toBe(false);
    expect(evaluateRouteEvidence(evidence, expectedUrl, 'League One'))
      .toMatchObject({ status: 'Healthy', reason: 'success' });
  });

  it('does not follow a real HTTP redirect or request its destination', async () => {
    const requests = [];
    const origin = await serve((request, response) => {
      requests.push({ method: request.method, path: request.url });
      if (request.url === '/matchups') {
        response.writeHead(302, { location: '/destination', 'content-type': 'text/html' });
      } else response.writeHead(200, { 'content-type': 'text/html' });
      response.end(page());
    });
    const url = `${origin}/matchups`;

    const evidence = await collectRouteEvidence(url);

    expect(evaluateRouteEvidence(evidence, url, 'League One'))
      .toMatchObject({ status: 'Unhealthy', reason: 'redirect' });
    expect(requests).toEqual([{ method: 'GET', path: '/matchups' }]);
  });

  it.each([
    ['League One', '/matchups'], ['League Two', '/league2/matchups'],
  ])('accepts a real direct HTTP %s fixture', async (leagueName, path) => {
    const requests = [];
    const origin = await serve((request, response) => {
      requests.push(request.url);
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(page(leagueName, path));
    });
    const url = `${origin}${path}`;

    expect(evaluateRouteEvidence(await collectRouteEvidence(url), url, leagueName))
      .toMatchObject({ status: 'Healthy', reason: 'success' });
    expect(requests).toEqual([path]);
  });

  it.each(['network', 'response body'])('reports %s errors as unavailable without retrying', async (stage) => {
    const fetchImpl = vi.fn(async () => {
      if (stage === 'network') throw new Error('Controlled network failure');
      return {
        url: expectedUrl, status: 200, redirected: false,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => { throw new Error('Controlled body read failure'); },
      };
    });

    expect(evaluateRouteEvidence(await collectRouteEvidence(expectedUrl, { fetchImpl }), expectedUrl, 'League One'))
      .toMatchObject({ status: 'Unverified', reason: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps credential-bearing errors, URLs, and bodies out of captured diagnostic output', async () => {
    const planted = ['fixture-password-doctor', 'fixture-bearer-doctor', 'fixture-key-doctor', 'fixture-query-doctor'];
    const privateUrl = `https://fixture-user:${planted[0]}@unrelated.example.invalid/matchups?bypass=${planted[3]}`;
    const databaseUrl = ['postgresql:', '//fixture-user:', planted[0], '@database.example.invalid/fixture'].join('');
    const errorText = `Failed at ${privateUrl}; authorization: Bearer ${planted[1]}; X-RapidAPI-Key: ${planted[2]}; ${databaseUrl}`;
    const stdout = [];
    const stderr = [];
    vi.spyOn(console, 'log').mockImplementation((...values) => stdout.push(values.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...values) => stderr.push(values.join(' ')));
    const unavailable = await collectRouteEvidence(expectedUrl, {
      fetchImpl: async () => { throw new Error(errorText); },
    });
    const results = [
      evaluateWorkflowEvidence(command([workflow()], { ok: false, stderr: errorText }), intendedSha),
      evaluateWorkflowEvidence(command([workflow({ workflowName: errorText })]), intendedSha),
      evaluateRouteEvidence(route({ url: privateUrl, body: errorText }), expectedUrl, 'League One'),
      evaluateRouteEvidence(route({ body: errorText }), expectedUrl, 'League One'),
      evaluateRouteEvidence(unavailable, expectedUrl, 'League One'),
    ];
    for (const result of results) console.log(`[${result.status}] ${result.detail}`);
    const captured = [...stdout, ...stderr].join('\n');

    expect(captured.length > 0).toBe(true);
    expect(results.every((result) => result.status !== 'Healthy')).toBe(true);
    // Boolean assertions prevent a failed test from printing the planted material.
    expect(planted.some((value) => captured.includes(value))).toBe(false);
    expect(captured.includes('fixture-user')).toBe(false);
    expect(planted.some((value) => JSON.stringify(unavailable).includes(value))).toBe(false);
  });
});

describe('Doctor diagnostic redaction', () => {
  it.each(['double-quoted token', 'single-quoted API key', 'JSON password'])(
    'redacts a %s assignment', (form) => {
      const planted = ['doctor', 'quoted', 'credential', 'fixture'].join('-');
      const detail = form === 'double-quoted token' ? `token="${planted}"`
        : form === 'single-quoted API key' ? `X-RapidAPI-Key:'${planted}'`
          : JSON.stringify({ password: planted });
      const redacted = redactDoctorDetail(detail);

      // Do not include a credential fixture in assertion output if redaction fails.
      expect(redacted.includes(planted)).toBe(false);
      expect(redacted.includes('[redacted')).toBe(true);
    },
  );

  it('redacts URL credentials and parameters, authorization schemes, tokens, and assigned secrets', () => {
    const planted = ['doctor-url-password', 'doctor-query-value', 'doctor-bearer-value', 'doctor-basic-value',
      'doctor-assigned-value', ['ghp', 'doctorfixturecredential0123456789'].join('_'),
      ['github', 'pat', 'doctorfixturecredential0123456789'].join('_')];
    const urls = [
      ['postgresql:', '//fixture-user:', planted[0], '@database.example.invalid/fixture'].join(''),
      ['https:', '//fixture-user:', planted[0], '@preview.example.invalid/path?token=', planted[1]].join(''),
    ];
    const detail = [...urls, `Bearer ${planted[2]}`, `Basic ${planted[3]}`, `X-RapidAPI-Key=${planted[4]}`,
      `password=${planted[4]}`, `CRON_SECRET=${planted[4]}`, planted[5], planted[6]].join('; ');
    const redacted = redactDoctorDetail(detail);

    expect(planted.some((value) => redacted.includes(value))).toBe(false);
    expect(redacted.includes('fixture-user')).toBe(false);
    expect(redacted.includes('database.example.invalid')).toBe(false);
    expect(redacted.includes('[redacted')).toBe(true);
  });
});

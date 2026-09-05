import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type RequestListener, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeBrowserTarget,
  markerPath,
  selectBrowserTarget,
  verifyBrowserTarget,
  writeLocalBuildMarker,
  type LocalBrowserTarget,
} from './browser-target';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const requestOnlyTest = 'former participant routes return 404 and are never redirected$';
const removedRoutes = [
  '/owners', '/owners/1', '/owners/1/transactions',
  '/league2/owners', '/league2/owners/1', '/league2/owners/1/transactions',
];
const directories: string[] = [];
const servers: Server[] = [];
const tcpServers: TcpServer[] = [];
const tcpSockets = new Set<Socket>();
const nonLoopbackIpv4 = Object.values(networkInterfaces()).flat()
  .find((address) => address?.family === 'IPv4' && !address.internal)?.address;
const scopedIpv6Host = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? []).flatMap((address) => address.family === 'IPv6' && address.scopeid
    ? [`${address.address}%${process.platform === 'win32' ? address.scopeid : name}`]
    : []))[0];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'l1-browser-provenance-'));
  directories.push(directory);
  return directory;
}

async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not receive a TCP port.');
  return { port: String(address.port), baseURL: `http://localhost:${address.port}` };
}

async function serveNonHttp(host: string, silent: boolean, ipv6Only?: boolean) {
  const server = createTcpServer((socket) => {
    tcpSockets.add(socket);
    socket.once('close', () => tcpSockets.delete(socket));
    socket.on('error', () => socket.destroy());
    if (!silent) socket.end('This listener does not speak HTTP.\r\n');
  });
  tcpServers.push(server);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen({ port: 0, host, ipv6Only }, resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not receive a TCP port.');
  return { port: String(address.port), baseURL: `http://localhost:${address.port}` };
}

function checkout(port: string) {
  const directory = temporaryDirectory();
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: directory, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '--quiet');
  writeFileSync(join(directory, '.gitignore'), '.next/\n');
  writeFileSync(join(directory, 'fixture.txt'), 'Current checkout fixture.\n');
  git('add', '.gitignore', 'fixture.txt');
  git('-c', 'user.name=Browser test fixture', '-c', 'user.email=browser-fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Create isolated browser fixture');
  mkdirSync(join(directory, '.next'));
  writeFileSync(join(directory, '.next/BUILD_ID'), 'current-fixture-build\n');
  const target = selectBrowserTarget({ PORT: port }, directory) as LocalBrowserTarget;
  return { directory, target, gitSha: git('rev-parse', 'HEAD') };
}

async function runPlaywright(env: { BASE_URL?: string; PORT?: string }) {
  const directory = temporaryDirectory();
  const buildTrap = join(directory, 'build-attempted');
  // A regression must never trigger a real build while running the unit suite.
  // The real config still owns webServer setup; PATH only records accidental starts.
  writeFileSync(join(directory, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'),
    process.platform === 'win32'
      ? '@echo off\r\necho build-attempted>"%L1_BROWSER_BUILD_TRAP%"\r\nexit /b 93\r\n'
      : '#!/bin/sh\nprintf build-attempted > "$L1_BROWSER_BUILD_TRAP"\nexit 93\n',
    { mode: 0o755 });
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !['PATH', 'BASE_URL', 'CI', 'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_DIR',
      'PLAYWRIGHT_JSON_OUTPUT_FILE'].includes(name.toUpperCase())));
  const reportPath = join(directory, 'report.json');
  const result = await new Promise<{ code: number | string | null; stdout: string; stderr: string }>((resolveRun) => {
    execFile(process.execPath, [
      require.resolve('@playwright/test/cli'), 'test', '--config', join(siteDir, 'playwright.config.ts'),
      'smoke.spec.ts', '--grep', requestOnlyTest, '--workers', '1', '--retries', '0',
      '--reporter', 'json', '--output', join(directory, 'results'),
    ], {
      cwd: siteDir, windowsHide: true, timeout: 20_000,
      env: {
        ...inherited, ...env, PATH: `${directory}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
        NODE_ENV: 'test',
        L1_BROWSER_BUILD_TRAP: buildTrap, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
      },
    }, (error, stdout, stderr) => resolveRun({ code: error ? error.code ?? null : 0, stdout, stderr }));
  });
  return {
    ...result, buildAttempted: existsSync(buildTrap),
    report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : undefined,
  };
}

function expectOccupiedPortFailure(result: Awaited<ReturnType<typeof runPlaywright>>, port: string) {
  const errors = result.report?.errors.map((error: { message: string }) => error.message).join('\n') ?? '';
  const output = `${result.stdout}\n${result.stderr}\n${errors}`;
  const evidence = JSON.stringify({
    code: result.code, buildAttempted: result.buildAttempted, stats: result.report?.stats, errors,
  });
  expect(result.code, evidence).toBe(1);
  expect(result.buildAttempted, evidence).toBe(false);
  expect(result.report?.stats, evidence).toMatchObject({ expected: 0, unexpected: 0, flaky: 0, skipped: 0 });
  expect(output, evidence).toContain(`Local browser port ${port} is occupied; build and browser feature tests were not started.`);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolveClose, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolveClose());
  })));
  for (const socket of tcpSockets) socket.destroy();
  await Promise.all(tcpServers.splice(0).map((server) => new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  })));
  // Only paths returned by mkdtemp above are eligible for cleanup.
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('local browser target provenance', () => {
  it('passes a genuinely free port through every prebuild probe in the actual Playwright lifecycle', async () => {
    const reservation = createTcpServer();
    await new Promise<void>((resolveListen, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, resolveListen);
    });
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not receive a TCP port.');
    const port = String(address.port);
    await new Promise<void>((resolveClose, reject) => {
      reservation.close((error) => error ? reject(error) : resolveClose());
    });

    const result = await runPlaywright({ PORT: port });
    const output = `${result.stdout}\n${result.stderr}`;

    // Reaching the trap proves that all real prebuild probes accepted the free port.
    // The trap stops here so this unit test never performs a production build.
    expect(result.buildAttempted, output).toBe(true);
    expect(result.code, output).toBe(1);
    expect(result.report?.errors.map((error: { message: string }) => error.message).join('\n'))
      .toContain('Exit code: 93');
    expect(result.report?.stats).toMatchObject({ expected: 0, unexpected: 0, flaky: 0, skipped: 0 });
    expect(output).not.toContain(`Local browser port ${port} is occupied`);
    expect(output).not.toContain(`Cannot prove local browser port ${port} is free`);
  }, 30_000);

  it.each([200, 404, 500])('rejects an occupied HTTP %s server through the actual Playwright lifecycle before building or running feature tests', async (status) => {
    const server = await serve((_request, response) => {
      response.writeHead(status, { 'content-type': 'text/html' });
      response.end('<html><body>Unrelated application</body></html>');
    });
    const result = await runPlaywright({ PORT: server.port });

    expectOccupiedPortFailure(result, server.port);
  }, 30_000);

  it.each([
    ['127.0.0.1', false], ['::1', false],
    ['127.0.0.1', true], ['::1', true],
  ] as const)('rejects an occupied non-HTTP listener on %s (silent: %s) through the actual Playwright lifecycle before building or running feature tests', async (host, silent) => {
    const server = await serveNonHttp(host, silent);
    const result = await runPlaywright({ PORT: server.port });

    expectOccupiedPortFailure(result, server.port);
  }, 30_000);

  it.each([
    ['0.0.0.0', false], ['::', true],
  ] as const)('rejects an occupied non-HTTP wildcard listener on %s (IPv6-only: %s) before building or running feature tests', async (host, ipv6Only) => {
    const server = await serveNonHttp(host, false, ipv6Only);
    const result = await runPlaywright({ PORT: server.port });

    expectOccupiedPortFailure(result, server.port);
  }, 30_000);

  it.skipIf(!nonLoopbackIpv4)('rejects a non-HTTP listener bound only to a non-loopback local IPv4 interface before building or running feature tests', async () => {
    const server = await serveNonHttp(nonLoopbackIpv4!, false);
    const result = await runPlaywright({ PORT: server.port });

    expectOccupiedPortFailure(result, server.port);
  }, 30_000);

  it.skipIf(!scopedIpv6Host)('rejects a non-HTTP listener bound to a scoped local IPv6 interface before building or running feature tests', async () => {
    const server = await serveNonHttp(scopedIpv6Host!, false, true);
    const result = await runPlaywright({ PORT: server.port });

    expectOccupiedPortFailure(result, server.port);
  }, 30_000);

  it.each([
    ['stale checkout', 'checkout', 'C:/different-checkout/apps/site'],
    ['stale Git revision', 'gitSha', '0'.repeat(40)],
    ['wrong build', 'buildId', 'previous-fixture-build'],
    ['previous verification run', 'runId', 'previous-run'],
    ['different working tree state', 'dirty', true],
    ['different source contents', 'sourceDigest', '0'.repeat(64)],
  ])('rejects a marker from a %s before reporting verified provenance', async (_label, field, value) => {
    let marker = '';
    const requests: string[] = [];
    const server = await serve((request, response) => {
      requests.push(request.url!);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(marker);
    });
    const fixture = checkout(server.port);
    marker = JSON.stringify({ ...writeLocalBuildMarker(fixture.target), [field as string]: value });
    const reports: string[] = [];

    await expect(verifyBrowserTarget(fixture.target, (message) => reports.push(message)))
      .rejects.toThrow(`Local browser provenance failed for ${server.baseURL}`);
    expect(requests).toEqual([markerPath]);
    expect(reports).toEqual([`${describeBrowserTarget(fixture.target)}`]);
    expect(reports.join('\n')).not.toContain('provenance verified');
  });

  it('accepts a generated marker for the current checkout and build and reports their exact identities', async () => {
    let markerFile = '';
    const requests: string[] = [];
    const server = await serve((request, response) => {
      requests.push(request.url!);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(readFileSync(markerFile));
    });
    const fixture = checkout(server.port);
    const identity = writeLocalBuildMarker(fixture.target);
    markerFile = join(fixture.directory, '.next/static/browser-verification.json');
    expect(JSON.parse(readFileSync(markerFile, 'utf8'))).toEqual({
      runId: fixture.target.runId, checkout: realpathSync(fixture.directory),
      gitSha: fixture.gitSha, dirty: false, buildId: 'current-fixture-build',
      sourceDigest: fixture.target.source.digest,
    });
    const reports: string[] = [];

    await verifyBrowserTarget(fixture.target, (message) => reports.push(message));

    expect(requests).toEqual([markerPath]);
    expect(reports).toEqual([
      `Browser target: ${server.baseURL}/ | fresh local production build`,
      `Local browser provenance verified: checkout=${identity.checkout} | Git SHA=${fixture.gitSha} | clean working tree | build=current-fixture-build | run=${fixture.target.runId}`,
    ]);
  });

  it.each([false, true])('rejects source edits after marker generation (checkout already dirty: %s)', async (alreadyDirty) => {
    const requests: string[] = [];
    let marker = '';
    const server = await serve((request, response) => {
      requests.push(request.url!);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(marker);
    });
    const fixture = checkout(server.port);
    if (alreadyDirty) writeFileSync(join(fixture.directory, 'fixture.txt'), 'First uncommitted edit.\n');
    const target = selectBrowserTarget({ PORT: server.port }, fixture.directory) as LocalBrowserTarget;
    marker = JSON.stringify(writeLocalBuildMarker(target));
    writeFileSync(join(fixture.directory, 'fixture.txt'), 'Changed after the build.\n');
    const reports: string[] = [];

    await expect(verifyBrowserTarget(target, (message) => reports.push(message)))
      .rejects.toThrow('checkout changed during verification');
    expect(() => writeLocalBuildMarker(target)).toThrow('checkout changed during verification');
    expect(requests).toEqual([]);
    expect(reports).toEqual([describeBrowserTarget(target)]);
  });

  it('preserves intentional BASE_URL mode through the actual config without a local build or marker request', async () => {
    const requests: string[] = [];
    const server = await serve((request, response) => {
      requests.push(request.url!);
      response.writeHead(404);
      response.end('Intentional external-target fixture');
    });
    const result = await runPlaywright({ BASE_URL: server.baseURL, PORT: 'invalid-and-unused' });

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.report?.stats).toMatchObject({ expected: 1, unexpected: 0, flaky: 0, skipped: 0 });
    expect(result.buildAttempted).toBe(false);
    expect(requests).toEqual(removedRoutes);
    expect(result.stdout).toContain(`Browser target: ${server.baseURL}/ | explicit BASE_URL; local build provenance not asserted`);
    expect(result.stdout).not.toContain('Local browser provenance verified:');
    expect(result.report?.config.metadata).not.toHaveProperty('browserTarget');
  }, 30_000);

  it('allows explicit preview selection without reading a local checkout or claiming local provenance', async () => {
    const baseURL = 'https://league-one-exact-commit.vercel.app/league2';
    const target = selectBrowserTarget({ BASE_URL: ` ${baseURL} `, PORT: 'unused' }, join(temporaryDirectory(), 'absent'));
    const reports: string[] = [];

    await verifyBrowserTarget(target, (message) => reports.push(message));

    expect(target).toEqual({ mode: 'explicit', baseURL });
    expect(reports).toEqual([`Browser target: ${baseURL} | explicit BASE_URL; local build provenance not asserted`]);
  });

  it('reports the selected origin and path while redacting credentials, query values, and fragments', async () => {
    const baseURL = 'https://fixture-user:fixture-password@preview.example.invalid/league2?bypass=fixture-secret#fixture-fragment';
    const target = selectBrowserTarget({ BASE_URL: baseURL }, 'unused');
    const reports: string[] = [];

    await verifyBrowserTarget(target, (message) => reports.push(message));

    expect(target.baseURL).toBe(baseURL);
    expect(reports).toEqual([
      'Browser target: https://preview.example.invalid/league2 (query/fragment omitted) | explicit BASE_URL; local build provenance not asserted',
    ]);
    expect(reports.join('\n')).not.toMatch(/fixture-user|fixture-password|fixture-secret|fixture-fragment/);
  });

  it('passes configured port 80 to the local server even when URL normalization omits it', async () => {
    vi.stubEnv('BASE_URL', '');
    vi.stubEnv('PORT', '80');
    vi.resetModules();

    const { default: config } = await import('../playwright.config');

    expect(config.use?.baseURL).toBe('http://localhost:80');
    expect(config.webServer).toMatchObject({ env: { PORT: '80' }, reuseExistingServer: false });
  });
});

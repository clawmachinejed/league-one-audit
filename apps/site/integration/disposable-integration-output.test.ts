import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DISPOSABLE_AUTHORIZATION, runDisposableIntegration, type IntegrationRunReceipt } from './disposable-integration';
import { FRESH_INSTALL_PROFILE } from './qualification-profile';

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), query: vi.fn(), spawn: vi.fn(), stop: vi.fn(), context: vi.fn(), evidence: vi.fn(), closure: vi.fn(),
  safe: vi.fn(), owner: vi.fn(), clean: vi.fn(), release: vi.fn(), end: vi.fn(),
  freshInitial: vi.fn(), freshEvidence: vi.fn(),
  api: { validateTarget: vi.fn(), createBranch: vi.fn(), rotateOwnerCredentials: vi.fn(),
    getOwnerConnectionUri: vi.fn(), ownedReceipts: vi.fn(), reconcileCreation: vi.fn(), deleteBranch: vi.fn() },
}));
vi.mock('./fresh-install-evidence', async importOriginal => ({
  ...await importOriginal<typeof import('./fresh-install-evidence')>(),
  writeFreshInstallInitialEvidence: mocks.freshInitial, readFreshInstallEvidence: mocks.freshEvidence,
}));
vi.mock('./qualification-profile', async importOriginal => ({
  ...await importOriginal<typeof import('./qualification-profile')>(),
  createQualificationContext: mocks.context, validateQualificationArtifacts: mocks.evidence,
}));
vi.mock('@neondatabase/serverless', () => ({ Pool: mocks.pool }));
vi.mock('./disposable-neon-api', async importOriginal => ({
  ...await importOriginal<typeof import('./disposable-neon-api')>(),
  DisposableNeonApi: vi.fn(function () { return mocks.api; }),
}));
vi.mock('./neon-integration-harness', () => ({
  assertSafeIntegrationDatabase: mocks.safe, cleanIntegrationDatabase: mocks.clean, integrationEnvironment: vi.fn(),
}));
vi.mock('./integration-database-ownership', () => ({
  INTEGRATION_MUTEX: 'test-mutex', INTEGRATION_OWNER_ENV: 'PROJECTION_INTEGRATION_OWNER_PROOF',
  assertIntegrationOwner: mocks.owner,
}));
vi.mock('./integration-artifacts', () => ({
  createIntegrationArtifactDirectory: vi.fn(async () => resolve('test-results/mock-artifacts')),
  INTEGRATION_ARTIFACT_DIRECTORY_ENV: 'PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY',
}));
vi.mock('./integration-child-process', () => ({
  spawnIntegrationChild: mocks.spawn, stopIntegrationChildTree: mocks.stop,
  verifyIntegrationChildTreeClosed: mocks.closure,
}));

const environment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  NEON_TEST_AUTHORIZATION: DISPOSABLE_AUTHORIZATION, NEON_TEST_API_KEY: 'fictional-api-key',
  NEON_TEST_PROJECT_ID: 'new-test-project', NEON_TEST_PROJECT_NAME: 'league-one-integration-tests',
  NEON_TEST_PARENT_BRANCH_ID: 'br-empty-parent', NEON_TEST_PARENT_BRANCH_NAME: 'empty-test-parent',
  NEON_TEST_DATABASE: 'integration_test', NEON_TEST_OWNER_ROLE: 'neondb_owner',
};
const branch = { branchId: 'br-fictional-child', branchName: 'fictional-test-child' };
const ownerUri = (password: string) => `postgresql://neondb_owner:${password}@ep-fictional.neon.tech/integration_test?sslmode=require`;
const run = (output = vi.fn(), journal: (receipt: IntegrationRunReceipt) => Promise<void> = async () => {}) =>
  runDisposableIntegration({ environment, gitSha: 'a'.repeat(40),
    journal, signal: new AbortController().signal, output });

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks)) if (typeof mock === 'function') mock.mockReset();
  for (const mock of Object.values(mocks.api)) mock.mockReset();
  mocks.context.mockImplementation(async (_root, gitSha, runId, profile = 'full') => ({
    kind: 'integration-qualification-context-v1', profile, runId, gitSha,
    nonce: '00000000-0000-4000-8000-000000000002', profileDigest: 'b'.repeat(64),
    modules: [{ path: 'integration/example.integration-case.ts', sourceDigest: 'c'.repeat(64) }] }));
  mocks.evidence.mockResolvedValue({ profile: 'full', collected: 1, executed: 1, passed: 1, skipped: 0, filtered: 0, reportDigest: 'a'.repeat(64) });
  mocks.closure.mockResolvedValue('child-close');
  mocks.api.createBranch.mockResolvedValue(branch);
  mocks.api.ownedReceipts.mockReturnValue([branch]);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('role.rolname AS name')) return { rows: ['league_one_account', 'league_one_auth', 'league_one_runtime']
      .map((name, index) => ({ name, oid: String(17000 + index), rolcanlogin: true, rolsuper: false, rolcreatedb: false,
        rolcreaterole: false, rolreplication: false, rolinherit: false, rolbypassrls: false, has_memberships: false })) };
    if (sql.includes("current_setting('server_version')")) return { rows: [{ database: 'integration_test',
      owner: 'neondb_owner', session: 'neondb_owner', branch: branch.branchId,
      server_version: '18.6', server_version_num: '180006' }] };
    if (sql.includes('current_database() AS database')) return { rows: [{ database: 'integration_test',
      owner: 'neondb_owner', session: 'neondb_owner', branch: branch.branchId,
      schemas: 0, relations: 0, functions: 0, types: 0, roles: 0, sessions: 0 }] };
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ owned: true }] };
    if (sql.includes('backend_start::text')) return { rows: [{ pid: 12345, backendStart: 'fictional-start' }] };
    if (sql.includes('pg_advisory_unlock(')) return { rows: [{ unlocked: true }] };
    if (sql.includes('count(*)')) return { rows: [{ count: 0 }] };
    return { rows: [] };
  });
  mocks.pool.mockImplementation(function () {
    const client = Object.assign(new EventEmitter(), { query: mocks.query, release: mocks.release });
    return Object.assign(new EventEmitter(), { connect: vi.fn(async () => client), end: mocks.end });
  });
});

describe('closed fresh-install supervisor evidence and credentials', () => {
  function setupFresh() {
    mocks.api.getOwnerConnectionUri.mockResolvedValue(ownerUri('fictional-owner'));
    mocks.evidence.mockResolvedValue({ profile: FRESH_INSTALL_PROFILE, collected: 8, executed: 8, passed: 8,
      skipped: 0, filtered: 0, reportDigest: 'a'.repeat(64) });
    mocks.freshInitial.mockResolvedValue('e'.repeat(64));
    mocks.freshEvidence.mockImplementation(async () => {
      const [, empty] = mocks.freshInitial.mock.calls[0];
      return { initial: { ...empty, emptyObservedAt: empty.observedAt },
        installed: { observedAt: new Date().toISOString(), catalog: { postgresVersion: '180006' } } };
    });
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { pid: 12345 });
      setImmediate(() => child.emit('close', 0, null)); return child;
    });
  }
  const runFresh = (journal: (receipt: IntegrationRunReceipt) => Promise<void> = async () => {}, output = vi.fn()) =>
    runDisposableIntegration({ environment, gitSha: 'a'.repeat(40), profile: FRESH_INSTALL_PROFILE,
      journal, output, signal: new AbortController().signal });
  it('acknowledges original empty state before any role writes and revokes all three generated logins', async () => {
    setupFresh();
    const ready = Promise.withResolvers<void>(), acknowledge = Promise.withResolvers<void>();
    let held = false;
    const running = runFresh(async receipt => {
      if (receipt.freshInstall && !receipt.freshInstall.initialDigest && !held) { held = true; ready.resolve(); await acknowledge.promise; }
    });
    await ready.promise;
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('CREATE ROLE'))).toBe(false);
    acknowledge.resolve(); const result = await running;
    expect(result.passed).toBe(true);
    expect(mocks.spawn.mock.calls[0][2].env.ACCOUNT_FRESH_INSTALL_DATABASE_URL).toContain('league_one_account:');
    expect(mocks.spawn.mock.calls[0][2].env.PROJECTION_INTEGRATION_FRESH_INSTALL_INITIAL_DIGEST).toBe('e'.repeat(64));
    expect(mocks.query.mock.calls.some(([sql]) => sql === 'ALTER ROLE league_one_account NOLOGIN PASSWORD NULL')).toBe(true);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("'league_one_account') AND rolcanlogin"))).toBe(true);
    expect(result.receipt.testEvidence?.freshInstall?.initialDigest).toBe(result.receipt.freshInstall?.initialDigest);
    expect(result.receipt.freshInstall?.installedDigest).toMatch(/^[a-f0-9]{64}$/u);
  });
  it('redacts the extra account password and URL including split child output', async () => {
    setupFresh(); const output = vi.fn();
    mocks.spawn.mockImplementation((_command, _args, options) => {
      const uri = options.env.ACCOUNT_FRESH_INSTALL_DATABASE_URL, password = new URL(uri).password;
      const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
      const child = Object.assign(new EventEmitter(), { pid: 12345, stdout });
      setImmediate(() => { stdout.emit('data', password.slice(0, 16)); stdout.emit('data', password.slice(16) + ' ' + uri + '\n');
        stdout.emit('end'); child.emit('close', 0, null); }); return child;
    });
    const result = await runFresh(undefined, output);
    expect(result.passed).toBe(true); expect(output.mock.calls.flat().join('')).toBe('[REDACTED] [REDACTED_DATABASE_URL]\n');
    expect(JSON.stringify(result.receipt)).not.toContain('postgresql://');
  });
  it.each(['empty-ack', 'initial-artifact', 'installed-artifact', 'installed-version', 'account-revoke'])(
    'fails %s without weakening cleanup evidence', async fault => {
      setupFresh();
      if (fault === 'initial-artifact') mocks.freshInitial.mockRejectedValue(new Error('private filesystem failure'));
      if (fault === 'installed-artifact') mocks.freshEvidence.mockRejectedValue(new Error('invalid installed evidence'));
      if (fault === 'installed-version') {
        const prior = mocks.freshEvidence.getMockImplementation()!;
        mocks.freshEvidence.mockImplementation(async () => { const evidence = await prior(); evidence.installed.catalog.postgresVersion = '170006'; return evidence; });
      }
      if (fault === 'account-revoke') {
        const prior = mocks.query.getMockImplementation()!;
        mocks.query.mockImplementation(async (sql: string) => {
          if (sql === 'ALTER ROLE league_one_account NOLOGIN PASSWORD NULL') throw new Error('private revoke failure');
          return prior(sql);
        });
      }
      let rejected = false;
      const result = await runFresh(async receipt => {
        if (fault === 'empty-ack' && receipt.freshInstall && !rejected) { rejected = true; throw new Error('private journal failure'); }
      });
      expect(result.passed).toBe(false); expect(result.receipt.branchDeletionVerified).toBe(true);
      if (fault === 'empty-ack' || fault === 'initial-artifact') {
        expect(mocks.spawn).not.toHaveBeenCalled(); expect(result.receipt.schemaCleanupVerified).toBe(false);
      } else expect(result.receipt.schemaCleanupVerified).toBe(true);
      if (fault === 'empty-ack') expect(mocks.query.mock.calls.some(([sql]) => sql.includes('CREATE ROLE'))).toBe(false);
      if (fault === 'account-revoke') expect(result.receipt.credentialsRevoked).toBe(false);
      expect(JSON.stringify(result.receipt)).not.toContain('private ');
    });
});

describe('disposable runner owner credential redaction', () => {
  it.each(['fictional-owner-password', 'fictional@/:plus+percent%2Ftail'])
  ('registers the API owner password before forwarding child diagnostics: %s', async password => {
    const encoded = encodeURIComponent(password);
    const uri = ownerUri(encoded);
    mocks.api.getOwnerConnectionUri.mockResolvedValue(uri);
    mocks.spawn.mockImplementation((_command, _args, options) => {
      expect(options.env.PROJECTION_INTEGRATION_OWNER_DATABASE_URL).toBe(uri);
      expect(options.env.ACCOUNT_FRESH_INSTALL_DATABASE_URL).toBeUndefined();
      expect(options.env.PROJECTION_INTEGRATION_FRESH_INSTALL_INITIAL_DIGEST).toBeUndefined();
      const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
      const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
      const child = Object.assign(new EventEmitter(), { pid: 12345, stdout, stderr });
      setImmediate(() => {
        const split = Math.floor(password.length / 2);
        stdout.emit('data', `safe stdout decoded=${password.slice(0, split)}`);
        stdout.emit('data', `${password.slice(split)} url=${uri}\n`);
        stdout.emit('end');
        stderr.emit('data', `safe stderr encoded=${encoded.slice(0, 5)}`);
        stderr.emit('data', encoded.slice(5));
        stderr.emit('end');
        child.emit('close', 0, null);
      });
      return child;
    });
    const output = vi.fn();
    const result = await run(output);
    expect(result.passed).toBe(true);
    expect(mocks.closure.mock.invocationCallOrder[0]).toBeLessThan(mocks.evidence.mock.invocationCallOrder[0]);
    expect(mocks.pool).toHaveBeenCalledWith(expect.objectContaining({ connectionString: uri }));
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(output.mock.calls.flat().join('')).toBe(
      'safe stdout decoded=[REDACTED] url=[REDACTED_DATABASE_URL]\nsafe stderr encoded=[REDACTED]');
    expect(mocks.api.deleteBranch).toHaveBeenCalledWith(expect.anything(), branch, expect.any(AbortSignal));
  });

  it.each(['fictional%ZZpassword', 'fictional%E0%A4password'])
  ('refuses malformed owner password encoding before connecting: %s', async password => {
    const uri = ownerUri(password);
    mocks.api.getOwnerConnectionUri.mockResolvedValue(uri);
    const output = vi.fn();
    const result = await run(output);
    expect(result.passed).toBe(false);
    expect(result.receipt).toMatchObject({ tests: 'not-run', failures: ['provision'], branchDeletionVerified: true });
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.api.deleteBranch).toHaveBeenCalledWith(expect.anything(), branch, expect.any(AbortSignal));
    expect(output).not.toHaveBeenCalled();
    expect(JSON.stringify(result.receipt)).not.toContain(password);
    expect(JSON.stringify(result.receipt)).not.toContain(uri);
  });
});

describe('actual supervisor owner-loss event wiring', () => {
  function ownerConnection() {
    const client = Object.assign(new EventEmitter(), { query: mocks.query, release: mocks.release });
    const connect = vi.fn(async () => client);
    const pool = Object.assign(new EventEmitter(), { connect, end: mocks.end });
    mocks.pool.mockImplementation(function () { return pool; });
    mocks.api.getOwnerConnectionUri.mockResolvedValue(ownerUri('fictional-owner-secret'));
    // Exercise the supervisor's real guarded query wrapper inside each owner check.
    mocks.owner.mockImplementation(async query => { await query('SELECT synthetic_owner_check'); });
    mocks.release.mockImplementation(() => client.emit('end'));
    return { client, pool, connect };
  }
  it.each([
    ['pool-error', 'transport', 'ECONNRESET'], ['client-error', 'postgresql', '57P01'],
    ['client-error', 'unexpected-termination', 'unknown'], ['client-end', 'unknown', 'unknown'],
    ['hostile-code', 'unknown', 'unknown'], ['hostile-descriptor', 'unknown', 'unknown'],
    ['diagnostic-write-failure', 'unknown', 'unknown'],
  ] as const)('retains first %s evidence with immediate sticky cancellation and unchanged teardown', async (origin, category, code) => {
    const { client, pool, connect } = ownerConnection();
    const snapshots: IntegrationRunReceipt[] = [];
    let current: IntegrationRunReceipt, queryCountAtLoss = 0, abortedSynchronously = false;
    const descriptorInspectedAfterAbort: boolean[] = [];
    const originalAbort = AbortController.prototype.abort;
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    // A synchronous listener may itself observe the connection ending during cancellation.
    abort.mockImplementation(function (this: AbortController, reason?: unknown) {
      if (reason === 'ownership-lost' && !this.signal.aborted) this.signal.addEventListener('abort', () => client.emit('end'), { once: true });
      return originalAbort.call(this, reason);
    });
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { pid: 12345 });
      mocks.stop.mockImplementation(async () => { child.emit('close', null, 'SIGTERM'); });
      setImmediate(() => {
        queryCountAtLoss = mocks.query.mock.calls.length;
        if (origin === 'diagnostic-write-failure') Object.defineProperty(current, 'ownerLoss', {
          configurable: true, get: () => undefined, set: () => { throw new Error('private diagnostic write'); },
        });
        const error = origin === 'hostile-descriptor' ? new Proxy({}, {
          getOwnPropertyDescriptor: () => {
            descriptorInspectedAfterAbort.push(abort.mock.contexts.some((controller, index) =>
              abort.mock.calls[index][0] === 'ownership-lost' && (controller as AbortController).signal.aborted));
            client.emit('end');
            throw new Error('private descriptor trap');
          },
        }) : origin === 'hostile-code'
          ? Object.defineProperty(new Error('private connection text'), 'code', { get: () => { throw new Error('private accessor'); } })
          : code === 'unknown' ? new Error('Connection terminated unexpectedly')
            : Object.assign(new Error('private connection text'), { code });
        if (origin === 'client-end') client.emit('end');
        else (origin === 'pool-error' ? pool : client).emit('error', error);
        abortedSynchronously = abort.mock.calls.some(([reason]) => reason === 'ownership-lost');
        // The installed driver may emit error followed by end. The latter is not the first cause.
        client.emit('end'); pool.emit('error', { code: 'EPIPE', message: 'private later event' });
      });
      return child;
    });
    try {
      const result = await run(vi.fn(), async receipt => { current = receipt; snapshots.push(structuredClone(receipt)); });
      expect(abortedSynchronously).toBe(true);
      if (origin === 'hostile-descriptor') expect(descriptorInspectedAfterAbort).toEqual([true, true]);
      expect(result.passed).toBe(false);
      expect(result.receipt).toMatchObject({ cancellationReason: 'ownership-lost', tests: 'failed',
        childClosed: true, schemaCleanupVerified: false, credentialsRevoked: false, branchDeletionVerified: true,
        failures: ['tests', 'schema-cleanup', 'credential-revocation'] });
      if (origin === 'diagnostic-write-failure') expect(result.receipt.ownerLoss).toBeUndefined();
      else {
        const retained = result.receipt.ownerLoss!;
        expect(retained).toMatchObject({ kind: 'integration-owner-loss-v1', event: origin.startsWith('hostile-') ? 'client-error' : origin,
          category, code, stage: 'tests' });
        expect(retained.elapsedMs).toBeGreaterThanOrEqual(retained.lastSuccessfulQueryElapsedMs!);
        expect(retained.lastSuccessfulQueryElapsedMs).not.toBeNull();
        expect(retained.lastSuccessfulQueryAgeMs).toBe(retained.elapsedMs! - retained.lastSuccessfulQueryElapsedMs!);
        expect(Object.isFrozen(retained)).toBe(true);
        expect(snapshots.at(-1)?.ownerLoss).toEqual(retained);
        expect(snapshots.filter(snapshot => snapshot.ownerLoss).every(snapshot => JSON.stringify(snapshot.ownerLoss) === JSON.stringify(retained))).toBe(true);
      }
      expect(JSON.stringify(snapshots)).not.toMatch(/private|fictional-owner-secret|postgresql:\/\//u);
      expect(mocks.query).toHaveBeenCalledTimes(queryCountAtLoss);
      expect(mocks.clean).not.toHaveBeenCalled();
      expect(connect).toHaveBeenCalledOnce(); expect(mocks.stop).toHaveBeenCalledOnce();
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith(true); expect(mocks.end).toHaveBeenCalledOnce();
      expect(mocks.api.deleteBranch).toHaveBeenCalledOnce();
      expect([pool.listenerCount('error'), client.listenerCount('error'), client.listenerCount('end')]).toEqual([0, 0, 0]);
      expect(mocks.pool).toHaveBeenCalledWith({ connectionString: ownerUri('fictional-owner-secret'), max: 1,
        connectionTimeoutMillis: 10_000, statement_timeout: 15_000, query_timeout: 20_000 });
    } finally { abort.mockRestore(); }
  });
  it('removes the diagnostic listeners before normal explicit connection closure', async () => {
    const { client, pool, connect } = ownerConnection();
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { pid: 12345 });
      setImmediate(() => child.emit('close', 0, null)); return child;
    });
    const result = await run();
    expect(result.passed).toBe(true); expect(result.receipt.ownerLoss).toBeUndefined();
    expect(result.receipt.cancellationReason).toBeUndefined();
    expect(connect).toHaveBeenCalledOnce(); expect(mocks.stop).not.toHaveBeenCalled();
    expect([pool.listenerCount('error'), client.listenerCount('error'), client.listenerCount('end')]).toEqual([0, 0, 0]);
  });
});

it.each(['invalid-evidence', 'unverified-closure'] as const)('rejects zero-exit child after %s while retaining parent cleanup', async failure => {
  mocks.api.getOwnerConnectionUri.mockResolvedValue(ownerUri('fictional'));
  if (failure === 'invalid-evidence') mocks.evidence.mockRejectedValue(new Error('missing acknowledgment'));
  else mocks.closure.mockRejectedValue(new Error('descendant remains'));
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { pid: 12345 });
    setImmediate(() => child.emit('close', 0, null)); return child;
  });
  const result = await run();
  expect(result.passed).toBe(false); expect(result.receipt.tests).toBe('failed');
  if (failure === 'invalid-evidence') {
    expect(result.receipt.testEvidenceFailure).toBe('missing-or-invalid');
    expect(result.receipt.schemaCleanupVerified).toBe(true);
  } else { expect(mocks.evidence).not.toHaveBeenCalled(); expect(result.receipt.schemaCleanupVerified).toBe(false); }
  expect(mocks.api.deleteBranch).toHaveBeenCalled();
});

describe('supervisor PostgreSQL-version observation and acceptance', () => {
  const versionQuery = (sql: string) => sql.includes("current_setting('server_version')");
  function passingChild() {
    const child = Object.assign(new EventEmitter(), { pid: 12345 });
    setImmediate(() => child.emit('close', 0, null)); return child;
  }
  it('observes after all guards and waits for immutable evidence acknowledgment before spawning', async () => {
    mocks.api.getOwnerConnectionUri.mockResolvedValue(ownerUri('fictional'));
    const reached = Promise.withResolvers<void>(), acknowledge = Promise.withResolvers<void>();
    const snapshots: IntegrationRunReceipt[] = [];
    mocks.spawn.mockImplementation(passingChild);
    const running = run(vi.fn(), async receipt => {
      snapshots.push(structuredClone(receipt));
      if (receipt.stage === 'provision' && receipt.postgresqlVersion) {
        reached.resolve(); await acknowledge.promise;
      }
    });
    await reached.promise;
    expect(mocks.spawn).not.toHaveBeenCalled();
    const versionIndex = mocks.query.mock.calls.findIndex(([sql]) => versionQuery(sql));
    expect(versionIndex).toBeGreaterThan(-1);
    expect(mocks.safe.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[versionIndex]);
    expect(mocks.owner.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[versionIndex]);
    expect(snapshots.at(-1)?.postgresqlVersion).toMatchObject({ serverVersion: '18.6', serverVersionNum: '180006',
      databaseName: 'integration_test', branchId: branch.branchId });
    acknowledge.resolve();
    const result = await running;
    expect(result.passed).toBe(true);
    expect(result.receipt.testEvidence?.contextDigest).toBe(result.receipt.postgresqlVersion?.contextDigest);
    expect(snapshots.filter(snapshot => snapshot.postgresqlVersion)
      .every(snapshot => JSON.stringify(snapshot.postgresqlVersion) === JSON.stringify(result.receipt.postgresqlVersion))).toBe(true);
  });
  it.each(['safe-guard', 'owner-guard', 'read', 'missing-row', 'wrong-target', 'version-pair', 'journal'])(
    'does not spawn after %s failure and retains honest owned-resource cleanup', async fault => {
      mocks.api.getOwnerConnectionUri.mockResolvedValue(ownerUri('fictional'));
      if (fault === 'safe-guard') mocks.safe.mockRejectedValue(new Error('private guard detail'));
      if (fault === 'owner-guard') mocks.owner.mockRejectedValue(new Error('private owner detail'));
      const originalQuery = mocks.query.getMockImplementation()!;
      mocks.query.mockImplementation(async (sql: string) => {
        if (versionQuery(sql)) {
          if (fault === 'read') throw new Error('private database password');
          if (fault === 'missing-row') return { rows: [] };
          const result = await originalQuery(sql);
          if (fault === 'wrong-target') result.rows[0].branch = 'br-parent';
          if (fault === 'version-pair') result.rows[0].server_version_num = '170006';
          return result;
        }
        return originalQuery(sql);
      });
      let rejected = false;
      const result = await run(vi.fn(), async receipt => {
        if (fault === 'journal' && receipt.postgresqlVersion && !rejected) {
          rejected = true; throw new Error('private filesystem detail');
        }
      });
      expect(result.passed).toBe(false);
      expect(mocks.spawn).not.toHaveBeenCalled();
      expect(mocks.clean).not.toHaveBeenCalled();
      expect(mocks.release).toHaveBeenCalledWith(true);
      expect(mocks.api.deleteBranch).toHaveBeenCalledOnce();
      expect(result.receipt).toMatchObject({ tests: 'not-run', schemaCleanupVerified: false,
        credentialsRevoked: false, branchDeletionVerified: true, failures: ['provision'] });
      if (fault.endsWith('guard')) expect(mocks.query.mock.calls.some(([sql]) => versionQuery(sql))).toBe(false);
      expect(JSON.stringify(result.receipt)).not.toContain('private ');
    });
  it('denies post-child version mismatch while preserving schema and credential cleanup', async () => {
    mocks.api.getOwnerConnectionUri.mockResolvedValue(ownerUri('fictional'));
    mocks.spawn.mockImplementation(passingChild);
    let current: IntegrationRunReceipt;
    const evidence = { profile: 'full', collected: 1, executed: 1, passed: 1, skipped: 0, filtered: 0, reportDigest: 'a'.repeat(64) };
    mocks.evidence.mockImplementation(async () => {
      current.postgresqlVersion = { ...current.postgresqlVersion!, branchId: 'br-foreign' };
      return evidence;
    });
    const result = await run(vi.fn(), async receipt => { current = receipt; });
    expect(result.passed).toBe(false);
    expect(result.receipt).toMatchObject({ tests: 'failed', testEvidenceFailure: 'missing-or-invalid',
      childClosed: true, schemaCleanupVerified: true, credentialsRevoked: true, branchDeletionVerified: true });
    expect(mocks.clean).toHaveBeenCalledOnce();
    expect(mocks.api.deleteBranch).toHaveBeenCalledOnce();
  });
});

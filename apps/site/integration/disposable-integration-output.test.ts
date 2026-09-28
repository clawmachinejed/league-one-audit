import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DISPOSABLE_AUTHORIZATION, runDisposableIntegration } from './disposable-integration';

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), query: vi.fn(), spawn: vi.fn(),
  api: { validateTarget: vi.fn(), createBranch: vi.fn(), rotateOwnerCredentials: vi.fn(),
    getOwnerConnectionUri: vi.fn(), ownedReceipts: vi.fn(), deleteBranch: vi.fn() },
}));
vi.mock('@neondatabase/serverless', () => ({ Pool: mocks.pool }));
vi.mock('./disposable-neon-api', async importOriginal => ({
  ...await importOriginal<typeof import('./disposable-neon-api')>(),
  DisposableNeonApi: vi.fn(function () { return mocks.api; }),
}));
vi.mock('./neon-integration-harness', () => ({
  assertSafeIntegrationDatabase: vi.fn(), cleanIntegrationDatabase: vi.fn(), integrationEnvironment: vi.fn(),
}));
vi.mock('./integration-database-ownership', () => ({
  INTEGRATION_MUTEX: 'test-mutex', INTEGRATION_OWNER_ENV: 'PROJECTION_INTEGRATION_OWNER_PROOF',
  assertIntegrationOwner: vi.fn(),
}));
vi.mock('./integration-artifacts', () => ({
  createIntegrationArtifactDirectory: vi.fn(async () => resolve('test-results/mock-artifacts')),
  INTEGRATION_ARTIFACT_DIRECTORY_ENV: 'PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY',
}));
vi.mock('./integration-child-process', () => ({
  spawnIntegrationChild: mocks.spawn, stopIntegrationChildTree: vi.fn(),
  verifyIntegrationChildTreeClosed: vi.fn(async () => 'child-close'),
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
const run = (output = vi.fn()) => runDisposableIntegration({ environment, gitSha: 'a'.repeat(40),
  journal: async () => {}, signal: new AbortController().signal, output });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.createBranch.mockResolvedValue(branch);
  mocks.api.ownedReceipts.mockReturnValue([branch]);
  mocks.query.mockImplementation(async (sql: string) => {
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
    const client = Object.assign(new EventEmitter(), { query: mocks.query, release: vi.fn() });
    return Object.assign(new EventEmitter(), { connect: vi.fn(async () => client), end: vi.fn(async () => {}) });
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
    expect(mocks.pool).toHaveBeenCalledWith(expect.objectContaining({ connectionString: uri }));
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(output.mock.calls.flat().join('')).toBe(
      'safe stdout decoded=[REDACTED] url=[REDACTED_DATABASE_URL]\nsafe stderr encoded=[REDACTED]');
    expect(mocks.api.deleteBranch).toHaveBeenCalledWith(expect.anything(), branch);
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
    expect(mocks.api.deleteBranch).toHaveBeenCalledWith(expect.anything(), branch);
    expect(output).not.toHaveBeenCalled();
    expect(JSON.stringify(result.receipt)).not.toContain(password);
    expect(JSON.stringify(result.receipt)).not.toContain(uri);
  });
});

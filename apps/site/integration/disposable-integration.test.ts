import { describe, expect, it, vi } from 'vitest';
import { assertEmptyDisposableDatabase, disposableConfiguration, DISPOSABLE_AUTHORIZATION,
  integrationChildEnvironment, redactIntegrationOutput, runIntegrationLifecycle, type IntegrationRunReceipt } from './disposable-integration';

const valid = {
  NEON_TEST_AUTHORIZATION: DISPOSABLE_AUTHORIZATION, NEON_TEST_API_KEY: 'secret',
  NEON_TEST_PROJECT_ID: 'new-test-project', NEON_TEST_PROJECT_NAME: 'league-one-integration-tests',
  NEON_TEST_PARENT_BRANCH_ID: 'br-empty-parent', NEON_TEST_PARENT_BRANCH_NAME: 'empty-test-parent',
  NEON_TEST_DATABASE: 'integration_test', NEON_TEST_OWNER_ROLE: 'neondb_owner',
};
describe('disposable test configuration', () => {
  it('requires explicit authorization and every identity', () => {
    expect(disposableConfiguration(valid).databaseName).toBe('integration_test');
    for (const key of Object.keys(valid)) expect(() => disposableConfiguration({ ...valid, [key]: '' })).toThrow();
  });
  it.each([
    ['NEON_TEST_PROJECT_ID', 'solitary-base-99261075'], ['NEON_TEST_PROJECT_NAME', 'production'],
    ['NEON_TEST_PARENT_BRANCH_ID', 'br-still-breeze-avaibago'], ['NEON_TEST_PARENT_BRANCH_ID', 'br-rapid-boat-avgeevye'],
    ['NEON_TEST_PARENT_BRANCH_NAME', 'main'], ['NEON_TEST_DATABASE', 'projection_refactor_test'],
    ['NEON_TEST_DATABASE', 'account_reset_integration_test'], ['NEON_TEST_DATABASE', 'neondb'],
    ['NEON_TEST_DATABASE', "test'; DROP DATABASE production;--"], ['NEON_TEST_OWNER_ROLE', 'league_one_runtime'],
  ])('refuses protected or unsafe identity %s=%s', (key, value) => {
    expect(() => disposableConfiguration({ ...valid, [key]: value })).toThrow();
  });
  it('passes only explicit OS variables to children', () => {
    expect(integrationChildEnvironment({ PATH: 'bin', SystemRoot: 'Windows', CI: '1',
      NEON_TEST_API_KEY: 'secret', DATABASE_URL: 'secret', NODE_OPTIONS: '--inspect',
      VERCEL_TOKEN: 'secret', TANK01_API_KEY: 'secret', UNKNOWN_SECRET: 'secret' }))
      .toEqual({ PATH: 'bin', SystemRoot: 'Windows', CI: '1', NODE_ENV: 'test' });
  });
  it('redacts URLs, standalone passwords, sentinel and API key from diagnostics', () => {
    expect(redactIntegrationOutput('postgresql://owner:password@host/test?sslmode=require api-key sentinel password',
      ['password', 'api-key', 'sentinel'])).toBe('[REDACTED_DATABASE_URL] [REDACTED] [REDACTED] [REDACTED]');
  });
});

describe('bootstrap identity and emptiness', () => {
  const row = { database: 'integration_test', owner: 'neondb_owner', session: 'neondb_owner', branch: 'br-run',
    schemas: 0, relations: 0, functions: 0, types: 0, roles: 0, sessions: 0 };
  const target = { database: 'integration_test', owner: 'neondb_owner', branch: 'br-run' };
  it('requires a truly empty fresh target before role/comment writes', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    await expect(assertEmptyDisposableDatabase(query, target)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^SELECT/u);
    expect(query.mock.calls[0][0]).toContain("left(nspname,3) <> 'pg_'");
    expect(query.mock.calls[0][0]).not.toContain("LIKE 'pg_%'");
  });
  it.each(Object.keys(row))('rejects mismatched identity/nonempty %s', async key => {
    const value = typeof row[key as keyof typeof row] === 'number' ? 1 : 'wrong';
    await expect(assertEmptyDisposableDatabase(vi.fn().mockResolvedValue({ rows: [{ ...row, [key]: value }] }), target)).rejects.toThrow();
  });
});

describe('disposable lifecycle failure boundaries', () => {
  function setup() {
    const receipt: IntegrationRunReceipt = { kind: 'disposable-integration-v1', runId: 'run', gitSha: 'abc',
      startedAt: 'now', projectId: 'test-project', parentBranchId: 'br-parent', stage: 'preflight',
      tests: 'not-run', childClosed: false, schemaCleanupVerified: false, credentialsRevoked: false,
      branchDeletionVerified: false, failures: [], productionWrites: false };
    const calls: string[] = [];
    const operation = (name: string) => vi.fn(async () => { calls.push(name); });
    const runtime = { provision: operation('provision'), execute: vi.fn(async () => {
      calls.push('execute'); return { passed: true, closed: true };
    }), clean: operation('clean'), revoke: operation('revoke'), close: operation('close'), delete: operation('delete') };
    return { receipt, calls, runtime, journal: vi.fn(async () => {}) };
  }
  it('passes only after tests, closed child, cleanup, revocation and verified deletion', async () => {
    const { receipt, runtime, journal, calls } = setup();
    await expect(runIntegrationLifecycle(runtime, receipt, journal)).resolves.toBe(true);
    expect(calls).toEqual(['provision', 'execute', 'clean', 'revoke', 'close', 'delete']);
    expect(receipt.stage).toBe('complete');
  });
  it('reclaims partial provisioning without running tests or unsafe SQL cleanup', async () => {
    const { receipt, runtime, journal } = setup();
    runtime.provision.mockRejectedValue(new Error('secret-bearing SQL failure'));
    expect(await runIntegrationLifecycle(runtime, receipt, journal)).toBe(false);
    expect(runtime.execute).not.toHaveBeenCalled(); expect(runtime.clean).not.toHaveBeenCalled();
    expect(runtime.delete).toHaveBeenCalledOnce(); expect(receipt.failures).toEqual(['provision']);
    expect(JSON.stringify(receipt)).not.toContain('secret-bearing');
  });
  it('cleans failed tests after closure, but never reports a pass', async () => {
    const { receipt, runtime, journal } = setup(); runtime.execute.mockResolvedValue({ passed: false, closed: true });
    expect(await runIntegrationLifecycle(runtime, receipt, journal)).toBe(false);
    expect(runtime.clean).toHaveBeenCalledOnce(); expect(runtime.revoke).toHaveBeenCalledOnce();
    expect(receipt.branchDeletionVerified).toBe(true);
  });
  it('does not issue destructive SQL when cancellation leaves child closure uncertain', async () => {
    const { receipt, runtime, journal } = setup(); runtime.execute.mockResolvedValue({ passed: false, closed: false });
    expect(await runIntegrationLifecycle(runtime, receipt, journal)).toBe(false);
    expect(runtime.clean).not.toHaveBeenCalled(); expect(runtime.revoke).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce(); expect(runtime.delete).toHaveBeenCalledOnce();
  });
  it.each(['clean', 'revoke', 'close', 'delete'] as const)('fails on %s error and still attempts branch cleanup', async name => {
    const { receipt, runtime, journal } = setup(); runtime[name].mockRejectedValue(new Error('fail'));
    expect(await runIntegrationLifecycle(runtime, receipt, journal)).toBe(false);
    expect(runtime.delete).toHaveBeenCalledOnce(); expect(receipt.failures.length).toBeGreaterThan(0);
  });
  it('does not let receipt disk failure prevent resource deletion', async () => {
    const { receipt, runtime, journal } = setup(); journal.mockRejectedValue(new Error('disk full'));
    expect(await runIntegrationLifecycle(runtime, receipt, journal)).toBe(false);
    expect(runtime.close).toHaveBeenCalledOnce(); expect(runtime.delete).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { DisposableNeonApi } from './disposable-neon-api';
import { assertEmptyDisposableDatabase, disposableConfiguration, DISPOSABLE_AUTHORIZATION,
  assertIntegrationPostgresqlVersionEvidence, captureIntegrationPostgresqlVersion,
  integrationCancellationReason, integrationChildEnvironment, redactIntegrationOutput, runDisposableIntegration, runIntegrationLifecycle, type IntegrationRunReceipt } from './disposable-integration';
import { IntegrationLifecycleBudget, HEALTHY_FLEET_LIFECYCLE_PROFILE } from './integration-lifecycle-budget';
import { qualificationDigest, type QualificationContext } from './qualification-profile';

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
      PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: 'untrusted-parent-path',
      PROJECTION_INTEGRATION_QUALIFICATION_CONTEXT: 'untrusted-parent-context',
      VERCEL_TOKEN: 'secret', TANK01_API_KEY: 'secret', UNKNOWN_SECRET: 'secret' }))
      .toEqual({ PATH: 'bin', SystemRoot: 'Windows', CI: '1', NODE_ENV: 'test' });
  });
  it('passes only the supervisor-created absolute artifact directory', () => {
    const directory = resolve('test-results/integration/artifacts/owned-run');
    expect(integrationChildEnvironment({ PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: 'untrusted-parent-path',
      NEON_TEST_API_KEY: 'secret' }, directory)).toEqual({ NODE_ENV: 'test', PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: directory });
    expect(() => integrationChildEnvironment({}, 'relative-path')).toThrow('must be absolute');
  });
  it.each(['deadline', 'sigint', 'sigterm', 'ownership-lost'] as const)('records the safe cancellation reason %s', reason => {
    expect(integrationCancellationReason(reason)).toBe(reason);
  });
  it('never serializes arbitrary cancellation values into receipts', () => {
    expect(integrationCancellationReason(new Error('secret-bearing failure'))).toBe('requested');
    expect(integrationCancellationReason('private-token')).toBe('requested');
    expect(integrationCancellationReason(undefined)).toBe('requested');
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
    await expect(assertEmptyDisposableDatabase(query, target)).resolves.toEqual(row);
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

describe('run-bound PostgreSQL version evidence', () => {
  const context: QualificationContext = { kind: 'integration-qualification-context-v1',
    runId: '00000000-0000-4000-8000-000000000001', nonce: '00000000-0000-4000-8000-000000000002',
    gitSha: 'a'.repeat(40), profile: 'full', profileDigest: 'b'.repeat(64),
    modules: [{ path: 'integration/example.integration-case.ts', sourceDigest: 'c'.repeat(64) }] };
  const target = { database: 'integration_test', branch: 'br-child', owner: 'neondb_owner' };
  const row = { ...target, session: target.owner, server_version: '18.6', server_version_num: '180006' };
  const receipt = (): IntegrationRunReceipt => ({ kind: 'disposable-integration-v1', runId: context.runId,
    gitSha: context.gitSha, startedAt: '2026-01-01T00:00:00.000Z', databaseName: target.database,
    branchId: target.branch, projectId: 'test-project', parentBranchId: 'br-parent', stage: 'tests',
    tests: 'passed', childClosed: true, schemaCleanupVerified: true, credentialsRevoked: true,
    branchDeletionVerified: true, failures: [], productionWrites: false, testContext: structuredClone(context),
    testEvidence: { profile: 'full', collected: 1, executed: 1, passed: 1, skipped: 0, filtered: 0,
      reportDigest: 'd'.repeat(64), contextDigest: qualificationDigest(context) } });
  it.each([['18.6', '180006'], ['17.0', '170000'], ['18.6 (Debian 18.6-1)', '180006'], ['9.6.24', '90624']])(
    'preserves the actual coherent server values %s / %s', async (version, numeric) => {
      const query = vi.fn().mockResolvedValue({ rows: [{ ...row, server_version: version, server_version_num: numeric }] });
      const result = receipt();
      result.postgresqlVersion = await captureIntegrationPostgresqlVersion(query, result, target);
      expect(result.postgresqlVersion).toMatchObject({ serverVersion: version, serverVersionNum: numeric,
        contextDigest: qualificationDigest(context), databaseName: target.database, branchId: target.branch });
      expect(Object.isFrozen(result.postgresqlVersion)).toBe(true);
      expect(() => assertIntegrationPostgresqlVersionEvidence(result, context)).not.toThrow();
      expect(query).toHaveBeenCalledOnce();
      expect(query.mock.calls[0][0]).toContain("current_setting('server_version_num')");
    });
  it.each([
    [], [row, row], [{ ...row, owner: 'another_owner' }], [{ ...row, session: 'another_owner' }],
    [{ ...row, database: 'another_test' }], [{ ...row, branch: 'br-parent' }], [{ ...row, extra: 'secret' }],
    [{ ...row, server_version: undefined }], [{ ...row, server_version_num: undefined }],
    [{ ...row, server_version: '18.6', server_version_num: '180005' }],
    [{ ...row, server_version: 'postgresql://private:secret@host/test' }],
    [{ ...row, server_version: '18.6\nprivate' }], [{ ...row, server_version: '18.6' + 'x'.repeat(97) }],
    [{ ...row, server_version_num: 180006 }], [{ ...row, server_version_num: '0180006' }],
  ].map(rows => ({ rows })))('rejects unsafe or inconsistent returned rows %# without retaining their values', async ({ rows }) => {
    const original = receipt();
    await expect(captureIntegrationPostgresqlVersion(vi.fn().mockResolvedValue({ rows }), original, target))
      .rejects.toMatchObject({ code: 'POSTGRESQL_VERSION_EVIDENCE_INVALID',
        message: 'Run-bound PostgreSQL version evidence is missing or invalid.' });
    expect(original.postgresqlVersion).toBeUndefined();
  });
  it('sanitizes failed reads without exposing driver text', async () => {
    await expect(captureIntegrationPostgresqlVersion(vi.fn().mockRejectedValue(new Error('private password')), receipt(), target))
      .rejects.toMatchObject({ message: 'Run-bound PostgreSQL version evidence is missing or invalid.' });
  });
  it.each(['missing', 'run', 'source', 'profile', 'context', 'database', 'branch', 'clock', 'finish',
    'test-evidence', 'test-context', 'test-profile', 'test-digest'])(
    'rejects %s evidence even when all cleanup flags and case counts pass', async fault => {
      const result = receipt();
      result.postgresqlVersion = { ...await captureIntegrationPostgresqlVersion(vi.fn().mockResolvedValue({ rows: [row] }), result, target) };
      const evidence = result.postgresqlVersion as { -readonly [Key in keyof NonNullable<IntegrationRunReceipt['postgresqlVersion']>]: NonNullable<IntegrationRunReceipt['postgresqlVersion']>[Key] };
      if (fault === 'missing') delete result.postgresqlVersion;
      if (fault === 'run') evidence.runId = 'another-run';
      if (fault === 'source') evidence.gitSha = 'b'.repeat(40);
      if (fault === 'profile') evidence.profile = 'data-transaction-history-intake-v1';
      if (fault === 'context') result.testContext!.nonce = '00000000-0000-4000-8000-000000000003';
      if (fault === 'database') evidence.databaseName = 'other_test';
      if (fault === 'branch') evidence.branchId = 'br-parent';
      if (fault === 'clock') evidence.observedAt = '2025-12-31T00:00:00.000Z';
      if (fault === 'finish') result.finishedAt = result.startedAt;
      if (fault === 'test-evidence') delete result.testEvidence;
      if (fault === 'test-context') result.testEvidence!.contextDigest = 'e'.repeat(64);
      if (fault === 'test-profile') result.testEvidence!.profile = 'data-transaction-history-refresh-v1';
      if (fault === 'test-digest') result.testEvidence!.reportDigest = '';
      expect(() => assertIntegrationPostgresqlVersionEvidence(result, context)).toThrow('version evidence');
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
  it.each([
    ['config', 'NEON_TEST_CONFIG_INVALID', 0],
    ['project', 'NEON_TEST_PROJECT_IDENTITY_MISMATCH', 1],
    ['parent', 'NEON_TEST_PARENT_IDENTITY_MISMATCH', 2],
    ['expiration', 'NEON_TEST_PARENT_EXPIRATION_MISMATCH', 2],
    ['state', 'NEON_TEST_PARENT_STATE_MISMATCH', 2],
  ] as const)('journals the fixed %s target diagnostic without provider values or secrets', async (failure, code, requests) => {
    const { receipt, runtime, journal } = setup();
    const config = disposableConfiguration(valid);
    const privateValue = 'private-provider-value-do-not-retain';
    const apiKey = 'private-api-key-do-not-retain';
    const fetch = vi.fn<typeof globalThis.fetch>(async input => {
      const parentRequest = new URL(String(input)).pathname.includes('/branches/');
      const project = { id: failure === 'project' ? privateValue : config.projectId, name: config.projectName };
      const branch = { id: failure === 'parent' ? privateValue : config.parentBranchId,
        project_id: config.projectId, name: config.parentBranchName,
        expires_at: failure === 'expiration' ? privateValue : null,
        current_state: failure === 'state' ? privateValue : 'archived' };
      return new Response(JSON.stringify({ ...(parentRequest ? { branch } : { project }),
        message: privateValue, detail: apiKey, cause: 'postgresql://private-owner:private-password@private-host/private-db' }));
    });
    const api = new DisposableNeonApi({ apiKey, fetch });
    runtime.provision.mockImplementation(async () => api.validateTarget(failure === 'config'
      ? { ...config, databaseName: privateValue } : config));
    runtime.delete.mockRejectedValue(new Error('No created branch identity; deletion remains unverified.'));
    const saved: IntegrationRunReceipt[] = [];
    journal.mockImplementation(async () => { saved.push(structuredClone(receipt)); });
    expect(await runIntegrationLifecycle(runtime, receipt, journal)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(api.ownedReceipts()).toEqual([]);
    expect(runtime.execute).not.toHaveBeenCalled();
    expect(runtime.clean).not.toHaveBeenCalled(); expect(runtime.revoke).not.toHaveBeenCalled();
    expect(receipt).toMatchObject({ stage: 'failed', tests: 'not-run', failures: ['provision', 'branch-deletion'],
      diagnostics: [{ stage: 'provision', code }], schemaCleanupVerified: false, credentialsRevoked: false, branchDeletionVerified: false });
    expect(receipt.qualification).not.toBe('passed');
    expect(saved.at(-1)?.diagnostics).toEqual([{ stage: 'provision', code }]);
    const persisted = JSON.stringify(saved);
    for (const forbidden of [privateValue, apiKey, 'postgresql://', 'private-password', 'private-host']) {
      expect(persisted).not.toContain(forbidden);
    }
    expect(runtime.close).toHaveBeenCalledOnce(); expect(runtime.delete).toHaveBeenCalledOnce();
  });

  it('cleans failed tests after closure, but never reports a pass', async () => {
    const { receipt, runtime, journal } = setup(); runtime.execute.mockResolvedValue({ passed: false, closed: true });
    expect(await runIntegrationLifecycle(runtime, receipt, journal)).toBe(false);
    expect(runtime.clean).toHaveBeenCalledOnce(); expect(runtime.revoke).toHaveBeenCalledOnce();
    expect(receipt.branchDeletionVerified).toBe(true);
  });
  it('fails a deadline during cleanup even when every test passed, while completing cleanup', async () => {
    const { receipt, runtime, journal } = setup();
    const controller = new AbortController();
    runtime.clean.mockImplementation(async () => { controller.abort('deadline'); });
    expect(await runIntegrationLifecycle(runtime, receipt, journal, controller.signal)).toBe(false);
    expect(runtime.revoke).toHaveBeenCalledOnce(); expect(runtime.close).toHaveBeenCalledOnce();
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(receipt).toMatchObject({ tests: 'passed', stage: 'failed', cancellationReason: 'deadline',
      failures: ['cancelled'], schemaCleanupVerified: true, credentialsRevoked: true, branchDeletionVerified: true });
  });
  it('rewrites the final receipt if cancellation arrives while its successful write is pending', async () => {
    const { receipt, runtime } = setup();
    const controller = new AbortController();
    const writtenStages: string[] = [];
    const journal = vi.fn(async () => {
      writtenStages.push(receipt.stage);
      if (receipt.stage === 'complete') { await Promise.resolve(); controller.abort('sigterm'); }
    });
    expect(await runIntegrationLifecycle(runtime, receipt, journal, controller.signal)).toBe(false);
    expect(writtenStages.slice(-2)).toEqual(['complete', 'failed']);
    expect(receipt).toMatchObject({ stage: 'failed', cancellationReason: 'sigterm', failures: ['cancelled'] });
    expect(runtime.delete).toHaveBeenCalledOnce();
  });
  it('persists a late cancellation reason on an already failed test run', async () => {
    const { receipt, runtime } = setup();
    runtime.execute.mockResolvedValue({ passed: false, closed: true });
    const controller = new AbortController();
    const writtenReceipts: IntegrationRunReceipt[] = [];
    const journal = vi.fn(async () => {
      writtenReceipts.push(structuredClone(receipt));
      if (receipt.finishedAt && !controller.signal.aborted) { await Promise.resolve(); controller.abort('deadline'); }
    });
    expect(await runIntegrationLifecycle(runtime, receipt, journal, controller.signal)).toBe(false);
    expect(receipt).toMatchObject({ stage: 'failed', cancellationReason: 'deadline', failures: ['tests'] });
    expect(writtenReceipts.at(-2)?.cancellationReason).toBeUndefined();
    expect(writtenReceipts.at(-1)?.cancellationReason).toBe('deadline');
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

it('rejects mismatched closed healthy lifecycle budgets before any provisioner or network use',async()=>{
  const denied=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No provisioning permitted'));
  try {
    await expect(runDisposableIntegration({environment:{NODE_ENV:'test'},gitSha:'a'.repeat(40),journal:async()=>{},signal:new AbortController().signal,output:()=>{},profile:HEALTHY_FLEET_LIFECYCLE_PROFILE,budget:new IntegrationLifecycleBudget()})).rejects.toThrow('Lifecycle');
    await expect(runDisposableIntegration({environment:{NODE_ENV:'test'},gitSha:'a'.repeat(40),journal:async()=>{},signal:new AbortController().signal,output:()=>{},profile:'full',budget:new IntegrationLifecycleBudget(HEALTHY_FLEET_LIFECYCLE_PROFILE)})).rejects.toThrow('Lifecycle');
    expect(denied).not.toHaveBeenCalled();
  } finally {denied.mockRestore();}
});


it('rejects recovery with a healthy budget before any provisioner or network use',async()=>{
  const denied=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No provisioning permitted'));
  try {
    await expect(runDisposableIntegration({environment:{NODE_ENV:'test'},gitSha:'a'.repeat(40),journal:async()=>{},signal:new AbortController().signal,output:()=>{},profile:'data-freshness-capacity-recovery-v1',budget:new IntegrationLifecycleBudget(HEALTHY_FLEET_LIFECYCLE_PROFILE)})).rejects.toThrow('Lifecycle');
    expect(denied).not.toHaveBeenCalled();
  }finally{denied.mockRestore();}
});

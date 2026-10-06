import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { Pool, type PoolClient } from '@neondatabase/serverless';
import { DisposableNeonApi, NeonApiError, type DisposableNeonConfig } from './disposable-neon-api';
import { assertSafeIntegrationDatabase, cleanIntegrationDatabase, integrationEnvironment } from './neon-integration-harness';
import { INTEGRATION_MUTEX, INTEGRATION_OWNER_ENV, assertIntegrationOwner } from './integration-database-ownership';
import { superviseCapacityChild } from './collection-capacity-supervision';
import { spawnIntegrationChild, stopIntegrationChildTree, verifyIntegrationChildTreeClosed } from './integration-child-process';
import { createIntegrationArtifactDirectory, INTEGRATION_ARTIFACT_DIRECTORY_ENV } from './integration-artifacts';
import { IntegrationDeadlineError, IntegrationLifecycleBudget, INTEGRATION_LIFECYCLE_MS,
  INTEGRATION_TEARDOWN_RESERVE_MS } from './integration-lifecycle-budget';

export const DISPOSABLE_AUTHORIZATION = 'I_AUTHORIZE_DISPOSABLE_TEST_BRANCHES';
const protectedIdentities = ['solitary-base-99261075', 'br-rapid-boat-avgeevye', 'br-still-breeze-avaibago',
  'main', 'production', 'neondb', 'projection_refactor_test', 'account_reset_integration_test'];

export function disposableConfiguration(env: Record<string, string | undefined>): DisposableNeonConfig {
  if (env.NEON_TEST_AUTHORIZATION !== DISPOSABLE_AUTHORIZATION) throw new Error('Explicit disposable test-branch authorization is required.');
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}. See integration/README.md.`);
    return value;
  };
  required('NEON_TEST_API_KEY');
  const config = {
    projectId: required('NEON_TEST_PROJECT_ID'), projectName: required('NEON_TEST_PROJECT_NAME'),
    parentBranchId: required('NEON_TEST_PARENT_BRANCH_ID'), parentBranchName: required('NEON_TEST_PARENT_BRANCH_NAME'),
    databaseName: required('NEON_TEST_DATABASE'), ownerRoleName: required('NEON_TEST_OWNER_ROLE'),
  };
  if (config.projectId === 'solitary-base-99261075' || protectedIdentities.includes(config.parentBranchId)
    || !/(?:^|[-_])test(?:s|[-_]|$)/iu.test(config.projectName)
    || !/(?:^|[-_])test(?:s|[-_]|$)/iu.test(config.parentBranchName)
    || !/^[a-z][a-z0-9_]{0,62}$/u.test(config.databaseName) || !/(?:^|_)test(?:_|$)/u.test(config.databaseName)
    || protectedIdentities.includes(config.databaseName)
    || !/^[a-z_][a-z0-9_]*$/u.test(config.ownerRoleName)
    || ['league_one_runtime', 'league_one_auth', 'league_one_account'].includes(config.ownerRoleName)) {
    throw new Error('Disposable integration requires a separate, explicitly named test-only project and empty test parent/database.');
  }
  return config;
}

/** Control-plane, application, provider, NODE_OPTIONS and unrelated DB secrets
 * never enter the test subprocess. Test code must still be reviewed/trusted. */
export function integrationChildEnvironment(source: Record<string, string | undefined>, artifactDirectory?: string): NodeJS.ProcessEnv {
  if (artifactDirectory !== undefined && !isAbsolute(artifactDirectory)) throw new Error('Integration artifact directory must be absolute.');
  const allow = new Set(['path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'tmpdir', 'home', 'userprofile',
    'localappdata', 'appdata', 'pathext', 'lang', 'lc_all', 'tz', 'ci', 'term', 'no_color', 'force_color']);
  return { ...Object.fromEntries(Object.entries(source).filter(([name]) => allow.has(name.toLowerCase()))), NODE_ENV: 'test',
    ...(artifactDirectory === undefined ? {} : { [INTEGRATION_ARTIFACT_DIRECTORY_ENV]: artifactDirectory }) };
}

export function integrationCancellationReason(reason: unknown): NonNullable<IntegrationRunReceipt['cancellationReason']> {
  return reason === 'deadline' || reason === 'sigint' || reason === 'sigterm' || reason === 'ownership-lost' ? reason : 'requested';
}

export function redactIntegrationOutput(value: string, secrets: readonly string[]): string {
  let result = value.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/giu, '[REDACTED_DATABASE_URL]');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join('[REDACTED]');
  return result;
}

type Query = (sql: string, parameters?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export async function assertEmptyDisposableDatabase(query: Query, target: { database: string; branch: string; owner: string }) {
  const result = await query(`SELECT current_database() AS database, current_user AS owner,
    session_user AS session, current_setting('neon.branch_id',true) AS branch,
    (SELECT count(*)::int FROM pg_namespace WHERE nspname NOT IN ('public','information_schema')
      AND left(nspname,3) <> 'pg_') AS schemas,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public') AS relations,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public') AS functions,
    (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public') AS types,
    (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('league_one_runtime','league_one_auth','league_one_account')) AS roles,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND backend_type='client backend') AS sessions`);
  assert.deepEqual(result.rows, [{ database: target.database, owner: target.owner, session: target.owner,
    branch: target.branch, schemas: 0, relations: 0, functions: 0, types: 0, roles: 0, sessions: 0 }],
  'Fresh disposable target must prove exact server identity and contain no inherited application/auth data or roles.');
}

export type IntegrationRunReceipt = {
  kind: 'disposable-integration-v1'; runId: string; gitSha: string; startedAt: string; finishedAt?: string;
  projectId: string; parentBranchId: string; branchId?: string; branchName?: string; expiresAt?: string;
  attemptedBranchName?: string;
  provisionStep?: string;
  stage: string; tests: 'not-run' | 'passed' | 'failed'; childClosed: boolean; schemaCleanupVerified: boolean;
  credentialsRevoked: boolean; branchDeletionVerified: boolean; failures: string[]; productionWrites: false;
  diagnostics?: { stage: string; status?: number; code: string; requestId?: string }[];
  childClosureEvidence?: string;
  artifactDirectory?: string;
  qualification?: 'unverified' | 'passed' | 'failed';
  cancellationReason?: 'deadline' | 'sigint' | 'sigterm' | 'requested' | 'ownership-lost';
  lifecycle?: { limitMs: number; teardownReserveMs: number; elapsedMs: number };
  unresolvedResources?: string[];
};
type Runtime = {
  provision: (signal: AbortSignal) => Promise<void>; execute: (signal: AbortSignal) => Promise<{ passed: boolean; closed: boolean }>;
  shutdown?: (signal: AbortSignal) => Promise<{ closed: boolean }>;
  clean: (signal: AbortSignal) => Promise<void>; revoke: (signal: AbortSignal) => Promise<void>;
  close: (signal: AbortSignal) => Promise<void>; delete: (signal: AbortSignal) => Promise<void>;
};

function unresolvedResources(receipt: IntegrationRunReceipt): string[] {
  return [
    ...(!receipt.branchDeletionVerified && (receipt.attemptedBranchName || receipt.branchId) ? ['branch-deletion-unverified'] : []),
    ...(!receipt.credentialsRevoked && receipt.branchId ? ['credential-revocation-unverified'] : []),
    ...(!receipt.childClosed && receipt.tests !== 'not-run' ? ['child-closure-unverified'] : []),
  ];
}

/** Always delete owned resources even after failed creation/setup; SQL cleanup
 * is allowed only after confirmed child closure. A cleanup failure cannot pass. */
export async function runIntegrationLifecycle(runtime: Runtime, receipt: IntegrationRunReceipt,
  journal: (signal: AbortSignal) => Promise<void>, signal?: AbortSignal,
  budget = new IntegrationLifecycleBudget()): Promise<boolean> {
  let provisioned = false;
  receipt.qualification = 'unverified';
  const recordCancellation = () => {
    if (!signal?.aborted) return false;
    const previousReason = receipt.cancellationReason;
    receipt.cancellationReason = integrationCancellationReason(signal.reason);
    const newlyFailed = receipt.tests === 'passed' && !receipt.failures.includes('cancelled');
    if (newlyFailed) receipt.failures.push('cancelled');
    return previousReason !== receipt.cancellationReason || newlyFailed;
  };
  const fail = (stage: string, error: unknown) => {
    receipt.failures.push(stage);
    if (error instanceof IntegrationDeadlineError) receipt.cancellationReason ??= 'deadline';
    if (error instanceof NeonApiError) (receipt.diagnostics ??= []).push({ stage, status: error.status,
      code: error.code, requestId: error.requestId });
    else if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      && /^[A-Z0-9_]{1,64}$/u.test(error.code)) (receipt.diagnostics ??= []).push({ stage, code: error.code });
  };
  const updateEvidence = () => {
    receipt.lifecycle = { limitMs: INTEGRATION_LIFECYCLE_MS, teardownReserveMs: INTEGRATION_TEARDOWN_RESERVE_MS,
      elapsedMs: Math.ceil(budget.elapsed()) };
    // Every in-progress journal is conservative if the process/host is lost.
    receipt.unresolvedResources = unresolvedResources(receipt);
  };
  const save = async (finalization = false) => {
    updateEvidence();
    await budget.run(journal, { capMs: 2_000, finalization });
  };
  const attempt = async (stage: string, action: (signal: AbortSignal) => Promise<void>, capMs: number) => {
    receipt.stage = stage;
    try { await save(); } catch (error) { fail('receipt', error); }
    try { await budget.run(action, { capMs }); } catch (error) { fail(stage, error); }
  };
  try {
    receipt.stage = 'provision'; await save(); await budget.run(runtime.provision, { work: true, signal }); provisioned = true;
    receipt.tests = 'failed'; // Host loss during execution never looks like an unstarted/closed child.
    receipt.stage = 'tests'; await save();
    const result = await budget.run(runtime.execute, { work: true, signal });
    receipt.tests = result.passed ? 'passed' : 'failed'; receipt.childClosed = result.closed;
    if (!result.passed || !result.closed) receipt.failures.push('tests');
  } catch (error) { fail(receipt.stage, error); }
  finally {
    if (runtime.shutdown) {
      receipt.childClosed = false;
      await attempt('child-shutdown', async phaseSignal => {
        const outcome = await runtime.shutdown!(phaseSignal); phaseSignal.throwIfAborted();
        receipt.childClosed = outcome.closed;
        if (!outcome.closed) throw new Error('Child closure remains unverified.');
      }, 30_000);
    }
    if (provisioned && receipt.childClosed) {
      await attempt('schema-cleanup', async phaseSignal => { await runtime.clean(phaseSignal); phaseSignal.throwIfAborted(); receipt.schemaCleanupVerified = true; }, 90_000);
      await attempt('credential-revocation', async phaseSignal => { await runtime.revoke(phaseSignal); phaseSignal.throwIfAborted(); receipt.credentialsRevoked = true; }, 30_000);
    }
    await attempt('connection-close', runtime.close, 30_000);
    await attempt('branch-deletion', async phaseSignal => { await runtime.delete(phaseSignal); phaseSignal.throwIfAborted(); receipt.branchDeletionVerified = true; }, budget.remaining());
    recordCancellation();
    receipt.finishedAt = new Date().toISOString(); receipt.stage = receipt.failures.length ? 'failed' : 'complete';
    try { await save(true); } catch { receipt.failures.push('receipt'); }
    // The deadline can fire while the final asynchronous receipt write is pending.
    const finalCancellationChanged = recordCancellation();
    if (finalCancellationChanged || (receipt.stage === 'complete' && receipt.failures.length)) {
      receipt.stage = 'failed';
      try { await save(true); } catch { receipt.failures.push('receipt'); }
    }
    updateEvidence();
  }
  return receipt.tests === 'passed' && receipt.childClosed && receipt.schemaCleanupVerified
    && receipt.credentialsRevoked && receipt.branchDeletionVerified && receipt.failures.length === 0 && !signal?.aborted;
}

export async function runDisposableIntegration(options: { environment: NodeJS.ProcessEnv; gitSha: string;
  journal: (receipt: IntegrationRunReceipt, signal: AbortSignal) => Promise<void>; signal: AbortSignal;
  output: (text: string) => void; budget?: IntegrationLifecycleBudget }) {
  const budget = options.budget ?? new IntegrationLifecycleBudget();
  const config = disposableConfiguration(options.environment);
  const controller = new AbortController();
  const abort = () => controller.abort(integrationCancellationReason(options.signal.reason));
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  let api: DisposableNeonApi;
  const runId = randomUUID();
  const receipt: IntegrationRunReceipt = { kind: 'disposable-integration-v1', runId, gitSha: options.gitSha,
    projectId: config.projectId, parentBranchId: config.parentBranchId, startedAt: new Date().toISOString(),
    stage: 'preflight', tests: 'not-run', childClosed: false, schemaCleanupVerified: false,
    credentialsRevoked: false, branchDeletionVerified: false, failures: [], productionWrites: false };
  const journal = async (signal: AbortSignal) => {
    if (controller.signal.aborted) receipt.cancellationReason = integrationCancellationReason(controller.signal.reason);
    receipt.unresolvedResources = unresolvedResources(receipt);
    receipt.lifecycle = { limitMs: INTEGRATION_LIFECYCLE_MS, teardownReserveMs: INTEGRATION_TEARDOWN_RESERVE_MS,
      elapsedMs: Math.ceil(budget.elapsed()) };
    await options.journal(receipt, signal);
  };
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let proof: string | undefined;
  let childEnvironment: NodeJS.ProcessEnv | undefined;
  const savedEnvironment = { ...process.env };
  const secrets = [options.environment.NEON_TEST_API_KEY!];
  const safeOutput = (value: string) => options.output(redactIntegrationOutput(value, secrets));
  const onLoss = () => { ownerLost = true; controller.abort('ownership-lost'); };
  let ownerLost = false;
  const query = async (sql: string, parameters: unknown[] = [], signal: AbortSignal = controller.signal) => {
    if (!client || ownerLost) throw new Error('Disposable owner connection unavailable.');
    signal.throwIfAborted();
    const result = await client.query(sql, parameters);
    signal.throwIfAborted();
    return result;
  };
  const verifyOwner = async (signal: AbortSignal) => {
    await assertIntegrationOwner(async (sql, params) => (await query(sql, [...(params ?? [])], signal)).rows,
      { database: config.databaseName, branch: receipt.branchId! }, proof, 'ShareLock');
  };
  let childCompletion: Promise<{ passed: boolean; closed: boolean }> | undefined;
  const runtime: Runtime = {
    async provision(signal) {
      signal.addEventListener('abort', () => controller.abort(signal.reason instanceof IntegrationDeadlineError ? 'deadline' : signal.reason), { once: true });
      signal.throwIfAborted();
      api = new DisposableNeonApi({ apiKey: options.environment.NEON_TEST_API_KEY!, signal });
      const save = () => budget.run(journal, { work: true, signal, capMs: 2_000 });
      receipt.provisionStep = 'artifact-directory';
      receipt.artifactDirectory = await createIntegrationArtifactDirectory();
      await save();
      controller.signal.throwIfAborted();
      receipt.provisionStep = 'api-target-validation';
      await api.validateTarget(config);
      receipt.provisionStep = 'branch-creation';
      const branch = await api.createBranch(config, runId, async intent => {
        controller.signal.throwIfAborted();
        receipt.attemptedBranchName = intent.branchName; receipt.expiresAt = intent.expiresAt;
        await save();
        controller.signal.throwIfAborted();
      });
      Object.assign(receipt, { branchId: branch.branchId, branchName: branch.branchName, expiresAt: branch.expiresAt });
      await save();
      controller.signal.throwIfAborted();
      receipt.provisionStep = 'child-owner-rotation';
      await api.rotateOwnerCredentials(config, branch);
      receipt.provisionStep = 'connection-uri';
      const ownerUrl = await api.getOwnerConnectionUri(config, branch);
      controller.signal.throwIfAborted();
      // Child/driver diagnostics can contain either standalone password form.
      const ownerPassword = new URL(ownerUrl).password;
      secrets.push(ownerUrl, ownerPassword, decodeURIComponent(ownerPassword));
      pool = new Pool({ connectionString: ownerUrl, max: 1, connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000, query_timeout: 20_000 });
      receipt.provisionStep = 'owner-connect';
      pool.on('error', onLoss);
      const connected = await pool.connect();
      if (signal.aborted) { connected.release(true); signal.throwIfAborted(); }
      client = connected; client.on('error', onLoss); client.on('end', onLoss);
      controller.signal.throwIfAborted();
      receipt.provisionStep = 'empty-database-verification';
      await assertEmptyDisposableDatabase(query, { database: config.databaseName, branch: branch.branchId, owner: config.ownerRoleName });
      receipt.provisionStep = 'exclusive-admission';
      assert.equal((await query('SELECT pg_try_advisory_lock(hashtextextended($1::text,0)) AS owned', [INTEGRATION_MUTEX])).rows[0].owned, true);
      const applicationName = `integration-owner-${runId}`;
      await query("SELECT set_config('application_name',$1::text,false)", [applicationName]);
      const identity = (await query('SELECT pid,backend_start::text AS "backendStart" FROM pg_stat_activity WHERE pid=pg_backend_pid()')).rows[0];
      const runtimePassword = randomBytes(32).toString('hex'), authPassword = randomBytes(32).toString('hex');
      const accountPassword = randomBytes(32).toString('hex');
      const sentinel = randomBytes(32).toString('hex'); secrets.push(runtimePassword, authPassword, accountPassword, sentinel);
      receipt.provisionStep = 'restricted-role-bootstrap';
      // Constants and random hex only. SQL parameter placeholders are not allowed in CREATE ROLE PASSWORD.
      await query(`CREATE ROLE league_one_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${runtimePassword}'`);
      await query(`CREATE ROLE league_one_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${authPassword}'`);
      await query(`CREATE ROLE league_one_account LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${accountPassword}'`);
      const comment = JSON.stringify({ purpose: 'league-one-projection-store-integration', sentinel,
        branchId: branch.branchId, branchName: branch.branchName });
      await query(`COMMENT ON DATABASE "${config.databaseName}" IS '${comment.replaceAll("'", "''")}'`);
      const roleUrl = (role: string, password: string) => { const url = new URL(ownerUrl); url.username = role; url.password = password; return url.href; };
      const generated = {
        PROJECTION_INTEGRATION_ENV_FILE: '.env.integration.local',
        PROJECTION_INTEGRATION_AUTHORIZATION: 'I_ACKNOWLEDGE_THIS_RESETS_AN_ISOLATED_DATABASE',
        PROJECTION_INTEGRATION_OWNER_DATABASE_URL: ownerUrl,
        PROJECTION_INTEGRATION_RUNTIME_DATABASE_URL: roleUrl('league_one_runtime', runtimePassword),
        AUTH_RESET_INTEGRATION_DATABASE_URL: roleUrl('league_one_auth', authPassword),
        ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL: roleUrl('league_one_account', accountPassword),
        PROJECTION_INTEGRATION_EXPECTED_DATABASE: config.databaseName,
        PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID: branch.branchId,
        PROJECTION_INTEGRATION_EXPECTED_BRANCH_NAME: branch.branchName,
        PROJECTION_INTEGRATION_DATABASE_SENTINEL: sentinel,
        PROJECTION_INTEGRATION_PRODUCTION_DENYLIST: [...protectedIdentities, config.parentBranchId, config.parentBranchName].join(','),
      };
      secrets.push(generated.PROJECTION_INTEGRATION_RUNTIME_DATABASE_URL, generated.AUTH_RESET_INTEGRATION_DATABASE_URL,
        generated.ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL);
      Object.assign(process.env, generated);
      receipt.provisionStep = 'guarded-private-role-preflight';
      await assertSafeIntegrationDatabase(integrationEnvironment(), signal);
      controller.signal.throwIfAborted();
      receipt.provisionStep = 'shared-ownership-transfer';
      await query('SELECT pg_advisory_lock_shared(hashtextextended($1::text,0))', [INTEGRATION_MUTEX]);
      assert.equal((await query('SELECT pg_advisory_unlock(hashtextextended($1::text,0)) AS unlocked', [INTEGRATION_MUTEX])).rows[0].unlocked, true);
      proof = JSON.stringify({ database: config.databaseName, branch: branch.branchId, ...identity, applicationName, lockMode: 'ShareLock' });
      await verifyOwner(signal);
      childEnvironment = { ...integrationChildEnvironment(options.environment, receipt.artifactDirectory), ...generated, [INTEGRATION_OWNER_ENV]: proof };
      receipt.provisionStep = 'complete';
    },
    async execute(signal) {
      controller.signal.throwIfAborted(); signal.throwIfAborted(); await verifyOwner(signal); signal.throwIfAborted();
      const child = spawnIntegrationChild(process.execPath, [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
        'run', '--config', fileURLToPath(new URL('../vitest.integration.config.ts', import.meta.url))],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), env: childEnvironment!, stdio: ['ignore', 'pipe', 'pipe'] });
      const childSignal = AbortSignal.any([signal, controller.signal]);
      const supervisor = superviseCapacityChild(child, childSignal, pid => stopIntegrationChildTree(child, pid));
      // Redact complete lines, including values split across stream chunks.
      for (const stream of [child.stdout, child.stderr]) {
        let pending = '';
        stream?.setEncoding('utf8');
        stream?.on('data', (chunk: string) => {
          pending += chunk;
          const lines = pending.split('\n'); pending = lines.pop()!;
          for (const line of lines) safeOutput(`${line}\n`);
          if (pending.length > 1_000_000) { pending = ''; supervisor.stop(); }
        });
        stream?.on('end', () => { if (pending) safeOutput(pending); });
      }
      childCompletion = (async () => {
        const outcome = await supervisor.completion;
        let closed = outcome.closed;
        if (closed) { try { receipt.childClosureEvidence = await verifyIntegrationChildTreeClosed(child); } catch { closed = false; } }
        return { passed: outcome.code === 0 && !outcome.childError && !childSignal.aborted && !ownerLost, closed };
      })();
      return childCompletion;
    },
    async shutdown(signal) {
      signal.throwIfAborted();
      return childCompletion ? await childCompletion : { closed: true };
    },
    async clean(signal) {
      await verifyOwner(signal); await cleanIntegrationDatabase({ ownerProof: proof, signal }); await verifyOwner(signal);
      const result = await query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','website_auth') AND c.relkind IN ('r','p','v','m','S','f')`, [], signal);
      assert.equal(result.rows[0].count, 0);
    },
    async revoke(signal) {
      await verifyOwner(signal);
      await query('ALTER ROLE league_one_runtime NOLOGIN PASSWORD NULL; ALTER ROLE league_one_auth NOLOGIN PASSWORD NULL; ALTER ROLE league_one_account NOLOGIN PASSWORD NULL', [], signal);
      const result = await query("SELECT count(*)::int AS count FROM pg_roles WHERE rolname IN ('league_one_runtime','league_one_auth','league_one_account') AND rolcanlogin", [], signal);
      assert.equal(result.rows[0].count, 0);
    },
    async close(signal) {
      client?.off('error', onLoss); client?.off('end', onLoss); pool?.off('error', onLoss);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        signal.throwIfAborted(); client?.release(true); client = undefined;
        await Promise.race([pool?.end(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Owner connection close deadline exceeded.')), 25_000);
        })]);
      }
      finally {
        clearTimeout(timer);
        for (const name of Object.keys(process.env)) if (!(name in savedEnvironment)) delete process.env[name];
        Object.assign(process.env, savedEnvironment);
      }
    },
    async delete(signal) {
      if (!api) throw new Error('No API creation attempted; deletion is unverified.');
      await api.reconcileCreation(config, signal);
      const owned = api.ownedReceipts();
      for (const branch of owned) {
        Object.assign(receipt, { branchId: branch.branchId, branchName: branch.branchName, expiresAt: branch.expiresAt });
        await api.deleteBranch(config, branch, signal);
      }
      if (owned.length === 0) throw new Error('No created branch identity; provisioning/deletion remains unverified.');
    },
  };
  try { return { passed: await runIntegrationLifecycle(runtime, receipt, journal, controller.signal, budget), receipt }; }
  finally { options.signal.removeEventListener('abort', abort); }
}

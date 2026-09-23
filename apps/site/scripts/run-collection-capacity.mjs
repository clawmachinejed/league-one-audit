import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import { assertDirectIntegrationOwnerUrl } from '../integration/integration-database-ownership.ts';
import { integrationEnvironment, assertSafeIntegrationDatabase, cleanIntegrationDatabase } from '../integration/neon-integration-harness.ts';
import { CAPACITY_MUTEX, CAPACITY_OWNER_ENV, CAPACITY_RECEIPT_KIND, assertCapacityOwner,
  capacitySessionSnapshot, priorCapacityBackends, superviseCapacityChild, verifyCapacityBackends } from '../integration/collection-capacity-supervision.ts';

if (process.argv.length !== 2) throw new Error('Collection capacity accepts no command-line arguments.');
if (process.platform !== 'win32') throw new Error('This capacity supervisor currently requires Windows child-tree control.');
process.env.PROJECTION_INTEGRATION_ENV_FILE = '.env.integration.local';
const environment = integrationEnvironment();
assertDirectIntegrationOwnerUrl(environment.ownerDatabaseUrl);
const output = process.env.COLLECTION_CAPACITY_OUTPUT;
if (!output || !isAbsolute(output)) throw new Error('Collection capacity requires an absolute COLLECTION_CAPACITY_OUTPUT path.');
try { await access(output); throw new Error('Capacity refuses to overwrite an existing measurement.'); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }
await mkdir(dirname(output), { recursive: true });
const receiptPath = join(dirname(output), `collection-capacity-supervision-${randomUUID()}.json`);
const target = { database: environment.expectedDatabase, branch: environment.expectedBranchId };
const report = { kind: CAPACITY_RECEIPT_KIND, ...target, startedAt: new Date().toISOString(),
  childClosed: false, cleanupVerified: false, productionWrites: false, credentialsCreated: false,
  measurementFile: output, stage: 'preflight' };
const journal = () => writeFile(receiptPath, `${JSON.stringify(report, null, 2)}\n`);
const controller = new AbortController();
const abort = () => { controller.abort(); process.exitCode = 1; };
process.on('SIGINT', abort); process.on('SIGTERM', abort);
const deadline = setTimeout(abort, 20 * 60_000);
const hardDeadline = setTimeout(() => { process.stderr.write('Capacity hard deadline; cleanup remains unverified.\n'); process.exit(1); }, 21 * 60_000);
let pool, client, supervisor, child, locked = false, sharedLocked = false, query, previous, ownedWindow;
try {
  await journal();
  await assertSafeIntegrationDatabase(environment);
  pool = new Pool({ connectionString: environment.ownerDatabaseUrl, max: 1,
    connectionTimeoutMillis: 10_000, statement_timeout: 15_000, query_timeout: 20_000 });
  pool.on('error', abort); client = await pool.connect(); client.on('error', abort);
  query = async (statement, parameters = []) => (await client.query(statement, [...parameters])).rows;
  report.stage = 'exclusive-owner';
  assert.equal((await query('SELECT pg_try_advisory_lock(hashtextextended($1::text,0)) AS owned', [CAPACITY_MUTEX]))[0].owned, true);
  locked = true;
  const applicationName = `capacity-owner-${randomUUID()}`;
  await query("SELECT set_config('application_name',$1::text,false)", [applicationName]);
  const owner = (await query('SELECT pid,backend_start::text AS "backendStart" FROM pg_stat_activity WHERE pid=pg_backend_pid()'))[0];
  let proof = JSON.stringify({ ...target, ...owner, applicationName, lockMode: 'ExclusiveLock' });
  await assertCapacityOwner(query, target, proof);
  const priorReceipts = [];
  for (const name of await readdir(dirname(receiptPath))) {
    if (!/^collection-capacity-supervision-[a-f0-9-]+\.json$/u.test(name) || join(dirname(receiptPath), name) === receiptPath) continue;
    priorReceipts.push(JSON.parse(await readFile(join(dirname(receiptPath), name), 'utf8')));
  }
  previous = priorCapacityBackends(priorReceipts, target);
  report.before = await capacitySessionSnapshot(query);
  assert.equal(report.before.relations, 0); verifyCapacityBackends(report.before, target, previous);
  controller.signal.throwIfAborted();
  // Keep admission exclusive until preflight completes. Parent and child then
  // retain shared locks on this same key, so either session protects the run
  // if the other disappears. Every independent run must first get exclusive.
  await query('SELECT pg_advisory_lock_shared(hashtextextended($1::text,0))', [CAPACITY_MUTEX]);
  sharedLocked = true;
  assert.equal((await query('SELECT pg_advisory_unlock(hashtextextended($1::text,0)) AS unlocked', [CAPACITY_MUTEX]))[0].unlocked, true);
  locked = false;
  proof = JSON.stringify({ ...target, ...owner, applicationName, lockMode: 'ShareLock' });
  await assertCapacityOwner(query, target, proof);
  const childEnvironment = { ...process.env, [CAPACITY_OWNER_ENV]: proof };
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PRODUCTION_DATABASE_URL', 'ACCOUNT_DATABASE_URL',
    'ACCOUNTS_AUTH_DATABASE_URL', 'TANK01_API_KEY', 'AUTH_RESET_INTEGRATION_DATABASE_URL']) delete childEnvironment[name];
  report.stage = 'measurement';
  const childStartedAt = Date.now();
  child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run', '--config', fileURLToPath(new URL('../integration/collection-capacity.config.ts', import.meta.url))],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), env: childEnvironment, stdio: 'inherit', windowsHide: true, shell: false });
  supervisor = superviseCapacityChild(child, controller.signal);
  assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0);
  report.childPid = child.pid; await journal();
  const outcome = await supervisor.completion;
  report.childClosed = outcome.closed; report.childExit = outcome.code;
  assert.equal(outcome.closed, true); child = undefined;
  if (outcome.code !== 0 || outcome.childError || controller.signal.aborted) process.exitCode = 1;
  report.stage = 'cleanup-verification';
  await assertCapacityOwner(query, target, proof);
  ownedWindow = [childStartedAt, Date.now()];
  report.after = await capacitySessionSnapshot(query);
  verifyCapacityBackends(report.after, target, previous, ownedWindow);
  if (report.after.relations !== 0) {
    report.recoveryCleanupRequired = true; await journal();
    await cleanIntegrationDatabase({ ownerProof: proof }); report.after = await capacitySessionSnapshot(query);
  }
  assert.equal(report.after.relations, 0); verifyCapacityBackends(report.after, target, previous, ownedWindow);
  report.cleanupVerified = true;
  report.idleBackendScope = 'Only exact previously recorded idle runtime backends or idle/no-transaction runtime backends created during this owned child are allowed. No database sessions terminated.';
  report.stage = 'complete';
} catch (error) {
  report.failed = true; report.error = { name: error?.name ?? 'Error', code: typeof error?.code === 'string' ? error.code : null };
  process.exitCode = 1;
} finally {
  if (child && supervisor) {
    supervisor.stop(); const outcome = await supervisor.completion;
    report.childClosed = outcome.closed; report.childExit = outcome.code;
    // A journal/owner failure before normal verification leaves cleanup unverified.
    // Do not reset while child closure, session attribution or ownership is uncertain.
  }
  if (locked && client) await client.query('SELECT pg_advisory_unlock(hashtextextended($1::text,0))', [CAPACITY_MUTEX])
    .catch(() => { report.unlockFailed = true; process.exitCode = 1; });
  if (sharedLocked && client) await client.query('SELECT pg_advisory_unlock_shared(hashtextextended($1::text,0))', [CAPACITY_MUTEX])
    .catch(() => { report.unlockFailed = true; process.exitCode = 1; });
  client?.release(); await pool?.end().catch(() => { report.connectionCloseFailed = true; process.exitCode = 1; });
  clearTimeout(deadline); clearTimeout(hardDeadline);
  process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
  report.finishedAt = new Date().toISOString(); await journal();
  process.stdout.write(`${JSON.stringify({ outcome: process.exitCode ? 'failed' : 'completed', receipt: receiptPath,
    childClosed: report.childClosed, cleanupVerified: report.cleanupVerified, stage: report.stage })}\n`);
}

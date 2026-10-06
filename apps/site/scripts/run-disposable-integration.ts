import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDisposableIntegration } from '../integration/disposable-integration';
import { IntegrationLifecycleBudget } from '../integration/integration-lifecycle-budget';
import { createIntegrationReceiptJournal } from '../integration/integration-receipt-journal';

if (process.argv.length !== 2) throw new Error('Disposable integration accepts configuration through its secured environment only.');
const budget = new IntegrationLifecycleBudget();
const root = fileURLToPath(new URL('../../..', import.meta.url));
const gitOptions = { cwd: root, encoding: 'utf8' as const, windowsHide: true, timeout: 2_000 };
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
if (execFileSync('git', ['status', '--porcelain'], gitOptions).trim()) {
  throw new Error('Commit the reviewed test source before running disposable integration; qualification must identify one clean Git SHA.');
}
const output = resolve(root, 'test-results', 'integration', `run-${Date.now()}-${randomUUID()}.json`);
await budget.run(async () => { await mkdir(dirname(output), { recursive: true }); }, { work: true, capMs: 2_000 });
// Reserve this invocation's path before provisioning; immutable journals use sibling paths.
await budget.run(signal => writeFile(output, '', { flag: 'wx', mode: 0o600, signal }), { work: true, capMs: 2_000 });
const journal = createIntegrationReceiptJournal(output);
const controller = new AbortController();
const interrupt = () => controller.abort('sigint');
const terminate = () => controller.abort('sigterm');
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
const workTimeout = setTimeout(() => controller.abort('deadline'), Math.max(1, budget.workDeadline - performance.now()));
// The phase budget starts cleanup by minute 30. This last-resort local exit also
// bounds leaked handles; it does not claim remote cancellation or cloud deletion.
// The last immutable in-progress receipt retains unresolved-resource evidence.
const timeout = setTimeout(() => {
  controller.abort('deadline');
  process.stderr.write(`Local lifecycle budget exhausted; qualification failed. Inspect unresolved resources in ${journal.latestPath}. Expiry is not verified cleanup.\n`);
  process.exit(1);
}, Math.max(1, budget.remaining(true)));
try {
  const { passed, receipt } = await runDisposableIntegration({ environment: process.env, gitSha, budget,
    signal: controller.signal, output: value => process.stdout.write(value),
    journal: (receipt, signal) => {
      // Work is complete once teardown is admitted. Cleanup can use its reserve
      // without a work-only timer turning an otherwise completed suite into an abort.
      if (['child-shutdown', 'schema-cleanup', 'credential-revocation', 'connection-close', 'branch-deletion'].includes(receipt.stage)) {
        clearTimeout(workTimeout);
      }
      return journal.save(receipt, signal);
    } });
  const sourceUnchanged = budget.remaining(true) > 4_000
    && execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim() === gitSha
    && !execFileSync('git', ['status', '--porcelain'], gitOptions).trim();
  if (controller.signal.aborted && !receipt.cancellationReason) {
    const reason: unknown = controller.signal.reason;
    receipt.cancellationReason = reason === 'deadline' || reason === 'sigint' || reason === 'sigterm' ? reason : 'requested';
  }
  const cancelled = controller.signal.aborted || Boolean(receipt.cancellationReason);
  if (!sourceUnchanged) receipt.failures.push('source-changed');
  if (cancelled && receipt.tests === 'passed' && !receipt.failures.includes('cancelled')) receipt.failures.push('cancelled');
  let qualificationPassed = passed && sourceUnchanged && !cancelled;
  receipt.qualification = qualificationPassed ? 'passed' : 'failed';
  receipt.stage = qualificationPassed ? 'complete' : 'failed';
  await budget.run(signal => journal.save(receipt, signal), { finalization: true, capMs: 2_000 });
  // Signals can arrive during the asynchronous final write. Never reuse its
  // pre-write pass decision for the command result; append a failure snapshot.
  if (controller.signal.aborted && qualificationPassed) {
    qualificationPassed = false;
    const reason: unknown = controller.signal.reason;
    receipt.cancellationReason = reason === 'deadline' || reason === 'sigint' || reason === 'sigterm' ? reason : 'requested';
    receipt.qualification = 'failed'; receipt.stage = 'failed';
    if (!receipt.failures.includes('cancelled')) receipt.failures.push('cancelled');
    try { await budget.run(signal => journal.save(receipt, signal), { finalization: true, capMs: 2_000 }); }
    catch { receipt.failures.push('receipt'); }
  }
  process.exitCode = qualificationPassed ? 0 : 1;
  process.stdout.write(`${JSON.stringify({ outcome: qualificationPassed ? 'passed' : 'failed', receipt: journal.latestPath,
    tests: receipt.tests, childClosed: receipt.childClosed, schemaCleanupVerified: receipt.schemaCleanupVerified,
    credentialsRevoked: receipt.credentialsRevoked, branchDeletionVerified: receipt.branchDeletionVerified,
    cancellationReason: receipt.cancellationReason, unresolvedResources: receipt.unresolvedResources, failures: receipt.failures })}\n`);
} catch {
  process.stderr.write('Disposable integration preflight failed. Check required test-only configuration in integration/README.md. No SQL test pass is claimed.\n');
  process.exitCode = 1;
} finally {
  // Keep the final local exit armed if a failed driver/child left live handles.
  clearTimeout(workTimeout);
  if (process.exitCode === 0) clearTimeout(timeout); else timeout.unref();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
}

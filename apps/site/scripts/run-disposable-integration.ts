import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDisposableIntegration } from '../integration/disposable-integration';

if (process.argv.length !== 2) throw new Error('Disposable integration accepts configuration through its secured environment only.');
const root = fileURLToPath(new URL('../../..', import.meta.url));
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()) {
  throw new Error('Commit the reviewed test source before running disposable integration; qualification must identify one clean Git SHA.');
}
const output = resolve(root, 'test-results', 'integration', `run-${Date.now()}-${randomUUID()}.json`);
await mkdir(dirname(output), { recursive: true });
// Reserve this invocation's path before provisioning; the first journal replaces the empty claim.
await writeFile(output, '', { flag: 'wx', mode: 0o600 });
const controller = new AbortController();
const interrupt = () => controller.abort('sigint');
const terminate = () => controller.abort('sigterm');
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
// Keep the CI job's ten-minute setup/cleanup allowance beyond this lifecycle deadline.
const timeout = setTimeout(() => controller.abort('deadline'), 40 * 60_000);
// Expiry is the final fallback if the OS kills this process before cleanup.
try {
  const { passed, receipt } = await runDisposableIntegration({ environment: process.env, gitSha,
    signal: controller.signal, output: value => process.stdout.write(value),
    journal: receipt => writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 }) });
  const sourceUnchanged = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim() === gitSha
    && !execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  if (controller.signal.aborted && !receipt.cancellationReason) {
    const reason: unknown = controller.signal.reason;
    receipt.cancellationReason = reason === 'deadline' || reason === 'sigint' || reason === 'sigterm' ? reason : 'requested';
  }
  const cancelled = controller.signal.aborted || Boolean(receipt.cancellationReason);
  if (!sourceUnchanged) receipt.failures.push('source-changed');
  if (cancelled && receipt.tests === 'passed' && !receipt.failures.includes('cancelled')) receipt.failures.push('cancelled');
  if (!sourceUnchanged || cancelled) { receipt.stage = 'failed';
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 }); }
  const qualificationPassed = passed && sourceUnchanged && !cancelled;
  process.exitCode = qualificationPassed ? 0 : 1;
  process.stdout.write(`${JSON.stringify({ outcome: qualificationPassed ? 'passed' : 'failed', receipt: output,
    tests: receipt.tests, childClosed: receipt.childClosed, schemaCleanupVerified: receipt.schemaCleanupVerified,
    credentialsRevoked: receipt.credentialsRevoked, branchDeletionVerified: receipt.branchDeletionVerified,
    cancellationReason: receipt.cancellationReason, failures: receipt.failures })}\n`);
} catch {
  process.stderr.write('Disposable integration preflight failed. Check required test-only configuration in integration/README.md. No SQL test pass is claimed.\n');
  process.exitCode = 1;
} finally {
  clearTimeout(timeout); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
}

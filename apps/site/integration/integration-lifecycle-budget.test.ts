import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationLifecycleBudget, INTEGRATION_LIFECYCLE_MS } from './integration-lifecycle-budget';
import { runIntegrationLifecycle, type IntegrationRunReceipt } from './disposable-integration';
import { createIntegrationReceiptJournal } from './integration-receipt-journal';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const never = () => new Promise<never>(() => {});
function fixture() {
  const receipt: IntegrationRunReceipt = { kind: 'disposable-integration-v1', runId: 'fixture', gitSha: 'a'.repeat(40),
    startedAt: 'now', projectId: 'test-project', parentBranchId: 'br-parent', branchId: 'br-owned',
    attemptedBranchName: 'l1-integration-fixture', stage: 'preflight', tests: 'not-run', childClosed: false,
    schemaCleanupVerified: false, credentialsRevoked: false, branchDeletionVerified: false, failures: [], productionWrites: false };
  type Operation = (signal: AbortSignal) => Promise<void>;
  const runtime = { provision: vi.fn<Operation>(async () => {}),
    execute: vi.fn<(signal: AbortSignal) => Promise<{ passed: boolean; closed: boolean }>>(async () => ({ passed: true, closed: true })),
    shutdown: vi.fn<(signal: AbortSignal) => Promise<{ closed: boolean }>>(async () => ({ closed: true })),
    clean: vi.fn<Operation>(async () => {}), revoke: vi.fn<Operation>(async () => {}),
    close: vi.fn<Operation>(async () => {}), delete: vi.fn<Operation>(async () => {}) };
  const snapshots: IntegrationRunReceipt[] = [];
  const journal = vi.fn<Operation>(async () => { snapshots.push(structuredClone(receipt)); });
  return { runtime, receipt, journal, snapshots };
}

describe('one absolute disposable integration lifecycle budget', () => {
  it.each(['provision', 'execute'] as const)('stops hung %s at minute30 and reserves teardown', async phase => {
    const f = fixture();
    f.runtime[phase].mockImplementation(never);
    const result = runIntegrationLifecycle(f.runtime, f.receipt, f.journal);
    await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
    expect(f.runtime.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(false);
    expect(f.runtime[phase].mock.calls[0][0].aborted).toBe(true);
    expect(f.runtime.delete).toHaveBeenCalledOnce();
    expect(f.receipt.cancellationReason).toBe('deadline');
    expect(f.receipt.lifecycle?.elapsedMs).toBe(30 * 60_000);
    expect(f.receipt.branchDeletionVerified).toBe(true);
  });

  it.each(['shutdown', 'clean', 'revoke', 'close', 'delete'] as const)('bounds hung %s and records unresolved resources', async phase => {
    const f = fixture();
    f.runtime[phase].mockImplementation(never);
    const result = runIntegrationLifecycle(f.runtime, f.receipt, f.journal);
    await vi.advanceTimersByTimeAsync(INTEGRATION_LIFECYCLE_MS);
    expect(await result).toBe(false);
    expect(f.receipt.lifecycle!.elapsedMs).toBeLessThan(INTEGRATION_LIFECYCLE_MS);
    expect(f.runtime[phase].mock.calls[0][0].aborted).toBe(true);
    if (phase === 'delete') {
      expect(f.receipt.branchDeletionVerified).toBe(false);
      expect(f.snapshots.at(-1)?.unresolvedResources).toContain('branch-deletion-unverified');
    }
  });

  it('never starts destructive cleanup after unverified child shutdown', async () => {
    const f = fixture();
    f.runtime.execute.mockResolvedValue({ passed: false, closed: false });
    f.runtime.shutdown.mockResolvedValue({ closed: false });
    expect(await runIntegrationLifecycle(f.runtime, f.receipt, f.journal)).toBe(false);
    expect(f.runtime.clean).not.toHaveBeenCalled();
    expect(f.runtime.revoke).not.toHaveBeenCalled();
    expect(f.runtime.delete).toHaveBeenCalledOnce();
    expect(f.receipt.unresolvedResources).toContain('child-closure-unverified');
  });

  it('an aborted teardown cannot mark late deletion or revocation as verified', async () => {
    const f = fixture();
    const revoke = Promise.withResolvers<void>();
    const deletion = Promise.withResolvers<void>();
    f.runtime.revoke.mockReturnValue(revoke.promise); f.runtime.delete.mockReturnValue(deletion.promise);
    const result = runIntegrationLifecycle(f.runtime, f.receipt, f.journal);
    await vi.advanceTimersByTimeAsync(INTEGRATION_LIFECYCLE_MS);
    expect(await result).toBe(false);
    revoke.resolve(); deletion.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(f.receipt.credentialsRevoked).toBe(false);
    expect(f.receipt.branchDeletionVerified).toBe(false);
  });

  it.each(['provision', 'execute', 'clean', 'revoke', 'close', 'delete'] as const)('external cancellation in %s never cancels teardown admission', async phase => {
    const f = fixture(); const external = new AbortController();
    if (phase === 'execute') f.runtime.execute.mockImplementation(async () => {
      external.abort('sigterm'); return { passed: true, closed: true };
    });
    else f.runtime[phase].mockImplementation(async () => { external.abort('sigterm'); });
    expect(await runIntegrationLifecycle(f.runtime, f.receipt, f.journal, external.signal)).toBe(false);
    expect(f.runtime.delete).toHaveBeenCalledOnce();
    expect(f.receipt.cancellationReason).toBe('sigterm');
    expect(f.receipt.branchDeletionVerified).toBe(true);
  });

  it('keeps a conservative last journal if the supervisor is lost during testing', async () => {
    const f = fixture(); f.runtime.execute.mockImplementation(never);
    const result = runIntegrationLifecycle(f.runtime, f.receipt, f.journal);
    await vi.advanceTimersByTimeAsync(1);
    const lastDurable = f.snapshots.at(-1)!;
    expect(lastDurable.stage).toBe('tests');
    expect(lastDurable.tests).toBe('failed');
    expect(lastDurable.unresolvedResources).toEqual(['branch-deletion-unverified', 'credential-revocation-unverified', 'child-closure-unverified']);
    await vi.advanceTimersByTimeAsync(INTEGRATION_LIFECYCLE_MS);
    await result;
  });

  it('bounds every hung journal and still attempts cleanup rather than waiting for disk forever', async () => {
    const f = fixture(); f.journal.mockImplementation(never);
    const result = runIntegrationLifecycle(f.runtime, f.receipt, f.journal);
    await vi.advanceTimersByTimeAsync(INTEGRATION_LIFECYCLE_MS);
    expect(await result).toBe(false);
    expect(f.runtime.provision).not.toHaveBeenCalled();
    expect(f.runtime.delete).toHaveBeenCalledOnce();
    expect(f.receipt.failures).toContain('receipt');
  });

  it('uses monotonic time despite a wall-clock jump and never renews the work deadline per phase', async () => {
    const budget = new IntegrationLifecycleBudget();
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    vi.setSystemTime(new Date('2000-01-01T00:00:00Z'));
    const work = budget.run(never, { work: true }).catch(error => error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await work).toMatchObject({ code: 'INTEGRATION_DEADLINE' });
    expect(budget.elapsed()).toBe(30 * 60_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await expect(budget.run(async () => 'never', { finalization: true })).rejects.toMatchObject({ code: 'INTEGRATION_DEADLINE' });
  });
});

describe('immutable deadline-safe receipt snapshots', () => {
  it('a late old write cannot overwrite the final failure evidence', async () => {
    const writes: { path: string; text: string }[] = [];
    const older = Promise.withResolvers<void>();
    const writer = vi.fn(async (path, text) => {
      writes.push({ path: String(path), text: String(text) });
      if (writes.length === 1) await older.promise;
    });
    const journal = createIntegrationReceiptJournal('run-owned.json', writer);
    const f = fixture(); const oldSignal = new AbortController();
    const old = journal.save(f.receipt, oldSignal.signal).catch(() => undefined);
    oldSignal.abort();
    f.receipt.stage = 'failed'; f.receipt.failures.push('branch-deletion');
    await journal.save(f.receipt, new AbortController().signal);
    older.resolve(); await old;
    expect(writes.map(write => write.path)).toEqual(['run-owned-0001.json', 'run-owned-0002.json']);
    expect(JSON.parse(writes[0].text).failures).toEqual([]);
    expect(JSON.parse(writes[1].text).failures).toEqual(['branch-deletion']);
    expect(journal.latestPath).toBe('run-owned-0002.json');
  });
});

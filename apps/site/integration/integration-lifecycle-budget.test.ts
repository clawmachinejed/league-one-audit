import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationLifecycleBudget, INTEGRATION_LIFECYCLE_MS, integrationLifecycleForQualification } from './integration-lifecycle-budget';
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

  it('does not renew the aggregate cleanup deadline across multiple hung phases', async () => {
    const f = fixture();
    f.runtime.execute.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 29 * 60_000));
      return { passed: true, closed: true };
    });
    for (const phase of ['clean', 'revoke', 'close', 'delete'] as const) f.runtime[phase].mockImplementation(never);
    const result = runIntegrationLifecycle(f.runtime, f.receipt, f.journal);
    await vi.advanceTimersByTimeAsync(INTEGRATION_LIFECYCLE_MS);
    expect(await result).toBe(false);
    expect(f.receipt.lifecycle!.elapsedMs).toBe(INTEGRATION_LIFECYCLE_MS - 10_000);
    expect(f.receipt.failures).toEqual(['schema-cleanup', 'credential-revocation', 'connection-close', 'branch-deletion']);
    expect(f.receipt.schemaCleanupVerified).toBe(false);
    expect(f.receipt.credentialsRevoked).toBe(false);
    expect(f.receipt.branchDeletionVerified).toBe(false);
    for (const phase of ['clean', 'revoke', 'close', 'delete'] as const) {
      expect(f.runtime[phase]).toHaveBeenCalledOnce();
      expect(f.runtime[phase].mock.calls[0][0].aborted).toBe(true);
    }
    expect(f.snapshots.at(-1)?.unresolvedResources).toEqual(['branch-deletion-unverified', 'credential-revocation-unverified']);
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

describe('closed healthy fleet lifecycle', () => {
  it('extends only the explicit named profile and preserves one absolute work deadline', async () => {
    const budget = new IntegrationLifecycleBudget('data-freshness-capacity-healthy-v1');
    expect(budget.envelope).toEqual({ profile: 'data-freshness-capacity-healthy-v1', workMs: 240 * 60_000, lifecycleMs: 250 * 60_000, branchExpiryMs: 270 * 60_000, ciMinutes: 270 });
    const f = fixture(); f.runtime.execute.mockImplementation(never);
    const result = runIntegrationLifecycle(f.runtime, f.receipt, f.journal, undefined, budget);
    await vi.advanceTimersByTimeAsync(240 * 60_000 - 1); expect(f.runtime.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(false);
    expect(f.runtime.execute.mock.calls[0][0].aborted).toBe(true); expect(f.runtime.delete).toHaveBeenCalledOnce();
    expect(f.receipt.lifecycle?.limitMs).toBe(250 * 60_000); expect(f.receipt.cancellationReason).toBe('deadline');
    expect(new IntegrationLifecycleBudget().envelope).toMatchObject({ workMs: 30 * 60_000, lifecycleMs: 40 * 60_000, branchExpiryMs: 60 * 60_000, ciMinutes: 50 });
  });
  it('rejects arbitrary extended deadlines and lookalike profiles', () => {
    for (const value of ['data-freshness-capacity-outage-v1', '270', { workMs: 240 * 60_000 }])
      expect(() => new IntegrationLifecycleBudget(value as 'default')).toThrow('Unknown integration lifecycle profile');
  });
});


describe('closed provider recovery lifecycle', () => {
  it('keeps setup and outage within the same 340 minute work budget and ten minute teardown reserve', async () => {
    const profile='data-freshness-capacity-recovery-v1' as const;
    const budget=new IntegrationLifecycleBudget(profile);
    expect(budget.envelope).toEqual({profile,workMs:340*60_000,lifecycleMs:350*60_000,branchExpiryMs:360*60_000,ciMinutes:360});
    const f=fixture();f.runtime.provision.mockImplementation(async()=>{await new Promise(resolve=>setTimeout(resolve,60*60_000));});f.runtime.execute.mockImplementation(never);
    const result=runIntegrationLifecycle(f.runtime,f.receipt,f.journal,undefined,budget);
    await vi.advanceTimersByTimeAsync(340*60_000-1);expect(f.runtime.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(await result).toBe(false);
    expect(f.runtime.execute.mock.calls[0][0].aborted).toBe(true);expect(f.receipt.lifecycle?.limitMs).toBe(350*60_000);
    expect(f.receipt.lifecycle?.elapsedMs).toBe(340*60_000);expect(f.runtime.delete).toHaveBeenCalledOnce();
  });
  it('selects only the exact closed names and keeps historical profiles on the default envelope',()=>{
    expect(integrationLifecycleForQualification('data-freshness-capacity-healthy-v1')).toBe('data-freshness-capacity-healthy-v1');
    expect(integrationLifecycleForQualification('data-freshness-capacity-recovery-v1')).toBe('data-freshness-capacity-recovery-v1');
    for(const profile of ['full','data-batch-calibration-v1','data-freshness-capacity-recovery-v2',undefined])expect(integrationLifecycleForQualification(profile)).toBe('default');
  });
});

describe('closed local daily lifecycle',()=>{
  it('keeps the 25 hour observation inside one original 26 hour work deadline',async()=>{
    const profile='data-freshness-capacity-daily-v1' as const,budget=new IntegrationLifecycleBudget(profile);
    expect(integrationLifecycleForQualification(profile)).toBe(profile);
    expect(budget.envelope).toEqual({profile,workMs:26*60*60_000,lifecycleMs:(26*60+10)*60_000,branchExpiryMs:27*60*60_000,ciMinutes:null});
    const f=fixture();f.runtime.provision.mockImplementation(async()=>{await new Promise(resolve=>setTimeout(resolve,30*60_000));});f.runtime.execute.mockImplementation(never);
    const result=runIntegrationLifecycle(f.runtime,f.receipt,f.journal,undefined,budget);
    await vi.advanceTimersByTimeAsync(26*60*60_000-1);expect(f.runtime.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(await result).toBe(false);expect(f.receipt.lifecycle?.elapsedMs).toBe(26*60*60_000);
    expect(f.runtime.execute.mock.calls[0][0].aborted).toBe(true);expect(f.runtime.delete).toHaveBeenCalledOnce();
    expect(budget.deadline-budget.workDeadline).toBe(10*60_000);
    expect(new IntegrationLifecycleBudget().envelope).toEqual({profile:'default',workMs:30*60_000,lifecycleMs:40*60_000,branchExpiryMs:60*60_000,ciMinutes:50});
  });
  it('rejects duration and near-match names rather than extending the default',()=>{
    expect(integrationLifecycleForQualification('data-freshness-capacity-daily-v2')).toBe('default');
    expect(()=>new IntegrationLifecycleBudget('26h' as 'default')).toThrow('Unknown');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationRunReceipt, runDisposableIntegration } from '../integration/disposable-integration';

const mocked = vi.hoisted(() => ({ git: vi.fn(), uuid: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), run: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: mocked.git }));
vi.mock('node:crypto', () => ({ randomUUID: mocked.uuid }));
vi.mock('node:fs/promises', () => ({ mkdir: mocked.mkdir, writeFile: mocked.writeFile }));
vi.mock('../integration/disposable-integration', () => ({ runDisposableIntegration: mocked.run }));

type RunOptions = Parameters<typeof runDisposableIntegration>[0];
const originalArguments = process.argv;
const originalExitCode = process.exitCode;
const originalInterrupts = process.listeners('SIGINT');
const originalTerminations = process.listeners('SIGTERM');
const messages: string[] = [];
const sha = 'a'.repeat(40);
const firstUuid = '00000000-0000-4000-8000-000000000001';
const secondUuid = '00000000-0000-4000-8000-000000000002';

function receipt(cancellationReason?: IntegrationRunReceipt['cancellationReason']): IntegrationRunReceipt {
  return { kind: 'disposable-integration-v1', runId: 'fixture', gitSha: sha,
    projectId: 'test-project', parentBranchId: 'test-parent', startedAt: '2026-09-28T00:00:00Z',
    stage: cancellationReason ? 'failed' : 'complete', tests: cancellationReason ? 'failed' : 'passed',
    childClosed: true, schemaCleanupVerified: true, credentialsRevoked: true,
    branchDeletionVerified: true, productionWrites: false,
    failures: cancellationReason ? ['tests'] : [], cancellationReason };
}

function waitForCancellation() {
  const ready = Promise.withResolvers<RunOptions>();
  const cleanup = Promise.withResolvers<void>();
  mocked.run.mockImplementation((options: RunOptions) => {
    ready.resolve(options);
    return new Promise(resolve => options.signal.addEventListener('abort', () => {
      void cleanup.promise.then(() => resolve({ passed: false, receipt: receipt(options.signal.reason) }));
    }, { once: true }));
  });
  return { ready: ready.promise, finishCleanup: () => cleanup.resolve() };
}

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks();
  process.argv = [process.execPath, 'run-disposable-integration.ts'];
  process.exitCode = undefined;
  messages.length = 0;
  mocked.git.mockImplementation((_command: string, arguments_: string[]) => arguments_[0] === 'status' ? '' : sha);
  mocked.uuid.mockReturnValue(firstUuid);
  mocked.mkdir.mockResolvedValue(undefined); mocked.writeFile.mockResolvedValue(undefined);
  mocked.run.mockResolvedValue({ passed: true, receipt: receipt() });
  vi.spyOn(process.stdout, 'write').mockImplementation(value => { messages.push(String(value)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(value => { messages.push(String(value)); return true; });
});

afterEach(() => {
  for (const listener of process.listeners('SIGINT')) {
    if (!originalInterrupts.includes(listener)) process.removeListener('SIGINT', listener);
  }
  for (const listener of process.listeners('SIGTERM')) {
    if (!originalTerminations.includes(listener)) process.removeListener('SIGTERM', listener);
  }
  vi.useRealTimers(); vi.restoreAllMocks();
  process.argv = originalArguments; process.exitCode = originalExitCode;
});

describe('disposable integration command cancellation and source evidence', () => {
  it('allows the full 40-minute budget and records a deadline abort while awaiting cleanup', async () => {
    const { ready, finishCleanup } = waitForCancellation();
    const executing = import('./run-disposable-integration');
    const options = await ready;
    await vi.advanceTimersByTimeAsync(40 * 60_000 - 1);
    expect(options.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(options.signal.reason).toBe('deadline');
    expect(process.exitCode).toBeUndefined();
    expect(messages).toEqual([]);
    finishCleanup();
    await executing;
    expect(options.signal.reason).toBe('deadline');
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(messages.at(-1)!)).toMatchObject({ outcome: 'failed', cancellationReason: 'deadline',
      childClosed: true, schemaCleanupVerified: true, credentialsRevoked: true, branchDeletionVerified: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([['SIGINT', 'sigint'], ['SIGTERM', 'sigterm']] as const)(
    'preserves %s as the cancellation reason and removes handlers', async (signal, reason) => {
      const { ready, finishCleanup } = waitForCancellation();
      const before = process.listeners(signal);
      const executing = import('./run-disposable-integration');
      const options = await ready;
      const handler = process.listeners(signal).find(listener => !before.includes(listener));
      expect(handler).toBeDefined();
      handler!(signal);
      await vi.advanceTimersByTimeAsync(40 * 60_000);
      expect(options.signal.reason).toBe(reason);
      finishCleanup();
      await executing;
      expect(options.signal.reason).toBe(reason);
      expect(JSON.parse(messages.at(-1)!)).toMatchObject({ outcome: 'failed', cancellationReason: reason });
      expect(process.listeners(signal)).toEqual(before);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects a dirty source before provisioning or creating receipt files', async () => {
    mocked.git.mockImplementation((_command: string, arguments_: string[]) => arguments_[0] === 'status' ? ' M reviewed-source.ts' : sha);
    await expect(import('./run-disposable-integration')).rejects.toThrow('Commit the reviewed test source');
    expect(mocked.run).not.toHaveBeenCalled();
    expect(mocked.mkdir).not.toHaveBeenCalled();
    expect(mocked.writeFile).not.toHaveBeenCalled();
  });

  it('fails qualification and rewrites the receipt if tests alter tracked source', async () => {
    let statusReads = 0;
    mocked.git.mockImplementation((_command: string, arguments_: string[]) => {
      if (arguments_[0] !== 'status') return sha;
      return statusReads++ === 0 ? '' : ' M reviewed-source.ts';
    });
    await import('./run-disposable-integration');
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(mocked.writeFile.mock.calls.at(-1)![1])).toMatchObject({ stage: 'failed', failures: ['source-changed'] });
    expect(JSON.parse(messages.at(-1)!)).toMatchObject({ outcome: 'failed', failures: ['source-changed'] });
  });

  it('clears the deadline after a complete run without inventing a cancellation reason', async () => {
    await import('./run-disposable-integration');
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(messages.at(-1)!)).toMatchObject({ outcome: 'passed', tests: 'passed' });
    expect(JSON.parse(messages.at(-1)!)).not.toHaveProperty('cancellationReason');
    expect(vi.getTimerCount()).toBe(0);
    expect(process.listeners('SIGINT')).toEqual(originalInterrupts);
    expect(process.listeners('SIGTERM')).toEqual(originalTerminations);
  });

  it('rejects a stale passed result if the deadline fired while cleanup was finishing', async () => {
    const ready = Promise.withResolvers<RunOptions>();
    const cleanup = Promise.withResolvers<void>();
    mocked.run.mockImplementation(async (options: RunOptions) => {
      ready.resolve(options);
      await cleanup.promise;
      return { passed: true, receipt: receipt() };
    });
    const executing = import('./run-disposable-integration');
    const options = await ready.promise;
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(options.signal.reason).toBe('deadline');
    cleanup.resolve();
    await executing;
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(mocked.writeFile.mock.calls.at(-1)![1])).toMatchObject({
      tests: 'passed', stage: 'failed', cancellationReason: 'deadline', failures: ['cancelled'],
    });
    expect(JSON.parse(messages.at(-1)!)).toMatchObject({ outcome: 'failed', cancellationReason: 'deadline' });
  });

  it('rejects a passed result carrying an internal cancellation reason even without a CLI abort', async () => {
    const result = { ...receipt(), cancellationReason: 'ownership-lost' as const, failures: ['cancelled'] };
    mocked.run.mockResolvedValue({ passed: true, receipt: result });
    await import('./run-disposable-integration');
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(mocked.writeFile.mock.calls.at(-1)![1])).toMatchObject({
      tests: 'passed', stage: 'failed', cancellationReason: 'ownership-lost', failures: ['cancelled'],
    });
    expect(JSON.parse(messages.at(-1)!)).toMatchObject({ outcome: 'failed', cancellationReason: 'ownership-lost' });
  });
});

describe('disposable integration receipt ownership', () => {
  it('gives same-timestamp invocations distinct exclusively claimed paths and keeps later journals on each path', async () => {
    vi.setSystemTime(new Date('2026-09-28T00:00:00Z'));
    const timestamp = Date.now();
    mocked.uuid.mockReturnValueOnce(firstUuid).mockReturnValueOnce(secondUuid);
    const journals: RunOptions['journal'][] = [];
    mocked.run.mockImplementation(async (options: RunOptions) => {
      journals.push(options.journal);
      await options.journal({ ...receipt(), stage: 'provision' });
      await options.journal(receipt());
      return { passed: true, receipt: receipt() };
    });
    await import('./run-disposable-integration');
    vi.resetModules();
    await import('./run-disposable-integration');
    expect(Date.now()).toBe(timestamp);
    const firstPath = mocked.writeFile.mock.calls[0][0];
    const secondPath = mocked.writeFile.mock.calls[3][0];
    expect(firstPath).toContain(`run-${timestamp}-${firstUuid}.json`);
    expect(secondPath).toContain(`run-${timestamp}-${secondUuid}.json`);
    expect(firstPath).not.toBe(secondPath);
    expect(mocked.writeFile.mock.calls.slice(0, 3).map(call => call[0])).toEqual([firstPath, firstPath, firstPath]);
    expect(mocked.writeFile.mock.calls.slice(3, 6).map(call => call[0])).toEqual([secondPath, secondPath, secondPath]);
    expect(mocked.writeFile.mock.calls[0]).toEqual([firstPath, '', { flag: 'wx', mode: 0o600 }]);
    expect(mocked.writeFile.mock.calls[3]).toEqual([secondPath, '', { flag: 'wx', mode: 0o600 }]);
    expect(mocked.writeFile.mock.calls[1][2]).toEqual({ mode: 0o600 });
    expect(mocked.writeFile.mock.calls[4][2]).toEqual({ mode: 0o600 });
    await journals[0]({ ...receipt(), stage: 'schema-cleanup' });
    expect(mocked.writeFile.mock.calls.at(-1)![0]).toBe(firstPath);
    expect(messages.map(message => JSON.parse(message).receipt)).toEqual([firstPath, secondPath]);
  });

  it('fails before provisioning if the exclusive receipt claim finds an existing path', async () => {
    const collision = Object.assign(new Error('Existing receipt'), { code: 'EEXIST' });
    mocked.writeFile.mockRejectedValueOnce(collision);
    await expect(import('./run-disposable-integration')).rejects.toBe(collision);
    expect(mocked.writeFile).toHaveBeenCalledOnce();
    expect(mocked.writeFile.mock.calls[0][2]).toEqual({ flag: 'wx', mode: 0o600 });
    expect(mocked.run).not.toHaveBeenCalled();
    expect(messages).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

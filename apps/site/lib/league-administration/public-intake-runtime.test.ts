import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ database: vi.fn(), bounded: vi.fn(), administration: vi.fn(), intake: vi.fn(),
  refresh: vi.fn(), jobs: vi.fn(), run: vi.fn(), batch: vi.fn(), directory: vi.fn(), configure: vi.fn(), configureResource: vi.fn(), submit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../database', () => ({ getDatabase: mocks.database, withDatabaseAbortSignal: mocks.bounded }));
vi.mock('../projection-store', () => ({ createProjectionStore: mocks.jobs }));
vi.mock('./store', () => ({ createLeagueAdministrationStore: mocks.administration, createPublicIntakeStore: mocks.intake,
  createPublicDataRefreshStore: mocks.refresh }));
vi.mock('./public-intake', () => ({ runPublicDataRefreshStep: mocks.run, runPublicDataBatch: mocks.batch, runPublicIntakeStep: vi.fn(), runPublicPlayerDirectoryStep: mocks.directory }));
import { configurePublicSleeperResourceSchedule, configurePublicSleeperRefresh, submitPublicSleeperIntake, runSelectedPublicIntakeBatch, runSelectedPublicDataRefresh, runSelectedPublicPlayerDirectory, type PublicDataRefreshSelection } from './public-intake-runtime';
const start = Date.parse('2026-10-06T12:00:00Z');
const enabled = { enabled: true } as const;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(start); vi.resetAllMocks();
  mocks.database.mockReturnValue({ enabled: true }); mocks.bounded.mockImplementation((database, signal) => ({ ...database, signal }));
  mocks.refresh.mockReturnValue({ configure: mocks.configure, configureResourceSchedule: mocks.configureResource }); mocks.intake.mockReturnValue({ submitWithReceipt: mocks.submit }); mocks.jobs.mockReturnValue({});
  mocks.administration.mockReturnValue({}); mocks.run.mockResolvedValue({ status: 'idle', providerRequests: 0 });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('closed opt-in batch runtime', () => {
  const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const selection = { enabled: true, requestId, batchPolicy: 'public-data-batch-v1' } as const;
  it.each([undefined, null, {}, { ...selection, enabled: false }, { ...selection, requestId: 'wrong' },
    { ...selection, batchPolicy: undefined }, { ...selection, batchPolicy: 'future' },
    { ...selection, managerEvidenceVersion: 'v3' }])('rejects missing, disabled or unknown selection before storage: %j', async value => {
    expect(await runSelectedPublicIntakeBatch(value as never, start)).toEqual({ status: 'disabled', providerRequests: 0 });
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, start + 1, start - 5001])('rejects an invalid original invocation time before storage: %s', async origin => {
    expect(await runSelectedPublicIntakeBatch(selection, origin)).toEqual({ status: 'deadline', providerRequests: 0 });
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('awaits the selected direct batch with its request and original time through the shared bounded composition', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    mocks.database.mockImplementation(() => { vi.setSystemTime(start + 4000); return { enabled: true }; });
    const outcome = { status: 'complete', providerRequests: 26, completedSteps: 18, stopReason: 'work-status' };
    mocks.batch.mockResolvedValue(outcome);
    expect(await runSelectedPublicIntakeBatch(selection, start)).toBe(outcome);
    expect(mocks.batch).toHaveBeenCalledExactlyOnceWith(requestId, expect.objectContaining({
      deadlineAt: '2026-10-06T12:00:20.000Z', preAdmission: expect.objectContaining({ signal: expect.any(AbortSignal) }),
    }), expect.any(AbortSignal), start);
    expect(timeout.mock.calls.map(call => call[0])).toEqual([16000, 6000]);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('selects recurring batches explicitly and preserves the omitted-policy legacy path', async () => {
    await runSelectedPublicDataRefresh({ enabled: true, batchPolicy: selection.batchPolicy }, start);
    expect(mocks.batch).toHaveBeenCalledWith(undefined, expect.anything(), expect.any(AbortSignal), start);
    expect(mocks.run).not.toHaveBeenCalled();
    await runSelectedPublicDataRefresh(enabled, start);
    expect(mocks.run).toHaveBeenCalledOnce();
  });
  it('keeps direct batch claim and admission on the early client and cleanup inside the original deadline', async () => {
    mocks.intake.mockImplementation(client => ({ client }));
    mocks.batch.mockImplementation(async (_requestId, dependencies, signal) => {
      expect(dependencies.intake.client.signal).toBe(signal);
      expect(dependencies.preAdmission.intake.client.signal).toBe(dependencies.preAdmission.signal);
      expect(dependencies.preAdmission.signal).not.toBe(signal);
      vi.setSystemTime(start + 22001); dependencies.cleanup();
      expect(mocks.bounded.mock.calls.at(-1)![1].aborted).toBe(true);
      return { status: 'unavailable', providerRequests: 0 };
    });
    await runSelectedPublicIntakeBatch(selection, start);
    expect(mocks.batch).toHaveBeenCalledOnce();
  });
});

describe('controlled durable submission runtime', () => {
  const input = { id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', username: 'Any_Manager', seasons: [2026] };
  const selection = { enabled: true, requestId: input.id.toLowerCase() } as const;
  it.each(['retained', 'capacity'] as const)('returns the durable %s receipt through the existing abort-bound store', async status => {
    const receipt = { status, requestId: selection.requestId };
    mocks.submit.mockResolvedValue(receipt);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    expect(await submitPublicSleeperIntake(input, selection)).toEqual(receipt);
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({ ...input, id: selection.requestId });
    expect(timeout).toHaveBeenCalledWith(3_000);
    expect(mocks.intake).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('does not construct storage for disabled selection or malformed inputs', async () => {
    await expect(submitPublicSleeperIntake(input, { ...selection, enabled: false } as never)).rejects.toThrow('not enabled');
    await expect(submitPublicSleeperIntake({ ...input, username: 123 } as never, selection)).rejects.toThrow('Invalid public intake');
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('keeps missing storage disabled and never converts storage errors into retained receipts', async () => {
    mocks.database.mockReturnValue({ enabled: false });
    expect(await submitPublicSleeperIntake(input, selection)).toEqual({ status: 'disabled' });
    expect(mocks.submit).not.toHaveBeenCalled();
    mocks.database.mockReturnValue({ enabled: true });
    mocks.submit.mockRejectedValue(new Error('storage unavailable'));
    await expect(submitPublicSleeperIntake(input, selection)).rejects.toThrow('storage unavailable');
  });
});

describe('explicit DATA recurrence runtime budget', () => {
  it('performs no storage construction when disabled or too late to admit work', async () => {
    expect(await runSelectedPublicDataRefresh({ enabled: false } as unknown as PublicDataRefreshSelection, start)).toEqual({ status: 'disabled', providerRequests: 0 });
    vi.setSystemTime(start + 6000);
    expect(await runSelectedPublicDataRefresh(enabled, start)).toEqual({ status: 'deadline', providerRequests: 0 });
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it('keeps delayed setup inside the original 20 second work fence', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    mocks.database.mockImplementation(() => { vi.setSystemTime(start + 4000); return { enabled: true }; });
    await runSelectedPublicDataRefresh({ ...enabled, managerEvidenceVersion: 'v2' }, start);
    expect(timeout).toHaveBeenCalledWith(16000);
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ deadlineAt: '2026-10-06T12:00:20.000Z', managerEvidenceVersion: 'v2' }), expect.any(AbortSignal));
  });
  it('does not start acquisition after setup has exhausted the original budget', async () => {
    mocks.database.mockImplementation(() => { vi.setSystemTime(start + 20001); return { enabled: true }; });
    expect(await runSelectedPublicDataRefresh(enabled, start)).toEqual({ status: 'deadline', providerRequests: 0 });
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.bounded).not.toHaveBeenCalled();
  });
  it.each([21000, 21500, 23000])('bounds cleanup to invocation+22 seconds after work finishes at %i', async elapsed => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    mocks.run.mockImplementation(async dependencies => {
      vi.setSystemTime(start + elapsed); dependencies.cleanup();
      const cleanupSignal = mocks.bounded.mock.calls.at(-1)![1] as AbortSignal;
      if (elapsed >= 22000) expect(cleanupSignal.aborted).toBe(true);
      else expect(timeout).toHaveBeenLastCalledWith(22000 - elapsed);
      return { status: 'unavailable', providerRequests: 0 };
    });
    expect((await runSelectedPublicDataRefresh(enabled, start)).status).toBe('unavailable');
    expect(mocks.bounded).toHaveBeenCalledTimes(3);
  });
  it('does not configure an explicit disabled runtime or query a disabled database', async () => {
    const input = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedRevision: 0,
      identityRequestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', seasons: [2026], cadenceSeconds: 3600,
      expiresAt: '2026-10-07T12:00:00Z', paused: false };
    expect(await configurePublicSleeperRefresh(input, { enabled: false } as unknown as PublicDataRefreshSelection)).toEqual({ status: 'disabled' });
    expect(mocks.database).not.toHaveBeenCalled();
    mocks.database.mockReturnValue({ enabled: false, reason: 'missing-database-url' });
    expect(await configurePublicSleeperRefresh(input, enabled)).toEqual({ status: 'disabled' });
    expect(mocks.configure).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('malformed recurrence runtime selection', () => {
  it.each([null, undefined, {}, { enabled: false }, { enabled: true, managerEvidenceVersion: 'v3' }])(
    'does not construct storage for %o', async selection => {
      expect(await runSelectedPublicDataRefresh(selection as PublicDataRefreshSelection | null | undefined, start)).toEqual({ status: 'disabled', providerRequests: 0 });
      expect(await configurePublicSleeperRefresh(null as never, selection as PublicDataRefreshSelection | null | undefined)).toEqual({ status: 'disabled' });
      expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
    });
});

describe('actual abort-aware admission database routing', () => {
  it('uses the early signal for claim/selection/state/admission and a separate live signal for later work', async () => {
    const actual = await vi.importActual<typeof import('../database')>('../database');
    const controllers: AbortController[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { const controller = new AbortController(); controllers.push(controller); return controller.signal; });
    let acceptedQueries = 0;
    const query = vi.fn(async (_statement: string, _parameters: readonly unknown[], options: { signal: AbortSignal }) => {
      options.signal.throwIfAborted(); acceptedQueries++; return [];
    });
    const base = { enabled: true, query };
    mocks.database.mockReturnValue(base); mocks.bounded.mockImplementation(actual.withDatabaseAbortSignal);
    mocks.intake.mockImplementation(client => ({ recover: () => client.query('recover'), next: () => client.query('next'), admit: () => client.query('admit') }));
    mocks.refresh.mockImplementation(client => ({ select: () => client.query('select'), recordSelectionFailure: () => client.query('reconcile') }));
    mocks.jobs.mockImplementation(client => ({ acquireJob: () => client.query('claim'), failJob: () => client.query('cleanup') }));
    mocks.run.mockImplementation(async (dependencies, signal) => {
      const phase = dependencies.preAdmission;
      await phase.jobs.acquireJob(); await phase.refresh.select(); await phase.intake.recover(); await phase.intake.next(); await phase.intake.admit();
      for (const call of query.mock.calls as unknown as [string, unknown[], { signal: AbortSignal }][]) expect(call[2].signal).toBe(phase.signal);
      expect(signal).not.toBe(phase.signal); expect(controllers).toHaveLength(2);
      controllers[1].abort(new Error('phase deadline'));
      const accepted = acceptedQueries;
      await expect(phase.intake.next()).rejects.toThrow('phase deadline'); expect(acceptedQueries).toBe(accepted);
      expect(signal.aborted).toBe(false);
      await dependencies.intake.next(); expect(acceptedQueries).toBe(accepted + 1);
      vi.setSystemTime(start + 10_000); await phase.cleanup().refresh.recordSelectionFailure();
      expect(controllers).toHaveLength(3); expect(controllers[2].signal.aborted).toBe(false);
      expect((query.mock.calls.at(-1) as unknown as [string, unknown[], { signal: AbortSignal }])[2].signal).toBe(controllers[2].signal);
      return { status: 'unavailable', providerRequests: 0 };
    });
    expect((await runSelectedPublicDataRefresh(enabled, start)).status).toBe('unavailable');
  });
  it.each([10_000, 19_500, 21_000])('clips admission reconciliation to the original work fence at elapsed %i', async elapsed => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    mocks.run.mockImplementation(async dependencies => {
      vi.setSystemTime(start + elapsed); dependencies.preAdmission.cleanup();
      const cleanupSignal = mocks.bounded.mock.calls.at(-1)![1] as AbortSignal;
      if (elapsed >= 20_000) expect(cleanupSignal.aborted).toBe(true);
      else expect(timeout).toHaveBeenLastCalledWith(Math.min(2000, 20_000 - elapsed));
      return { status: 'unavailable', providerRequests: 0 };
    });
    await runSelectedPublicDataRefresh(enabled, start);
  });
  it('does not select any target when setup has already consumed the early phase', async () => {
    mocks.database.mockImplementation(() => { vi.setSystemTime(start + 10_001); return { enabled: true }; });
    expect(await runSelectedPublicDataRefresh(enabled, start)).toEqual({ status: 'deadline', providerRequests: 0 });
    expect(mocks.bounded).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
});


describe('explicit shared player directory runtime', () => {
  it.each([null, undefined, {}, { enabled: false }])('remains dormant for selection %o', async selection => {
    expect(await runSelectedPublicPlayerDirectory(selection as { enabled: true } | null | undefined, start))
      .toEqual({ status: 'disabled', providerRequests: 0 });
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.directory).not.toHaveBeenCalled();
  });
  it('uses the same original 20-second work deadline and bounded 2-second cleanup', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    mocks.database.mockImplementation(() => { vi.setSystemTime(start + 4000); return { enabled: true }; });
    mocks.directory.mockImplementation(async (dependencies, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(dependencies.deadlineAt).toBe('2026-10-06T12:00:20.000Z');
      vi.setSystemTime(start + 21_000); dependencies.cleanup();
      expect(timeout).toHaveBeenLastCalledWith(1000);
      return { status: 'progress', resource: 'player-directory', providerRequests: 1 };
    });
    expect(await runSelectedPublicPlayerDirectory(enabled, start)).toMatchObject({ status: 'progress', providerRequests: 1 });
    expect(timeout).toHaveBeenCalledWith(16000); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('does not acquire a job after setup exhausts the original deadline', async () => {
    mocks.database.mockImplementation(() => { vi.setSystemTime(start + 20_001); return { enabled: true }; });
    expect(await runSelectedPublicPlayerDirectory(enabled, start)).toEqual({ status: 'deadline', providerRequests: 0 });
    expect(mocks.directory).not.toHaveBeenCalled(); expect(mocks.bounded).not.toHaveBeenCalled();
  });
});

describe('closed resource scheduling runtime', () => {
  const selection = { enabled: true, batchPolicy: 'public-data-batch-v1', schedulingPolicy: 'public-data-resource-schedule-v1' } as const;
  const input = { targetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedRevision: 2,
    activePeriods: [{ season: 2026 as const, externalLeagueId: '99', nativeWeek: 7 }] };
  it.each([{ ...selection, enabled: 'true' }, { ...selection, batchPolicy: undefined },
    { ...selection, schedulingPolicy: 'future' }, { ...selection, schedulingPolicy: ['public-data-resource-schedule-v1'] }])(
    'rejects unsupported policy before database or source work: %#', async value => {
      expect(await runSelectedPublicDataRefresh(value as never, start)).toEqual({ status: 'disabled', providerRequests: 0 });
      expect(await configurePublicSleeperResourceSchedule(input, value as never)).toEqual({ status: 'disabled' });
      expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
    });
  it('requires global fair selection rather than a fixed-request batch', async () => {
    expect(await runSelectedPublicIntakeBatch({ ...selection, requestId: input.targetId }, start)).toEqual({ status: 'disabled', providerRequests: 0 });
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('configures only a validated immutable declaration on bounded storage', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout'); const configured = { targetId: input.targetId, configurationRevision: 2 };
    mocks.configureResource.mockResolvedValue(configured);
    expect(await configurePublicSleeperResourceSchedule(input, selection)).toBe(configured);
    expect(mocks.configureResource).toHaveBeenCalledExactlyOnceWith(input); expect(timeout).toHaveBeenCalledWith(3000);
    expect(mocks.configure).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('passes the closed policy through the original admission/work/cleanup windows', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    mocks.batch.mockImplementation(async (_requestId, dependencies) => {
      expect(dependencies.schedulingPolicy).toBe(selection.schedulingPolicy);
      expect(dependencies.deadlineAt).toBe(new Date(start + 20000).toISOString());
      vi.setSystemTime(start + 21000); dependencies.cleanup();
      return { status: 'idle', providerRequests: 0 };
    });
    expect(await runSelectedPublicDataRefresh(selection, start)).toEqual({ status: 'idle', providerRequests: 0 });
    expect(mocks.batch).toHaveBeenCalledExactlyOnceWith(undefined, expect.anything(), expect.any(AbortSignal), start);
    expect(timeout.mock.calls.map(([value]) => value)).toEqual([20000, 10000, 1000]);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

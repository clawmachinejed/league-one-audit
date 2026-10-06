import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ database: vi.fn(), bounded: vi.fn(), administration: vi.fn(), intake: vi.fn(),
  refresh: vi.fn(), jobs: vi.fn(), run: vi.fn(), configure: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../database', () => ({ getDatabase: mocks.database, withDatabaseAbortSignal: mocks.bounded }));
vi.mock('../projection-store', () => ({ createProjectionStore: mocks.jobs }));
vi.mock('./store', () => ({ createLeagueAdministrationStore: mocks.administration, createPublicIntakeStore: mocks.intake,
  createPublicDataRefreshStore: mocks.refresh }));
vi.mock('./public-intake', () => ({ runPublicDataRefreshStep: mocks.run, runPublicIntakeStep: vi.fn() }));
import { configurePublicSleeperRefresh, runSelectedPublicDataRefresh, type PublicDataRefreshSelection } from './public-intake-runtime';
const start = Date.parse('2026-10-06T12:00:00Z');
const enabled = { enabled: true } as const;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(start); vi.resetAllMocks();
  mocks.database.mockReturnValue({ enabled: true }); mocks.bounded.mockImplementation((database, signal) => ({ ...database, signal }));
  mocks.refresh.mockReturnValue({ configure: mocks.configure }); mocks.intake.mockReturnValue({}); mocks.jobs.mockReturnValue({});
  mocks.administration.mockReturnValue({}); mocks.run.mockResolvedValue({ status: 'idle', providerRequests: 0 });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

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

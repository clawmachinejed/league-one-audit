import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ current: vi.fn(), future: vi.fn(), preflight: vi.fn(), runCurrent: vi.fn(), runFuture: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./projection-composition', () => ({
  createProductionProjectionDependencies: runtime.current,
}));
vi.mock('./future-projection-composition', () => ({ createProductionFutureProjectionDependencies: runtime.future }));
vi.mock('../worker/current-lineup-context', () => ({ refreshCurrentLineupContext: runtime.preflight }));
vi.mock('../worker/orchestrator', () => ({ runWithDependencies: runtime.runCurrent }));
vi.mock('../worker/future-orchestrator', () => ({ runFutureWithDependencies: runtime.runFuture }));

import { runProductionProjectionSync } from './projection-dispatch';

const now = new Date('2026-09-03T12:00:00.000Z');
const period = { season: 2026, seasonType: 'regular', week: 1 };
const current = {
  repository: { enabled: true }, lineupRepository: { enabled: true },
  clock: { now: () => now, monotonicNow: () => 100 }, idGenerator: { generate: () => 'fixed-worker' },
  logger: { write: vi.fn() }, nflCalendar: { getCadenceState: vi.fn() },
};
const future = { fixture: 'future-capabilities' };

function preflight(lane: 'current' | 'future') {
  return {
    context: {
      kind: 'stored', authorities: [{ configuration: { key: 'league1' } }, { configuration: { key: 'league2' } }],
      skippedLeagueKeys: [] as string[],
      states: ['league1', 'league2'].map((key) => ({ configuration: { key }, period,
        materializationLane: lane, watchClass: 'current', retiredAt: null })),
    },
    failedCadenceLeagueKeys: [] as string[],
    cadenceByKey: new Map(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  current.repository.enabled = true;
  current.lineupRepository.enabled = true;
  runtime.current.mockReturnValue(current);
  runtime.future.mockReturnValue(future);
  runtime.runCurrent.mockResolvedValue({ status: 'skipped', reason: 'idle', cadence: 'idle' });
  runtime.runFuture.mockResolvedValue({ status: 'completed', action: 'materialize', period,
    publishedLeagues: 1, unchangedLeagues: 1, failedLeagues: 0 });
  runtime.preflight.mockImplementation(async (dependencies) => {
    await dependencies.nflCalendar.getCadenceState();
    return preflight('current');
  });
});

describe('existing force maintenance dispatch', () => {
  it('keeps every ordinary current invocation away from the future lane', async () => {
    await expect(runProductionProjectionSync()).resolves.toEqual({ status: 'skipped', reason: 'idle', cadence: 'idle' });
    expect(runtime.runCurrent).toHaveBeenCalledExactlyOnceWith(current, {});
    expect(runtime.preflight).not.toHaveBeenCalled();
    expect(runtime.future).not.toHaveBeenCalled();
    expect(runtime.runFuture).not.toHaveBeenCalled();
  });

  it.each(['repository', 'lineupRepository'] as const)('exits disabled force before provider work if %s is disabled', async (field) => {
    current[field].enabled = false;
    await expect(runProductionProjectionSync({ force: true })).resolves.toEqual({ status: 'disabled' });
    expect(runtime.preflight).not.toHaveBeenCalled();
    expect(runtime.runCurrent).not.toHaveBeenCalled();
    expect(runtime.future).not.toHaveBeenCalled();
  });

  it('reuses one prepared authority refresh when current owns the default', async () => {
    const prepared = preflight('current');
    runtime.preflight.mockImplementation(async () => {
      await current.nflCalendar.getCadenceState();
      return prepared;
    });
    await runProductionProjectionSync({ force: true });
    expect(current.nflCalendar.getCadenceState).toHaveBeenCalledTimes(1);
    expect(runtime.preflight).toHaveBeenCalledExactlyOnceWith(current, 'fixed-worker');
    expect(runtime.runCurrent).toHaveBeenCalledExactlyOnceWith(current, { force: true }, {
      runId: 'fixed-worker', now, runStartedAt: 100, value: prepared,
    });
    expect(runtime.future).not.toHaveBeenCalled();
  });

  it('hands one preseason default period to the future owner and maps the unchanged legacy result shape', async () => {
    runtime.preflight.mockImplementation(async () => {
      await current.nflCalendar.getCadenceState();
      return preflight('future');
    });
    await expect(runProductionProjectionSync({ force: true })).resolves.toEqual({
      status: 'completed', cadence: 'forced', publishedLeagues: 2, failedLeagues: 0, providerGroups: 1,
    });
    expect(current.nflCalendar.getCadenceState).toHaveBeenCalledTimes(1);
    expect(runtime.runCurrent).not.toHaveBeenCalled();
    expect(runtime.future).toHaveBeenCalledTimes(1);
    expect(runtime.runFuture).toHaveBeenCalledExactlyOnceWith(future, {
      period, leagueKeys: ['league1', 'league2'], execution: {
        now, runId: 'fixed-worker', timing: { wallStartedAtMs: now.getTime(), monotonicStartedAt: 100 },
      },
    });
  });

  it('carries the original execution clock through a slow preflight instead of granting a new budget', async () => {
    const readClock = vi.spyOn(current.clock, 'monotonicNow').mockReturnValueOnce(100).mockReturnValue(25_100);
    runtime.preflight.mockResolvedValue(preflight('future'));
    await runProductionProjectionSync({ force: true });
    expect(runtime.runFuture.mock.calls[0][1].execution).toEqual({
      now, runId: 'fixed-worker', timing: { wallStartedAtMs: now.getTime(), monotonicStartedAt: 100 },
    });
    readClock.mockRestore();
  });

  it('counts unavailable authorities without assigning their periods from a healthy league', async () => {
    const prepared = preflight('future');
    prepared.context.authorities = prepared.context.authorities.slice(0, 1);
    prepared.context.states = prepared.context.states.slice(0, 1);
    prepared.context.skippedLeagueKeys = ['league2'];
    runtime.preflight.mockResolvedValue(prepared);
    runtime.runFuture.mockResolvedValue({ status: 'completed', action: 'materialize', period,
      publishedLeagues: 1, unchangedLeagues: 0, failedLeagues: 0 });
    await expect(runProductionProjectionSync({ force: true })).resolves.toEqual({
      status: 'completed', cadence: 'forced', publishedLeagues: 1, failedLeagues: 1, providerGroups: 1,
    });
    expect(runtime.runFuture.mock.calls[0][1].leagueKeys).toEqual(['league1']);
  });
  it('does not send a stale cached preseason default to forced work after its cadence refresh failed', async () => {
    const prepared = preflight('future');
    prepared.failedCadenceLeagueKeys = ['league2'];
    runtime.preflight.mockResolvedValue(prepared);
    runtime.runFuture.mockResolvedValue({ status: 'completed', action: 'materialize', period,
      publishedLeagues: 1, unchangedLeagues: 0, failedLeagues: 0 });
    expect(await runProductionProjectionSync({ force: true })).toEqual({
      status: 'completed', cadence: 'forced', publishedLeagues: 1, failedLeagues: 1, providerGroups: 1,
    });
    expect(runtime.runFuture.mock.calls[0][1].leagueKeys).toEqual(['league1']);
  });
  it('reports failed force when all preseason cadence refreshes fail despite fresh stored defaults', async () => {
    const prepared = preflight('future');
    prepared.failedCadenceLeagueKeys = ['league1', 'league2'];
    runtime.preflight.mockResolvedValue(prepared);
    expect(await runProductionProjectionSync({ force: true })).toEqual({ status: 'failed' });
    expect(runtime.runCurrent).not.toHaveBeenCalled();
    expect(runtime.runFuture).not.toHaveBeenCalled();
  });

  it.each([
    { result: { status: 'disabled' }, expected: { status: 'disabled' } },
    { result: { status: 'failed' }, expected: { status: 'failed' } },
    { result: { status: 'skipped', reason: 'deadline' }, expected: { status: 'failed' } },
    { result: { status: 'skipped', reason: 'busy' }, expected: { status: 'skipped', reason: 'busy', cadence: 'forced' } },
  ])('preserves safe force outcome without inventing public fields: $result', async ({ result, expected }) => {
    runtime.preflight.mockResolvedValue(preflight('future'));
    runtime.runFuture.mockResolvedValue(result);
    await expect(runProductionProjectionSync({ force: true })).resolves.toEqual(expected);
  });

  it('does not report success when authority is unavailable for every league', async () => {
    runtime.preflight.mockResolvedValue({ context: { kind: 'stored', authorities: [], states: [] }, cadenceByKey: new Map() });
    await expect(runProductionProjectionSync({ force: true })).resolves.toEqual({ status: 'failed' });
    expect(runtime.runCurrent).not.toHaveBeenCalled();
    expect(runtime.future).not.toHaveBeenCalled();
  });

  it('does not silently choose a different period or owner for a second league', async () => {
    const prepared = preflight('future');
    prepared.context.states[1].period = { ...period, week: 2 };
    runtime.preflight.mockResolvedValue(prepared);
    await expect(runProductionProjectionSync({ force: true })).resolves.toEqual({ status: 'failed' });
    expect(runtime.future).not.toHaveBeenCalled();
  });

  it('does not claim legacy publication success for ingestion-only or zero publication results', async () => {
    runtime.preflight.mockResolvedValue(preflight('future'));
    runtime.runFuture.mockResolvedValue({ status: 'completed', action: 'projection-ingest', period,
      publishedLeagues: 0, unchangedLeagues: 0, failedLeagues: 0 });
    await expect(runProductionProjectionSync({ force: true })).resolves.toEqual({ status: 'failed' });
  });

  it('contains preflight failures without logging raw errors', async () => {
    runtime.preflight.mockRejectedValue(new Error('Bearer secret postgres://private-connection'));
    await expect(runProductionProjectionSync({ force: true })).resolves.toEqual({ status: 'failed' });
    expect(JSON.stringify(current.logger.write.mock.calls)).not.toMatch(/secret|private-connection/);
    expect(runtime.future).not.toHaveBeenCalled();
  });
});

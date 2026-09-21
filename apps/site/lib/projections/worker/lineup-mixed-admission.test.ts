import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));
import { cadenceInput, fakeStore, workerDependencies } from '../../live-projection-worker.fixtures';
import { planCurrentWork } from './current-work-plan';
import { runLineupObservation } from './lineup-orchestrator';
import { synchronizeLineupWatches } from './lineup-watch-context';
import { lineupAuthority, lineupAuthorityResult, lineupConfiguration, lineupHarness, lineupNow } from './lineup-observation.fixtures';

describe('shared current/preseason/future admission under sustained overload', () => {
  it('preserves progress for all three classes and rotates active-current checks within twenty requests', async () => {
    const h = lineupHarness(Array.from({ length: 31 }, (_, index) => lineupConfiguration(`league-${index}`)));
    const authorities = h.configurations.map((configuration, index) =>
      lineupAuthorityResult(lineupAuthority(configuration, index < 30 ? 'active' : 'preseason')));
    h.periodAuthorityReader.readAuthorities.mockResolvedValue(authorities);
    const context = await synchronizeLineupWatches(h.lineupRepository, h.configurations, authorities, lineupNow);
    if (context.kind !== 'stored') throw new Error('Expected stored context.');
    expect(context.capacity).toMatchObject({ currentTargets: 31, observerCurrentTargets: 1,
      maximumCurrentChecks: 18, maximumFutureChecks: 1 });
    // Emulate the SQL claim policy: one due future slot, current/defaults first otherwise.
    // The isolated SQL suite independently exercises the actual row-locking implementation.
    h.lineupRepository.claimDueLineupObservations.mockImplementation(async (input) => {
      const eligible = h.states().filter((row) => row.materializationLane === input.materializationLane
        && row.activeAttemptId === null && row.lastCheckedAt === null);
      const future = eligible.filter((row) => row.watchClass === 'future');
      const reserve = input.futureLimit > 0 && future.length ? 1 : 0;
      const defaults = eligible.filter((row) => row.watchClass === 'current').slice(0, input.limit - reserve);
      const selected = [...defaults, ...future.slice(0, Math.min(input.futureLimit, input.limit - defaults.length))];
      return selected.map((state) => {
        const claim = { activeAttemptId: `claim-${state.watchId}`, leaseOwner: 'run-1', claimGeneration: state.claimGeneration + 1 };
        Object.assign(state, claim);
        return { ...state, ...claim };
      });
    });
    const dependencies = workerDependencies(fakeStore());
    let current = context.states.filter((row) => row.materializationLane === 'current' && row.watchClass === 'current');
    const cadence = cadenceInput('l1');
    const cadenceByKey = new Map(current.map((state) => [state.configuration.key, { ...cadence, configuration: state.configuration }]));
    const checked = new Set<string>();
    for (let minute = 0; minute < 3; minute += 1) {
      const now = new Date(lineupNow.getTime() + minute * 60_000);
      const plan = await planCurrentWork(dependencies, current, cadenceByKey, now, `current-${minute}`, true,
        context.capacity.maximumCurrentChecks);
      expect(plan.full).toHaveLength(18);
      h.lineupSource.getLineup.mockClear();
      const observed = await runLineupObservation(h.dependencies);
      expect(observed).toMatchObject({ status: 'completed', checked: 2 });
      const calls = h.lineupSource.getLineup.mock.calls;
      expect(calls.filter(([input]) => input.period.week === 1)).toHaveLength(1);
      expect(calls.filter(([input]) => input.period.week > 1)).toHaveLength(1);
      expect(plan.full.length + calls.length).toBe(20);
      const selected = new Set(plan.full.map((target) => target.state.configuration.key));
      for (const key of selected) checked.add(key);
      current = current.map((state) => selected.has(state.configuration.key) ? { ...state, lastCheckedAt: now.toISOString() } : state);
    }
    expect(checked.size).toBe(30);
  });
  it('charges retained current rows to the active lane when their authority is missing', async () => {
    const h = lineupHarness(Array.from({ length: 21 }, (_, index) => lineupConfiguration(`league-${index}`)));
    const authorities = h.configurations.map((configuration, index) =>
      lineupAuthorityResult(lineupAuthority(configuration, index < 20 ? 'active' : 'preseason')));
    await synchronizeLineupWatches(h.lineupRepository, h.configurations, authorities, lineupNow);
    const result = await synchronizeLineupWatches(h.lineupRepository, h.configurations,
      authorities.map((value, index) => index === 0 ? { kind: 'missing' as const, leagueKey: value.leagueKey } : value), lineupNow);
    expect(result).toMatchObject({ kind: 'stored', skippedLeagueKeys: ['league-0'], capacity: {
      currentTargets: 21, observerCurrentTargets: 1, maximumCurrentChecks: 18, maximumFutureChecks: 1,
    } });
  });
});

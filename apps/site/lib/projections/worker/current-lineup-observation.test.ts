import { describe, expect, it } from 'vitest';
import { observeCurrentLineups } from './current-lineup-observation';
import { lineupAuthority, lineupAuthorityResult, lineupConfiguration, lineupHarness, lineupNow } from './lineup-observation.fixtures';
import { synchronizeLineupWatches } from './lineup-watch-context';

async function setup(count: number) {
  const configurations = Array.from({ length: count }, (_, index) => lineupConfiguration(`current-${index}`));
  const harness = lineupHarness(configurations);
  const authorities = configurations.map((configuration) => {
    const value = lineupAuthority(configuration);
    const period = { ...value.authority.defaultDisplayPeriod, week: 18 };
    return lineupAuthorityResult({ ...value, authority: { ...value.authority,
      defaultDisplayPeriod: period, activeScoringPeriod: period } });
  });
  const context = await synchronizeLineupWatches(harness.lineupRepository, configurations, authorities, lineupNow);
  if (context.kind !== 'stored') throw new Error('Expected supported current fixture.');
  return { ...harness, context, current: context.states.filter((state) => state.watchClass === 'current') };
}

describe('bounded current lineup observations', () => {
  it('observes all ten supported Week 18 current leagues in two batches with at most eight active requests', async () => {
    const h = await setup(10);
    expect(h.context.capacity).toMatchObject({ status: 'supported', currentTargets: 10, futureTargets: 0 });
    let active = 0; let peak = 0;
    const source = h.lineupSource.getLineup.getMockImplementation()!;
    h.lineupSource.getLineup.mockImplementation(async (input) => {
      active += 1; peak = Math.max(peak, active);
      try { await new Promise((resolve) => setTimeout(resolve, 1)); return await source(input); }
      finally { active -= 1; }
    });
    expect(await observeCurrentLineups(h.dependencies, h.current, 'run-1', 0))
      .toMatchObject({ checked: 10, changed: 10, pending: 10, skipped: 0, failed: 0 });
    expect(peak).toBe(8);
    expect(h.lineupRepository.claimDueLineupObservations.mock.calls.map(([input]) => input.limit)).toEqual([8, 2]);
    expect(h.lineupSource.getLineup.mock.calls.every(([input]) => input.period.week === 18)).toBe(true);
    expect(new Set(h.lineupSource.getLineup.mock.calls.map(([input]) => input.configuration.key)).size).toBe(10);
    expect(h.lineupRepository.wakeFutureProjectionAndMaterialization).not.toHaveBeenCalled();
  });
  it('reserves full-load requests before observing thin targets and never exceeds twenty total calls', async () => {
    const h = await setup(20);
    expect(await observeCurrentLineups(h.dependencies, h.current, 'run-1', 4))
      .toMatchObject({ checked: 16, skipped: 4 });
    expect(h.lineupSource.getLineup).toHaveBeenCalledTimes(16);
    expect(h.lineupRepository.claimDueLineupObservations.mock.calls.map(([input]) => input.limit)).toEqual([8, 8]);
  });
  it('does not reselect completed targets when a run crosses a minute or a row is unavailable', async () => {
    const h = await setup(10);
    const original = h.lineupRepository.claimDueLineupObservations.getMockImplementation()!;
    h.lineupRepository.claimDueLineupObservations.mockImplementationOnce(original).mockResolvedValueOnce([]);
    expect(await observeCurrentLineups(h.dependencies, h.current, 'run-1', 0)).toMatchObject({ checked: 8, skipped: 2 });
    expect(h.lineupRepository.claimDueLineupObservations).toHaveBeenLastCalledWith(expect.objectContaining({
      leagueKeys: h.current.slice(8).map((state) => state.configuration.key), limit: 2,
    }));
  });
  it('performs no thin work when full requests consume the entire budget', async () => {
    const h = await setup(2);
    expect(await observeCurrentLineups(h.dependencies, h.current, 'run-1', 20)).toMatchObject({ checked: 0, skipped: 2 });
    expect(h.lineupRepository.claimDueLineupObservations).not.toHaveBeenCalled();
    expect(h.lineupSource.getLineup).not.toHaveBeenCalled();
  });
});

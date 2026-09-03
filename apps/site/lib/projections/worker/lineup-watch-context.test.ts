import { describe, expect, it } from 'vitest';
import { synchronizeLineupWatches } from './lineup-watch-context';
import { lineupAuthority, lineupAuthorityResult, lineupConfiguration, lineupHarness, lineupNow } from './lineup-observation.fixtures';

describe('shared complete-horizon lineup watch context', () => {
  it('balances 34 future rows in stable 12/11/11 buckets independent of registry order', async () => {
    const harness = lineupHarness();
    const run = async (reverse: boolean) => synchronizeLineupWatches(harness.lineupRepository,
      reverse ? [...harness.configurations].reverse() : harness.configurations,
      harness.configurations.map((configuration) => lineupAuthorityResult(lineupAuthority(configuration))), lineupNow);
    const first = await run(false);
    const second = await run(true);
    if (first.kind !== 'stored' || second.kind !== 'stored') throw new Error('Expected stored watches.');
    const phases = (rows: typeof first.states) => rows.filter((row) => row.watchClass === 'future');
    expect([0, 1, 2].map((phase) => phases(first.states).filter((row) => row.phase === phase).length)).toEqual([12, 11, 11]);
    expect(first.capacity.requiredMatchupRequestsPerMinute).toBe(14);
    const keys = (rows: typeof first.states) => rows.map((row) => `${row.watchId}:${row.phase}`).sort();
    expect(keys(first.states)).toEqual(keys(second.states));
  });
  it('keeps missing-authority leagues registered and never retires them by omission', async () => {
    const harness = lineupHarness();
    const result = await synchronizeLineupWatches(harness.lineupRepository, harness.configurations,
      [lineupAuthorityResult(lineupAuthority(harness.configurations[0])), { kind: 'missing', leagueKey: 'two' }], lineupNow);
    expect(result).toMatchObject({ kind: 'stored', skippedLeagueKeys: ['two'] });
    expect(harness.lineupRepository.synchronizeLineupWatchStates.mock.calls[0][0]).toMatchObject({ registeredLeagueKeys: ['one', 'two'] });
    expect(result.kind === 'stored' && result.states.every((state) => state.configuration.key === 'one')).toBe(true);
  });
  it('retains the same healthy phases while another authority is temporarily missing', async () => {
    const h = lineupHarness();
    const results = h.configurations.map((configuration) => lineupAuthorityResult(lineupAuthority(configuration)));
    const initial = await synchronizeLineupWatches(h.lineupRepository, h.configurations, results, lineupNow);
    if (initial.kind !== 'stored') throw new Error('Expected stored watches.');
    const disrupted = await synchronizeLineupWatches(h.lineupRepository, h.configurations,
      [results[0], { kind: 'stale', leagueKey: 'two' }], lineupNow);
    if (disrupted.kind !== 'stored') throw new Error('Expected healthy stored watches.');
    const phases = (states: typeof initial.states) => states.filter((row) => row.configuration.key === 'one')
      .map((row) => `${row.period.week}:${row.phase}`);
    expect(phases(disrupted.states)).toEqual(phases(initial.states));
    const recovered = await synchronizeLineupWatches(h.lineupRepository, h.configurations, results, lineupNow);
    if (recovered.kind !== 'stored') throw new Error('Expected recovered watches.');
    expect(phases(recovered.states)).toEqual(phases(initial.states));
  });
  it('keeps preseason default on current observation cadence with future ownership', async () => {
    const harness = lineupHarness([lineupConfiguration()]);
    const result = await synchronizeLineupWatches(harness.lineupRepository, harness.configurations,
      [lineupAuthorityResult(lineupAuthority(harness.configurations[0], 'preseason'))], lineupNow);
    expect(result.kind === 'stored' && result.states[0]).toMatchObject({ watchClass: 'current', materializationLane: 'future', phase: 0 });
  });
  it('retires completed horizon rows without scheduling a provider request', async () => {
    const harness = lineupHarness([lineupConfiguration()]);
    const result = await synchronizeLineupWatches(harness.lineupRepository, harness.configurations,
      [lineupAuthorityResult(lineupAuthority(harness.configurations[0], 'complete'))], lineupNow);
    expect(result.kind === 'stored' && result.states.every((state) => state.watchClass === 'completed'
      && state.materializationLane === null && state.nextCheckAt === null)).toBe(true);
  });
  it('fails closed on unsupported request demand before synchronizing rows', async () => {
    const harness = lineupHarness(Array.from({ length: 5 }, (_, index) => lineupConfiguration(`fleet-${index}`)));
    const result = await synchronizeLineupWatches(harness.lineupRepository, harness.configurations,
      harness.configurations.map((configuration) => lineupAuthorityResult(lineupAuthority(configuration))), lineupNow);
    expect(result.kind).toBe('capacity-exceeded');
    expect(harness.lineupRepository.synchronizeLineupWatchStates).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import { synchronizeLineupWatches } from './lineup-watch-context';
import { lineupAuthority, lineupAuthorityResult, lineupConfiguration, lineupHarness, lineupNow } from './lineup-observation.fixtures';
import { parseLineupCadencePolicy } from '../shared/lineup-cadence';

describe('shared complete-horizon lineup watch context', () => {
  it('stably spreads tiered future rows independently of registry order', async () => {
    const harness = lineupHarness();
    const run = async (reverse: boolean) => synchronizeLineupWatches(harness.lineupRepository,
      reverse ? [...harness.configurations].reverse() : harness.configurations,
      harness.configurations.map((configuration) => lineupAuthorityResult(lineupAuthority(configuration))), lineupNow);
    const first = await run(false);
    const second = await run(true);
    if (first.kind !== 'stored' || second.kind !== 'stored') throw new Error('Expected stored watches.');
    expect(first.capacity.requiredMatchupRequestsPerMinute).toBeLessThan(14);
    const keys = (rows: typeof first.states) => rows.map((row) => `${row.watchId}:${row.cadencePolicyVersion}`).sort();
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

  it('retains intended leagues with missing registrations and does not plan provider work for them', async () => {
    const h = lineupHarness();
    const healthy = h.configurations[0];
    const result = await synchronizeLineupWatches(h.lineupRepository, [healthy],
      [lineupAuthorityResult(lineupAuthority(healthy))], lineupNow,
      { intendedLeagueKeys: ['one', 'two'], failures: [{ leagueKey: 'two', reason: 'unregistered-season' }] });
    expect(result).toMatchObject({ kind: 'stored', skippedLeagueKeys: ['two'] });
    expect(h.lineupRepository.synchronizeLineupWatchStates.mock.calls[0][0]).toMatchObject({ registeredLeagueKeys: ['one', 'two'] });
    expect(h.lineupRepository.synchronizeLineupWatchStates.mock.calls[0][0].targets.every(target => target.configuration.key === 'one')).toBe(true);
    expect(h.lineupRepository.readLineupWatchSchedule).toHaveBeenCalledWith(['one', 'two']);
  });
  it('plans both complete horizons from active Week 2 despite a Week 1 display marker', async () => {
    const harness = lineupHarness();
    const authorities = harness.configurations.map((configuration) => {
      const value = lineupAuthority(configuration);
      return lineupAuthorityResult({ ...value, authorityGeneration: 2,
        authority: { ...value.authority, activeScoringPeriod: { season: 2026, seasonType: 'regular', week: 2 } } });
    });
    const result = await synchronizeLineupWatches(harness.lineupRepository, harness.configurations,
      authorities, lineupNow);
    expect(result).toMatchObject({ kind: 'stored', skippedLeagueKeys: [],
      capacity: { status: 'supported', currentTargets: 2, futureTargets: 32 } });
    const targets = harness.lineupRepository.synchronizeLineupWatchStates.mock.calls[0][0].targets;
    expect(targets).toHaveLength(36);
    for (const configuration of harness.configurations) {
      const owned = targets.filter((target) => target.configuration.key === configuration.key);
      expect(owned.map((target) => target.period.week)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
      expect(owned[0]).toMatchObject({ watchClass: 'completed', materializationLane: null, initialNextCheckAt: null });
      expect(owned[1]).toMatchObject({ watchClass: 'current', materializationLane: 'current',
        authorityGeneration: 2, initialNextCheckAt: lineupNow.toISOString() });
      expect(owned.slice(2).every((target) => target.watchClass === 'future' && target.materializationLane === 'future')).toBe(true);
    }
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
      .map((row) => `${row.period.week}:${row.cadencePolicyVersion}`);
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
  it('synchronizes overloaded fleets while reserving bounded current and future progress', async () => {
    const harness = lineupHarness(Array.from({ length: 25 }, (_, index) => lineupConfiguration(`fleet-${index}`)));
    const result = await synchronizeLineupWatches(harness.lineupRepository, harness.configurations,
      harness.configurations.map((configuration) => lineupAuthorityResult(lineupAuthority(configuration))), lineupNow);
    expect(result).toMatchObject({ kind: 'stored', capacity: { status: 'capacity-exceeded',
      maximumCurrentChecks: 19, maximumFutureChecks: 1 } });
    expect(harness.lineupRepository.synchronizeLineupWatchStates).toHaveBeenCalledOnce();
  });
  it('promotes future tiers at authoritative rollover and stops completed watches', async () => {
    const h = lineupHarness([lineupConfiguration()]);
    const run = (week: number) => {
      const value = lineupAuthority(h.configurations[0]);
      return synchronizeLineupWatches(h.lineupRepository, h.configurations,
        [lineupAuthorityResult({ ...value, authorityGeneration: week, authority: { ...value.authority,
          activeScoringPeriod: { ...value.authority.activeScoringPeriod!, week } } })], lineupNow);
    };
    const before = await run(1); const after = await run(2);
    if (before.kind !== 'stored' || after.kind !== 'stored') throw new Error('Expected stored context.');
    const tier = (states: typeof before.states, week: number) => {
      const state = states.find((row) => row.period.week === week)!;
      return parseLineupCadencePolicy(state.cadencePolicyVersion, state.watchClass, state.phase).minutes;
    };
    expect([tier(before.states, 2), tier(after.states, 2)]).toEqual([15, 1]);
    expect([tier(before.states, 3), tier(after.states, 3)]).toEqual([60, 15]);
    expect([tier(before.states, 6), tier(after.states, 6)]).toEqual([360, 60]);
    expect(after.states[0]).toMatchObject({ watchClass: 'completed', nextCheckAt: null });
    const incoming = h.lineupRepository.synchronizeLineupWatchStates.mock.calls[1][0].targets;
    expect(Date.parse(incoming[2].initialNextCheckAt!) - lineupNow.getTime()).toBeLessThan(15 * 60_000);
  });
  it('adding a fourth league does not reschedule existing scoped identities or stop their watches', async () => {
    const h = lineupHarness(Array.from({ length: 3 }, (_, i) => lineupConfiguration(`league-${i}`)));
    const initial = await synchronizeLineupWatches(h.lineupRepository, h.configurations,
      h.configurations.map((c) => lineupAuthorityResult(lineupAuthority(c))), lineupNow);
    const expanded = [...h.configurations, lineupConfiguration('fourth')];
    const next = await synchronizeLineupWatches(h.lineupRepository, expanded,
      expanded.map((c) => lineupAuthorityResult(lineupAuthority(c))), lineupNow);
    if (initial.kind !== 'stored' || next.kind !== 'stored') throw new Error('Expected stored context.');
    expect(next.capacity.maximumCurrentChecks).toBe(4);
    for (const state of initial.states) expect(next.states.find((row) => row.watchId === state.watchId)?.cadencePolicyVersion)
      .toBe(state.cadencePolicyVersion);
  });
});

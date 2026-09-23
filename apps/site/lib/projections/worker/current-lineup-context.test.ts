import { describe, expect, it, vi } from 'vitest';
import type { LeagueCadenceState, LeagueConfiguration, LeaguePeriodAuthority } from '../domain/contracts';
import type { PeriodAuthorityReadResult } from '../ports/period-authority-reader';
import { cadenceInput, fakeStore, workerDependencies } from '../../live-projection-worker.fixtures';
import { refreshCurrentLineupContext } from './current-lineup-context';
import { runWithDependencies } from './orchestrator';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));

function cadenceAt(configuration: LeagueConfiguration, week = 1,
  lifecycle: LeaguePeriodAuthority['lifecycle'] = 'active'): LeagueCadenceState {
  const source = cadenceInput(String(configuration.leagueRef.externalId));
  const period = { ...source.period, week };
  return { ...source, configuration, period,
    periodAuthority: { ...source.periodAuthority, configuration,
      defaultDisplayPeriod: period, activeScoringPeriod: lifecycle === 'active' ? period : null, lifecycle } };
}

function durable(value: LeagueCadenceState): PeriodAuthorityReadResult {
  return { kind: 'present', leagueKey: value.configuration.key, value: {
    configuration: value.configuration, authority: value.periodAuthority, authorityGeneration: 2,
    shape: value.lineupShape, defaultPeriodCadence: value.defaultPeriodCadence,
  } };
}

function harness() {
  const store = fakeStore();
  const dependencies = workerDependencies(store);
  dependencies.loggerMock.mockImplementation(() => undefined);
  const configurations = dependencies.leagueRegistry.listActiveLeagues();
  const proposed = configurations.map((configuration) => cadenceAt(configuration));
  dependencies.cadenceMock.mockImplementation(async (configuration: LeagueConfiguration) => (
    proposed.find((value) => value.configuration.key === configuration.key)!
  ));
  const upsert = vi.spyOn(dependencies.repository, 'upsertPeriodAuthority').mockResolvedValue({ kind: 'ignored' });
  const read = vi.spyOn(dependencies.periodAuthorityReader, 'readAuthorities').mockResolvedValue(proposed.map(durable));
  return { dependencies, configurations, proposed, upsert, read, store };
}

describe('current cadence agrees with durable authority', () => {
  it('keeps incomplete registrations in watch scope while progressing a healthy current league', async () => {
    const h = harness();
    const dependencies = { ...h.dependencies, leagueRegistry: { listActiveLeagues: () => [h.configurations[0]],
      registration: { intendedLeagueKeys: ['league1', 'league2'], failures: [{ leagueKey: 'league2', reason: 'unregistered-season' }] } } };
    h.read.mockResolvedValue([durable(h.proposed[0])]);
    const result = await runWithDependencies(dependencies);
    expect(result).toMatchObject({ status: 'completed', publishedLeagues: 1, failedLeagues: 1 });
    expect(h.dependencies.sourceMock.mock.calls.every(([configuration]) => configuration.key === 'league1')).toBe(true);
  });
  it.each(['ignored', 'stored'] as const)(
    'reports a regressing proposal after %s instead of treating mismatched cadence as idle', async (kind) => {
      const h = harness();
      h.upsert.mockResolvedValue({ kind });
      h.read.mockResolvedValue([durable(cadenceAt(h.configurations[0], 2)), durable(h.proposed[1])]);
      const result = await refreshCurrentLineupContext(h.dependencies, 'fixture-run');
      expect(result.failedCadenceLeagueKeys).toEqual(['league1']);
      expect([...result.cadenceByKey.keys()]).toEqual(['league2']);
      expect(result.context.kind).toBe('stored');
      if (result.context.kind !== 'stored') throw new Error('Expected durable watch synchronization.');
      expect(result.context.states.find((state) => state.configuration.key === 'league1' && state.period.week === 2))
        .toMatchObject({ watchClass: 'current', authorityGeneration: 2 });
      expect(result.context.states.find((state) => state.configuration.key === 'league1' && state.period.week === 1))
        .toMatchObject({ watchClass: 'completed', materializationLane: null });
      expect(h.dependencies.loggerMock).toHaveBeenCalledWith('warn', expect.objectContaining({
        stage: 'period-authority', outcome: 'failed', leagueKey: 'league1',
        failureCode: 'period-authority-regression', period: { season: 2026, seasonType: 'regular', week: 1 },
        storedAuthorityPeriod: { season: 2026, seasonType: 'regular', week: 2 },
      }));
      expect(h.read).toHaveBeenCalledTimes(1);
      expect(h.upsert).toHaveBeenCalledTimes(2);
      expect(h.dependencies.sourceMock).not.toHaveBeenCalled();
      expect(h.dependencies.projectionMock).not.toHaveBeenCalled();
      expect(h.dependencies.gamesMock).not.toHaveBeenCalled();
    },
  );

  it('accepts an ignored older observation when its period and lifecycle still match durable authority', async () => {
    const h = harness();
    h.read.mockResolvedValue(h.proposed.map((value) => durable({ ...value,
      periodAuthority: { ...value.periodAuthority, sourceRevision: 'later-confirmation',
        observedAt: '2026-09-13T18:00:09.000Z', verifiedAt: '2026-09-13T18:00:10.000Z' },
    })));
    const result = await refreshCurrentLineupContext(h.dependencies, 'fixture-run');
    expect(result.failedCadenceLeagueKeys).toEqual([]);
    expect([...result.cadenceByKey.keys()]).toEqual(['league1', 'league2']);
    expect(h.dependencies.loggerMock).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it('reports a lifecycle regression while keeping completed durable watches', async () => {
    const h = harness();
    h.read.mockResolvedValue([durable(cadenceAt(h.configurations[0], 1, 'complete')), durable(h.proposed[1])]);
    const result = await refreshCurrentLineupContext(h.dependencies, 'fixture-run');
    expect(result.failedCadenceLeagueKeys).toEqual(['league1']);
    expect(h.dependencies.loggerMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      failureCode: 'period-authority-regression', leagueKey: 'league1',
    }));
    if (result.context.kind !== 'stored') throw new Error('Expected durable watch synchronization.');
    expect(result.context.states.filter((state) => state.configuration.key === 'league1')
      .every((state) => state.watchClass === 'completed')).toBe(true);
  });

  it('reports a forward proposal that was not accepted as an authority conflict', async () => {
    const h = harness();
    h.proposed[0] = cadenceAt(h.configurations[0], 2);
    const result = await refreshCurrentLineupContext(h.dependencies, 'fixture-run');
    expect(result.failedCadenceLeagueKeys).toEqual(['league1']);
    expect(h.dependencies.loggerMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      failureCode: 'period-authority-conflict', period: { season: 2026, seasonType: 'regular', week: 2 },
      storedAuthorityPeriod: { season: 2026, seasonType: 'regular', week: 1 },
    }));
  });

  it('records a rejected SQL authority update as a conflict without another authority read', async () => {
    const h = harness();
    h.upsert.mockResolvedValueOnce({ kind: 'conflict' });
    const result = await refreshCurrentLineupContext(h.dependencies, 'fixture-run');
    expect(result.failedCadenceLeagueKeys).toEqual(['league1']);
    expect(h.dependencies.loggerMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      failureCode: 'period-authority-conflict', leagueKey: 'league1',
    }));
    expect(h.dependencies.loggerMock).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it('marks unavailable readback as failed while retaining a healthy peer cadence', async () => {
    const h = harness();
    h.read.mockResolvedValue([{ kind: 'stale', leagueKey: 'league1' }, durable(h.proposed[1])]);
    const result = await refreshCurrentLineupContext(h.dependencies, 'fixture-run');
    expect(result.failedCadenceLeagueKeys).toEqual(['league1']);
    expect([...result.cadenceByKey.keys()]).toEqual(['league2']);
    expect(h.dependencies.loggerMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      failureCode: 'period-authority-unavailable', leagueKey: 'league1',
    }));
  });

  it('returns a failed real current-worker result when all proposals regress, with no provider work or lease', async () => {
    const h = harness();
    h.read.mockResolvedValue(h.configurations.map((configuration) => durable(cadenceAt(configuration, 2))));
    await expect(runWithDependencies(h.dependencies)).resolves.toEqual({ status: 'failed' });
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.dependencies.repository.acquireJob).not.toHaveBeenCalled();
    expect(h.dependencies.sourceMock).not.toHaveBeenCalled();
    expect(h.dependencies.projectionMock).not.toHaveBeenCalled();
    expect(h.dependencies.gamesMock).not.toHaveBeenCalled();
  });
});

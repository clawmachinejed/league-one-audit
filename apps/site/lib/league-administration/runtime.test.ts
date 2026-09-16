import { describe, expect, it, vi } from 'vitest';
import { recordCapturedAdministration } from './runtime';
import { createLeagueAdministrationStore } from './store';
import { loadAdministrationRegistry } from './registry';
import { administrationMaintenanceSelection, runAdministrationMaintenance } from './maintenance';
import type { LeagueAdministrationStore } from './store-contracts';
import { createLeagueRegistry } from '../projections/adapters/configuration/league-registry';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
const scope = { leagueKey: 'league1', provider: 'sleeper' as const, externalLeagueId: 'source-2026', season: 2026 };
const time = '2026-09-16T18:00:00.000Z';
const document = { family: 'league' as const, week: null,
  requestStartedAt: time, requestCompletedAt: time,
  payload: { league_id: scope.externalLeagueId, season: '2026', sport: 'nfl', name: 'League One',
    total_rosters: 1, roster_positions: ['QB', 'BN'], settings: { playoff_week_start: 15 }, scoring_settings: { pass_yd: 0.04 } } };
function fakeStore(): LeagueAdministrationStore {
  return { enabled: true, recordObservation: vi.fn(async () => ({ status: 'changed' as const,
    observationId: 'observation', versionId: 'version', generation: 2 })),
  readSource: vi.fn(async () => ({ status: 'missing' as const })),
  readSourceByConnection: vi.fn(async () => ({ status: 'missing' as const })), listEnrollments: vi.fn(async () => []) };
}

describe('administration collection and enrollment composition', () => {
  it('does not inspect inputs or construct storage when persistence is disabled', async () => {
    const store = createLeagueAdministrationStore({ enabled: false, reason: 'preview-persistence-disabled' });
    const unreadable = new Proxy({}, { get() { throw new Error('must not inspect'); } });
    expect(await store.recordObservation(unreadable as never)).toEqual({ status: 'disabled' });
    expect(await recordCapturedAdministration(unreadable as never, unreadable as never, { store }))
      .toEqual({ status: 'disabled', results: [] });
  });

  it('keeps a cache read distinct from an upstream observation and passes the live write fence', async () => {
    const store = fakeStore();
    const fence = { jobKey: 'maintenance', workerId: 'worker', generation: 4, deadlineAt: '2026-09-16T18:01:00.000Z' };
    const result = await recordCapturedAdministration(scope, [document], { store, now: () => new Date(time), fence });
    expect(result.context).toEqual({ observationId: 'observation', configurationVersionId: 'version', generation: 2 });
    expect(store.recordObservation).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted', envelope: expect.objectContaining({
      provenance: { origin: 'cache', requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: null, checkedAt: time },
    }) }), fence);
  });

  it('retains a rejected source observation without claiming an accepted calculation context', async () => {
    const store = fakeStore();
    vi.mocked(store.recordObservation).mockResolvedValue({ status: 'rejected' });
    const result = await recordCapturedAdministration(scope, [{ ...document, payload: { ...document.payload, league_id: 'wrong' } }],
      { store, now: () => new Date(time) });
    expect(result.status).toBe('unavailable');
    expect(result.context).toBeUndefined();
    expect(store.recordObservation).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }), undefined);
  });

  it('verifies a changed unknown-age cache once and binds only the verified configuration', async () => {
    const store = fakeStore();
    vi.mocked(store.recordObservation).mockResolvedValueOnce({ status: 'stale', reason: 'unproven_cache_change' })
      .mockResolvedValueOnce({ status: 'changed', observationId: 'verified-observation', versionId: 'verified-version', generation: 3 });
    const verify = vi.fn(async () => ({ ...document, origin: 'network' as const }));
    const result = await recordCapturedAdministration(scope, [document], { store, verify, now: () => new Date(time) });
    expect(verify).toHaveBeenCalledOnce();
    expect(store.recordObservation).toHaveBeenCalledTimes(2);
    expect(result.context).toEqual({ observationId: 'verified-observation', configurationVersionId: 'verified-version', generation: 3 });
    expect(vi.mocked(store.recordObservation).mock.calls[1][0].envelope.provenance.sourceObservedAt).toBe(time);
  });

  it('does not refetch unchanged cached documents or blindly retry a genuinely older network response', async () => {
    const store = fakeStore(); const verify = vi.fn();
    vi.mocked(store.recordObservation).mockResolvedValueOnce({ status: 'unchanged' }).mockResolvedValueOnce({ status: 'stale' });
    await recordCapturedAdministration(scope, [document, { ...document, origin: 'network' }], { store, verify, now: () => new Date(time) });
    expect(verify).not.toHaveBeenCalled();
  });

  it('retains freshly changed settings but never attaches them to the older loaded calculation', async () => {
    const store = fakeStore();
    vi.mocked(store.recordObservation).mockResolvedValueOnce({ status: 'stale', reason: 'unproven_cache_change' })
      .mockResolvedValueOnce({ status: 'changed', observationId: 'new', versionId: 'new', generation: 3 });
    const verify = vi.fn(async () => ({ ...document, origin: 'network' as const,
      payload: { ...document.payload, roster_positions: ['QB', 'SUPER_FLEX', 'BN'] } }));
    const result = await recordCapturedAdministration(scope, [document], { store, verify, now: () => new Date(time) });
    expect(store.recordObservation).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('unavailable');
    expect(result.context).toBeUndefined();
  });

  it('uses accepted annual source mappings for the synchronous invocation registry', async () => {
    const store = fakeStore();
    vi.mocked(store.listEnrollments).mockResolvedValue([{ leagueId: 'league-id', leagueSeasonId: 'season-id',
      leagueKey: 'league1', displayName: 'Renamed League', season: 2027, provider: 'sleeper', externalLeagueId: 'new-2027', scoringProfileId: 'profile' }]);
    const registry = await loadAdministrationRegistry(store);
    expect(registry.listActiveLeagues()[0]).toMatchObject({ key: 'league1', displayName: 'Renamed League',
      leagueRef: { externalId: 'new-2027', provider: 'sleeper' } });
    expect(store.listEnrollments).toHaveBeenCalledOnce();
  });

  it('does not silently fall back to three hardcoded leagues when enabled enrollment is empty or unavailable', async () => {
    const store = fakeStore();
    await expect(loadAdministrationRegistry(store)).rejects.toThrow('No accepted league enrollment');
    vi.mocked(store.listEnrollments).mockRejectedValue(new Error('unavailable'));
    await expect(loadAdministrationRegistry(store)).rejects.toThrow('unavailable');
  });

  it('pins an operator registry to its explicitly approved historical season', async () => {
    const store = fakeStore();
    vi.mocked(store.listEnrollments).mockResolvedValue([{ leagueId: 'league-id', leagueSeasonId: 'historical-season-id',
      leagueKey: 'league1', displayName: 'League One', season: 2026, provider: 'sleeper', externalLeagueId: 'source-2026', scoringProfileId: 'profile' }]);
    const registry = await loadAdministrationRegistry(store, 2026);
    expect(store.listEnrollments).toHaveBeenCalledWith(2026);
    expect(registry.listActiveLeagues()[0].leagueRef.externalId).toBe('source-2026');
  });

  it.each([1, 2, 3, 7, 15, 18])('covers every historical transaction week through week %i despite intervening metadata turns', (currentWeek) => {
    const covered = new Map<number, Set<number>>();
    for (let hour = 0; hour < 4 * 3 * 3 * 19; hour++) {
      const selected = administrationMaintenanceSelection(new Date(Date.UTC(2026, 8, 16, hour, 30)), 3, currentWeek);
      if (selected.metadata) continue;
      const weeks = covered.get(selected.leagueIndex) ?? new Set<number>();
      weeks.add(selected.week); covered.set(selected.leagueIndex, weeks);
    }
    expect([...covered.keys()].sort()).toEqual([0, 1, 2]);
    for (const weeks of covered.values()) expect([...weeks].sort((a, b) => a - b)).toEqual(Array.from({ length: currentWeek + 1 }, (_, i) => i));
  });

  it('skips maintenance before any database, registry or provider work outside its existing-lane opportunity', async () => {
    const registry = createLeagueRegistry([]);
    expect(await runAdministrationMaintenance(registry, Date.parse('2026-09-16T18:00:00Z'))).toEqual({ status: 'not-due' });
  });
});

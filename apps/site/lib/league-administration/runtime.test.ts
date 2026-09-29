import capture from '../../test-support/fixtures/sleeper-2026-season-schedule.json';
import { createSleeperCalendarEvidence } from './period-mapping';
import { describe, expect, it, vi } from 'vitest';
import { recordCapturedAdministration } from './runtime';
import { createLeagueAdministrationStore } from './store';
import { loadAdministrationRegistry, loadIsolatedAdministrationRegistry } from './registry';
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
  readSourceMapping: vi.fn(async () => null),
  beginLeagueSettingsAttempt: vi.fn(), readAcceptedLeagueSettings: vi.fn(async () => ({ status: 'missing' as const })),
  beginExactMatchupAttempt: vi.fn(), readAcceptedExactMatchups: vi.fn(async () => ({ status: 'missing' as const })),
  beginRosterAttempt: vi.fn(), readAcceptedCurrentRoster: vi.fn(async () => ({ status: 'missing' as const })),
  beginRosterCapture: vi.fn(), readAcceptedTeamManagers: vi.fn(async () => ({ status: 'missing' as const })),
  readSourceByConnection: vi.fn(async () => ({ status: 'missing' as const })), listEnrollments: vi.fn(async () => []),
  listEnrollmentInventory: vi.fn(async () => ({ entries: [] })), readEnrollment: vi.fn(async () => ({ status: 'missing' as const })) };
}

describe('administration collection and enrollment composition', () => {
  it('forwards an exact-period attempt with same-batch population but never reserves ordinary cache evidence', async () => {
    const store = fakeStore();
    const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
      revisionId: '33333333-3333-4333-8333-333333333333', generation: 1, scope };
    const attempt = { id: 'matchup-attempt', scopeId: 'matchup-scope', ordinal: 1, expectedGeneration: 0 };
    const matchup = { family: 'matchups' as const, week: 3, payload: [{ roster_id: 1, matchup_id: null, players: [], starters: [], points: 0 }],
      requestStartedAt: time, requestCompletedAt: time };
    await recordCapturedAdministration(scope, [{ ...document, origin: 'network' }, { ...matchup, origin: 'network' }],
      { store, mapping, matchupAttempt: { week: 3, attempt }, now: () => new Date(time) });
    const call = vi.mocked(store.recordObservation).mock.calls[1];
    expect(call[2]).toEqual(mapping);
    expect(call[6]).toMatchObject({ attempt, population: { envelope: { family: 'league', provenance: { origin: 'network' } } } });
    await recordCapturedAdministration(scope, [{ ...matchup, origin: 'cache' }],
      { store, mapping, now: () => new Date(time) });
    expect(store.beginExactMatchupAttempt).not.toHaveBeenCalled();
    expect(vi.mocked(store.recordObservation).mock.calls[2]).toHaveLength(3);
  });

  it('reserves a changed-cache matchup only before its existing verification fetch', async () => {
    const store = fakeStore();
    const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
      revisionId: '33333333-3333-4333-8333-333333333333', generation: 1, scope };
    const attempt = { id: 'matchup-attempt', scopeId: 'matchup-scope', ordinal: 1, expectedGeneration: 0 };
    const matchup = { family: 'matchups' as const, week: 3, payload: [{ roster_id: 1, players: [], starters: [] }],
      requestStartedAt: time, requestCompletedAt: time, origin: 'cache' as const };
    vi.mocked(store.recordObservation).mockResolvedValueOnce({ status: 'changed', observationId: 'network-population' })
      .mockResolvedValueOnce({ status: 'stale', reason: 'unproven_cache_change' })
      .mockResolvedValueOnce({ status: 'changed' });
    vi.mocked(store.beginExactMatchupAttempt).mockResolvedValue(attempt);
    const verify = vi.fn(async () => {
      expect(store.beginExactMatchupAttempt).toHaveBeenCalledWith(mapping, 3, expect.any(String), undefined);
      return { ...matchup, origin: 'network' as const };
    });
    await recordCapturedAdministration(scope, [{ ...document, origin: 'network' }, matchup],
      { store, mapping, verify, now: () => new Date(time) });
    expect(verify).toHaveBeenCalledOnce();
    expect(vi.mocked(store.recordObservation).mock.calls.at(-1)?.[6]).toEqual({ attempt });
  });
  it('reserves only an already-needed league network verification and never borrows roster attempts', async () => {
    const store = fakeStore();
    const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
      revisionId: '33333333-3333-4333-8333-333333333333', generation: 1, scope };
    const attempt = { id: 'league-attempt', scopeId: 'league-scope', ordinal: 1, expectedGeneration: 0 };
    vi.mocked(store.beginLeagueSettingsAttempt).mockResolvedValue(attempt);
    vi.mocked(store.recordObservation).mockResolvedValueOnce({ status: 'stale', reason: 'unproven_cache_change' }).mockResolvedValueOnce({ status: 'changed' });
    const verify = vi.fn(async () => {
      expect(store.beginLeagueSettingsAttempt).toHaveBeenCalledOnce(); return { ...document, origin: 'network' as const };
    });
    await recordCapturedAdministration(scope, [document], { store, mapping, verify, now: () => new Date(time) });
    expect(verify).toHaveBeenCalledOnce(); expect(store.beginRosterCapture).not.toHaveBeenCalled();
    expect(vi.mocked(store.recordObservation).mock.calls[1].slice(2)).toEqual([mapping, undefined, undefined, { attempt }]);
    const ordinary = fakeStore();
    await recordCapturedAdministration(scope, [document], { store: ordinary, mapping, now: () => new Date(time) });
    expect(ordinary.beginLeagueSettingsAttempt).not.toHaveBeenCalled();
  });

  it('forwards the pre-acquisition league attempt only to network league capture', async () => {
    const store = fakeStore();
    const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
      revisionId: '33333333-3333-4333-8333-333333333333', generation: 1, scope };
    const attempt = { id: 'league-attempt', scopeId: 'league-scope', ordinal: 1, expectedGeneration: 0 };
    await recordCapturedAdministration(scope, [{ ...document, origin: 'network' }], { store, mapping, leagueSettingsAttempt: attempt, now: () => new Date(time) });
    expect(store.recordObservation).toHaveBeenCalledOnce();
    expect(vi.mocked(store.recordObservation).mock.calls[0].slice(2)).toEqual([mapping, undefined, undefined, { attempt }]);
    expect(store.beginLeagueSettingsAttempt).not.toHaveBeenCalled();
  });

  it('reserves both policies before an already-required changed-cache network verification and forwards the same receipt evidence', async () => {
    const store = fakeStore();
    const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
      revisionId: '33333333-3333-4333-8333-333333333333', generation: 1, scope };
    const players = { id: 'players', scopeId: 'players-scope', ordinal: 2, expectedGeneration: 1 };
    const managers = { id: 'managers', scopeId: 'managers-scope', ordinal: 3, expectedGeneration: 0 };
    const roster = { family: 'rosters' as const, week: null, payload: [{ roster_id: 1, owner_id: 'owner', co_owners: null, players: [] }],
      origin: 'cache' as const, requestStartedAt: time, requestCompletedAt: time };
    vi.mocked(store.recordObservation).mockResolvedValueOnce({ status: 'stale', reason: 'unproven_cache_change' })
      .mockResolvedValueOnce({ status: 'changed' });
    vi.mocked(store.beginRosterCapture).mockResolvedValue({ players, managers });
    const verify = vi.fn(async () => {
      expect(store.beginRosterCapture).toHaveBeenCalledExactlyOnceWith(mapping, expect.any(String), expect.any(String), undefined);
      return { ...roster, origin: 'network' as const };
    });
    await recordCapturedAdministration(scope, [roster], { store, mapping, verify, now: () => new Date(time) });
    expect(verify).toHaveBeenCalledOnce();
    expect(vi.mocked(store.recordObservation).mock.calls[0]).toHaveLength(3);
    const completed = vi.mocked(store.recordObservation).mock.calls[1];
    expect(completed[2]).toBe(mapping); expect(completed[3]).toEqual({ attempt: players }); expect(completed[4]).toEqual({ attempt: managers });
    expect(completed[0]).toMatchObject({ teamManagers: { status: 'partial', teams: [{ primaryOwner: { state: 'owned' } }] } });
  });

  it('does not fetch after failed paired reservation and does not reserve for ordinary cache evidence', async () => {
    const store = fakeStore();
    const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
      revisionId: '33333333-3333-4333-8333-333333333333', generation: 1, scope };
    const roster = { family: 'rosters' as const, week: null, payload: [{ roster_id: 1, owner_id: 'owner' }],
      origin: 'cache' as const, requestStartedAt: time, requestCompletedAt: time };
    const verify = vi.fn();
    await recordCapturedAdministration(scope, [roster], { store, mapping, verify, now: () => new Date(time) });
    expect(store.beginRosterCapture).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
    vi.mocked(store.recordObservation).mockResolvedValue({ status: 'stale', reason: 'unproven_cache_change' });
    vi.mocked(store.beginRosterCapture).mockRejectedValue(new Error('mapping moved'));
    await expect(recordCapturedAdministration(scope, [roster], { store, mapping, verify, now: () => new Date(time) })).rejects.toThrow('mapping moved');
    expect(verify).not.toHaveBeenCalled();
  });

  it.each(['changed', 'rejected', 'stale'] as const)('only forwards independently retained network population evidence after a %s configuration write', async status => {
    const store = fakeStore();
    const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
      revisionId: '33333333-3333-4333-8333-333333333333', generation: 1, scope };
    const rosterAttempt = { id: 'attempt', scopeId: 'scope', ordinal: 1, expectedGeneration: 0 };
    vi.mocked(store.recordObservation).mockResolvedValueOnce({ status, observationId: 'exact-config-observation' })
      .mockResolvedValueOnce({ status: 'changed' });
    await recordCapturedAdministration(scope, [{ ...document, origin: 'network' },
      { family: 'rosters', week: null, payload: [{ roster_id: 1, players: [], reserve: null }],
        origin: 'network', requestStartedAt: time, requestCompletedAt: time }],
    { store, mapping, rosterAttempt, now: () => new Date(time) });
    const acceptance = vi.mocked(store.recordObservation).mock.calls[1][3];
    expect(acceptance?.attempt).toBe(rosterAttempt);
    if (status === 'changed') expect(acceptance?.population).toMatchObject({ observationId: 'exact-config-observation',
      envelope: { family: 'league', provenance: { origin: 'network' }, payload: { total_rosters: 1 } } });
    else expect(acceptance).not.toHaveProperty('population');
    expect(store.beginRosterAttempt).not.toHaveBeenCalled();
  });

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
    }) }), fence, undefined);
  });

  it('retains a rejected source observation without claiming an accepted calculation context', async () => {
    const store = fakeStore();
    vi.mocked(store.recordObservation).mockResolvedValue({ status: 'rejected' });
    const result = await recordCapturedAdministration(scope, [{ ...document, payload: { ...document.payload, league_id: 'wrong' } }],
      { store, now: () => new Date(time) });
    expect(result.status).toBe('unavailable');
    expect(result.context).toBeUndefined();
    expect(store.recordObservation).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }), undefined, undefined);
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

  it('keeps healthy collection configurations and explicitly retains failed intended membership', async () => {
    const store = fakeStore();
    const enrollment = { leagueId: 'league-id', leagueSeasonId: 'season-id', leagueKey: 'league1',
      displayName: 'Healthy', season: 2026, provider: 'sleeper' as const, externalLeagueId: 'source', scoringProfileId: 'profile' };
    vi.mocked(store.listEnrollmentInventory).mockResolvedValue({ entries: [
      { status: 'ready', intended: enrollment, enrollment },
      { status: 'unavailable', intended: { leagueId: 'broken', leagueKey: 'other', provider: 'sleeper', season: 2027 },
        reason: 'unregistered-season' },
    ] });
    const registry = await loadIsolatedAdministrationRegistry(store);
    expect(registry.listActiveLeagues().map(value => value.key)).toEqual(['league1']);
    expect(registry.registration).toEqual({ intendedLeagueKeys: ['league1', 'other'],
      failures: [{ leagueKey: 'other', reason: 'unregistered-season' }] });
    expect(store.listEnrollments).not.toHaveBeenCalled();
  });

  it('never converts an enabled registry database failure into an empty or bootstrap fleet', async () => {
    const store = fakeStore();
    vi.mocked(store.listEnrollmentInventory).mockRejectedValue(new Error('unavailable'));
    await expect(loadIsolatedAdministrationRegistry(store)).rejects.toThrow('unavailable');
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

describe('calendar evidence through the existing administration capture', () => {
  const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
    revisionId: '33333333-3333-4333-8333-333333333333', generation: 1, scope };
  function calendar() {
    const evidence = createSleeperCalendarEvidence({ season: '2026', seasonSchedule: capture.body,
      evaluatedAt: time, retrievalStartedAt: time, retrievalCompletedAt: time });
    if (!evidence) throw new Error('Invalid calendar fixture.');
    return evidence;
  }
  const league = { ...document, payload: { ...document.payload, season_type: 'regular' } };

  it('forwards original calendar evidence and pre-load mapping only alongside its accepted league document', async () => {
    const store = fakeStore();
    const calendarEvidence = calendar();
    await recordCapturedAdministration(scope, [league, { ...document, family: 'rosters', payload: [{ roster_id: 1, players: [] }] }],
      { store, mapping, calendarEvidence, now: () => new Date(time) });
    const calls = vi.mocked(store.recordObservation).mock.calls;
    expect(calls[0][2]).toEqual(mapping);
    expect(calls[0][7]).toEqual(calendarEvidence);
    expect(calls[0][0].envelope.provenance.sourceObservedAt).toBeNull();
    expect(calls[1][7]).toBeUndefined();
    expect(store.beginLeagueSettingsAttempt).not.toHaveBeenCalled();
  });

  it('drops original calendar proof before a changed cached league is verified', async () => {
    const store = fakeStore();
    vi.mocked(store.recordObservation).mockResolvedValueOnce({ status: 'stale', reason: 'unproven_cache_change' })
      .mockResolvedValueOnce({ status: 'changed', observationId: 'new-config' });
    vi.mocked(store.beginLeagueSettingsAttempt).mockResolvedValue({ id: 'attempt', scopeId: 'scope', ordinal: 1, expectedGeneration: 0 });
    const verify = vi.fn(async () => ({ ...league, origin: 'network' as const,
      payload: { ...league.payload, roster_positions: ['QB', 'RB', 'BN'] } }));
    await recordCapturedAdministration(scope, [league], { store, mapping, calendarEvidence: calendar(), verify,
      now: () => new Date(time) });
    const calls = vi.mocked(store.recordObservation).mock.calls;
    expect(calls[0][7]).toBeDefined();
    expect(calls[1][7]).toBeUndefined();
    expect(calls[1][2]).toEqual(mapping);
    expect(verify).toHaveBeenCalledOnce();
  });

  it('keeps unsupported or unmapped league writes unchanged without retaining optional proof', async () => {
    const store = fakeStore();
    await recordCapturedAdministration(scope, [document], { store, mapping, calendarEvidence: calendar(), now: () => new Date(time) });
    await recordCapturedAdministration(scope, [league], { store, calendarEvidence: calendar(), now: () => new Date(time) });
    await recordCapturedAdministration(scope, [{ ...league, completeness: 'partial' }],
      { store, mapping, calendarEvidence: calendar(), now: () => new Date(time) });
    for (const call of vi.mocked(store.recordObservation).mock.calls) expect(call).toHaveLength(3);
  });
});

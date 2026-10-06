import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runPublicDataRefreshStep, runPublicIntakeStep, type PublicIntakeDependencies } from './public-intake';
import type { PublicDataRefreshStore } from './public-refresh-contracts';
import { validatePublicIntake, type PublicIntakeStore, type PublicIntakeWork } from './public-intake-contracts';
import { createLeagueAdministrationStore } from './store';
import { readPublicSleeperIntake } from './public-intake-reader';
import { capturePublicSleeperIdentity, capturePublicSleeperLeagueList, capturePublicSleeperCore } from '../sleeper';
import type { DatabaseClient } from '../database';
import type { CapturedAdministrationDocument } from './runtime';
import type { NormalizedAdministrationObservation } from './contracts';
import { readAcceptedExactMatchupsRows } from './neon/exact-matchups';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../aggregator/exact-matchups';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
const id = '11111111-1111-4111-8111-111111111111';
const native = '98765432109876543210';
const time = '2026-10-06T12:00:00.000Z';
const scope = { leagueKey: `sleeper-${native}`, provider: 'sleeper' as const, externalLeagueId: native, season: 2026 };
const mapping = { connectionId: '22222222-2222-4222-8222-222222222222', leagueSeasonId: '33333333-3333-4333-8333-333333333333',
  revisionId: '44444444-4444-4444-8444-444444444444', generation: 1, scope };
const league = { league_id: native, name: 'Unrelated unusual league', season: '2026', sport: 'nfl', total_rosters: 1,
  roster_positions: ['QB', 'BN'], scoring_settings: { rec_yd: 0.1, unsupported_bonus: 2 }, settings: { divisions: 3 } };
function document(family: 'league' | 'rosters' | 'users'): CapturedAdministrationDocument & { origin: 'network'; sourceObservedAt: string } {
  return { family, week: null, origin: 'network', requestStartedAt: time, requestCompletedAt: time,
    sourceObservedAt: time, payload: family === 'league' ? league : family === 'rosters'
      ? [{ roster_id: 1, owner_id: '55', co_owners: ['66'], players: ['123'], starters: ['123'], reserve: [], taxi: [] }]
      : [{ user_id: '55', display_name: 'Manager' }] };
}
function fixture(kind: 'identity' | 'leagues' | 'bootstrap' | 'core' | 'users' = 'core') {
  let work: PublicIntakeWork | 'complete' = kind === 'identity' ? { requestId: id, revision: 0, kind, username: 'public_manager' }
    : kind === 'leagues' ? { requestId: id, revision: 1, kind, userId: '55', season: 2026 }
      : { requestId: id, revision: 2, kind, externalLeagueId: native, season: 2026 };
  const intake: PublicIntakeStore = { submit: vi.fn(), recover: vi.fn(async () => undefined), next: vi.fn(async () => work), admit: vi.fn(async () => true),
    recordIdentity: vi.fn(async () => { work = { requestId: id, revision: 1, kind: 'leagues', userId: '55', season: 2026 }; }),
    recordLeagues: vi.fn(async () => { work = { requestId: id, revision: 2, kind: 'bootstrap', externalLeagueId: native, season: 2026 }; }),
    register: vi.fn(async () => { work = { requestId: id, revision: 3, kind: 'core', externalLeagueId: native, season: 2026 }; }),
    completeExactPeriod: vi.fn(async () => undefined),
    completeCore: vi.fn(async (_work, _mapping, checkpoint) => { work = checkpoint.observations.users ? 'complete'
      : { requestId: id, revision: 4, kind: 'users', externalLeagueId: native, season: 2026 }; }), fail: vi.fn(async () => undefined) };
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping),
    beginRosterCapture: vi.fn(async () => ({ players: { id: 'players', scopeId: 'players', ordinal: 1, expectedGeneration: 0 },
      managers: { id: 'managers', scopeId: 'managers', ordinal: 1, expectedGeneration: 0 } })),
    beginLeagueSettingsAttempt: vi.fn(async () => ({ id: 'settings', scopeId: 'settings', ordinal: 1, expectedGeneration: 0 })),
    recordObservation: vi.fn(async (input: NormalizedAdministrationObservation) => ({ status: 'changed' as const,
      observationId: `observation-${input.envelope.family}`, versionId: 'version', generation: 1,
      ...(input.envelope.family === 'league' ? { leagueSettingsAcceptance: { status: 'accepted' as const, receiptId: 'settings-receipt', acceptedGeneration: 1 } }
        : input.envelope.family === 'rosters' ? { rosterAcceptance: { status: 'accepted' as const, receiptId: 'players-receipt', acceptedGeneration: 1 },
          teamManagerAcceptance: { status: 'accepted' as const, receiptId: 'managers-receipt', acceptedGeneration: 1 } } : {}) })) };
  const source = { identity: vi.fn(async () => ({ value: { userId: '55', username: 'public_manager', displayName: 'Manager', avatarUrl: null },
    payload: { user_id: '55', username: 'public_manager' }, requestStartedAt: time, requestCompletedAt: time })),
  leagues: vi.fn(async () => ({ value: [{ id: native, name: league.name, season: '2026' }], payload: [league],
    requestStartedAt: time, requestCompletedAt: time })), core: vi.fn(async (_native: string, family: 'league' | 'rosters' | 'users') => document(family)) };
  const dependencies: PublicIntakeDependencies = { intake, administration, source, now: () => new Date(time),
    jobs: { acquireJob: vi.fn(async () => ({ kind: 'acquired' as const, attempt: 1, leaseUntil: '2026-10-06T12:00:25.000Z' })),
      completeJob: vi.fn(async () => true), failJob: vi.fn(async () => true) } };
  return { dependencies, intake, administration, source, setWork: (value: typeof work) => { work = value; } };
}

describe('public official data intake through the existing worker/writer', () => {
  it('retains explicit distinct seasons and stable request identity', () => {
    expect(validatePublicIntake({ id, username: 'Any_Manager', seasons: [2026, 2025] }).seasons).toEqual([2025, 2026]);
    for (const seasons of [[], [2026, 2026], [2023, 2024, 2025, 2026], [2026.5]]) {
      expect(() => validatePublicIntake({ id, username: 'Any_Manager', seasons })).toThrow();
    }
  });
  it('collects unrelated official formats using real normalization and same-capture proof without analytics gating', async () => {
    const f = fixture();
    const outcome = await runPublicIntakeStep(id, f.dependencies, new AbortController().signal);
    expect(outcome).toEqual({ status: 'progress', resource: 'core', providerRequests: 2 });
    expect(f.administration.recordObservation).toHaveBeenCalledTimes(2);
    const calls = f.administration.recordObservation.mock.calls;
    expect(calls[0][0]).toMatchObject({ status: 'accepted', envelope: { payload: { scoring_settings: league.scoring_settings } } });
    const rosterCall = vi.mocked(f.dependencies.administration.recordObservation).mock.calls[1];
    expect(rosterCall[2]).toEqual(mapping);
    expect(rosterCall[3]?.population?.observationId).toBe('observation-league');
    expect(rosterCall[4]?.population?.observationId).toBe('observation-league');
    expect(f.intake.completeCore).toHaveBeenCalledWith(expect.anything(), mapping,
      { observations: { league: 'observation-league', rosters: 'observation-rosters' },
        receipts: { settings: 'settings-receipt', players: 'players-receipt', managers: 'managers-receipt' } }, expect.objectContaining({ generation: 1 }));
  });
  it('checkpoints new typed receipts when an unchanged capture reuses older immutable observation identities', async () => {
    const f = fixture();
    const record = f.administration.recordObservation.getMockImplementation()!;
    vi.mocked(f.dependencies.administration.recordObservation).mockImplementation(async input => ({ ...await record(input), status: 'unchanged' as const,
      observationId: 'retained-' + input.envelope.family }));
    expect(await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).toMatchObject({ status: 'progress' });
    expect(f.intake.completeCore).toHaveBeenCalledWith(expect.anything(), mapping,
      { observations: { league: 'retained-league', rosters: 'retained-rosters' },
        receipts: { settings: 'settings-receipt', players: 'players-receipt', managers: 'managers-receipt' } }, expect.anything());
    expect(vi.mocked(f.dependencies.administration.recordObservation).mock.calls[1][3]?.population)
      .toMatchObject({ observationId: 'retained-league', envelope: { provenance: { requestStartedAt: time } } });
  });
  it('finishes official core after a scoring correction while preserving the legacy calculation rejection', async () => {
    const f = fixture(); const record = f.administration.recordObservation.getMockImplementation()!;
    vi.mocked(f.dependencies.administration.recordObservation).mockImplementation(async input => ({ ...await record(input),
      status: input.envelope.family === 'league' ? 'rejected' as const : 'changed' as const }));
    expect(await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).toMatchObject({ status: 'progress' });
    expect(vi.mocked(f.dependencies.administration.recordObservation).mock.calls[1][3]?.population)
      .toMatchObject({ observationId: 'observation-league', envelope: { payload: { scoring_settings: league.scoring_settings } } });
    expect(f.intake.completeCore).toHaveBeenCalledOnce();
  });
  it('retains the fresh directory request alongside a deduplicated older observation ID', async () => {
    const f = fixture('users');
    vi.mocked(f.dependencies.administration.recordObservation).mockResolvedValue({ status: 'unchanged', observationId: 'older-directory', versionId: 'v', generation: 1 });
    expect(await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).toEqual({ status: 'progress', resource: 'users', providerRequests: 1 });
    expect(f.intake.completeCore).toHaveBeenCalledWith(expect.anything(), mapping,
      { observations: { users: 'older-directory' }, directoryCapture: document('users') }, expect.anything());
  });
  it('preserves the core checkpoint after optional directory outage and resumes only that resource', async () => {
    const f = fixture();
    f.source.core.mockImplementation(async (_native, family) => {
      if (family === 'users') throw new Error('directory unavailable');
      return document(family);
    });
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('progress');
    expect(f.intake.completeCore).toHaveBeenLastCalledWith(expect.anything(), mapping,
      { observations: { league: 'observation-league', rosters: 'observation-rosters' },
        receipts: { settings: 'settings-receipt', players: 'players-receipt', managers: 'managers-receipt' } }, expect.anything());
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('unavailable');
    f.source.core.mockImplementation(async (_native, family) => document(family));
    const before = f.administration.beginRosterCapture.mock.calls.length;
    expect(await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).toEqual({ status: 'progress', resource: 'users', providerRequests: 1 });
    expect(f.administration.beginRosterCapture).toHaveBeenCalledTimes(before);
  });
  it('resumes an acknowledged identity/list checkpoint after a lost completion acknowledgment', async () => {
    const f = fixture('identity');
    vi.mocked(f.dependencies.jobs.completeJob).mockRejectedValueOnce(new Error('unknown acknowledgment'));
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('unavailable');
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).resource).toBe('leagues');
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).resource).toBe('bootstrap');
    expect(f.source.identity).toHaveBeenCalledTimes(1);
    expect(f.source.leagues).toHaveBeenCalledExactlyOnceWith('55', 2026, expect.any(AbortSignal));
  });
  it.each(['leagueSettingsAcceptance', 'rosterAcceptance', 'teamManagerAcceptance'] as const)(
    'does not complete a core capture when %s preserves a previous head', async field => {
      const f = fixture();
      const record = f.administration.recordObservation.getMockImplementation()!;
      f.administration.recordObservation.mockImplementation(async input => {
        const result = await record(input);
        return { ...result, ...(field in result ? { [field]: { status: 'preserved', receiptId: 'new-rejected-receipt',
          acceptedGeneration: 1, reason: 'incomplete-source' } } : {}) };
      });
      if (field === 'rosterAcceptance') f.source.core.mockImplementation(async (_native, family) => family === 'rosters'
        ? { ...document(family), payload: [{ roster_id: 1, owner_id: '55', players: null, starters: [] }] } : document(family));
      expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('unavailable');
      expect(f.intake.completeCore).not.toHaveBeenCalled();
      expect(f.intake.fail).toHaveBeenCalledOnce();
    });
  it('recovers an admitted interrupted step under a different live owner exactly once, even after job generation resets', async () => {
    const f = fixture('users');
    let revision = 2;
    let failures = 0;
    let dispatch: { owner: string; generation: number; revision: number; outcome: boolean } | undefined;
    const retainedKeys = new Set<string>();
    vi.mocked(f.intake.recover).mockImplementation(async (_id, fence) => {
      if (dispatch && !dispatch.outcome) {
        expect(fence.workerId).not.toBe(dispatch.owner);
        if (revision === dispatch.revision) { revision++; failures++; }
        dispatch.outcome = true;
        f.setWork({ requestId: id, revision, kind: 'users', externalLeagueId: native, season: 2026 });
      }
    });
    vi.mocked(f.intake.admit).mockImplementation(async (work, fence) => {
      const key = `${fence.workerId}:${fence.generation}`;
      expect(retainedKeys.has(key)).toBe(false);
      retainedKeys.add(key);
      dispatch = { owner: fence.workerId, generation: fence.generation, revision: work.revision, outcome: false };
      return true;
    });
    // Both the old scoped database and cleanup are unavailable after a deadline.
    vi.mocked(f.intake.fail).mockRejectedValue(new Error('expired database signal'));
    f.source.core.mockRejectedValueOnce(new Error('directory timeout'));
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('unavailable');
    expect(failures).toBe(0);
    // A new job lifecycle starts at generation 1; the retained worker UUID makes
    // its dispatch distinct from history that outlived normal job pruning.
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('progress');
    expect(failures).toBe(1);
    expect(retainedKeys.size).toBe(2);
    dispatch!.outcome = true;
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('complete');
    expect(failures).toBe(1);
    expect(f.source.identity).not.toHaveBeenCalled();
    expect(f.source.leagues).not.toHaveBeenCalled();
  });
  it('does not dispatch after duplicate claim, failed-attempt cooldown, or stored terminal failure', async () => {
    const f = fixture();
    vi.mocked(f.dependencies.jobs.acquireJob).mockResolvedValueOnce({ kind: 'busy' });
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('busy');
    vi.mocked(f.intake.admit).mockResolvedValueOnce(false);
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('backoff');
    for (const status of ['partial', 'unavailable', 'complete'] as const) {
      vi.mocked(f.intake.next).mockResolvedValueOnce(status);
      expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe(status);
    }
    expect(f.source.core).not.toHaveBeenCalled();
  });
  it('does not advance a checkpoint after lease loss or season mismatch', async () => {
    const f = fixture();
    f.administration.recordObservation.mockRejectedValue(new Error('lease lost after response'));
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('unavailable');
    expect(f.intake.completeCore).not.toHaveBeenCalled();
    const g = fixture();
    g.administration.readSourceMapping.mockResolvedValue({ ...mapping, scope: { ...scope, season: 2025 } });
    expect((await runPublicIntakeStep(id, g.dependencies, new AbortController().signal)).status).toBe('unavailable');
    expect(g.source.core).not.toHaveBeenCalled();
  });
  it('reports stored core resources independently and never invokes a source during readback', async () => {
    const f = fixture();
    const rows = [[{ id, seasons: [2026], terminal: true, external_manager_id: '55' }], [{ season: 2026 }],
      [{ season: 2026, external_league_id: native, name: league.name, stage: 'unavailable', league_season_id: mapping.leagueSeasonId }], []];
    const client = { enabled: true as const, query: vi.fn(async () => rows.shift() ?? []) } as unknown as DatabaseClient;
    const result = await readPublicSleeperIntake(client, f.dependencies.administration, id);
    expect(result.status).toBe('partial');
    if (result.status === 'missing') throw new Error('Missing fixture result.');
    expect(result.leagues[0].resources?.heldRoster.status).toBe('disabled');
    expect(result.coverage.notRequested).toContain('exact-matchups');
    expect(f.source.core).not.toHaveBeenCalled();
  });
  it.each([false, true])('binds fresh directory acquisition separately from its old observation (foreign mapping: %s)', async foreign => {
    const f = fixture();
    const acquisition = { id: 'directory-capture', contentId: 'retained-content', legacyObservationId: 'retained-users',
      sourceMapping: foreign ? { ...mapping, generation: 2 } : mapping,
      requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time };
    const rows = [[{ id, seasons: [2026], terminal: true, external_manager_id: '55' }], [{ season: 2026 }],
      [{ season: 2026, external_league_id: native, name: league.name, stage: 'complete', league_season_id: mapping.leagueSeasonId,
        users_observation_id: 'retained-users', directory_capture: acquisition }], []];
    const client = { enabled: true, query: vi.fn(async () => rows.shift() ?? []) } as unknown as DatabaseClient;
    const retained = { status: 'available', observationId: 'retained-users', envelope: { provenance: {
      origin: 'cache', requestStartedAt: '2026-10-01T00:00:00.000Z', requestCompletedAt: '2026-10-01T00:00:00.000Z' } } };
    const administration = { ...f.dependencies.administration, readSource: vi.fn(async () => retained) } as unknown as typeof f.dependencies.administration;
    const result = await readPublicSleeperIntake(client, administration, id);
    if (result.status === 'missing') throw new Error('Missing read fixture.');
    expect(result.leagues[0].resources?.directory).toEqual(foreign
      ? { status: 'unavailable', reason: 'intake-capture-not-current-head', retained }
      : { ...retained, acquisition });
    expect(f.source.core).not.toHaveBeenCalled();
  });
  it('preserves available typed resources when the optional directory reader throws', async () => {
    const f = fixture();
    const rows = [[{ id, seasons: [2026], terminal: true, external_manager_id: '55' }], [{ season: 2026 }],
      [{ season: 2026, external_league_id: native, name: league.name, stage: 'complete', league_season_id: mapping.leagueSeasonId,
        settings_receipt_id: 'settings', managers_receipt_id: 'managers', players_receipt_id: 'roster' }], []];
    const client = { enabled: true as const, query: vi.fn(async () => rows.shift() ?? []) } as unknown as DatabaseClient;
    const administration = { ...f.dependencies.administration,
      readAcceptedLeagueSettings: vi.fn(async () => ({ status: 'available', accepted: { observationIds: ['settings'] } })),
      readAcceptedTeamManagers: vi.fn(async () => ({ status: 'available', accepted: { observationIds: ['managers'] } })),
      readAcceptedCurrentRoster: vi.fn(async () => ({ status: 'available', accepted: { observationIds: ['roster'] } })),
      readSource: vi.fn(async () => { throw new Error('optional directory read failed'); }),
    } as unknown as typeof f.dependencies.administration;
    const result = await readPublicSleeperIntake(client, administration, id);
    expect(result.status).toBe('partial');
    if (result.status === 'missing') throw new Error('Missing fixture result.');
    expect(result.leagues[0].resources).toMatchObject({ settings: { status: 'available' },
      teamManagers: { status: 'available' }, heldRoster: { status: 'available' }, directory: { status: 'unavailable' } });
  });
  it('keeps a different retained typed head visible without calling it the completed intake capture', async () => {
    const f = fixture();
    const rows = [[{ id, seasons: [2026], terminal: true, external_manager_id: '55' }], [{ season: 2026 }],
      [{ season: 2026, external_league_id: native, name: league.name, stage: 'complete', league_season_id: mapping.leagueSeasonId,
        settings_receipt_id: 'current-settings', managers_receipt_id: 'current-managers', players_receipt_id: 'current-roster' }], []];
    const client = { enabled: true, query: vi.fn(async () => rows.shift() ?? []) } as unknown as DatabaseClient;
    const retained = { status: 'available', accepted: { observationIds: ['different-capture'] } };
    const administration = { ...f.dependencies.administration, readAcceptedLeagueSettings: vi.fn(async () => retained),
      readAcceptedTeamManagers: vi.fn(async () => retained), readAcceptedCurrentRoster: vi.fn(async () => retained) } as unknown as typeof f.dependencies.administration;
    const result = await readPublicSleeperIntake(client, administration, id);
    expect(result.status).toBe('partial');
    if (result.status === 'missing') throw new Error('Missing fixture result.');
    for (const resource of ['settings', 'teamManagers', 'heldRoster'] as const) {
      expect(result.leagues[0].resources?.[resource]).toEqual({ status: 'unavailable', reason: 'intake-capture-not-current-head', retained });
    }
  });
});

describe('bounded shared Sleeper transport captures', () => {
  it('retains invalid raw lists without describing them as a complete filtered list', async () => {
    const payload = [league, { ...league, league_id: 'broken' }];
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload)));
    try {
      const captured = await capturePublicSleeperLeagueList('55', 2026, new AbortController().signal);
      expect(captured).toMatchObject({ value: null, diagnostic: 'invalid-source', payload });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' });
    } finally { fetch.mockRestore(); }
  });
  it('keeps numeric stable identity mismatches as invalid evidence, and performs no redirect retry', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ user_id: '66', username: 'Other' })))
      .mockResolvedValueOnce(new Response('', { status: 302 }));
    try {
      expect(await capturePublicSleeperIdentity('55', new AbortController().signal)).toMatchObject({ value: null, diagnostic: 'invalid-source' });
      await expect(capturePublicSleeperCore(native, 'league', new AbortController().signal)).rejects.toThrow('HTTP 302');
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { fetch.mockRestore(); }
  });
  it('keeps the additive installer/role and registry boundary explicit in source', async () => {
    const sql = await readFile(new URL('../../migrations/034_public_data_intake.sql', import.meta.url), 'utf8');
    expect(sql).not.toContain('website_auth');
    expect(sql).not.toContain('app_acquisition_demands');
    expect(sql).toContain("admitted_at>clock_timestamp()-interval '60 seconds'");
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('PRIMARY KEY(worker_id,generation)');
    expect(sql).toContain('CREATE FUNCTION public.recover_public_data_dispatch');
    expect(sql).toContain('attempt.source_mapping=mapping AND attempt.write_fence=p_fence');
    expect(sql).toContain('head.accepted_id=accepted.id');
    expect(sql).toContain("FOREACH receipt_key IN ARRAY ARRAY['settings','players','managers']");
    expect(sql).toContain("evidence='public-data-intake-v1' AND NOT active");
    const original = await readFile(new URL('../../migrations/025_account_league_enrollment.sql', import.meta.url), 'utf8');
    const originalRegistrationGuard = original.slice(original.indexOf('  IF NOT EXISTS ('), original.indexOf("  IF EXISTS (SELECT 1 FROM public.league_administration_enrollments"));
    expect(sql).toContain(originalRegistrationGuard);
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.activate_account_league_enrollment');
    expect(sql).toContain("VALUES(v_league_id,'sleeper',false,'public-data-intake-v1') ON CONFLICT DO NOTHING");
    const enrollment = await readFile(new URL('./neon/enrollment.ts', import.meta.url), 'utf8');
    expect(enrollment).toContain("membership.evidence<>'public-data-intake-v1'");
    expect(enrollment).not.toContain('public_data_intakes');
    expect(enrollment).toContain("(to_jsonb(enrollment)->'data_adopted_seasons') @> jsonb_build_array(candidate.season)");
    expect(enrollment).toContain("(to_jsonb(adopted)->'data_adopted_seasons') @> jsonb_build_array(membership.season)");
    expect(sql).not.toContain('UPDATE public.league_administration_enrollment_seasons');
    expect(sql).not.toContain("observed.request_started_at>=clock_timestamp()-interval '30 seconds'");
    expect(sql).toContain('attempt.reserved_at>=dispatch_row.admitted_at');
    expect(sql).toContain("(receipt.provenance->>'requestStartedAt')::timestamptz>=dispatch_row.admitted_at");
    expect(sql).toContain('head.verified_at=completed AND head.ordering_at=completed');
    expect(sql).toContain("stage=CASE WHEN kind='core' THEN 'users' ELSE 'complete' END");
    expect(sql).toContain("CREATE TRIGGER public_directory_capture_immutable BEFORE UPDATE OR DELETE");
    expect(sql).toContain('PERFORM public.validate_current_roster_mapping(mapping)');
    expect(sql.split('\n').some(line => line.endsWith('AS $'))).toBe(false);
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.validate_current_roster_lineage');
    for (const version of ['v30', 'v31', 'v32']) expect(sql).not.toContain('FUNCTION public.record_league_administration_observation_' + version + '(');
    const v29 = await readFile(new URL('../../migrations/029_league_season_settings.sql', import.meta.url), 'utf8');
    const originalWriter = v29.slice(v29.indexOf('CREATE OR REPLACE FUNCTION public.record_league_administration_observation(p_input jsonb)'));
    const rewritten = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.record_league_administration_observation_v29(p_input jsonb)'), sql.indexOf('REVOKE ALL ON public.public_data_intakes')).trim();
    expect(rewritten.slice(rewritten.indexOf('  IF manager_resource THEN')).trim()).toBe(originalWriter.slice(originalWriter.indexOf('  IF manager_resource THEN')).trim());
    expect(rewritten).toContain("official_head.read_conflict='scoring_profile_change_requires_explicit_compatibility_and_period_review'");
    expect(rewritten).toContain('settings_attempt.write_fence IS NOT DISTINCT FROM attempt.write_fence');
    expect(rewritten).toContain('settings_attempt.ordinal=settings_head.latest_ordinal');

  });
});


describe('opt-in manager evidence through public DATA intake', () => {
  it.each([false, true])('retains v1 reservations and same GETs with an invalid primary: %s', async malformed => {
    const f = fixture();
    const evidenceAttempt = { id: 'evidence', scopeId: 'evidence-scope', ordinal: 1, expectedGeneration: 0 };
    const reserve = vi.fn(async () => evidenceAttempt);
    const administration = { ...f.administration, beginTeamManagerEvidenceAttempt: reserve };
    const write = vi.mocked((administration as typeof f.dependencies.administration).recordObservation);
    const original = f.administration.recordObservation.getMockImplementation()!;
    write.mockImplementation(async input => ({ ...await original(input),
      ...(input.envelope.family === 'rosters' ? {
        teamManagerAcceptance: malformed ? { status: 'preserved' as const, reason: 'invalid-primary', receiptId: 'preserved-receipt', acceptedGeneration: 0 }
          : { status: 'accepted' as const, receiptId: 'managers-receipt', acceptedGeneration: 1 },
        teamManagerEvidenceAcceptance: { status: 'accepted' as const, receiptId: 'evidence-receipt', acceptedGeneration: 1 },
      } : {}) }));
    f.source.core.mockImplementation(async (_native, family) => {
      expect(reserve).toHaveBeenCalledOnce();
      expect(f.administration.beginRosterCapture).toHaveBeenCalledOnce();
      return family === 'rosters' && malformed
        ? { ...document(family), payload: [{ roster_id: 1, owner_id: 0, co_owners: ['66'], players: ['123'] }] }
        : document(family);
    });
    const outcome = await runPublicIntakeStep(id, { ...f.dependencies, administration, managerEvidenceVersion: 'v2' }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: malformed ? 'unavailable' : 'progress', resource: 'core', providerRequests: 2 });
    expect(f.source.core.mock.calls.map(call => call[1])).toEqual(['league', 'rosters']);
    const call = vi.mocked((administration as typeof f.dependencies.administration).recordObservation).mock.calls[1];
    expect(call[3]?.attempt.id).toBe('players');
    expect(call[4]?.attempt.id).toBe('managers');
    expect(call[10]).toMatchObject({ attempt: evidenceAttempt, population: { observationId: 'observation-league' } });
    expect(call[0].teamManagerEvidence).toMatchObject({ status: malformed ? 'partial' : 'complete', teams: [{
      primaryOwner: { state: malformed ? 'unknown' : 'owned' }, coManagers: { state: 'known', externalManagerIds: ['66'] } }] });
    if (malformed) {
      expect(f.intake.completeCore).not.toHaveBeenCalled();
      expect(f.intake.fail).toHaveBeenCalledOnce();
    } else expect(f.intake.completeCore).toHaveBeenCalledWith(expect.anything(), mapping,
      expect.objectContaining({ receipts: { settings: 'settings-receipt', players: 'players-receipt', managers: 'managers-receipt' } }), expect.anything());
  });

  it('makes no v2 reservation or projection without explicit selection', async () => {
    const f = fixture(); const reserve = vi.fn();
    await runPublicIntakeStep(id, { ...f.dependencies, administration: { ...f.administration, beginTeamManagerEvidenceAttempt: reserve } }, new AbortController().signal);
    expect(reserve).not.toHaveBeenCalled();
    for (const call of f.administration.recordObservation.mock.calls) expect(call[0]).not.toHaveProperty('teamManagerEvidence');
  });

  it('performs no source request when the selected evidence reservation cannot be obtained', async () => {
    const f = fixture();
    const result = await runPublicIntakeStep(id, { ...f.dependencies, managerEvidenceVersion: 'v2',
      administration: { ...f.administration, beginTeamManagerEvidenceAttempt: undefined } }, new AbortController().signal);
    expect(result).toMatchObject({ status: 'unavailable', providerRequests: 0 });
    expect(f.source.core).not.toHaveBeenCalled(); expect(f.intake.completeCore).not.toHaveBeenCalled();
  });

  it('exposes stored partial evidence for an incomplete core without promoting it to intake completion', async () => {
    const f = fixture();
    const rows = [[{ id, seasons: [2026], terminal: true, external_manager_id: '55' }], [{ season: 2026 }],
      [{ season: 2026, external_league_id: native, name: league.name, stage: 'pending', league_season_id: mapping.leagueSeasonId }], []];
    const client = { enabled: true, query: vi.fn(async () => rows.shift() ?? []) } as unknown as DatabaseClient;
    const evidence = { status: 'available', evidenceCompleteness: 'partial', evidenceReasons: ['primary_owner_invalid'],
      accepted: { observationIds: ['evidence-receipt'] }, teams: [{ primaryOwner: { state: 'unknown', manager: null, reason: 'primary_owner_invalid' },
        coManagers: { state: 'known', managers: [{ providerManagerId: 'canonical-co', sourceManager: { nativeId: '66' } }] }, assurance: 'provider-observed' }] };
    const read = vi.fn(async () => evidence);
    const administration = { ...f.administration, readAcceptedTeamManagerEvidence: read } as unknown as typeof f.dependencies.administration;
    const result = await readPublicSleeperIntake(client, administration, id, { managerEvidenceVersion: 'v2' });
    expect(result.status).toBe('partial');
    if (result.status === 'missing') throw new Error('Missing fixture.');
    expect(result.leagues[0].resources?.teamManagerEvidence).toEqual({ ...evidence, captureBinding: 'latest-for-current-source-mapping' });
    expect(result.leagues[0].resources?.teamManagers.status).not.toBe('available');
    expect(read).toHaveBeenCalledExactlyOnceWith(mapping);
    expect(f.source.core).not.toHaveBeenCalled(); expect(f.intake.completeCore).not.toHaveBeenCalled();
  });
});

describe('recurring DATA uses the same owned intake step', () => {
  const selected = { status: 'selected' as const, targetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    configurationRevision: 3, cycleConfigurationRevision: 2, cycle: 4, requestId: id };
  function recurring() {
    const f = fixture();
    const refresh: PublicDataRefreshStore = { configure: vi.fn(), select: vi.fn(async () => selected),
      recordSelectionFailure: vi.fn(async () => ({ status: 'recorded' as const })) };
    return { ...f, refresh, dependencies: { ...f.dependencies, refresh } };
  }
  it('keeps an explicit manual request on its original path even if a dependency object also exposes recurrence', async () => {
    const f = recurring();
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('progress');
    expect(f.refresh.select).not.toHaveBeenCalled(); expect(f.refresh.recordSelectionFailure).not.toHaveBeenCalled();
    expect(f.dependencies.jobs.acquireJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { requestId: id, policy: 'public-data-intake-v1' } }));
  });
  it('binds the selected immutable request under one owner before the unchanged capture path', async () => {
    const f = recurring();
    vi.mocked(f.refresh.select).mockImplementation(async fence => {
      expect(f.dependencies.jobs.acquireJob).toHaveBeenCalledOnce();
      expect(f.intake.next).not.toHaveBeenCalled();
      expect(fence.deadlineAt).toBe('2026-10-06T12:00:18.000Z');
      return selected;
    });
    const result = await runPublicDataRefreshStep({ ...f.dependencies, deadlineAt: '2026-10-06T12:00:18.000Z' }, new AbortController().signal);
    expect(result).toEqual({ status: 'progress', resource: 'core', providerRequests: 2 });
    expect(f.dependencies.jobs.acquireJob).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      jobKey: 'league-administration-public-intake', payload: { policy: 'public-data-refresh-v1', mode: 'recurring' } }));
    expect(f.intake.recover).toHaveBeenCalledWith(id, expect.objectContaining({ generation: 1 }));
    expect(f.intake.next).toHaveBeenCalledExactlyOnceWith(id);
    expect(f.source.core).toHaveBeenCalledTimes(2);
    expect(f.administration.beginRosterCapture).toHaveBeenCalledOnce();
    expect(f.intake.completeCore).toHaveBeenCalledOnce();
    expect(f.refresh.recordSelectionFailure).not.toHaveBeenCalled();
  });
  it.each(['idle', 'backoff', 'capacity'] as const)('makes no intake/provider request for selector %s', async status => {
    const f = recurring(); vi.mocked(f.refresh.select).mockResolvedValue({ status });
    expect(await runPublicDataRefreshStep(f.dependencies, new AbortController().signal)).toEqual({ status, providerRequests: 0 });
    expect(f.intake.next).not.toHaveBeenCalled(); expect(f.source.core).not.toHaveBeenCalled();
    expect(f.dependencies.jobs.completeJob).toHaveBeenCalledOnce(); expect(f.refresh.recordSelectionFailure).not.toHaveBeenCalled();
  });
  it('does not select or debit failure for busy ownership or admission throttle', async () => {
    const f = recurring(); vi.mocked(f.dependencies.jobs.acquireJob).mockResolvedValueOnce({ kind: 'busy' });
    expect((await runPublicDataRefreshStep(f.dependencies, new AbortController().signal)).status).toBe('busy');
    expect(f.refresh.select).not.toHaveBeenCalled();
    vi.mocked(f.intake.admit).mockResolvedValue(false);
    expect((await runPublicDataRefreshStep(f.dependencies, new AbortController().signal)).status).toBe('backoff');
    expect(f.refresh.recordSelectionFailure).not.toHaveBeenCalled(); expect(f.source.core).not.toHaveBeenCalled();
  });
  it.each(['selection-failed', 'request-state-failed', 'admission-unconfirmed'] as const)(
    'reconciles %s using the exact owner before releasing its lease', async reason => {
      const f = recurring();
      const method = reason === 'selection-failed' ? f.refresh.select : reason === 'request-state-failed' ? f.intake.next : f.intake.admit;
      vi.mocked(method).mockRejectedValue(new Error('unknown acknowledgment'));
      vi.mocked(f.refresh.recordSelectionFailure).mockImplementation(async (token, fence, actualReason) => {
        expect(token).toEqual(reason === 'selection-failed' ? null : selected);
        expect(actualReason).toBe(reason); expect(fence.workerId).toEqual(expect.any(String));
        expect(f.dependencies.jobs.failJob).not.toHaveBeenCalled();
        return { status: reason === 'admission-unconfirmed' ? 'admitted' : 'recorded' };
      });
      expect(await runPublicDataRefreshStep(f.dependencies, new AbortController().signal)).toMatchObject({ status: 'unavailable', providerRequests: 0 });
      expect(f.refresh.recordSelectionFailure).toHaveBeenCalledOnce(); expect(f.source.core).not.toHaveBeenCalled();
      expect(f.dependencies.jobs.failJob).toHaveBeenCalledOnce();
    });
  it('uses admitted capture recovery without adding pre-admission failure credit', async () => {
    const f = recurring(); f.source.core.mockRejectedValue(new Error('source failed'));
    expect((await runPublicDataRefreshStep(f.dependencies, new AbortController().signal)).status).toBe('unavailable');
    expect(f.intake.fail).toHaveBeenCalledOnce(); expect(f.refresh.recordSelectionFailure).not.toHaveBeenCalled();
  });
  it('never grants a new work fence after a delayed owner claim', async () => {
    const f = recurring(); let clock = Date.parse(time);
    vi.mocked(f.dependencies.jobs.acquireJob).mockImplementation(async () => {
      clock += 17_000; return { kind: 'acquired', attempt: 1, leaseUntil: '2026-10-06T12:00:25.000Z' };
    });
    await runPublicDataRefreshStep({ ...f.dependencies, now: () => new Date(clock), deadlineAt: '2026-10-06T12:00:20.000Z' }, new AbortController().signal);
    expect(f.refresh.select).toHaveBeenCalledWith(expect.objectContaining({ deadlineAt: '2026-10-06T12:00:20.000Z' }));
    expect(f.intake.admit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ deadlineAt: '2026-10-06T12:00:20.000Z' }));
  });
  it('cleans up an owner obtained after cancellation without selecting or charging a target', async () => {
    const f = recurring(); const controller = new AbortController();
    vi.mocked(f.dependencies.jobs.acquireJob).mockImplementation(async () => {
      controller.abort(); return { kind: 'acquired', attempt: 1, leaseUntil: '2026-10-06T12:00:25.000Z' };
    });
    expect((await runPublicDataRefreshStep(f.dependencies, controller.signal)).status).toBe('unavailable');
    expect(f.refresh.select).not.toHaveBeenCalled(); expect(f.refresh.recordSelectionFailure).not.toHaveBeenCalled();
    expect(f.dependencies.jobs.failJob).toHaveBeenCalledOnce(); expect(f.source.core).not.toHaveBeenCalled();
  });
  it('does not blame selection for a spent work budget and cleans up through an independent bounded store', async () => {
    const f = recurring(); const controller = new AbortController();
    vi.mocked(f.refresh.select).mockImplementation(async () => { controller.abort(); throw controller.signal.reason; });
    const cleanup = { intake: { fail: vi.fn() }, jobs: { failJob: vi.fn(async () => true) },
      refresh: { recordSelectionFailure: vi.fn() } };
    expect((await runPublicDataRefreshStep({ ...f.dependencies, cleanup: () => cleanup }, controller.signal)).status).toBe('unavailable');
    expect(cleanup.jobs.failJob).toHaveBeenCalledOnce(); expect(f.dependencies.jobs.failJob).not.toHaveBeenCalled();
    expect(cleanup.refresh.recordSelectionFailure).not.toHaveBeenCalled(); expect(f.refresh.recordSelectionFailure).not.toHaveBeenCalled();
    expect(f.source.core).not.toHaveBeenCalled();
  });
  it('returns a terminal request without creating a cycle or fabricating fresh content in TypeScript', async () => {
    const f = recurring(); f.setWork('complete');
    expect(await runPublicDataRefreshStep(f.dependencies, new AbortController().signal)).toEqual({ status: 'complete', providerRequests: 0 });
    expect(f.intake.submit).not.toHaveBeenCalled(); expect(f.source.core).not.toHaveBeenCalled();
    expect(f.refresh.configure).not.toHaveBeenCalled(); expect(f.refresh.recordSelectionFailure).not.toHaveBeenCalled();
  });
});

describe('early recurring admission phase and owner reconciliation', () => {
  const selected = { status: 'selected' as const, targetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    configurationRevision: 1, cycleConfigurationRevision: 1, cycle: 1, requestId: id };
  function phaseFixture() {
    const f = fixture('identity'); const phase = new AbortController(); const outer = new AbortController();
    const refresh: PublicDataRefreshStore = { configure: vi.fn(), select: vi.fn(async () => selected),
      recordSelectionFailure: vi.fn(async () => ({ status: 'recorded' as const })) };
    const phaseIntake = { recover: vi.fn(async () => undefined), next: vi.fn((...args: Parameters<typeof f.intake.next>) => f.intake.next(...args)), admit: vi.fn(async () => true) };
    const phaseJobs = { acquireJob: vi.fn((...args: Parameters<typeof f.dependencies.jobs.acquireJob>) => f.dependencies.jobs.acquireJob(...args)) };
    const phaseRefresh = { select: vi.fn((...args: Parameters<typeof refresh.select>) => refresh.select(...args)) };
    const cleanup = { intake: { fail: vi.fn(async () => undefined) }, jobs: { failJob: vi.fn(async () => true) },
      refresh: { recordSelectionFailure: vi.fn((...args: Parameters<typeof refresh.recordSelectionFailure>) => refresh.recordSelectionFailure(...args)) } };
    return { ...f, phase, outer, refresh, phaseIntake, phaseJobs, phaseRefresh, cleanup,
      dependencies: { ...f.dependencies, refresh, preAdmission: { signal: phase.signal, intake: phaseIntake,
        jobs: phaseJobs, refresh: phaseRefresh, cleanup: () => cleanup } } };
  }
  it('routes every pre-admission database operation through the phase and keeps HTTP on the outer signal', async () => {
    const f = phaseFixture(); const capture = f.source.identity.getMockImplementation()!;
    vi.mocked(f.dependencies.source!.identity).mockImplementation(async (_username, signal) => {
      f.phase.abort(); expect(signal).toBe(f.outer.signal); expect(f.outer.signal.aborted).toBe(false);
      return capture();
    });
    expect((await runPublicDataRefreshStep(f.dependencies, f.outer.signal)).status).toBe('progress');
    expect(f.phaseJobs.acquireJob).toHaveBeenCalledOnce(); expect(f.phaseRefresh.select).toHaveBeenCalledOnce();
    expect(f.phaseIntake.recover).toHaveBeenCalledOnce(); expect(f.phaseIntake.next).toHaveBeenCalledOnce();
    expect(f.phaseIntake.admit).toHaveBeenCalledOnce(); expect(f.intake.admit).not.toHaveBeenCalled();
    expect(f.refresh.select).toHaveBeenCalledOnce(); // phase mock delegates only to its injected storage double.
    expect(f.cleanup.refresh.recordSelectionFailure).not.toHaveBeenCalled();
  });
  it('keeps manual intake on its original signal and client even when supplied an incidental recurring phase', async () => {
    const f = phaseFixture(); f.phase.abort();
    expect((await runPublicIntakeStep(id, f.dependencies, f.outer.signal)).status).toBe('progress');
    expect(f.phaseJobs.acquireJob).not.toHaveBeenCalled(); expect(f.phaseRefresh.select).not.toHaveBeenCalled();
    expect(f.dependencies.jobs.acquireJob).toHaveBeenCalledOnce(); expect(f.source.identity).toHaveBeenCalledOnce();
  });
  it('does not attribute setup or claim exhaustion to a target that was never selected', async () => {
    const f = phaseFixture();
    f.phaseJobs.acquireJob.mockImplementation(async () => { f.phase.abort(); return { kind: 'acquired', attempt: 1, leaseUntil: time }; });
    expect((await runPublicDataRefreshStep(f.dependencies, f.outer.signal)).status).toBe('unavailable');
    expect(f.phaseRefresh.select).not.toHaveBeenCalled(); expect(f.refresh.recordSelectionFailure).not.toHaveBeenCalled();
    expect(f.cleanup.refresh.recordSelectionFailure).not.toHaveBeenCalled(); expect(f.source.identity).not.toHaveBeenCalled();
    expect(f.dependencies.jobs.failJob).toHaveBeenCalledOnce();
  });
  it('reconciles an unknown selection acknowledgment using only the exact owner binding', async () => {
    const f = phaseFixture();
    f.phaseRefresh.select.mockImplementation(async () => { f.phase.abort(); throw new Error('selection ACK lost'); });
    expect((await runPublicDataRefreshStep(f.dependencies, f.outer.signal)).status).toBe('unavailable');
    expect(f.cleanup.refresh.recordSelectionFailure).toHaveBeenCalledExactlyOnceWith(null,
      expect.objectContaining({ jobKey: 'league-administration-public-intake', generation: 1 }), 'selection-failed');
    expect(f.outer.signal.aborted).toBe(false); expect(f.source.identity).not.toHaveBeenCalled();
  });
  it('lets a committed admission win over a timed-out acknowledgment without a second HTTP or failure debit', async () => {
    const f = phaseFixture(); let admitted = false; let failureCredits = 0;
    f.phaseIntake.admit.mockImplementation(async () => { admitted = true; f.phase.abort(); throw new Error('admission ACK lost'); });
    f.cleanup.refresh.recordSelectionFailure.mockImplementation(async () => {
      if (admitted) return { status: 'admitted' }; failureCredits++; return { status: 'recorded' };
    });
    expect((await runPublicDataRefreshStep(f.dependencies, f.outer.signal)).status).toBe('unavailable');
    expect(f.cleanup.refresh.recordSelectionFailure).toHaveBeenCalledWith(selected, expect.anything(), 'admission-unconfirmed');
    expect(f.phaseIntake.admit).toHaveBeenCalledOnce(); expect(failureCredits).toBe(0);
    expect(f.source.identity).not.toHaveBeenCalled(); expect(f.cleanup.intake.fail).toHaveBeenCalledOnce();
  });
  it('does not let repeated early next-state timeouts monopolize six minute-spaced selections', async () => {
    const targets = [{ requestId: id, name: 'A', served: null as number | null, eligible: 0, failures: 0 },
      { requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'B', served: null as number | null, eligible: 0, failures: 0 }];
    const order: string[] = []; let clock = 0; let selectedTarget = targets[0]; let healthyCalls = 0; let failureCredits = 0;
    for (let turn = 0; turn < 6; turn++) {
      clock = turn * 60_000; const f = phaseFixture();
      f.phaseRefresh.select.mockImplementation(async () => {
        selectedTarget = targets.filter(target => target.eligible <= clock)
          .sort((left, right) => (left.served ?? -1) - (right.served ?? -1) || left.name.localeCompare(right.name))[0];
        order.push(selectedTarget.name); return { ...selected, requestId: selectedTarget.requestId };
      });
      f.phaseIntake.next.mockImplementation(async requestId => {
        if (selectedTarget.name === 'A') { clock += 10_000; f.phase.abort(); throw new Error('actual phase aborted storage call'); }
        return { kind: 'identity', requestId, revision: 0, username: 'stable-manager' };
      });
      f.phaseIntake.admit.mockImplementation(async () => { selectedTarget.served = clock; return true; });
      f.cleanup.refresh.recordSelectionFailure.mockImplementation(async () => {
        expect(f.outer.signal.aborted).toBe(false); failureCredits++; selectedTarget.failures++;
        selectedTarget.eligible = clock + 60_000 * 2 ** (selectedTarget.failures - 1); return { status: 'recorded' };
      });
      const capture = f.source.identity.getMockImplementation()!;
      f.source.identity.mockImplementation(async () => { healthyCalls++; return capture(); });
      await runPublicDataRefreshStep(f.dependencies, f.outer.signal);
    }
    expect(order).toEqual(['A', 'B', 'A', 'B', 'B', 'A']);
    expect(healthyCalls).toBe(3); expect(failureCredits).toBe(3); expect(targets[0].served).toBeNull();
  });
});

const exactSelection = [{ season: 2026, nativeWeek: 18 }];
const periodWork = { requestId: id, revision: 3, kind: 'exact-matchups' as const, externalLeagueId: native, season: 2026, nativeWeek: 18 };
const periodReceipt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const settingsReceipt = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const configurationContent = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const periodPayload = [{ roster_id: 1, matchup_id: null, players: ['123'], starters: ['123', '0'],
  starters_points: [-2, null], players_points: { '123': -2 }, points: -2, custom_points: 0 }];
function periodFixture() {
  const f = fixture(); f.setWork(periodWork);
  const events: string[] = [];
  const source = { ...f.source, exactPeriod: vi.fn(async (_native: string, week: number): Promise<CapturedAdministrationDocument> => {
    events.push('get-matchups'); return { family: 'matchups', week, origin: 'network', payload: periodPayload,
      requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time };
  }) };
  source.core.mockImplementation(async (_native, family) => { events.push('get-' + family); return document(family); });
  f.administration.beginLeagueSettingsAttempt.mockImplementation(async () => {
    events.push('reserve-settings'); return { id: settingsReceipt, scopeId: settingsReceipt, ordinal: 1, expectedGeneration: 0 };
  });
  const administration = { ...f.dependencies.administration,
    beginExactMatchupAttempt: vi.fn(async () => { events.push('reserve-matchups');
      return { id: periodReceipt, scopeId: periodReceipt, ordinal: 1, expectedGeneration: 0 }; }) };
  vi.mocked(administration.recordObservation).mockImplementation(async input => {
    events.push('write-' + input.envelope.family);
    return { status: 'changed', observationId: input.envelope.family === 'league' ? settingsReceipt : periodReceipt,
      ...(input.envelope.family === 'league'
        ? { leagueSettingsAcceptance: { status: 'accepted' as const, receiptId: settingsReceipt, acceptedGeneration: 1 } }
        : { matchupAcceptance: { status: input.status === 'accepted' ? 'accepted' as const : 'preserved' as const,
          receiptId: periodReceipt, acceptedGeneration: 1 } }) };
  });
  return { ...f, administration, source, events, dependencies: { ...f.dependencies, source, administration } };
}

describe('explicit exact-period intake composition', () => {
  it('canonically selects at most one native period in each declared season and leaves old wire identity unchanged', () => {
    const old = { id, username: 'Manager', seasons: [2026, 2025, 2024] };
    expect(JSON.stringify(validatePublicIntake({ ...old, exactPeriods: [] }))).toBe(JSON.stringify(validatePublicIntake(old)));
    expect(validatePublicIntake({ ...old, exactPeriods: [{ season: 2026, nativeWeek: 18 }, { season: 2024, nativeWeek: 1 }] }))
      .toEqual({ ...old, seasons: [2024, 2025, 2026], exactPeriods: [{ season: 2024, nativeWeek: 1 }, { season: 2026, nativeWeek: 18 }] });
  });
  it.each([null, {}, [null], [{ season: 2026 }], [{ season: '2026', nativeWeek: 1 }], [{ season: 2026, nativeWeek: '1' }],
    [{ season: 2026, nativeWeek: 0 }], [{ season: 2026, nativeWeek: 19 }], [{ season: 2026, nativeWeek: 1.5 }],
    [{ season: 2025, nativeWeek: 1 }], [{ season: 2026, nativeWeek: 1, extra: true }],
    [{ season: 2026, nativeWeek: 1 }, { season: 2026, nativeWeek: 2 }],
    [1, 2, 3, 4].map(nativeWeek => ({ season: 2026, nativeWeek }))])('rejects an invalid explicit period selection: %j', exactPeriods => {
    expect(() => validatePublicIntake({ id, username: 'Manager', seasons: [2026], exactPeriods } as unknown as Parameters<typeof validatePublicIntake>[0])).toThrow();
  });
  it('reserves settings and matchups before both GETs and writes same-capture population without managers or directory', async () => {
    const f = periodFixture();
    expect(await runPublicIntakeStep(id, f.dependencies, new AbortController().signal))
      .toEqual({ status: 'progress', resource: 'exact-matchups', providerRequests: 2 });
    expect(f.events).toEqual(['reserve-settings', 'reserve-matchups', 'get-league', 'get-matchups', 'write-league', 'write-matchups']);
    expect(f.administration.beginExactMatchupAttempt).toHaveBeenCalledWith(mapping, 18, expect.any(String), expect.objectContaining({ generation: 1 }));
    const calls = vi.mocked(f.administration.recordObservation).mock.calls;
    expect(calls[1][6]).toMatchObject({ attempt: { id: periodReceipt }, population: {
      observationId: settingsReceipt, contentHash: calls[0][0].contentHash, envelope: calls[0][0].envelope } });
    expect(f.intake.completeExactPeriod).toHaveBeenCalledWith(periodWork, mapping,
      { observations: { league: settingsReceipt, matchups: periodReceipt }, receipts: { settings: settingsReceipt, matchups: periodReceipt } },
      expect.objectContaining({ generation: 1 }));
    expect(f.administration.beginRosterCapture).not.toHaveBeenCalled(); expect(f.intake.completeCore).not.toHaveBeenCalled();
    expect(f.source.core).toHaveBeenCalledOnce(); expect(f.source.exactPeriod).toHaveBeenCalledOnce();
  });
  it('retains fresh typed settings population after legacy scoring incompatibility, including absent official scoring', async () => {
    const f = periodFixture();
    f.source.core.mockResolvedValue({ ...document('league'), payload: { ...league, scoring_settings: null } });
    const write = vi.mocked(f.administration.recordObservation).getMockImplementation()!;
    vi.mocked(f.administration.recordObservation).mockImplementation(async (...args) => ({ ...await write(...args),
      ...(args[0].envelope.family === 'league' ? { status: 'rejected' as const } : {}) }));
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('progress');
    expect(vi.mocked(f.administration.recordObservation).mock.calls[1][6]?.population?.envelope.payload)
      .toMatchObject({ scoring_settings: null });
  });
  it.each(['settings', 'matchups'] as const)('never completes from a preserved %s head', async family => {
    const f = periodFixture(); const write = vi.mocked(f.administration.recordObservation).getMockImplementation()!;
    vi.mocked(f.administration.recordObservation).mockImplementation(async (...args) => ({ ...await write(...args),
      ...(args[0].envelope.family === (family === 'settings' ? 'league' : 'matchups')
        ? { [family === 'settings' ? 'leagueSettingsAcceptance' : 'matchupAcceptance']: { status: 'preserved', receiptId: 'older', acceptedGeneration: 1 } } : {}) }));
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('unavailable');
    expect(f.intake.completeExactPeriod).not.toHaveBeenCalled(); expect(f.intake.fail).toHaveBeenCalledOnce();
  });
  it('keeps independently accepted settings when the period response fails and retries through the same work identity', async () => {
    const f = periodFixture(); f.source.exactPeriod.mockRejectedValueOnce(new Error('source unavailable'));
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('unavailable');
    expect(f.administration.recordObservation).toHaveBeenCalledOnce(); expect(f.intake.completeExactPeriod).not.toHaveBeenCalled();
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('progress');
    expect(f.intake.completeExactPeriod).toHaveBeenCalledOnce(); expect(f.source.exactPeriod).toHaveBeenCalledTimes(2);
  });
  it.each([{ family: 'rosters' }, { week: 17 }, { origin: 'cache' }, { sourceObservedAt: '2026-01-01T00:00:00Z' }])('rejects mismatched returned period capture without fallback GET: %j', patch => {
    return (async () => {
      const f = periodFixture(); const get = f.source.exactPeriod.getMockImplementation()!;
      f.source.exactPeriod.mockImplementation(async (...args) => ({ ...await get(...args), ...patch } as CapturedAdministrationDocument));
      expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('unavailable');
      expect(f.source.exactPeriod).toHaveBeenCalledOnce(); expect(f.intake.completeExactPeriod).not.toHaveBeenCalled();
      expect(f.administration.recordObservation).not.toHaveBeenCalled();
    })();
  });
  it('makes no provider request when the second reservation fails or admission is refused', async () => {
    const f = periodFixture(); f.administration.beginExactMatchupAttempt.mockRejectedValue(new Error('mapping superseded'));
    expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).providerRequests).toBe(0);
    expect(f.source.core).not.toHaveBeenCalled(); expect(f.source.exactPeriod).not.toHaveBeenCalled();
    const g = periodFixture(); vi.mocked(g.intake.admit).mockResolvedValue(false);
    expect((await runPublicIntakeStep(id, g.dependencies, new AbortController().signal)).status).toBe('backoff');
    expect(g.administration.beginExactMatchupAttempt).not.toHaveBeenCalled();
  });
});

describe('bounded exact-period Sleeper transport', () => {
  it('uses the exact native endpoint without cache or redirect, retaining raw partial fields and custom zero', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(periodPayload)));
    try {
      const captured = await capturePublicSleeperCore(native, 'matchups', new AbortController().signal, 18);
      expect(captured).toMatchObject({ family: 'matchups', week: 18, origin: 'network', payload: periodPayload });
      expect(captured.sourceObservedAt).toBe(captured.requestCompletedAt);
      expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.sleeper.app/v1/league/' + native + '/matchups/18',
        expect.objectContaining({ cache: 'no-store', redirect: 'error' }));
    } finally { fetch.mockRestore(); }
  });
  it.each([0, 19, 1.5, NaN, null, undefined, '3'])('refuses malformed native week %s before HTTP', async week => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try { await expect(capturePublicSleeperCore(native, 'matchups', new AbortController().signal, week as number)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled(); } finally { fetch.mockRestore(); }
  });
  it('has no redirect retry and rejects an already-aborted request before dispatch', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 302 }));
    try {
      await expect(capturePublicSleeperCore(native, 'matchups', new AbortController().signal, 1)).rejects.toThrow('302');
      expect(fetch).toHaveBeenCalledOnce(); fetch.mockClear();
      await expect(capturePublicSleeperCore(native, 'matchups', AbortSignal.abort(), 1)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});

async function storedPeriodFixture() {
  const f = periodFixture();
  expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('progress');
  const [settings, matchup] = vi.mocked(f.administration.recordObservation).mock.calls;
  const normalized = matchup[0];
  const exactRow = {
    identity: { scope: exactMatchupsScope(mapping, 18), policy: EXACT_MATCHUPS_POLICY }, generation: 1,
    source_mapping_revision_id: mapping.revisionId, receipt_id: periodReceipt, attempt_id: periodReceipt,
    provenance: normalized.envelope.provenance, coverage: { periodIds: ['sleeper:matchup-week:18'], interval: null,
      entitySet: 'full', fields: ['roster_id', 'matchup_id'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] },
    configuration_content_id: configurationContent, population_evidence: matchup[6]?.population,
    expected_team_count: 1, legacy_observation_id: periodReceipt, ordinal: 1, source_mapping: mapping,
    configuration_payload: settings[0].envelope.payload, configuration_hash: settings[0].contentHash,
    content_id: id, content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash,
    payload: normalized.envelope.payload, normalized_value: normalized.value, normalizer_version: normalized.envelope.normalizerVersion,
    completeness: 'complete', league_season_id: mapping.leagueSeasonId, provider: 'sleeper', external_league_id: native,
    family: 'matchups', week: 18, teams: [{ seasonTeamId: mapping.leagueSeasonId, externalRosterId: '1' }],
  };
  const task = { ordinal: 1, season: 2026, external_league_id: native, native_week: 18, status: 'complete',
    failure_count: 0, reason: null, worker_id: 'recorded-worker', generation: 1, league_season_id: mapping.leagueSeasonId,
    source_mapping: mapping, settings_receipt_id: settingsReceipt, matchups_receipt_id: periodReceipt,
    recorded_at: time, configuration_content_id: configurationContent, settings_provenance: settings[0].envelope.provenance };
  const tasks = [task];
  const header: Record<string, unknown> = { id, seasons: [2026], terminal: true, external_manager_id: '55', selected_exact_periods: exactSelection };
  const candidate: Record<string, unknown> = { season: 2026, external_league_id: native, name: league.name,
    stage: 'unavailable', league_season_id: mapping.leagueSeasonId };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('read-request')) return [header];
    if (sql.includes('read-lists')) return [{ season: 2026 }];
    if (sql.includes('read-candidates')) return [candidate];
    if (sql.includes('read-exact-periods')) return tasks;
    if (sql.includes('read-rejections')) return [];
    throw new Error('Unexpected reader query');
  });
  const administration = { ...f.dependencies.administration,
    readAcceptedExactMatchups: vi.fn(async (source: typeof mapping, week: number) => readAcceptedExactMatchupsRows([exactRow], source, week)),
    readAcceptedLeagueSettings: vi.fn(async () => { throw new Error('Current settings head superseded or unavailable'); }),
    readSource: vi.fn(async () => { throw new Error('Optional directory invalid'); }),
  };
  const read = () => readPublicSleeperIntake({ enabled: true, query } as unknown as DatabaseClient, administration, id);
  return { f, exactRow, task, tasks, header, candidate, query, administration, read };
}

describe('exact-period worker to typed stored reader with storage mocked', () => {
  it('returns the captured exact period despite incomplete core/invalid directory, with honest unknown phase, slots and finality', async () => {
    const f = await storedPeriodFixture(); const result = await f.read();
    expect(result.status).toBe('partial');
    if (result.status === 'missing') throw new Error('Missing fixture');
    expect(result.request).toMatchObject({ exactPeriods: exactSelection });
    expect(result.request).not.toHaveProperty('selected_exact_periods');
    const period = result.exactPeriods?.[0];
    expect(period?.phase).toEqual({ status: 'unknown', reason: 'native-period-phase-not-evidenced' });
    expect(period?.resource.status).toBe('available');
    if (period?.resource.status !== 'available') throw new Error('Missing exact resource');
    expect(period.resource.value.period).toMatchObject({ nativeWeek: 18, nflWeekMappings: [] });
    expect(period.resource.value.state.reason).toBe('no_matchup_finality_evidence');
    expect(period.resource.value.teams[0].officialTeamPoints).toEqual({ raw: '-2', custom: '0', effective: '0', adjustment: 'custom-override', adjustmentReason: null });
    expect(period.resource.value.teams[0].starters?.[1]).toMatchObject({ index: 1, nativeSlot: null, empty: true, playerExternalId: null });
    expect(period.resource.value.groups[0]).toMatchObject({ nativeMatchupId: null, format: 'unpaired', resultSupport: 'limited' });
    expect(period.acquisition?.settingsReceiptId).toBe(settingsReceipt);
    expect(f.administration.readAcceptedLeagueSettings).toHaveBeenCalledOnce(); // Core only; no current-settings gate on period.
    expect(f.administration.readAcceptedExactMatchups).toHaveBeenCalledExactlyOnceWith(mapping, 18);
    expect(result.coverage.requested).toContain('exact-matchups'); expect(result.coverage.notRequested).toContain('official-results');
    expect(f.query).toHaveBeenCalledTimes(5); expect(f.f.source.exactPeriod).toHaveBeenCalledOnce(); // Read never refreshes.
  });
  it.each(['head', 'configuration'] as const)('exposes another capture as retained, never completion for this request: %s', async mismatch => {
    const f = await storedPeriodFixture();
    if (mismatch === 'head') f.exactRow.receipt_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    else f.exactRow.configuration_content_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const result = await f.read(); if (result.status === 'missing') throw new Error('Missing fixture');
    expect(result.exactPeriods?.[0].resource).toMatchObject({ status: 'unavailable', reason: 'intake-capture-not-current-head', retained: { status: 'available' } });
  });
  it('rejects a remapped source without replacing the stored capture mapping', async () => {
    const f = await storedPeriodFixture();
    vi.mocked(f.administration.readSourceMapping).mockResolvedValue({ ...mapping, generation: 2 });
    const result = await f.read(); if (result.status === 'missing') throw new Error('Missing fixture');
    expect(result.exactPeriods?.[0].resource).toMatchObject({ status: 'unavailable', reason: 'stored-period-source-unavailable' });
    expect(f.administration.readAcceptedExactMatchups).not.toHaveBeenCalled(); expect(f.task.source_mapping).toEqual(mapping);
  });
  it.each(['pending', 'unavailable'])('never borrows a shared head for a %s task', async status => {
    const f = await storedPeriodFixture(); f.task.status = status; f.task.failure_count = status === 'unavailable' ? 5 : 0;
    const result = await f.read(); if (result.status === 'missing') throw new Error('Missing fixture');
    expect(result.exactPeriods?.[0]).toMatchObject({ collection: status, acquisition: null, resource: { status: 'unavailable' } });
    expect(f.administration.readAcceptedExactMatchups).not.toHaveBeenCalled();
  });
  it.each(['missing-column', 'empty'] as const)('performs no new-schema period read and preserves old shape for %s', async version => {
    const f = await storedPeriodFixture();
    if (version === 'empty') f.header.selected_exact_periods = []; else delete f.header.selected_exact_periods;
    const result = await f.read(); if (result.status === 'missing') throw new Error('Missing fixture');
    expect(result).not.toHaveProperty('exactPeriods'); expect(result.request).not.toHaveProperty('exactPeriods');
    expect(f.query).toHaveBeenCalledTimes(4); expect(f.administration.readAcceptedExactMatchups).not.toHaveBeenCalled();
    expect(result.coverage.notRequested).toContain('exact-matchups');
  });
  it.each(['duplicate', 'wrong-period', 'oversize'] as const)('rejects corrupt retained task scope: %s', async kind => {
    const f = await storedPeriodFixture();
    if (kind === 'wrong-period') f.task.native_week = 17;
    else if (kind === 'duplicate') f.tasks.push({ ...f.task, ordinal: 2 });
    else f.tasks.push(...Array.from({ length: 20 }, (_, index) => ({ ...f.task, ordinal: index + 2 })));
    await expect(f.read()).rejects.toThrow(/Stored exact-period|Invalid stored exact-period/);
  });
});

it('does not call a missing requested task complete even when every old core resource is available', async () => {
  const f = await storedPeriodFixture(); f.tasks.length = 0;
  Object.assign(f.candidate, { stage: 'complete', settings_receipt_id: settingsReceipt, players_receipt_id: settingsReceipt,
    managers_receipt_id: settingsReceipt, users_observation_id: 'users', directory_capture: { sourceMapping: mapping } });
  const available = { status: 'available' as const, accepted: { observationIds: [settingsReceipt] } };
  vi.mocked(f.administration.readAcceptedLeagueSettings).mockResolvedValue(available as never);
  vi.mocked(f.administration.readSource).mockResolvedValue({ status: 'available', observationId: 'users' } as never);
  const result = await readPublicSleeperIntake({ enabled: true, query: f.query } as unknown as DatabaseClient,
    { ...f.administration, readAcceptedCurrentRoster: vi.fn(async () => available), readAcceptedTeamManagers: vi.fn(async () => available) } as unknown as typeof f.administration, id);
  expect(result.status).toBe('partial'); if (result.status === 'missing') throw new Error('Missing fixture');
  expect(result.leagues[0].resources).toMatchObject({ settings: { status: 'available' }, teamManagers: { status: 'available' },
    heldRoster: { status: 'available' }, directory: { status: 'available' } });
  expect(result.exactPeriods).toEqual([]);
});

it('routes a selected recurring request through the same exact-period worker and original fence', async () => {
  const f = periodFixture();
  const refresh: PublicDataRefreshStore = { configure: vi.fn(), recordSelectionFailure: vi.fn(), select: vi.fn(async () => ({
    status: 'selected' as const, targetId: mapping.connectionId, configurationRevision: 2, cycleConfigurationRevision: 1, cycle: 3, requestId: id })) };
  expect(await runPublicDataRefreshStep({ ...f.dependencies, refresh }, new AbortController().signal))
    .toEqual({ status: 'progress', resource: 'exact-matchups', providerRequests: 2 });
  expect(refresh.select).toHaveBeenCalledOnce(); expect(refresh.recordSelectionFailure).not.toHaveBeenCalled();
  expect(f.intake.completeExactPeriod).toHaveBeenCalledWith(periodWork, mapping, expect.anything(), expect.objectContaining({ generation: 1 }));
});

it('uses only two bounded existing adapter GETs for an actual period worker with HTTP stubbed', async () => {
  const f = periodFixture(); const requested: string[] = [];
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    requested.push(String(url)); expect(f.events.slice(0, 2)).toEqual(['reserve-settings', 'reserve-matchups']);
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
    return new Response(JSON.stringify(String(url).endsWith('/matchups/18') ? periodPayload : league));
  });
  try {
    expect((await runPublicIntakeStep(id, { ...f.dependencies, source: undefined, now: () => new Date() }, new AbortController().signal)).status).toBe('progress');
    expect(requested).toEqual(['https://api.sleeper.app/v1/league/' + native, 'https://api.sleeper.app/v1/league/' + native + '/matchups/18']);
    expect(f.intake.completeExactPeriod).toHaveBeenCalledOnce();
  } finally { fetch.mockRestore(); }
});

it('keeps the accepted historical matchup readable after a different settings head becomes current', async () => {
  const f = await storedPeriodFixture();
  vi.mocked(f.administration.readAcceptedLeagueSettings).mockResolvedValue({ status: 'available',
    accepted: { observationIds: ['newer-core-settings-receipt'] } } as never);
  const result = await f.read(); if (result.status === 'missing') throw new Error('Missing fixture');
  expect(result.leagues[0].resources?.settings).toMatchObject({ status: 'unavailable', retained: { status: 'available' } });
  expect(result.exactPeriods?.[0]).toMatchObject({ resource: { status: 'available' }, acquisition: { settingsReceiptId: settingsReceipt } });
});

it('cannot checkpoint the period when its settings response fails, even if a matchup write returns acceptance', async () => {
  const f = periodFixture(); f.source.core.mockRejectedValueOnce(new Error('settings response unavailable'));
  expect((await runPublicIntakeStep(id, f.dependencies, new AbortController().signal)).status).toBe('unavailable');
  expect(f.intake.completeExactPeriod).not.toHaveBeenCalled(); expect(f.intake.fail).toHaveBeenCalledOnce();
  expect(f.source.core).toHaveBeenCalledOnce(); expect(f.source.exactPeriod).toHaveBeenCalledOnce();
});

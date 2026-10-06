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

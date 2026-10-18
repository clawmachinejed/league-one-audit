import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { DatabaseClient } from '../../database';
import { createPublicIntakeStore } from './public-intake';
import { normalizeAdministrationObservation } from '../normalize';
import { ADMINISTRATION_DIALECT, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_SCHEMA_VERSION, type JsonValue } from '../contracts';
vi.mock('server-only', () => ({}));
const requestId = '11111111-1111-4111-8111-111111111111';
const work = { requestId, revision: 2, kind: 'bootstrap' as const, externalLeagueId: '98765432109876543210', season: 2026 };
const fence = { jobKey: 'league-administration-public-intake', workerId: 'worker', generation: 1,
  deadlineAt: new Date(Date.now() + 20_000).toISOString() };
const league = { league_id: work.externalLeagueId, season: '2026', sport: 'nfl', name: 'Unrelated division league',
  total_rosters: 2, roster_positions: ['UNKNOWN_NATIVE_SLOT', 'BN'], settings: { divisions: 2 },
  scoring_settings: { rec_yd: 0.1, unsupported_bonus: 2 } };

describe('SQL-issued batch ownership and atomic admission', () => {
  const origin = '2026-10-16T12:00:00.000Z';
  const worker = '55555555-5555-4555-8555-555555555555';
  const successor = '66666666-6666-4666-8666-666666666666';
  const owner = { kind: 'acquired', fence: { ...fence, workerId: worker, generation: 10, deadlineAt: '2026-10-16T12:00:20+00:00' },
    admissionDeadlineAt: '2026-10-16T12:00:10+00:00', cleanupDeadlineAt: '2026-10-16T12:00:22+00:00',
    leaseUntil: '2026-10-16T12:00:25+00:00' };
  const setup = (rows: unknown[]) => {
    const query = vi.fn().mockResolvedValue(rows);
    return { query, store: createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient) };
  };
  it('starts only the global resource batch with the original SQL deadlines', async () => {
    const { store, query } = setup([{ result: owner }]);
    expect(await store.beginResourceBatch!(worker, origin)).toEqual(owner);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('public.begin_public_data_resource_batch('), [worker, origin]);
    query.mockResolvedValue([{ result: { ...owner, admissionDeadlineAt: '2026-10-16T12:00:11Z' } }]);
    await expect(store.beginResourceBatch!(worker, origin)).rejects.toThrow();
  });
  it.each([[], [{ policy: 'future' }], [{ policy: ['public-data-resource-schedule-v1'] }],
    [{ policy: 'public-data-resource-schedule-v1' }, { policy: 'public-data-resource-schedule-v1' }]].map(rows => ({ rows })))(
    'requires the exact resource capability without fallback: %#', async ({ rows }) => {
      const { store, query } = setup(rows); await expect(store.requireResourceScheduleCapability!()).rejects.toThrow('capability');
      expect(query).toHaveBeenCalledOnce();
    });
  it('reads the resource capability using fixed SQL', async () => {
    const { store, query } = setup([{ policy: 'public-data-resource-schedule-v1' }]);
    await store.requireResourceScheduleCapability!();
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('public.public_data_resource_schedule_capability()'));
  });
  it('preserves exact SQL-issued fence strings and binds the direct request', async () => {
    const { store, query } = setup([{ result: owner }]);
    expect(await store.beginBatch!(worker, origin, requestId)).toEqual(owner);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('public.begin_public_data_batch('), [worker, origin, requestId]);
    query.mockClear(); await store.beginBatch!(worker, origin);
    expect(query).toHaveBeenCalledWith(expect.any(String), [worker, origin, null]);
  });
  it.each([[], [{ result: owner }, { result: owner }], [{ result: null }],
    [{ result: { kind: 'busy', fence: owner.fence } }], [{ result: { ...owner, extra: true } }],
    [{ result: { ...owner, leaseUntil: '2026-10-16T12:00:26Z' } }],
    [{ result: { ...owner, fence: { ...owner.fence, workerId: successor } } }],
    [{ result: { ...owner, fence: { ...owner.fence, generation: 0 } } }],
    [{ result: { ...owner, fence: { ...owner.fence, deadlineAt: '2026-10-16T12:00:21Z' } } }],
  ].map(rows => ({ rows })))('refuses unknown, duplicate or rebound claims without retrying: %#', async ({ rows }) => {
    const { store, query } = setup(rows);
    await expect(store.beginBatch!(worker, origin, requestId)).rejects.toThrow();
    expect(query).toHaveBeenCalledOnce();
  });
  it.each(['busy', 'deadline'] as const)('preserves the explicit SQL %s disposition', async kind => {
    const { store } = setup([{ result: { kind } }]);
    expect(await store.beginBatch!(worker, origin)).toEqual({ kind });
  });
  it('accepts only a rotated worker at exactly the next generation under unchanged deadlines', async () => {
    const next = { ...owner, fence: { ...owner.fence, workerId: successor, generation: 11 } };
    const { store, query } = setup([{ result: next }]);
    expect(await store.advanceBatch!(owner.fence, successor)).toEqual(next);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('public.advance_public_data_batch_owner('),
      [JSON.stringify(owner.fence), successor]);
    query.mockResolvedValue([{ result: { ...next, fence: { ...next.fence, generation: 12 } } }]);
    await expect(store.advanceBatch!(owner.fence, successor)).rejects.toThrow('generation');
    query.mockClear();
    await expect(store.advanceBatch!(owner.fence, worker)).rejects.toThrow('successor');
    expect(query).not.toHaveBeenCalled();
  });
  const capability = { policy: 'public-data-batch-v1', budget_policy: 'public-data-settled-request-budget-v1' };
  it.each([[], [{ policy: 'future' }], [{ policy: 'public-data-batch-v1' }],
    [{ ...capability, budget_policy: 'future' }], [{ ...capability, budget_policy: ['public-data-settled-request-budget-v1'] }],
    [capability, capability]].map(rows => ({ rows })))(
    'requires both installed batch and settled-budget capabilities: %#', async ({ rows }) => {
      const { store, query } = setup(rows); await expect(store.requireBatchCapability!()).rejects.toThrow('R062');
      expect(query).toHaveBeenCalledOnce();
    });
  it('uses fixed batch capability/selection/admission calls and preserves every status', async () => {
    const { store, query } = setup([capability]);
    await store.requireBatchCapability!();
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('public.public_data_settled_request_budget_capability()'));
    query.mockResolvedValue([{ result: work }]);
    expect(await store.nextBatch!(requestId)).toEqual(work);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('public.next_public_data_batch_intake('), [requestId]);
    for (const status of ['admitted', 'denied', 'deadline']) {
      query.mockResolvedValue([{ result: { status } }]);
      expect(await store.admitBatch!(work, owner.fence)).toEqual({ status });
      expect(query).toHaveBeenLastCalledWith(expect.stringContaining('public.admit_public_data_batch_dispatch_status('),
        [JSON.stringify(work), JSON.stringify(owner.fence)]);
    }
    query.mockResolvedValue([{ result: 'complete' }, { result: 'complete' }]);
    await expect(store.nextBatch!(requestId)).rejects.toThrow('acknowledgment');
  });
  const backoff = { status: 'budget-backoff', serverNow: '2026-10-16T08:00:00.000999-04:00',
    retryAt: '2026-10-16T12:00:00.500001+00:00', retryAfterMs: 500 };
  it('preserves native microsecond clocks and verifies the server-relative ceiling without client clock assumptions', async () => {
    const { store, query } = setup([{ result: backoff }]);
    expect(await store.admitBatch!(work, owner.fence)).toEqual(backoff);
    expect(query).toHaveBeenCalledOnce();
  });
  it.each([[], [{ admitted: true }], [{ result: null }], [{ result: true }], [{ result: { status: ['admitted'] } }],
    [{ result: { status: 'admitted', extra: true } }], [{ result: { status: 'admitted' } }, { result: { status: 'admitted' } }],
    ...[{}, { status: 'future' }, { serverNow: 'invalid' }, { retryAt: backoff.serverNow }, { retryAt: '2026-10-16T12:00:00Z' },
      { retryAfterMs: '500' }, { retryAfterMs: 499 }, { retryAfterMs: 501 }, { retryAfterMs: 0 }, { retryAfterMs: -1 },
      { retryAfterMs: 0.5 }, { retryAfterMs: Infinity }, { retryAfterMs: Number.MAX_SAFE_INTEGER + 1 },
      { retryAt: '2026-10-16T13:00:20.002Z', retryAfterMs: 3_620_002 }, { extra: true },
      { serverNow: '2026-10-16T12:00:00' }].map(change => [{ result: { ...backoff, ...change,
        ...(Object.keys(change).length === 0 ? { retryAt: undefined } : {}) } }]),
  ].map(rows => ({ rows })))('rejects ambiguous or malformed admission without a retry: %#', async ({ rows }) => {
    const { store, query } = setup(rows);
    await expect(store.admitBatch!(work, owner.fence)).rejects.toThrow();
    expect(query).toHaveBeenCalledOnce();
  });
});

describe('controlled durable submission receipts', () => {
  const input = { id: requestId, username: 'Any_Manager', seasons: [2026] };
  it.each(['retained', 'capacity'] as const)('decodes a canonical %s receipt without changing legacy submission', async status => {
    const query = vi.fn().mockResolvedValue([{ result: { status, requestId } }]);
    const store = createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient);
    expect(await store.submitWithReceipt(input)).toEqual({ status, requestId });
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('public.submit_public_data_intake($1::jsonb,true)'), [JSON.stringify(input)]);
    query.mockClear(); query.mockResolvedValue([]);
    expect(await store.submit(input)).toBeUndefined();
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('public.submit_public_data_intake($1::jsonb)'), [JSON.stringify(input)]);
  });
  it.each([[], [{ result: null }], [{ result: { status: 'retained', requestId } }, { result: { status: 'retained', requestId } }],
    [{ result: { status: ['retained'], requestId } }], [{ result: { status: ['capacity'], requestId } }],
    [{ result: { status: 'complete', requestId } }], [{ result: { status: 'retained', requestId: 'foreign' } }],
    [{ result: { status: 'capacity', requestId, extra: true } }], [{ result: { status: 'retained' } }],
  ].map(rows => ({ rows })))('rejects malformed or foreign acknowledgments without inventing a receipt: %#', async ({ rows }) => {
    const query = vi.fn().mockResolvedValue(rows);
    const store = createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient);
    await expect(store.submitWithReceipt(input)).rejects.toThrow();
    expect(query).toHaveBeenCalledOnce();
  });
  it('rejects coercible usernames before SQL and preserves unknown SQL failures', async () => {
    const query = vi.fn().mockRejectedValue(new Error('missing installed controlled submission'));
    const store = createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient);
    await expect(store.submitWithReceipt({ ...input, username: 123 } as never)).rejects.toThrow('Invalid public intake');
    expect(query).not.toHaveBeenCalled();
    await expect(store.submitWithReceipt(input)).rejects.toThrow('missing installed controlled submission');
  });
});

describe('database-issued public acquisition boundary', () => {
  const owner = { ...fence, workerId: '55555555-5555-4555-8555-555555555555' };
  const witness = { version: 'public-network-capture-v1', work, fence: owner,
    dispatchNonce: '66666666-6666-4666-8666-666666666666', mapping: null, attempts: {} };
  it('returns exactly one bound immutable witness from the fixed read without synthesizing it', async () => {
    const raw = structuredClone(witness), query = vi.fn(async () => [{ witness: raw }]);
    const store = createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient);
    const returned = await store.captureWitness!(work, null, owner);
    expect(returned).toEqual(witness); expect(returned).not.toBe(raw);
    expect(Object.isFrozen(returned.work)).toBe(true);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('public.read_public_data_capture_witness($1::jsonb,$2::jsonb,$3::jsonb)'),
      [JSON.stringify(work), null, JSON.stringify(owner)]);
  });
  it.each([[], [{ witness }, { witness }], [{ witness: null }], [{ witness: { ...witness, dispatchNonce: '' } }],
    [{ witness: { ...witness, work: { ...work, revision: work.revision + 1 } } }],
    [{ witness: { ...witness, fence: { ...owner, generation: 2 } } }],
    [{ witness: { ...witness, attempts: { settings: { id: owner.workerId, nonce: witness.dispatchNonce } } } }],
  ].map(rows => ({ rows })))('fails closed on absent, duplicate, malformed or foreign persisted witness: %#', async ({ rows }) => {
    const query = vi.fn(async () => rows);
    const store = createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient);
    await expect(store.captureWitness!(work, null, owner)).rejects.toThrow();
    expect(query).toHaveBeenCalledOnce();
  });
  it('keeps late-role capture grants schema-gated and private helpers denied', async () => {
    const provision = await readFile(new URL('../../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
    const block = provision.match(/-- BEGIN OPTIONAL PUBLIC CAPTURE WITNESS GRANT([\s\S]*?)-- END OPTIONAL PUBLIC CAPTURE WITNESS GRANT/u)?.[1];
    expect(block).toContain("to_regprocedure('public.read_public_data_capture_witness(jsonb,jsonb,jsonb)') IS NOT NULL");
    expect(block).toContain('GRANT EXECUTE ON FUNCTION public.read_public_data_capture_witness(jsonb,jsonb,jsonb) TO league_one_runtime');
    expect(block).not.toMatch(/GRANT (?:ALL|INSERT|UPDATE|DELETE|CREATE)/u);
    expect(block).toContain("REVOKE ALL ON FUNCTION %s FROM league_one_runtime");
    for (const helper of ['derive_public_data_capture_witness', 'assert_public_data_capture_witness',
      'public_capture_after_reservation', 'assert_public_capture_observation', 'assert_public_capture_input_shape']) expect(block).toContain('public.' + helper + '(');
    expect(block).toContain("has_function_privilege('league_one_runtime',helper,'EXECUTE')");
  });
});
function fixture(existing = false) {
  const query = vi.fn(async (statement: string, parameters?: readonly unknown[]) => {
    void parameters; // Retain the transport argument for checkpoint assertions.
    return statement.includes('resolve-registration') && existing
      ? [{ league_key: 'league1', season: 2026, league_id: 'existing-league', league_season_id: 'existing-season' }] : [];
  });
  const queryAfterLock = vi.fn(async (_statement: string, parameters: readonly unknown[]) => [[], [{
    league_id: 'league-id', league_season_id: 'season-id', scoring_profile_id: parameters[0] === null ? null : 'profile-id',
  }]]);
  const client = { enabled: true, query, queryAfterLock } as unknown as DatabaseClient;
  const capture = (payload: unknown) => ({ family: 'league' as const, week: null, origin: 'network' as const, payload,
    requestStartedAt: new Date().toISOString(), requestCompletedAt: new Date().toISOString() });
  return { store: createPublicIntakeStore(client), query, queryAfterLock, capture };
}
describe('public-data registration through the existing identity writer', () => {
  it('keeps official unknown scoring/slots and fences shared registration after the response', async () => {
    const f = fixture();
    await f.store.register(work, f.capture(league), fence);
    expect(f.queryAfterLock).toHaveBeenCalledWith(expect.stringContaining('/* projection-store:register-league-season-official-data */'),
      expect.arrayContaining([JSON.stringify(league.scoring_settings), `sleeper-${work.externalLeagueId}`]),
      expect.objectContaining({ statement: 'SELECT public.guard_public_data_intake($1::jsonb,$2::jsonb)',
        parameters: [JSON.stringify(work), JSON.stringify({ ...fence, reserveCollection: true })],
        verifyAfter: { statement: 'SELECT public.guard_public_data_intake($1::jsonb,$2::jsonb)',
          parameters: [JSON.stringify(work), JSON.stringify(fence)] } }), undefined);
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining('checkpoint'),
      [JSON.stringify(work), expect.stringContaining('"leagueSeasonId":"season-id"'), JSON.stringify(fence)]);
  });
  it('preserves an existing permanent league identity and immutable scoring profile', async () => {
    const f = fixture(true);
    await f.store.register(work, f.capture(league), fence);
    expect(f.queryAfterLock).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining('checkpoint'),
      [JSON.stringify(work), expect.stringContaining('"leagueId":"existing-league"'), JSON.stringify(fence)]);
  });
  it.each([
    { ...league, league_id: 'other' }, { ...league, season: '2025' }, { ...league, sport: 'nba' },
    { ...league, settings: [] }, { ...league, settings: 'bad' }, { ...league, scoring_settings: { rec: 'bad' } },
    { ...league, scoring_settings: [] }, { ...league, scoring_settings: 'bad' },
    { ...league, roster_positions: {} }, { ...league, roster_positions: [false] }, { ...league, total_rosters: 0 },
  ])('retains malformed official configuration as rejected evidence without registering it', async payload => {
    const f = fixture();
    await f.store.register(work, f.capture(payload), fence);
    expect(f.queryAfterLock).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining('checkpoint'),
      [JSON.stringify(work), expect.stringContaining('"diagnostic":"invalid-source"'), JSON.stringify(fence)]);
  });
  it('retains an over-capacity official league as a distinct deferred candidate', async () => {
    const f = fixture();
    await f.store.register(work, f.capture({ ...league, total_rosters: 21 }), fence);
    expect(f.queryAfterLock).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining('checkpoint'),
      [JSON.stringify(work), expect.stringContaining('"capacity":"roster-count-unqualified"'), JSON.stringify(fence)]);
  });
  it('does not checkpoint registration after the database rejects the expired fence', async () => {
    const f = fixture();
    f.queryAfterLock.mockRejectedValue(new Error('public intake lease lost'));
    await expect(f.store.register(work, f.capture(league), fence)).rejects.toThrow('lease lost');
    expect(f.query).toHaveBeenCalledTimes(1);
  });
});


describe('official preconfiguration registration', () => {
  it.each((['settings', 'scoring_settings', 'roster_positions'] as const).flatMap(field =>
    (['absent', 'null', 'empty'] as const).map(state => ({ field, state }))))('retains $field:$state without invented configuration', async ({ field, state }) => {
      const payload: Record<string, unknown> = { ...league };
      if (state === 'absent') delete payload[field];
      else payload[field] = state === 'null' ? null : field === 'roster_positions' ? [] : {};
      const f = fixture(); const capture = f.capture(payload);
      const normalized = normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
        normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT,
        scope: { leagueKey: 'unrelated', provider: 'sleeper', externalLeagueId: work.externalLeagueId, season: work.season },
        family: 'league', week: null, completeness: 'complete', payload: payload as JsonValue,
        provenance: { origin: 'network', requestStartedAt: capture.requestStartedAt, requestCompletedAt: capture.requestCompletedAt,
          sourceObservedAt: capture.requestCompletedAt, checkedAt: capture.requestCompletedAt } });
      expect(normalized.status, field + ':' + state).toBe('accepted');
      await f.store.register(work, capture, fence);
      expect(f.queryAfterLock, field + ':' + state).toHaveBeenCalledOnce();
      const parameters = f.queryAfterLock.mock.calls[0][1];
      if (field === 'scoring_settings') expect(parameters.slice(0, 2)).toEqual([null, null]);
      else expect(parameters[1]).toBe(JSON.stringify(league.scoring_settings));
      const checkpoint = JSON.parse(String(f.query.mock.calls.at(-1)?.[1]?.[1]));
      expect(checkpoint.payload).toEqual(payload); expect(checkpoint).not.toHaveProperty('diagnostic');
  });
});


it('recovers a committed bootstrap before its checkpoint using the same source identity without another profile write', async () => {
  let committed = false; let loseAcknowledgment = true;
  const query = vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
    if (sql.includes('resolve-registration')) return committed ? [{ league_key: 'permanent-existing-key', season: 2026,
      league_id: 'original-league', league_season_id: 'original-season', scoring_profile_id: null }] : [];
    if (sql.includes('checkpoint')) {
      const captured = JSON.parse(String(parameters[1]));
      expect(captured).toMatchObject({ leagueId: 'original-league', leagueSeasonId: 'original-season' });
      expect(captured).not.toHaveProperty('diagnostic');
    }
    return [];
  });
  const queryAfterLock = vi.fn(async (_sql: string, parameters: readonly unknown[]) => {
    expect(parameters.slice(0, 2)).toEqual([null, null]); committed = true;
    if (loseAcknowledgment) { loseAcknowledgment = false; throw new Error('unknown commit acknowledgment'); }
    return [[], [{ league_id: 'original-league', league_season_id: 'original-season', scoring_profile_id: null }]];
  });
  const store = createPublicIntakeStore({ enabled: true, query, queryAfterLock } as unknown as DatabaseClient);
  const capture = fixture().capture({ ...league, scoring_settings: null, settings: null, roster_positions: [] });
  await expect(store.register(work, capture, fence)).rejects.toThrow('unknown commit acknowledgment');
  expect(query.mock.calls.filter(([sql]) => sql.includes('checkpoint'))).toHaveLength(0);
  await store.register(work, capture, fence);
  await store.register(work, { ...capture, payload: { ...league, scoring_settings: { rec: 1 } } }, fence);
  expect(queryAfterLock).toHaveBeenCalledOnce();
  expect(query.mock.calls.filter(([sql]) => sql.includes('checkpoint'))).toHaveLength(2);
});

it.each([
  { rows: [{ league_key: 'other-year', season: 2025, league_id: 'l', league_season_id: 's' }] },
  { rows: [{ season: 2026 }, { season: 2026 }] },
])('refuses ambiguous or cross-season identity before official registration', async ({ rows }) => {
  const query = vi.fn(async () => rows); const queryAfterLock = vi.fn();
  const store = createPublicIntakeStore({ enabled: true, query, queryAfterLock } as unknown as DatabaseClient);
  await expect(store.register(work, fixture().capture({ ...league, scoring_settings: null }), fence))
    .rejects.toThrow('Ambiguous public source identity');
  expect(queryAfterLock).not.toHaveBeenCalled(); expect(query).toHaveBeenCalledOnce();
});

describe('exact-period capability and checkpoint transport', () => {
  const selected = { id: requestId, username: 'Any_Manager', seasons: [2026], exactPeriods: [{ season: 2026, nativeWeek: 18 }] };
  it.each([undefined, []])('keeps old submit wire with no capability query when selection is %j', async exactPeriods => {
    const query = vi.fn(async () => []);
    await createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient).submit({ ...selected, exactPeriods });
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('submit_public_data_intake'),
      [JSON.stringify({ id: requestId, username: 'Any_Manager', seasons: [2026] })]);
  });
  it.each([false, undefined, 'true'])('refuses a nonempty selector before old SQL can ignore it (capability %s)', async supported => {
    const query = vi.fn(async () => [{ supported }]);
    await expect(createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient).submit(selected)).rejects.toThrow('R038');
    expect(query).toHaveBeenCalledOnce(); expect(query.mock.calls[0]).toEqual([expect.stringContaining('exact-period-capability')]);
  });
  it('checks both request/config scope columns and task/checkpoint tables before submitting selected scope unchanged', async () => {
    const query = vi.fn(async () => [{ supported: true }]);
    await createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient).submit(selected);
    expect(query.mock.calls[0]).toEqual([expect.stringContaining('public_data_exact_period_checkpoints')]);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('submit_public_data_intake'), [JSON.stringify(selected)]);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each([{ nativeWeek: 0 }, { nativeWeek: '3' }, { nativeWeek: 19 }, { season: '2026' }, { externalLeagueId: 'x' }])('rejects malformed persisted period work before admission: %j', async patch => {
    const result = { requestId, revision: 3, kind: 'exact-matchups', externalLeagueId: work.externalLeagueId, season: 2026, nativeWeek: 18, ...patch };
    const query = vi.fn(async () => [{ result }]);
    await expect(createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient).next(requestId)).rejects.toThrow();
  });
  it('uses the existing atomic checkpoint with exact work, mapping and both fresh receipts', async () => {
    const query = vi.fn(async () => []);
    const store = createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient);
    const exactWork = { requestId, revision: 3, kind: 'exact-matchups' as const, externalLeagueId: work.externalLeagueId, season: 2026, nativeWeek: 18 };
    const mapping = { connectionId: requestId, leagueSeasonId: requestId, revisionId: requestId, generation: 1,
      scope: { leagueKey: 'generic', provider: 'sleeper' as const, externalLeagueId: work.externalLeagueId, season: 2026 } };
    const captured = { observations: { league: 'league-observation', matchups: 'matchup-observation' },
      receipts: { settings: 'settings-receipt', matchups: 'matchups-receipt' } };
    await store.completeExactPeriod(exactWork, mapping, captured, fence);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('checkpoint_public_data_intake'),
      [JSON.stringify(exactWork), JSON.stringify({ mapping, ...captured }), JSON.stringify(fence)]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../database';
import { PUBLIC_PERIOD_INVENTORY, publicInventoryPeriods, normalizeStoredPublicPeriods, validatePublicIntake } from './public-intake-contracts';
import { validatePublicDataRefresh } from './public-refresh-contracts';
import { createPublicIntakeStore, createPublicDataRefreshStore } from './neon/public-intake';
import { readPublicSleeperIntake } from './public-intake-reader';
import { readPublicDataRefresh } from './public-refresh-reader';
import { createLeagueAdministrationStore, readPublicPeriodInventory } from './store';
import type { LeagueAdministrationStore } from './store-contracts';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', worker = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const time = '2026-10-10T12:00:00.000Z', expiry = '2026-10-11T12:00:00.000Z';
const input = { id, username: 'Manager', seasons: [2026], periodInventory: PUBLIC_PERIOD_INVENTORY };
const refresh = { id, identityRequestId: id, expectedRevision: 0, seasons: [2026], cadenceSeconds: 60,
  paused: false, expiresAt: expiry, periodInventory: PUBLIC_PERIOD_INVENTORY };
afterEach(() => vi.useRealTimers());

describe('explicit full 2026 inventory scope', () => {
  it('preserves the mode while leaving old empty/omitted selector bytes unchanged', () => {
    expect(validatePublicIntake(input)).toEqual(input);
    expect(validatePublicDataRefresh(refresh, new Date(time))).toEqual(refresh);
    const old = { id, username: 'Manager', seasons: [2025, 2026] };
    expect(JSON.stringify(validatePublicIntake({ ...old, exactPeriods: [] }))).toBe(JSON.stringify(validatePublicIntake(old)));
    expect(normalizeStoredPublicPeriods(publicInventoryPeriods(), [2026], PUBLIC_PERIOD_INVENTORY))
      .toEqual({ periodInventory: PUBLIC_PERIOD_INVENTORY, exactPeriods: publicInventoryPeriods() });
  });
  it.each([{ seasons: [2025] }, { seasons: [2025, 2026] }, { exactPeriods: [] },
    { exactPeriods: [{ season: 2026, nativeWeek: 1 }] }, { periodInventory: null },
    { periodInventory: 'sleeper-2026-matchup-weeks-v1' }])('refuses ambiguous or unsupported opt-in %j', patch => {
    expect(() => validatePublicIntake({ ...input, ...patch } as typeof input)).toThrow();
    expect(() => validatePublicDataRefresh({ ...refresh, ...patch } as typeof refresh, new Date(time))).toThrow();
  });
  it.each([[], publicInventoryPeriods().slice(0, 17), [...publicInventoryPeriods()].reverse(),
    publicInventoryPeriods().map(period => ({ ...period, extra: true }))])('refuses incomplete/noncanonical stored selection %j', periods => {
    expect(() => normalizeStoredPublicPeriods(periods, [2026], PUBLIC_PERIOD_INVENTORY)).toThrow();
  });
  it('does not widen the legacy one-period-per-season selector', () => {
    expect(() => validatePublicIntake({ id, username: 'Manager', seasons: [2026], exactPeriods: publicInventoryPeriods() })).toThrow();
  });
  it.each([false, undefined, 'true', true])('checks installed R044 before either mutation (%s)', async supported => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => { void parameters; return sql.includes('capability') ? [{ supported }]
      : [{ result: { status: 'configured', targetId: id, configurationRevision: 1 } }]; });
    const client = { enabled: true, query } as unknown as DatabaseClient;
    for (const run of [() => createPublicIntakeStore(client).submit(input), () => createPublicDataRefreshStore(client).configure(refresh)]) {
      query.mockClear();
      if (supported === true) { await run(); expect(query).toHaveBeenCalledTimes(2);
        expect(JSON.parse(String(query.mock.calls[1][1]?.[0]))).toMatchObject({ periodInventory: PUBLIC_PERIOD_INVENTORY }); }
      else { await expect(run()).rejects.toThrow('R044'); expect(query).toHaveBeenCalledOnce(); }
      expect(query.mock.calls[0][0]).toContain('period-inventory-capability');
    }
  });
});

function mapping(externalLeagueId: string) {
  return { connectionId: worker, leagueSeasonId: worker, revisionId: worker, generation: 1,
    scope: { provider: 'sleeper' as const, leagueKey: 'sleeper-' + externalLeagueId, externalLeagueId, season: 2026 } };
}
function fixture(count = 1, completed = 0) {
  const candidates: DatabaseRow[] = Array.from({ length: count }, (_, i) => ({ season: 2026, external_league_id: String(100000 + i),
    stage: i < 20 ? 'registered' : 'capacity', name: 'League' }));
  const plans: DatabaseRow[] = candidates.map((candidate, i) => ({ ...candidate, policy: PUBLIC_PERIOD_INVENTORY,
    admitted: i < 20, worker_id: worker, generation: 1 }));
  const sources: DatabaseRow[] = candidates.map((candidate, index) => ({ season: 2026, external_league_id: candidate.external_league_id,
    source_evidence_equal: true, source_kind: 'leagues', source_ordinal: index + 1, native_fields: { settingsPresent: false }, worker_id: worker, generation: 1,
    request_started_at: time, request_completed_at: time, acquisition: { version: 'public-network-capture-v1',
      work: { requestId: id, revision: 1, kind: 'leagues', userId: '123', season: 2026 },
      fence: { jobKey: 'league-administration-public-intake', workerId: worker, generation: 1, deadlineAt: expiry },
      dispatchNonce: worker, mapping: null, attempts: {} } }));
  const tasks: DatabaseRow[] = candidates.slice(0, 20).flatMap((candidate, i) => publicInventoryPeriods().map(period => {
    const ordinal = i * 18 + period.nativeWeek, complete = ordinal <= completed;
    return { ordinal, season: 2026, external_league_id: candidate.external_league_id, native_week: period.nativeWeek,
      status: complete ? 'complete' : 'pending', failure_count: 0, reason: null,
      ...(complete ? { worker_id: worker, generation: 1, league_season_id: worker, source_mapping: mapping(String(candidate.external_league_id)),
        settings_receipt_id: 'settings', matchups_receipt_id: 'matchups-' + period.nativeWeek, recorded_at: time,
        configuration_content_id: 'configuration', settings_provenance: {} } : {}) };
  }));
  const lists: DatabaseRow[] = [{ season: 2026, request_started_at: time, request_completed_at: time }];
  const header: DatabaseRow = { id, seasons: [2026], terminal: false, external_manager_id: '123',
    selected_exact_periods: publicInventoryPeriods(), selected_period_inventory: PUBLIC_PERIOD_INVENTORY };
  const evidence = [{ season: 2026, request_started_at: time, request_completed_at: time,
    bootstraps: [] as string[], members: candidates.map((candidate, index) => ({ externalLeagueId: String(candidate.external_league_id), sourceOrdinal: index + 1 })) }];
  const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    void parameters;
    if (sql.includes('read-request')) return [header];
    if (sql.includes('read-lists')) return lists;
    if (sql.includes('read-candidates')) return candidates;
    if (sql.includes('read-period-inventory-list-evidence')) return evidence;
    if (sql.includes('read-period-inventory-plans')) return plans;
    if (sql.includes('read-period-inventory-sources')) return sources;
    if (sql.includes('read-exact-periods')) return tasks;
    return [];
  });
  const client = { enabled: true, query } as unknown as DatabaseClient;
  return { candidates, plans, sources, tasks, lists, evidence, header, query, client,
    read: (page = {}) => readPublicPeriodInventory(client, id, candidates, lists, page) };
}

describe('stored requested inventory and source evidence', () => {
  it('accounts all 1000 candidates and 18000 requested periods with only 360 acquisition tasks', async () => {
    const f = fixture(1000); const { inventory, selectedRows } = await f.read();
    expect(inventory.summary).toEqual({ observedLeagues: 1000, admittedLeagues: 20, capacityLeagues: 980,
      requestedPeriods: 18000, admittedPeriods: 360, capacityPeriods: 17640, pendingPeriods: 360, completePeriods: 0, unavailablePeriods: 0 });
    expect(inventory).toMatchObject({ discovery: 'complete', coverage: 'limited', collection: 'pending', readCoverage: 'page', page: { nextAfterOrdinal: 20 } });
    expect(inventory.tasks).toHaveLength(360); expect(new Set(inventory.tasks.map(task => task.externalLeagueId + ':' + task.nativeWeek)).size).toBe(360);
    expect(selectedRows).toHaveLength(20); expect(f.query).toHaveBeenCalledTimes(4);
  });
  it('accepts actual admitted candidates interspersed with lexically earlier capacity entries', async () => {
    const f = fixture(21);
    f.plans.forEach((row, index) => { f.plans[index] = { ...row, admitted: index > 0 }; });
    f.tasks.forEach((row, index) => { f.tasks[index] = { ...row, external_league_id: f.plans[Math.floor(index / 18) + 1].external_league_id }; });
    const { inventory } = await f.read();
    expect(inventory.summary).toMatchObject({ admittedLeagues: 20, capacityLeagues: 1, admittedPeriods: 360 });
    expect(inventory.tasks[0].externalLeagueId).toBe('100001'); expect(inventory.tasks.at(-1)?.externalLeagueId).toBe('100020');
  });
  it('retains duplicate source occurrences and conflicting period clues separately', async () => {
    const f = fixture();
    f.sources[0] = { ...f.sources[0], native_fields: { settingsPresent: true, settings: { leg: 1 } } };
    f.evidence[0].members.push({ externalLeagueId: '100000', sourceOrdinal: 2 });
    f.sources.push({ ...f.sources[0], source_ordinal: 2, native_fields: { settingsPresent: true, settings: { leg: 19 } } });
    const { inventory } = await f.read();
    expect(inventory.summary.observedLeagues).toBe(1); expect(inventory.sources).toHaveLength(2);
    expect(inventory.sources.map(source => source.references[0].value)).toEqual([1, 19]);
    expect(inventory.gaps).toEqual([{ externalLeagueId: '100000', season: 2026, sourceKind: 'leagues',
      sourceOrdinal: 2, sourcePath: 'settings.leg', nativePeriod: 19, reason: 'native-period-outside-supported-range' }]);
    f.sources.pop(); await expect(f.read()).rejects.toThrow('Missing stored period inventory source');
  });
  it('requires every retained bootstrap source occurrence before declaring source coverage', async () => {
    const f = fixture(); f.evidence[0].bootstraps.push('100000');
    const acquisition = f.sources[0].acquisition as Record<string, unknown>;
    f.sources.push({ ...f.sources[0], source_kind: 'bootstrap', source_ordinal: 1,
      native_fields: { settingsPresent: true, settings: { leg: 19 } },
      acquisition: { ...acquisition, work: { requestId: id, revision: 2, kind: 'bootstrap', externalLeagueId: '100000', season: 2026 } } });
    expect((await f.read()).inventory.gaps[0]).toMatchObject({ sourceKind: 'bootstrap', nativePeriod: 19 });
    const bootstrap = f.sources.pop()!; await expect(f.read()).rejects.toThrow('Missing stored period inventory source');
    f.sources.push(bootstrap); f.evidence[0].bootstraps.length = 0;
    await expect(f.read()).rejects.toThrow('Invalid stored period inventory source');
  });
  it('separates globally completed collection from selected rich page coverage', async () => {
    const f = fixture(20, 360); const { inventory, selectedRows } = await f.read({ afterOrdinal: 340, limit: 20 });
    expect(inventory).toMatchObject({ collection: 'complete', coverage: 'complete', readCoverage: 'page',
      summary: { completePeriods: 360, pendingPeriods: 0 }, page: { nextAfterOrdinal: null } });
    expect(selectedRows.map(row => row.ordinal)).toEqual(Array.from({ length: 20 }, (_, index) => 341 + index));
  });
  it('bounds actual typed rich reads to the selected20 and preserves receipt/mapping guards', async () => {
    const f = fixture(20, 360);
    const exact = vi.fn(async (_mapping, week: number) => ({ status: 'available', receipt: { id: 'matchups-' + week, configurationContentId: 'configuration' } }));
    const administration = { readSourceMapping: vi.fn(async (native: string) => mapping(native)), readAcceptedExactMatchups: exact } as unknown as LeagueAdministrationStore;
    const result = await readPublicSleeperIntake(f.client, administration, id, { periodInventoryPage: { afterOrdinal: 20, limit: 20 } });
    if (result.status === 'missing') throw new Error('Missing fixture');
    expect(result.periodInventory?.collection).toBe('complete'); expect(result.periodInventory?.readCoverage).toBe('page');
    expect(result.reason).toBe('period-page-not-fully-verified'); expect(result.exactPeriods).toHaveLength(20);
    expect(exact).toHaveBeenCalledTimes(20); expect(result.exactPeriods?.every(period => period.resource.status === 'available')).toBe(true);
  });
  it('represents empty completed discovery separately from not-yet-discovered inventory', async () => {
    const f = fixture(0); expect((await f.read()).inventory).toMatchObject({ discovery: 'complete', collection: 'complete', summary: { requestedPeriods: 0 } });
    f.lists.length = 0; f.evidence.length = 0; expect((await f.read()).inventory).toMatchObject({ discovery: 'pending', collection: 'pending' });
    expect((await readPublicPeriodInventory(f.client, id, [], [], {}, true)).inventory)
      .toMatchObject({ discovery: 'unavailable', coverage: 'limited', collection: 'unavailable' });
  });
  it('retains retry failures as pending until the actual durable state is terminal', async () => {
    const f = fixture(); f.tasks[0] = { ...f.tasks[0], failure_count: 1, reason: null };
    expect((await f.read()).inventory).toMatchObject({ collection: 'pending', summary: { pendingPeriods: 18, unavailablePeriods: 0 } });
    f.tasks.forEach((row, index) => { f.tasks[index] = { ...row, status: 'unavailable', failure_count: 5, reason: 'period-capture-exhausted' }; });
    expect((await f.read()).inventory).toMatchObject({ collection: 'unavailable', summary: { pendingPeriods: 0, unavailablePeriods: 18 } });
  });
  it.each(['leg', 'last_scored_leg', 'start_week', 'playoff_week_start'])('keeps all field states and extra-period gaps for %s', async field => {
    const f = fixture();
    for (const [settings, state, value] of [[{}, 'absent', null], [{ [field]: null }, 'null', null],
      [{ [field]: '19' }, 'invalid', null], [{ [field]: 0 }, 'known', 0], [{ [field]: 18 }, 'known', 18], [{ [field]: 19 }, 'known', 19]] as const) {
      f.sources[0] = { ...f.sources[0], native_fields: { settingsPresent: true, settings } };
      const { inventory } = await f.read();
      expect(inventory.sources[0].references.find(reference => reference.sourcePath === 'settings.' + field)).toMatchObject({ state, value });
      expect(inventory.gaps).toHaveLength(value === 19 ? 1 : 0); expect(inventory.tasks.at(-1)?.nativeWeek).toBe(18);
      if (value === 19) expect(inventory.coverage).toBe('limited');
    }
  });
  it.each([null, 'invalid', [], false])('retains invalid/null parent settings semantics: %j', async settings => {
    const f = fixture(); f.sources[0] = { ...f.sources[0], native_fields: { settingsPresent: true, settings } };
    const references = (await f.read()).inventory.sources[0].references;
    expect(references.every(reference => reference.state === (settings === null ? 'null' : 'invalid'))).toBe(true);
  });
  it('bounds large invalid raw output while preserving explicit retained evidence', async () => {
    const f = fixture(); f.sources[0] = { ...f.sources[0], native_fields: { settingsPresent: true, settings: 'x'.repeat(2048) } };
    const reference = (await f.read()).inventory.sources[0].references[0];
    expect(reference).toMatchObject({ state: 'invalid', rawRetained: true }); expect(reference).not.toHaveProperty('raw');
  });
  it.each(['missing-task', 'duplicate-week', 'wrong-ordinal', 'wrong-season', 'missing-plan', 'duplicate-candidate', 'missing-source', 'duplicate-source', 'unbound-source', 'incomplete-checkpoint', 'pending-reason', 'pending-exhausted', 'raw-parity'])('rejects invalid immutable inventory %s', async corruption => {
    const f = fixture();
    if (corruption === 'missing-task') f.tasks.pop();
    if (corruption === 'duplicate-week') f.tasks[1] = { ...f.tasks[1], native_week: 1 };
    if (corruption === 'wrong-ordinal') f.tasks[1] = { ...f.tasks[1], ordinal: 19 };
    if (corruption === 'wrong-season') f.tasks[1] = { ...f.tasks[1], season: 2025 };
    if (corruption === 'missing-plan') f.plans.pop();
    if (corruption === 'duplicate-candidate') f.candidates.push(f.candidates[0]);
    if (corruption === 'missing-source') f.sources.pop();
    if (corruption === 'duplicate-source') f.sources.push(f.sources[0]);
    if (corruption === 'unbound-source') f.sources[0] = { ...f.sources[0], worker_id: id };
    if (corruption === 'incomplete-checkpoint') f.tasks[0] = { ...f.tasks[0], status: 'complete' };
    if (corruption === 'pending-reason') f.tasks[0] = { ...f.tasks[0], reason: 'request-failed' };
    if (corruption === 'pending-exhausted') f.tasks[0] = { ...f.tasks[0], failure_count: 5 };
    if (corruption === 'raw-parity') f.sources[0] = { ...f.sources[0], source_evidence_equal: false };
    await expect(f.read()).rejects.toThrow();
  });
  it.each([{ afterOrdinal: -1 }, { afterOrdinal: 361 }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }])('rejects unbounded page %j', async page => {
    const f = fixture(); await expect(f.read(page)).rejects.toThrow('page'); expect(f.query).not.toHaveBeenCalled();
  });
});

describe('immutable refresh full-mode scope', () => {
  it.each([false, true])('preserves current configuration versus original cycle, rejects different request mode=%s', async mismatch => {
    const f = fixture(0); const old = [{ season: 2026, nativeWeek: 1 }];
    const row = { id, provider: 'sleeper', source_manager_account_id: worker, external_manager_id: '123',
      configuration_revision: 2, current_cycle: 1, next_due_at: time, last_served_at: null,
      selection_failure_count: 0, selection_failed_at: null, selection_next_eligible_at: time,
      identity_request_id: id, seasons: [2026], cadence_seconds: 60, expires_at: expiry, paused: false, configured_at: time,
      selected_exact_periods: old, selected_period_inventory: null, cycle_exact_periods: publicInventoryPeriods(),
      cycle_period_inventory: PUBLIC_PERIOD_INVENTORY, cycle_seasons: [2026], cycle_configuration_revision: 1,
      intake_id: id, cycle_created_at: time, due_at: time, disposition: null };
    const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, params) => sql.includes('public-data-refresh:read') ? [row]
      : mismatch && sql.includes('read-request') ? [{ ...f.header, selected_period_inventory: null, selected_exact_periods: old }]
        : original(sql, params));
    const read = readPublicDataRefresh(f.client, createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), id);
    if (mismatch) await expect(read).rejects.toThrow('period scope differs');
    else await expect(read).resolves.toMatchObject({ target: { exactPeriods: old }, cycle: { periodInventory: PUBLIC_PERIOD_INVENTORY },
      intake: { request: { periodInventory: PUBLIC_PERIOD_INVENTORY }, periodInventory: { collection: 'complete' } } });
  });
});

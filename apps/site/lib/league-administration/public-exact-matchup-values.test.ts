import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseClient, DatabaseRow } from '../database';
import { EXACT_MATCHUP_VALUES_VERSION, type ExactMatchupValuesRead, type ExactMatchupValuesSelection } from '../aggregator/exact-matchup-values';
import type { AdministrationSourceMapping } from './source-mapping';
import { PUBLIC_PERIOD_INVENTORY, publicInventoryPeriods, type PublicIntakeReadOptions } from './public-intake-contracts';
import { readPublicSleeperIntake } from './public-intake-reader';
import { readPublicDataRefresh } from './public-refresh-reader';
import { createLeagueAdministrationStore } from './store';
import type { LeagueAdministrationStore } from './store-contracts';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
const uuid = (value: number) => '11111111-2222-4333-8444-' + String(value).padStart(12, '0');
const id = uuid(1), worker = uuid(2), configurationContentId = uuid(3);
const time = '2026-10-10T12:00:00.000Z', expiry = '2026-10-11T12:00:00.000Z';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function mapping(externalLeagueId: string): AdministrationSourceMapping {
  return { connectionId: worker, leagueSeasonId: worker, revisionId: worker, generation: 1,
    scope: { provider: 'sleeper', leagueKey: 'sleeper-' + externalLeagueId, externalLeagueId, season: 2026 } };
}
function values(source: AdministrationSourceMapping, selection: ExactMatchupValuesSelection): Extract<ExactMatchupValuesRead, { status: 'available' }> {
  return { status: 'available', version: EXACT_MATCHUP_VALUES_VERSION, selection: 'receipt',
    sourceMappingRevisionId: source.revisionId, contentId: uuid(4), matchupsReceiptId: selection.matchupsReceiptId!,
    acceptanceId: uuid(5), acceptedGeneration: 1,
    provenance: { origin: 'network', requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time, checkedAt: time },
    value: { season: 2026, nativeWeek: selection.nativeWeek, teams: [] } };
}
function fixture(count = 1, completed = 2) {
  const candidates: DatabaseRow[] = Array.from({ length: count }, (_, index) => ({ season: 2026,
    external_league_id: String(100000 + index), stage: 'registered', name: 'Unrelated league' }));
  const plans = candidates.map(candidate => ({ ...candidate, policy: PUBLIC_PERIOD_INVENTORY, admitted: true, worker_id: worker, generation: 1 }));
  const sources = candidates.map((candidate, index) => ({ ...candidate, source_evidence_equal: true, source_kind: 'leagues', source_ordinal: index + 1,
    native_fields: { settingsPresent: false }, worker_id: worker, generation: 1, request_started_at: time, request_completed_at: time,
    acquisition: { version: 'public-network-capture-v1', work: { requestId: id, revision: 1, kind: 'leagues', userId: '123', season: 2026 },
      fence: { jobKey: 'league-administration-public-intake', workerId: worker, generation: 1, deadlineAt: expiry },
      dispatchNonce: worker, mapping: null, attempts: {} } }));
  const tasks: DatabaseRow[] = candidates.flatMap((candidate, index) => publicInventoryPeriods().map(period => {
    const ordinal = index * 18 + period.nativeWeek;
    return { ordinal, season: 2026, external_league_id: candidate.external_league_id, native_week: period.nativeWeek,
      status: ordinal <= completed ? 'complete' : 'pending', failure_count: 0, reason: null,
      ...(ordinal <= completed ? { worker_id: worker, generation: 1, league_season_id: worker,
        source_mapping: mapping(String(candidate.external_league_id)), settings_receipt_id: uuid(1000 + ordinal),
        matchups_receipt_id: uuid(2000 + ordinal), recorded_at: time, configuration_content_id: configurationContentId, settings_provenance: {} } : {}) };
  }));
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('public-data-refresh:read')) return [{ id, provider: 'sleeper', source_manager_account_id: worker,
      external_manager_id: '123', identity_request_id: id, configuration_revision: 1, seasons: [2026],
      selected_exact_periods: publicInventoryPeriods(), selected_period_inventory: PUBLIC_PERIOD_INVENTORY,
      cadence_seconds: 60, expires_at: expiry, paused: false, configured_at: time, next_due_at: expiry,
      last_served_at: time, selection_failure_count: 0, selection_failed_at: null, selection_next_eligible_at: time,
      current_cycle: 1, cycle_configuration_revision: 1, intake_id: id, disposition: null,
      cycle_exact_periods: publicInventoryPeriods(), cycle_period_inventory: PUBLIC_PERIOD_INVENTORY,
      cycle_seasons: [2026], cycle_created_at: time, due_at: time }];
    if (sql.includes('read-request')) return [{ id, seasons: [2026], terminal: false, external_manager_id: '123',
      selected_exact_periods: publicInventoryPeriods(), selected_period_inventory: PUBLIC_PERIOD_INVENTORY }];
    if (sql.includes('read-lists')) return [{ season: 2026, request_started_at: time, request_completed_at: time }];
    if (sql.includes('read-candidates')) return candidates;
    if (sql.includes('read-period-inventory-list-evidence')) return [{ season: 2026, request_started_at: time, request_completed_at: time,
      bootstraps: [], members: candidates.map((candidate, index) => ({ externalLeagueId: String(candidate.external_league_id), sourceOrdinal: index + 1 })) }];
    if (sql.includes('read-period-inventory-plans')) return plans;
    if (sql.includes('read-period-inventory-sources')) return sources;
    if (sql.includes('read-exact-periods')) return tasks;
    return [];
  });
  const client = { enabled: true, query } as unknown as DatabaseClient;
  const exact = vi.fn(async (source: AdministrationSourceMapping, week: number) => {
    const row = tasks.find(task => task.external_league_id === source.scope.externalLeagueId && task.native_week === week)!;
    return { status: 'available' as const, receipt: { id: row.matchups_receipt_id, configurationContentId } };
  });
  const readValues = vi.fn(async (source: AdministrationSourceMapping, selection: ExactMatchupValuesSelection): Promise<ExactMatchupValuesRead> => values(source, selection));
  const administration = { readSourceMapping: vi.fn(async (native: string) => mapping(native)), readAcceptedExactMatchups: exact,
    readExactMatchupValues: readValues } as unknown as LeagueAdministrationStore;
  const read = async (options: PublicIntakeReadOptions = {}) => {
    const result = await readPublicSleeperIntake(client, administration, id, options);
    if (result.status === 'missing') throw new Error('Missing inventory fixture');
    return result;
  };
  return { query, client, tasks, administration, exact, readValues, read };
}

describe('opt-in persisted native matchup value composition', () => {
  it.each([null, 'v2', '', false])('rejects unsupported version %j before any database work', async version => {
    const f = fixture();
    await expect(f.read({ exactMatchupValuesVersion: version } as unknown as PublicIntakeReadOptions)).rejects.toThrow('Unsupported public exact matchup values version');
    expect(f.query).not.toHaveBeenCalled(); expect(f.readValues).not.toHaveBeenCalled();
  });
  it('preserves omitted-option payload bytes and database work independently of capability presence', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    const f = fixture(); const current = await f.read(), calls = f.query.mock.calls.length;
    const { readExactMatchupValues: _values, ...legacy } = f.administration; void _values;
    f.query.mockClear();
    const prior = await readPublicSleeperIntake(f.client, legacy, id);
    expect(JSON.stringify(current)).toBe(JSON.stringify(prior)); expect(f.query).toHaveBeenCalledTimes(calls);
    expect(current.exactPeriods?.every(period => !('exactMatchupValues' in period))).toBe(true);
    expect(current.coverage.requested).not.toContain('exact-matchup-values'); expect(f.readValues).not.toHaveBeenCalled();
  });
  it('pins completed periods to original receipt IDs and never fetches queued periods', async () => {
    const f = fixture(); const fetch = vi.fn(() => { throw new Error('Provider disabled'); }); vi.stubGlobal('fetch', fetch);
    const result = await f.read({ exactMatchupValuesVersion: 'v1' });
    expect(f.readValues).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled();
    expect(f.readValues).toHaveBeenNthCalledWith(1, mapping('100000'), { nativeWeek: 1, matchupsReceiptId: uuid(2001) });
    expect(result.exactPeriods?.slice(0, 2).every(period => period.exactMatchupValues?.status === 'available')).toBe(true);
    expect(result.exactPeriods?.slice(2).every(period => period.exactMatchupValues?.status === 'unavailable')).toBe(true);
    expect(result.periodInventory?.summary).toMatchObject({ completePeriods: 2, pendingPeriods: 16 });
    expect(result.coverage.requested).toContain('exact-matchup-values');
  });
  it('bounds 360 completed tasks to twenty selected detailed value reads', async () => {
    const f = fixture(20, 360); const result = await f.read({ exactMatchupValuesVersion: 'v1', periodInventoryPage: { afterOrdinal: 340, limit: 20 } });
    expect(f.readValues).toHaveBeenCalledTimes(20); expect(f.exact).toHaveBeenCalledTimes(20);
    expect(result.exactPeriods?.map(period => period.ordinal)).toEqual(Array.from({ length: 20 }, (_, index) => 341 + index));
    expect(result.periodInventory).toMatchObject({ readCoverage: 'page', summary: { completePeriods: 360, pendingPeriods: 0 } });
  });
  it('refuses an oversized rich page before typed-value fanout', async () => {
    const f = fixture(20, 360);
    await expect(f.read({ exactMatchupValuesVersion: 'v1', periodInventoryPage: { limit: 21 } })).rejects.toThrow();
    expect(f.readValues).not.toHaveBeenCalled(); expect(f.exact).not.toHaveBeenCalled();
  });
  it('keeps original accepted values independent of a newer head or failed legacy read', async () => {
    const f = fixture(); f.exact.mockImplementation(async () => ({ status: 'available', receipt: { id: uuid(99), configurationContentId } }));
    let result = await f.read({ exactMatchupValuesVersion: 'v1' });
    expect(result.exactPeriods?.[0]).toMatchObject({ resource: { status: 'unavailable', reason: 'intake-capture-not-current-head' }, exactMatchupValues: { status: 'available' } });
    f.exact.mockRejectedValue(new Error('head read failed'));
    result = await f.read({ exactMatchupValuesVersion: 'v1' });
    expect(result.exactPeriods?.[0]).toMatchObject({ resource: { status: 'unavailable' }, exactMatchupValues: { status: 'available' } });
    expect(result.status).not.toBe('available');
  });
  it.each(['version', 'selection', 'season', 'week', 'mapping', 'receipt', 'malformed'] as const)(
    'isolates mismatched %s supplemental evidence from official resource availability', async changed => {
      const f = fixture();
      f.readValues.mockImplementation(async (source, selection) => {
        const value = values(source, selection);
        if (changed === 'version') return { ...value, version: 'other' } as unknown as ExactMatchupValuesRead;
        if (changed === 'selection') return { ...value, selection: 'current' };
        if (changed === 'season') return { ...value, value: { ...value.value, season: 2025 } };
        if (changed === 'week') return { ...value, value: { ...value.value, nativeWeek: 18 } };
        if (changed === 'mapping') return { ...value, sourceMappingRevisionId: uuid(99) };
        if (changed === 'receipt') return { ...value, matchupsReceiptId: uuid(99) };
        return { ...value, value: null } as unknown as ExactMatchupValuesRead;
      });
      const result = await f.read({ exactMatchupValuesVersion: 'v1' });
      expect(result.exactPeriods?.[0]).toMatchObject({ resource: { status: 'available' }, exactMatchupValues: { status: 'unavailable',
        reason: changed === 'malformed' ? 'exact-matchup-values-read-failed' : 'intake-exact-matchup-values-mismatch' } });
    });
  it('isolates unsupported or failing optional readers and honors task mapping fences', async () => {
    const f = fixture(); f.readValues.mockRejectedValue(new Error('failed'));
    expect((await f.read({ exactMatchupValuesVersion: 'v1' })).exactPeriods?.[0].exactMatchupValues)
      .toEqual({ status: 'unavailable', reason: 'exact-matchup-values-read-failed' });
    const { readExactMatchupValues: _values, ...legacy } = f.administration; void _values;
    const result = await readPublicSleeperIntake(f.client, legacy, id, { exactMatchupValuesVersion: 'v1' });
    if (result.status === 'missing') throw new Error('Missing fixture');
    expect(result.exactPeriods?.[0].exactMatchupValues).toEqual({ status: 'unavailable', reason: 'exact-matchup-values-unsupported' });
    f.readValues.mockClear(); f.tasks[0] = { ...f.tasks[0], source_mapping: { ...mapping('100000'), revisionId: uuid(99) } };
    expect((await f.read({ exactMatchupValuesVersion: 'v1' })).exactPeriods?.[0].exactMatchupValues)
      .toEqual({ status: 'unavailable', reason: 'stored-period-source-unavailable' });
    expect(f.readValues).toHaveBeenCalledTimes(1);
  });
  it('forwards the same optional selector through the existing stored refresh reader', async () => {
    const f = fixture(); const current = await readPublicDataRefresh(f.client as Database, f.administration, id, { exactMatchupValuesVersion: 'v1' });
    if (current.status !== 'available' || !current.intake || current.intake.status === 'missing') throw new Error('Missing current refresh fixture');
    expect(current.intake.exactPeriods?.[0].exactMatchupValues?.status).toBe('available');
    expect(f.readValues).toHaveBeenCalledTimes(2);
  });
  it('returns disabled without evaluating selection or obtaining a database', async () => {
    const store = createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' });
    await expect(store.readExactMatchupValues!(null as unknown as AdministrationSourceMapping, null as unknown as ExactMatchupValuesSelection))
      .resolves.toEqual({ status: 'disabled' });
  });
  it('keeps late role provisioning SELECT-only and all supplemental helpers private', async () => {
    const source = await readFile(new URL('../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
    const block = source.split('-- BEGIN OPTIONAL EXACT MATCHUP VALUES GRANTS')[1]?.split('-- END OPTIONAL EXACT MATCHUP VALUES GRANTS')[0];
    expect(block).toBeTruthy();
    for (const name of ['league_exact_matchup_value_contents', 'league_exact_matchup_team_values', 'league_exact_matchup_starter_points',
      'league_exact_matchup_player_points', 'exact_matchup_native_state(jsonb,text,text)', 'validate_exact_matchup_value_lineage()',
      'validate_exact_matchup_value_cardinality()', 'capture_exact_matchup_values()']) expect(block).toContain(name);
    expect(block).toContain('GRANT SELECT ON TABLE'); expect(block).not.toMatch(/GRANT (?:ALL|INSERT|UPDATE|DELETE|EXECUTE)/u);
    expect(block).toContain("has_function_privilege('league_one_runtime',helper,'EXECUTE')");
  });
});

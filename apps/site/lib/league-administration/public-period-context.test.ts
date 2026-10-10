import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../database';
import type { ExactPeriodContextRead, ExactPeriodContextSelection } from '../aggregator/exact-period-context';
import { EXACT_PERIOD_CONTEXT_VERSION, deriveExactPeriodPhase } from '../aggregator/exact-period-context';
import { normalizeAdministrationObservation } from './normalize';
import type { AdministrationSourceMapping } from './source-mapping';
import { PUBLIC_PERIOD_INVENTORY, publicInventoryPeriods, type PublicIntakeReadOptions } from './public-intake-contracts';
import { readPublicSleeperIntake } from './public-intake-reader';
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
function context(source: AdministrationSourceMapping, selection: ExactPeriodContextSelection): Extract<ExactPeriodContextRead, { status: 'available' }> {
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: source.scope, family: 'league', week: null, completeness: 'complete',
    provenance: { origin: 'network', requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time, checkedAt: time },
    payload: { league_id: source.scope.externalLeagueId, season: '2026', sport: 'nfl', settings: { start_week: 1, playoff_week_start: 15 } } });
  if (!normalized.leagueSettings?.value) throw new Error('Invalid context fixture');
  const calendar = { status: 'unmapped', reason: 'calendar_evidence_missing' } as const;
  const unknown = { status: 'unknown', reason: 'period_mapping_unproved' } as const;
  return { status: 'available', version: EXACT_PERIOD_CONTEXT_VERSION, period: { season: 2026, nativeWeek: selection.nativeWeek },
    sourceMappingRevisionId: source.revisionId, capture: { matchupsReceiptId: selection.matchupsReceiptId,
      settingsReceiptId: selection.intakeCapture?.settingsReceiptId ?? null, configurationContentId },
    observedConfiguration: { contentId: configurationContentId, configurationVersionId: uuid(4), rawContentHash: normalized.contentHash,
      provenance: normalized.envelope.provenance, value: normalized.leagueSettings.value, applicability: 'observation-only' },
    calendar, configuration: { scoring: unknown, roster: unknown, competition: unknown },
    nativeOfficialPhase: { status: 'unknown', reason: 'native-period-phase-not-exposed' }, phase: deriveExactPeriodPhase(calendar, unknown) };
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
  const readContext = vi.fn(async (source: AdministrationSourceMapping, selection: ExactPeriodContextSelection): Promise<ExactPeriodContextRead> => context(source, selection));
  const administration = { readSourceMapping: vi.fn(async (native: string) => mapping(native)), readAcceptedExactMatchups: exact,
    readExactPeriodContext: readContext } as unknown as LeagueAdministrationStore;
  const read = async (options: PublicIntakeReadOptions = {}) => {
    const result = await readPublicSleeperIntake(client, administration, id, options);
    if (result.status === 'missing') throw new Error('Missing inventory fixture');
    return result;
  };
  return { query, client, tasks, administration, exact, readContext, read };
}

describe('opt-in stored exact-period context composition', () => {
  it.each([null, 'v2', '', false])('rejects unsupported version %j before any database work', async version => {
    const f = fixture();
    await expect(f.read({ periodContextVersion: version } as unknown as PublicIntakeReadOptions)).rejects.toThrow('Unsupported public period context version');
    expect(f.query).not.toHaveBeenCalled(); expect(f.readContext).not.toHaveBeenCalled();
  });
  it('keeps default payload bytes and read count independent of capability presence', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    const f = fixture(); const current = await f.read();
    const { readExactPeriodContext: _context, ...legacy } = f.administration;
    void _context;
    const prior = await readPublicSleeperIntake(f.client, legacy, id);
    expect(JSON.stringify(current)).toBe(JSON.stringify(prior));
    expect(current.exactPeriods?.every(period => !('periodContext' in period))).toBe(true);
    expect(current.coverage.requested).not.toContain('exact-period-context'); expect(f.readContext).not.toHaveBeenCalled();
  });
  it('uses the exact retained checkpoint pair and leaves sixteen queued periods unqueried', async () => {
    const f = fixture(); const fetch = vi.fn(() => { throw new Error('Provider access disabled'); }); vi.stubGlobal('fetch', fetch);
    const result = await f.read({ periodContextVersion: 'v1' });
    expect(f.readContext).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled();
    expect(f.readContext).toHaveBeenNthCalledWith(1, mapping('100000'), { nativeWeek: 1, matchupsReceiptId: uuid(2001),
      intakeCapture: { intakeId: id, settingsReceiptId: uuid(1001) } });
    expect(result.exactPeriods?.slice(0, 2).every(period => period.periodContext?.status === 'available')).toBe(true);
    expect(result.exactPeriods?.slice(2).every(period => period.periodContext?.status === 'unavailable')).toBe(true);
    expect(result.periodInventory?.summary).toMatchObject({ completePeriods: 2, pendingPeriods: 16 });
    expect(result.coverage.requested).toContain('exact-period-context');
    expect(result.exactPeriods?.[0].phase).toEqual({ status: 'unknown', reason: 'native-period-phase-not-evidenced' });
  });
  it('bounds 360 completed tasks to twenty selected context reads and never invents pending work from pagination', async () => {
    const f = fixture(20, 360); const result = await f.read({ periodContextVersion: 'v1', periodInventoryPage: { afterOrdinal: 340, limit: 20 } });
    expect(f.readContext).toHaveBeenCalledTimes(20); expect(f.exact).toHaveBeenCalledTimes(20);
    expect(result.exactPeriods?.map(period => period.ordinal)).toEqual(Array.from({ length: 20 }, (_, index) => 341 + index));
    expect(result.periodInventory).toMatchObject({ collection: 'complete', readCoverage: 'page',
      summary: { completePeriods: 360, pendingPeriods: 0 }, page: { nextAfterOrdinal: null } });
  });
  it('rejects an oversized rich page without any rich context fanout', async () => {
    const f = fixture(20, 360);
    await expect(f.read({ periodContextVersion: 'v1', periodInventoryPage: { limit: 21 } })).rejects.toThrow();
    expect(f.readContext).not.toHaveBeenCalled(); expect(f.exact).not.toHaveBeenCalled();
  });
  it('retains context independently of a newer accepted head or a failed optional read', async () => {
    const f = fixture(); f.exact.mockImplementation(async () => ({ status: 'missing' } as unknown as Awaited<ReturnType<typeof f.exact>>));
    let result = await f.read({ periodContextVersion: 'v1' });
    expect(result.exactPeriods?.[0]).toMatchObject({ resource: { status: 'missing' }, periodContext: { status: 'available' } });
    f.exact.mockRejectedValue(new Error('head read failed'));
    result = await f.read({ periodContextVersion: 'v1' });
    expect(result.exactPeriods?.[0]).toMatchObject({ resource: { status: 'unavailable' }, periodContext: { status: 'available' } });
  });
  it.each(['version', 'season', 'week', 'mapping', 'matchups', 'settings', 'configuration', 'observed', 'malformed'] as const)(
    'isolates a mismatched %s context without suppressing official matchup data', async changed => {
      const f = fixture();
      f.readContext.mockImplementation(async (source, selection) => {
        const value = context(source, selection);
        if (changed === 'version') return { ...value, version: 'other' } as unknown as ExactPeriodContextRead;
        if (changed === 'season') return { ...value, period: { ...value.period, season: 2025 } } as unknown as ExactPeriodContextRead;
        if (changed === 'week') return { ...value, period: { ...value.period, nativeWeek: 18 } };
        if (changed === 'mapping') return { ...value, sourceMappingRevisionId: uuid(99) };
        if (changed === 'matchups') return { ...value, capture: { ...value.capture, matchupsReceiptId: uuid(99) } };
        if (changed === 'settings') return { ...value, capture: { ...value.capture, settingsReceiptId: uuid(99) } };
        if (changed === 'configuration') return { ...value, capture: { ...value.capture, configurationContentId: uuid(99) } };
        if (changed === 'observed') return { ...value, observedConfiguration: { ...value.observedConfiguration, contentId: uuid(99) } };
        return { ...value, capture: null } as unknown as ExactPeriodContextRead;
      });
      const result = await f.read({ periodContextVersion: 'v1' });
      expect(result.exactPeriods?.[0]).toMatchObject({ resource: { status: 'available' }, periodContext: { status: 'unavailable',
        reason: changed === 'malformed' ? 'period-context-read-failed' : 'intake-period-context-mismatch' } });
    });
  it('isolates an unsupported/throwing context capability and respects mapping fences', async () => {
    const f = fixture(); f.readContext.mockRejectedValue(new Error('context read failed'));
    expect((await f.read({ periodContextVersion: 'v1' })).exactPeriods?.[0]).toMatchObject({ resource: { status: 'available' },
      periodContext: { status: 'unavailable', reason: 'period-context-read-failed' } });
    const { readExactPeriodContext: _context, ...legacy } = f.administration; void _context;
    const result = await readPublicSleeperIntake(f.client, legacy, id, { periodContextVersion: 'v1' });
    if (result.status === 'missing') throw new Error('Missing fixture');
    expect(result.exactPeriods?.[0]).toMatchObject({ resource: { status: 'available' }, periodContext: { status: 'unavailable', reason: 'period-context-unsupported' } });
    f.readContext.mockClear(); f.tasks[0] = { ...f.tasks[0], source_mapping: { ...mapping('100000'), revisionId: uuid(99) } };
    expect((await f.read({ periodContextVersion: 'v1' })).exactPeriods?.[0]).toMatchObject({ resource: { status: 'unavailable' },
      periodContext: { status: 'unavailable', reason: 'stored-period-source-unavailable' } });
    expect(f.readContext).toHaveBeenCalledTimes(1);
  });
  it('returns disabled without evaluating a selection or obtaining a database', async () => {
    const store = createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' });
    await expect(store.readExactPeriodContext!(null as unknown as AdministrationSourceMapping, null as unknown as ExactPeriodContextSelection))
      .resolves.toEqual({ status: 'disabled' });
  });
});

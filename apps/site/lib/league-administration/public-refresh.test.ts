import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../database';
import { createPublicDataRefreshStore } from './neon/public-intake';
import { validatePublicDataRefresh } from './public-refresh-contracts';
import { readPublicDataRefresh } from './public-refresh-reader';
import { createLeagueAdministrationStore } from './store';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const managerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const time = '2026-10-06T12:00:00.000Z';
const input = { id: targetId, expectedRevision: 0, identityRequestId: requestId, seasons: [2026, 2025],
  cadenceSeconds: 3600, expiresAt: '2026-10-07T12:00:00.000Z', paused: false };
const selected = { status: 'selected', targetId, configurationRevision: 3, cycleConfigurationRevision: 2, cycle: 4, requestId };
const fence = { jobKey: 'league-administration-public-intake', workerId: 'worker', generation: 1, deadlineAt: time };
function database(result: unknown) {
  const query = vi.fn(async () => [{ result }]);
  return { query, client: { enabled: true, query } as unknown as DatabaseClient };
}
afterEach(() => vi.useRealTimers());

describe('explicit recurring DATA configuration and SQL transport', () => {
  it('normalizes only explicit scope and keeps stable identities as exact strings', () => {
    const normalized = validatePublicDataRefresh(input, new Date(time));
    expect(normalized).toEqual({ ...input, seasons: [2025, 2026] });
    expect(input.seasons).toEqual([2026, 2025]);
  });
  it.each([
    { seasons: [] }, { seasons: [2026, 2026] }, { seasons: [2023, 2024, 2025, 2026] }, { seasons: [2026.5] },
    { cadenceSeconds: 59 }, { cadenceSeconds: 604801 }, { cadenceSeconds: 60.5 }, { paused: 'false' },
    { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { id: 'username' },
    { identityRequestId: '55' }, { expiresAt: time }, { expiresAt: '2027-10-06T12:00:00Z' },
  ])('rejects configuration outside the bounded contract: %o', patch => {
    expect(() => validatePublicDataRefresh({ ...input, ...patch } as typeof input, new Date(time))).toThrow();
  });
  it('constructs no query and keeps configuration CAS/replay at the existing database boundary', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    const f = database({ status: 'replayed', targetId, configurationRevision: 1 });
    const store = createPublicDataRefreshStore(f.client); expect(f.query).not.toHaveBeenCalled();
    expect(await store.configure(input)).toEqual({ status: 'replayed', targetId, configurationRevision: 1 });
    const parameters = (f.query.mock.calls as unknown as [string, string[]][])[0][1];
    expect(JSON.parse(parameters[0])).toEqual({ ...input, seasons: [2025, 2026] });
    expect(f.query).toHaveBeenCalledOnce();
  });
  it.each([
    { ...selected, requestId: 'native-id' }, { ...selected, cycle: 0 }, { ...selected, cycle: Number.MAX_SAFE_INTEGER + 1 },
    { ...selected, cycleConfigurationRevision: 4 }, { ...selected, configurationRevision: '3' },
    { status: 'backoff', nextEligibleAt: 'invalid' }, { status: 'fresh' },
  ])('fails closed on malformed selection acknowledgments: %o', async result => {
    const f = database(result); await expect(createPublicDataRefreshStore(f.client).select(fence)).rejects.toThrow();
  });
  it('retains current approval and original cycle revisions separately', async () => {
    const f = database(selected); expect(await createPublicDataRefreshStore(f.client).select(fence)).toEqual(selected);
  });
  it('passes unknown selection acknowledgment as SQL NULL, never a guessed target', async () => {
    const f = database({ status: 'admitted' });
    expect(await createPublicDataRefreshStore(f.client).recordSelectionFailure(null, fence, 'admission-unconfirmed')).toEqual({ status: 'admitted' });
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('record_public_data_refresh_selection_failure'),
      [null, JSON.stringify(fence), 'admission-unconfirmed']);
  });
});

function targetRow() {
  return { id: targetId, provider: 'sleeper', source_manager_account_id: managerId, external_manager_id: '98765432109876543210',
    configuration_revision: '3', current_cycle: null as unknown, next_due_at: time, last_served_at: null,
    selection_failure_count: 0, selection_failed_at: null, selection_next_eligible_at: time,
    identity_request_id: requestId, seasons: [2025, 2026], cadence_seconds: 3600, expires_at: input.expiresAt,
    paused: true, configured_at: time, cycle_configuration_revision: null as unknown, intake_id: null as unknown,
    cycle_created_at: null as unknown, due_at: null as unknown, disposition: null as unknown,
    outcome_recorded_at: null as unknown, outcome_next_due_at: null as unknown };
}
describe('stored recurring DATA reader', () => {
  const administration = createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' });
  it('performs no query for disabled storage and validates target identity first', async () => {
    expect(await readPublicDataRefresh({ enabled: false, reason: 'missing-database-url' }, administration, targetId)).toEqual({ status: 'disabled' });
    await expect(readPublicDataRefresh({ enabled: false, reason: 'missing-database-url' }, administration, 'username')).rejects.toThrow();
  });
  it('exposes pause/due/failure fields without claiming a successful or fresh capture', async () => {
    const query = vi.fn(async () => [targetRow()]);
    const result = await readPublicDataRefresh({ enabled: true, query } as unknown as DatabaseClient, administration, targetId);
    expect(result).toMatchObject({ status: 'available', target: { paused: true, configurationRevision: 3,
      externalManagerId: '98765432109876543210' }, schedule: { lastServedAt: null }, cycle: null, intake: null });
    expect(query).toHaveBeenCalledOnce();
    if (result.status === 'available') expect(result.freshness).toContain('do not assert fresh content');
  });
  it('reads immutable cycle request evidence separately from newer approval and terminal scheduling outcome', async () => {
    const row = { ...targetRow(), current_cycle: '4', cycle_configuration_revision: '2', intake_id: requestId,
      cycle_created_at: time, due_at: time, disposition: 'partial', outcome_recorded_at: time, outcome_next_due_at: input.expiresAt };
    const query = vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([{ id: requestId, seasons: [2025, 2026], terminal: true }])
      .mockResolvedValue([]);
    const result = await readPublicDataRefresh({ enabled: true, query } as unknown as DatabaseClient, administration, targetId,
      { managerEvidenceVersion: 'v2' });
    expect(result).toMatchObject({ status: 'available', target: { configurationRevision: 3 },
      cycle: { configurationRevision: 2, number: 4, requestId, outcome: { disposition: 'partial' } }, intake: { status: 'unavailable' } });
    expect(query.mock.calls[1][1]).toEqual([requestId]);
    if (result.status === 'available' && result.intake && result.intake.status !== 'missing') {
      expect(result.intake.coverage.requested).toContain('team-manager-evidence-v2');
    }
  });
  it.each([{ provider: 'yahoo' }, { current_cycle: 1 }, { seasons: [2026, 2026] }, { configuration_revision: '9007199254740992' },
    { selection_failure_count: 8 }, { external_manager_id: 55 }, { next_due_at: 'bad-time' }])('rejects malformed retained schedule scope: %o', async patch => {
    const query = vi.fn(async () => [{ ...targetRow(), ...patch }]);
    await expect(readPublicDataRefresh({ enabled: true, query } as unknown as DatabaseClient, administration, targetId)).rejects.toThrow();
    expect(query).toHaveBeenCalledOnce();
  });
});

describe('explicit period recurrence scope', () => {
  const periods = [{ season: 2026, nativeWeek: 18 }, { season: 2025, nativeWeek: 1 }];
  it('normalizes periods in stable order and omits empty selection from the old configuration wire', () => {
    expect(validatePublicDataRefresh({ ...input, exactPeriods: periods }, new Date(time)).exactPeriods).toEqual([...periods].reverse());
    expect(JSON.stringify(validatePublicDataRefresh({ ...input, exactPeriods: [] }, new Date(time))))
      .toBe(JSON.stringify(validatePublicDataRefresh(input, new Date(time))));
    expect(() => validatePublicDataRefresh({ ...input, exactPeriods: [{ season: 2024, nativeWeek: 1 }] }, new Date(time))).toThrow();
  });
  it.each([false, true])('capability-gates explicit configure before mutation while preserving CAS/replay scope: %s', async supported => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    const query = vi.fn(async (sql: string) => sql.includes('capability') ? [{ supported }]
      : [{ result: { status: 'replayed', targetId, configurationRevision: 1 } }]);
    const store = createPublicDataRefreshStore({ enabled: true, query } as unknown as DatabaseClient);
    const configured = store.configure({ ...input, exactPeriods: periods });
    if (!supported) { await expect(configured).rejects.toThrow('R038'); expect(query).toHaveBeenCalledOnce(); }
    else {
      await expect(configured).resolves.toEqual({ status: 'replayed', targetId, configurationRevision: 1 });
      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(expect.stringContaining('configure_public_data_refresh'),
        [JSON.stringify({ ...validatePublicDataRefresh(input, new Date(time)), exactPeriods: [...periods].reverse() })]);
    }
  });
  it('keeps empty configure on the old single-query path', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    const f = database({ status: 'configured', targetId, configurationRevision: 1 });
    await createPublicDataRefreshStore(f.client).configure({ ...input, exactPeriods: [] });
    expect(f.query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('configure_public_data_refresh'),
      [JSON.stringify(validatePublicDataRefresh(input, new Date(time)))]);
  });
  it.each([false, true])('keeps current configuration separate from cycle period scope and rejects request mismatch=%s', async mismatch => {
    const current = [{ season: 2026, nativeWeek: 1 }]; const original = [{ season: 2026, nativeWeek: 18 }];
    const row = { ...targetRow(), current_cycle: '4', cycle_configuration_revision: '2', intake_id: requestId,
      cycle_created_at: time, due_at: time, selected_exact_periods: current, cycle_exact_periods: original, cycle_seasons: [2025, 2026] };
    const query = vi.fn(async (sql: string) => sql.includes('public-data-refresh:read') ? [row]
      : sql.includes('read-request') ? [{ id: requestId, seasons: [2025, 2026], terminal: true, selected_exact_periods: mismatch ? current : original }]
        : []);
    const read = readPublicDataRefresh({ enabled: true, query } as unknown as DatabaseClient,
      createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), targetId);
    if (mismatch) await expect(read).rejects.toThrow('period scope differs');
    else await expect(read).resolves.toMatchObject({ target: { exactPeriods: current }, cycle: { exactPeriods: original },
      intake: { request: { exactPeriods: original }, exactPeriods: [] } });
    expect(query).toHaveBeenCalledTimes(6);
  });
});

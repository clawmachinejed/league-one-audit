import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../database';
import { createLeagueAdministrationStore } from './store';
import { readPublicSleeperIntake } from './public-intake-reader';
import { PUBLIC_DRAFT_PICKS, PUBLIC_PERIOD_INVENTORY, PUBLIC_TRANSACTION_HISTORY, PUBLIC_PLAYOFF_BRACKETS,
  publicInventoryPeriods, type PublicIntakeReadOptions } from './public-intake-contracts';
vi.mock('server-only', () => ({}));

const id = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const query = vi.fn(async (sql: string): Promise<DatabaseRow[]> => sql.includes('public-data-intake:read-request')
    ? [{ id, seasons: [2026], terminal: true, external_manager_id: '99', selected_exact_periods: null,
      selected_period_inventory: null, selected_playoff_brackets: null, selected_weekly_reports: null,
      selected_transaction_period: null, selected_transaction_history: null, selected_draft_picks: null }]
    : sql.includes('public-data-intake:read-lists') ? [{ season: 2026 }] : []);
  const client = { enabled: true, query } as unknown as DatabaseClient;
  const administration = createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' });
  return { client, administration, query };
}
describe('public intake history compatibility', () => {
  it('keeps capacity authoritative for a fully selected request with detailed paging options', async () => {
    const f = fixture();
    f.query.mockImplementation(async sql => sql.includes('public-data-intake:read-request')
      ? [{ id, seasons: [2026], terminal: true, revision: 0, failure_count: 0,
        selected_submission_capacity: 'pending-request-limit', selected_period_inventory: PUBLIC_PERIOD_INVENTORY,
        selected_exact_periods: publicInventoryPeriods(), selected_draft_picks: PUBLIC_DRAFT_PICKS,
        selected_transaction_history: PUBLIC_TRANSACTION_HISTORY, selected_playoff_brackets: PUBLIC_PLAYOFF_BRACKETS,
        selected_weekly_reports: [{ season: 2026, nativeWeek: 1 }] }] : []);
    const read = await readPublicSleeperIntake(f.client, f.administration, id, {
      periodInventoryPage: { limit: 1 }, transactionHistoryPage: { limit: 1 }, draftPicksPage: { limit: 1 },
    });
    expect(read).toMatchObject({ status: 'unavailable', reason: 'submission-capacity',
      request: { submissionCapacity: 'pending-request-limit', draftPicks: PUBLIC_DRAFT_PICKS } });
  });
  it('exposes a durable capacity reason without provider calls or changing ordinary missing-marker payloads', async () => {
    const f = fixture();
    const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async sql => sql.includes('public-data-intake:read-request')
      ? [{ id, seasons: [2026], terminal: true, revision: 0, failure_count: 0,
        selected_submission_capacity: 'pending-request-limit' }] : original(sql));
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Stored reader must not fetch'));
    try {
      const read = await readPublicSleeperIntake(f.client, f.administration, id);
      expect(read).toMatchObject({ status: 'unavailable', reason: 'submission-capacity',
        request: { submissionCapacity: 'pending-request-limit', terminal: true, revision: 0, failure_count: 0 }, leagues: [] });
      expect(fetch).not.toHaveBeenCalled();
      expect(f.query.mock.calls.every(([sql]) => !/\b(insert|update|delete)\b/iu.test(sql))).toBe(true);
    } finally { fetch.mockRestore(); }
  });
  it.each([{ selected_submission_capacity: 'unknown' }, { terminal: false }, { revision: 1 }, { failure_count: 1 }])(
    'fails closed on an invalid stored capacity envelope: %o', async patch => {
      const f = fixture();
      f.query.mockResolvedValue([{ id, seasons: [2026], terminal: true, revision: 0, failure_count: 0,
        selected_submission_capacity: 'pending-request-limit', ...patch }]);
      await expect(readPublicSleeperIntake(f.client, f.administration, id)).rejects.toThrow('capacity receipt');
      expect(f.query).toHaveBeenCalledOnce();
    });
  it('preserves omitted-option payload and exact SQL query behavior', async () => {
    const f = fixture();
    const old = await readPublicSleeperIntake(f.client, f.administration, id);
    const queries = structuredClone(f.query.mock.calls);
    f.query.mockClear();
    const explicit = await readPublicSleeperIntake(f.client, f.administration, id, {});
    expect(f.query.mock.calls).toEqual(queries);
    expect(old).not.toHaveProperty('seasonHistory');
    if (old.status === 'missing' || explicit.status === 'missing') throw new Error('Fixture');
    expect({ ...explicit, readAt: old.readAt }).toEqual(old);
  });
  it('adds stored-only composition by explicit version without altering intake completion', async () => {
    const f = fixture();
    const old = await readPublicSleeperIntake(f.client, f.administration, id);
    const queries = structuredClone(f.query.mock.calls);
    f.query.mockClear();
    const read = await readPublicSleeperIntake(f.client, f.administration, id, { seasonHistoryVersion: 'v1' });
    expect(f.query.mock.calls).toEqual(queries);
    expect(read.status).toBe(old.status);
    expect(read).toMatchObject({ seasonHistory: { status: 'available', scope: 'selected-request',
      leagues: [], coverage: { detailedPeriods: 0, taskCount: 0, corrections: 'original-request-receipts' } } });
    expect(f.query.mock.calls.every(([sql]) => !/\b(insert|update|delete|fetch)\b/iu.test(sql))).toBe(true);
  });
  it('retains capacity gaps without fanning out source reads for unadmitted history leagues', async () => {
    const f = fixture();
    const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async sql => sql.includes('public-data-intake:read-candidates')
      ? [{ season: 2026, external_league_id: '9001', league_season_id: null, stage: 'capacity', name: 'Generic overflow' }]
      : original(sql));
    const mappingRead = vi.spyOn(f.administration, 'readSourceMapping');
    const read = await readPublicSleeperIntake(f.client, f.administration, id, { seasonHistoryVersion: 'v1' });
    expect(read).toMatchObject({ seasonHistory: { leagues: [{ resource: { status: 'unavailable', reason: 'season-history-capacity' } }] } });
    expect(mappingRead).not.toHaveBeenCalled();
  });
  it('rejects unsupported versions before the first query', async () => {
    const f = fixture();
    await expect(readPublicSleeperIntake(f.client, f.administration, id,
      { seasonHistoryVersion: 'v2' } as unknown as PublicIntakeReadOptions)).rejects.toThrow('history version');
    expect(f.query).not.toHaveBeenCalled();
  });
});

describe('internal resource occurrences are not public username imports', () => {
  it.each([id, '', false])('excludes a marked occurrence before inherited lists or typed reads: %j', async marker => {
    const f = fixture(); const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No reader HTTP'));
    const typed = vi.spyOn(f.administration, 'readSourceMapping');
    f.query.mockImplementation(async sql => sql.includes('read-request')
      ? [{ id, seasons: [2026], terminal: true, external_manager_id: '99', selected_resource_occurrence_id: marker }]
      : sql.includes('read-lists') ? [{ season: 2026, payload: [{ league_id: '11' }, { league_id: '22' }] }]
        : [{ season: 2026, external_league_id: '11', status: 'complete' }]);
    try {
      expect(await readPublicSleeperIntake(f.client, f.administration, id)).toEqual({ status: 'missing' });
      expect(f.query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("to_jsonb(request)->>'resource_occurrence_id'"), [id]);
      expect(typed).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('preserves ordinary and legacy-schema reads without leaking the nullable marker', async () => {
    const f = fixture(); const original = f.query.getMockImplementation()!;
    const legacy = await readPublicSleeperIntake(f.client, f.administration, id);
    f.query.mockImplementation(async sql => (await original(sql)).map(row => sql.includes('read-request')
      ? { ...row, selected_resource_occurrence_id: null } : row));
    expect(await readPublicSleeperIntake(f.client, f.administration, id)).toEqual({ ...legacy, readAt: expect.any(String) });
    if (legacy.status === 'missing') throw new Error('Expected ordinary intake');
    expect(legacy.request).not.toHaveProperty('selected_resource_occurrence_id');
  });
});

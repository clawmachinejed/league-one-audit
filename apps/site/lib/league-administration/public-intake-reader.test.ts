import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../database';
import { createLeagueAdministrationStore } from './store';
import { readPublicSleeperIntake } from './public-intake-reader';
import type { PublicIntakeReadOptions } from './public-intake-contracts';
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

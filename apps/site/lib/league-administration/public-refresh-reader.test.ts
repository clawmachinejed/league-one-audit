import { expect, it, vi } from 'vitest';
import type { Database } from '../database';
import { createLeagueAdministrationStore } from './store';
import { readPublicDataRefresh } from './public-refresh-reader';
import { readPublicSleeperIntake } from './public-intake-reader';
vi.mock('server-only', () => ({}));
vi.mock('./public-intake-reader', () => ({ readPublicSleeperIntake: vi.fn() }));

it('forwards stored history options to the immutable original refresh cycle request', async () => {
  const target = '00000000-0000-4000-8000-000000000001', intake = '00000000-0000-4000-8000-000000000002';
  const time = '2026-10-14T10:00:00Z';
  const query = vi.fn(async () => [{ id: target, provider: 'sleeper', source_manager_account_id: target, external_manager_id: '123',
    configuration_revision: 2, current_cycle: 1, next_due_at: time, last_served_at: null, selection_failure_count: 0,
    selection_failed_at: null, selection_next_eligible_at: time, identity_request_id: target, seasons: [2026],
    cadence_seconds: 60, expires_at: time, paused: false, configured_at: time,
    cycle_seasons: [2026], cycle_configuration_revision: 1, intake_id: intake,
    cycle_created_at: time, due_at: time, disposition: null }]);
  const client = { enabled: true, query } as unknown as Database;
  const administration = createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' });
  const options = { seasonHistoryVersion: 'v1' as const, periodInventoryPage: { afterOrdinal: 20, limit: 20 } };
  vi.mocked(readPublicSleeperIntake).mockResolvedValue({ status: 'pending', request: {} } as Awaited<ReturnType<typeof readPublicSleeperIntake>>);
  const result = await readPublicDataRefresh(client, administration, target, options);
  expect(readPublicSleeperIntake).toHaveBeenCalledExactlyOnceWith(client, administration, intake, options);
  expect(result).toMatchObject({ target: { configurationRevision: 2 }, cycle: { configurationRevision: 1, requestId: intake } });
  expect(query).toHaveBeenCalledTimes(1);
});

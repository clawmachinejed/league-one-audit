import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../../database';
import type { AdministrationWriteFence } from '../contracts';
import { normalizePlayerDirectoryCapture, normalizePlayerDirectoryRow } from '../player-directory';
import type { PlayerDirectoryAttempt } from '../player-directory-contracts';
import { playerDirectoryMethods, PLAYER_DIRECTORY_READ_SQL } from './player-directory';

vi.mock('server-only', () => ({}));
const at = '2026-10-10T01:00:00.000Z';
const attempt: PlayerDirectoryAttempt = { id: randomUUID(), nonce: randomUUID(), ordinal: 1, expectedGeneration: 0,
  reservedAt: '2026-10-10T00:59:59.999123+00:00' };
const owner: AdministrationWriteFence = { jobKey: 'league-administration-public-intake', workerId: randomUUID(), generation: 1,
  deadlineAt: '2026-10-10T01:00:20.000Z' };
function client(result: unknown) {
  const query = vi.fn(async () => result) as unknown as DatabaseClient['query'] & ReturnType<typeof vi.fn>;
  return { query, database: { enabled: true as const, query } };
}
function readFixture() {
  const native = normalizePlayerDirectoryRow('007', { player_id: '007', full_name: '', team: null, active: false,
    fantasy_positions: [], position: 'LB', injury_status: null, unknown_source: 0 });
  return { head_generation: 1, latest_attempt: { attemptId: attempt.id, ordinal: 1, reservedAt: attempt.reservedAt,
    status: 'complete', receiptId: randomUUID(), reasons: [] as string[], retryAt: '2026-10-11T01:00:00.000Z' },
  version_id: randomUUID(), generation: 1, accepted_at: at, receipt_id: randomUUID(), attempt_id: attempt.id,
  content_id: randomUUID(), source_revision: `sha256:${'a'.repeat(64)}`, row_count: 1, request_started_at: at,
  request_completed_at: at, source_observed_at: at, source_slice: { scope: 'all', endpoint: '/players/nfl', status: 'available',
    sourceRevision: `sha256:${'a'.repeat(64)}`, observedAt: at, complete: true, rowCount: 1, validRowCount: 1,
    invalidRowCount: 0, conflictRowCount: 0 }, native_rows: [native] };
}
describe('stored shared player directory boundary', () => {
  it('retains the database reservation precision and requires the existing owner before any SQL', async () => {
    const mock = client([{ result: { status: 'reserved', attempt } }]);
    const store = playerDirectoryMethods(mock.database);
    expect(await store.beginPlayerDirectoryAttempt(attempt.id, owner)).toEqual({ status: 'reserved', attempt });
    expect(mock.query.mock.calls[0][1]).toEqual([attempt.id, JSON.stringify(owner)]);
    mock.query.mockClear();
    await expect(store.beginPlayerDirectoryAttempt(attempt.id, undefined as unknown as AdministrationWriteFence)).rejects.toThrow('fence');
    expect(mock.query).not.toHaveBeenCalled();
  });
  it('passes original captures and immutable version results without adding observation timestamps', async () => {
    const capture = normalizePlayerDirectoryCapture({ attempt, rawJson: '{"007":{"player_id":"007","position":"LB"}}',
      requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, providerRequests: 1 });
    const result = { status: 'replayed', reason: 'exact_receipt_replay', receiptId: randomUUID(), contentId: randomUUID(),
      acceptedVersionId: randomUUID(), generation: 1 };
    const mock = client([{ result }]);
    expect(await playerDirectoryMethods(mock.database).recordPlayerDirectoryCapture(attempt, capture, owner)).toEqual(result);
    expect(mock.query.mock.calls[0][1]).toEqual([JSON.stringify(attempt), JSON.stringify(capture), JSON.stringify(owner)]);
  });
  it('reads source presence and unfamiliar positions from stored rows without acquiring a provider', async () => {
    const row = readFixture(); const mock = client([row]);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Reader must not use HTTP.'));
    try {
      const read = await playerDirectoryMethods(mock.database).readAcceptedPlayerDirectory({ versionId: row.version_id, playerIds: ['007'], limit: 1 });
      expect(read).toMatchObject({ status: 'available', rows: row.native_rows,
        version: { versionId: row.version_id, sourceObservedAt: at }, nextCursor: null });
      expect(mock.query.mock.calls[0]).toEqual([PLAYER_DIRECTORY_READ_SQL, [row.version_id, null, ['007'], 2]]);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('pins pages to the requested immutable version and validates typed parity', async () => {
    const row = readFixture(); row.native_rows.push(normalizePlayerDirectoryRow('008', { position: 'UNKNOWN' }));
    row.row_count = 2; row.source_slice.rowCount = 2; row.source_slice.validRowCount = 2;
    const mock = client([row]); const store = playerDirectoryMethods(mock.database);
    expect(await store.readAcceptedPlayerDirectory({ versionId: row.version_id, limit: 1 })).toMatchObject({ status: 'available', nextCursor: '007', rows: [row.native_rows[0]] });
    row.native_rows[0] = { ...row.native_rows[0], team: 'invented' };
    expect(await store.readAcceptedPlayerDirectory({ limit: 1 })).toEqual({ status: 'unavailable', reason: 'player_directory_evidence_unavailable' });
  });
  it('keeps latest failed or pending attempts separate from an accepted version', async () => {
    const row = readFixture(); row.latest_attempt.status = 'partial'; row.latest_attempt.reasons = ['invalid-player-rows'];
    expect(await playerDirectoryMethods(client([row]).database).readAcceptedPlayerDirectory()).toMatchObject({ status: 'available',
      latestAttempt: { status: 'partial' }, version: { versionId: row.version_id, sourceObservedAt: at } });
    expect(await playerDirectoryMethods(client([{ ...row, version_id: null }]).database).readAcceptedPlayerDirectory()).toMatchObject({ status: 'missing', latestAttempt: { status: 'partial' } });
  });
  it('rejects unbounded or mixed selection without database work', async () => {
    const mock = client([]); const store = playerDirectoryMethods(mock.database);
    for (const selection of [{ limit: 201 }, { limit: 0 }, { afterPlayerId: '007' }, { afterPlayerId: '007', playerIds: ['008'] },
      { playerIds: ['007', '007'] }, { playerIds: Array.from({ length: 201 }, (_, index) => String(index)) }]) {
      expect(await store.readAcceptedPlayerDirectory(selection)).toMatchObject({ status: 'unavailable' });
    }
    expect(mock.query).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createNeonAccountAcquisitionPort, createNeonAcquisitionSourcePort, createNeonSleeperPermitPort } from './discovery';
import type { AccountAuthorityDatabase } from './database';
import type { AuthReceiptV2 } from '../session-authority';
import type { DatabaseClient } from '../../database';
const id = '11111111-1111-4111-8111-111111111111';
const receipt = { testOnly: true } as unknown as AuthReceiptV2;
function account(value: unknown) {
  const finalTransaction = vi.fn(async () => ({ results: [[{ value }]], decisionTiming: { broader: 'auth-only' } }));
  const database = { transaction: vi.fn(), finalTransaction } as unknown as AccountAuthorityDatabase;
  return { port: createNeonAccountAcquisitionPort(database, id, receipt), finalTransaction };
}
describe('concrete acquisition port (offline database doubles only)', () => {
  it('uses the helper domain deadline instead of the broader final account deadline', async () => {
    const timing = { dbSampleAt: '2026-10-06T00:00:00.000Z', minimumAuthorityExpiresAt: '2026-10-06T00:00:01.000Z', remainingLifetimeMs: '1000' };
    const f = account({ result: { status: 'pending', demandId: id, retryAfterSeconds: 2 }, decisionTiming: timing });
    const result = await f.port.admit({ kind: 'identify', commandId: id, username: 'alice' });
    expect(result.decisionTiming).toEqual(timing);
    expect(f.finalTransaction).toHaveBeenCalledWith([{ statement: expect.stringContaining('admit_account_acquisition_v1'),
      parameters: [JSON.stringify({ kind: 'identify', commandId: id, username: 'alice' }), JSON.stringify(receipt)] }],
    { actorUserId: id, requestId: id, access: 'write' });
  });
  it.each([{ status: 'pending', demandId: 'foreign-invalid', retryAfterSeconds: 2 },
    { status: 'denied', reason: 'secret_database_detail' }, { status: 'pending', demandId: id, retryAfterSeconds: 2, extra: 'raw' }])(
    'refuses malformed or expanded SQL result instead of casting it', async result => {
      const f = account({ result, decisionTiming: null });
      await expect(f.port.read(id, id)).rejects.toThrow('Acquisition unavailable.');
    });
  it('binds identification-purpose polling in SQL', async () => {
    const f = account({ result: { status: 'pending', demandId: id, retryAfterSeconds: 2 }, decisionTiming: null });
    await f.port.read(id, id, 'identify');
    expect(f.finalTransaction.mock.calls[0]).toEqual([[{ statement: expect.stringContaining('$3::text'),
      parameters: [id, JSON.stringify(receipt), 'identify'] }], { actorUserId: id, requestId: id, access: 'read' }]);
  });
  it('treats unknown permit acknowledgement as unknown without retrying', async () => {
    const query = vi.fn(async () => { throw new Error('acknowledgement lost'); });
    const database = { enabled: true, query } as unknown as DatabaseClient;
    const request = { kind: 'target' } as Parameters<ReturnType<typeof createNeonSleeperPermitPort>['reserveCommitted']>[0];
    expect(await createNeonSleeperPermitPort(database).reserveCommitted(request)).toEqual({ commit: 'unknown' });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('does not retry or falsely confirm an unknown source commit', async () => {
    const query = vi.fn(async () => { throw new Error('acknowledgement lost'); });
    const database = { enabled: true, query } as unknown as DatabaseClient;
    const port = createNeonAcquisitionSourcePort(database, { jobKey: 'account-acquisition:test', workerId: 'worker', attemptCount: 1,
      leaseUntil: '2026-10-06T00:00:30.000Z' });
    expect(await port.recordCalendar({ request: { kind: 'target' } as Parameters<typeof port.recordCalendar>[0]['request'], permitId: id,
      rawValue: { league_season: '2026' }, normalizedValue: { leagueSeason: 2026 },
      requestStartedAt: '2026-10-06T00:00:00.000Z', requestCompletedAt: '2026-10-06T00:00:00.050Z' })).toEqual({ commit: 'unknown' });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ neon: vi.fn(), transaction: vi.fn(), query: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: mocks.neon }));
import { createAcquisitionDatabase } from './acquisition-database';
const url = 'postgresql://league_one_runtime:synthetic@ep-test.us-east-2.aws.neon.tech/test?sslmode=require';
const identity = { projectId: 'synthetic-project-123', branchId: 'br-test', tenantId: 'd'.repeat(32), timelineId: 'e'.repeat(32),
  databaseName: 'test', databaseOid: '123', clockDomain: `neon:${'d'.repeat(32)}:${'e'.repeat(32)}:123` };
const environment = { ACCOUNTS_ENABLED: 'true', DATABASE_URL: url, ACCOUNTS_DATABASE_IDENTITY: JSON.stringify(identity) };
beforeEach(() => {
  mocks.neon.mockReturnValue({ transaction: mocks.transaction });
  mocks.query.mockImplementation((statement, parameters) => ({ statement, parameters }));
  mocks.transaction.mockImplementation(async fn => { fn({ query: mocks.query }); return [[], [], [{ result: 'safe' }]]; });
});
afterEach(() => vi.resetAllMocks());
describe('restricted acquisition runtime transport', () => {
  it('validates URL and independent manifest before constructing client; guards every operation in its same transaction', async () => {
    const database = createAcquisitionDatabase(environment); expect(database.enabled).toBe(true);
    if (!database.enabled) throw new Error('Expected enabled test client');
    expect(await database.query('SELECT claim($1)', ['worker-a'])).toEqual([{ result: 'safe' }]);
    expect(mocks.query.mock.calls[1]).toEqual(['SELECT public.require_runtime_infrastructure_v1($1::jsonb)', [JSON.stringify(identity)]]);
    expect(mocks.query.mock.calls[2]).toEqual(['SELECT claim($1)', ['worker-a']]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    await database.query('SELECT read()'); expect(mocks.query.mock.calls[4][0]).toContain('require_runtime_infrastructure');
  });
  it.each([
    url.replace('league_one_runtime', 'neondb_owner'), url.replace('sslmode=require', 'sslmode=disable'),
    `${url}&sslmode=disable`, `${url}&sslmode=require`, `${url}&ssl=false`, `${url}&host=evil.example`,
    `${url}&options=-c%20role%3Dneondb_owner`, `${url}&channel_binding=disable`, `${url}#ignored`,
    url.replace('ep-test.us-east-2.aws.neon.tech', 'evil.example'), url.replace('/test?', '/other?'),
  ])('refuses unsafe credential configuration without creating or contacting driver', unsafe => {
    expect(createAcquisitionDatabase({ ...environment, DATABASE_URL: unsafe }).enabled).toBe(false);
    expect(mocks.neon).not.toHaveBeenCalled();
  });
  it.each([
    { ACCOUNTS_ENABLED: 'false' }, { VERCEL_ENV: 'preview' }, { ACCOUNTS_DATABASE_IDENTITY: '' },
    { ACCOUNTS_DATABASE_IDENTITY: JSON.stringify({ ...identity, clockDomain: 'forged' }) },
  ])('refuses disabled preview or unverified identity %j before credential use', overrides => {
    expect(createAcquisitionDatabase({ ...environment, ...overrides }).enabled).toBe(false);
    expect(mocks.neon).not.toHaveBeenCalled();
  });
  it('suppresses driver secrets and unknown acknowledgements without retry', async () => {
    mocks.transaction.mockRejectedValue(new Error('secret-url receipt lost'));
    const database = createAcquisitionDatabase(environment); if (!database.enabled) throw new Error('Expected client');
    await expect(database.query('SELECT claim()')).rejects.toThrow(/^Acquisition storage unavailable\.$/);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});

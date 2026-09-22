import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn(), neon: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: mock.neon }));
import { ACCOUNT_DATABASE_GUARD, AccountWriteRateLimitError, accountDatabaseUrl, createAccountDatabase } from './database';

const url = 'postgresql://league_one_account:test-secret@ep-isolated.example.neon.tech/test?sslmode=require';
const environment = { ACCOUNTS_ENABLED: 'true', ACCOUNT_DATABASE_URL: url };
afterEach(() => vi.clearAllMocks());
describe('private database composition', () => {
  it('rejects previews, dormant configuration, plaintext and privileged credentials before connecting', () => {
    for (const env of [{ ...environment, VERCEL_ENV: 'preview' }, { ...environment, ACCOUNTS_ENABLED: 'false' },
      { ...environment, ACCOUNT_DATABASE_URL: url.replace('league_one_account', 'neondb_owner') },
      { ...environment, ACCOUNT_DATABASE_URL: url.replace('?sslmode=require', '') }, { ...environment, ACCOUNT_DATABASE_URL: '' }]) {
      expect(accountDatabaseUrl(env)).toBeNull();
      expect(() => createAccountDatabase(env)).toThrow('unavailable');
    }
    expect(mock.neon).not.toHaveBeenCalled();
  });
  it('binds identity and request context transaction-locally after physical guards and before each query', async () => {
    mock.neon.mockReturnValue({ transaction: mock.transaction });
    mock.query.mockImplementation((statement, parameters) => ({ statement, parameters }));
    mock.transaction.mockImplementation(async (callback) => { callback({ query: mock.query }); return [[], [], [{ value: 7 }]]; });
    const database = createAccountDatabase(environment);
    const context = { actorUserId: '10000000-0000-4000-8000-000000000001', requestId: '20000000-0000-4000-8000-000000000001' };
    expect(await database.transaction([{ statement: 'SELECT private_value', parameters: [] }], context)).toEqual([[{ value: 7 }]]);
    expect(mock.query.mock.calls[0][0]).toBe(ACCOUNT_DATABASE_GUARD);
    expect(mock.query.mock.calls[1][0]).toContain("set_config('app.actor_user_id',$1,true)");
    expect(mock.query.mock.calls[1][1]).toEqual([context.actorUserId, context.requestId]);
    expect(mock.query.mock.calls[2][0]).toBe('SELECT private_value');
    expect(mock.transaction.mock.calls[0][1].isolationLevel).toBe('ReadCommitted');
    expect(mock.transaction.mock.calls[0][1].fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not carry an earlier actor into login resolution and sanitizes driver errors', async () => {
    mock.neon.mockReturnValue({ transaction: mock.transaction });
    mock.transaction.mockImplementation(async callback => { callback({ query: mock.query }); throw new Error(url); });
    await expect(createAccountDatabase(environment).transaction([{ statement: 'SELECT identity', parameters: [] }])).rejects.toThrow('Account storage is unavailable.');
    expect(mock.query.mock.calls[1][1]).toEqual(['', '']);
  });
  it('exposes only the reviewed rate-limit SQLSTATE as a retryable limit', async () => {
    mock.neon.mockReturnValue({ transaction: mock.transaction });
    mock.transaction.mockRejectedValue({ code: 'P4290', message: url });
    await expect(createAccountDatabase(environment).transaction([{ statement: 'UPDATE private', parameters: [] }])).rejects.toBeInstanceOf(AccountWriteRateLimitError);
    mock.transaction.mockRejectedValue({ code: '23505', message: url });
    await expect(createAccountDatabase(environment).transaction([{ statement: 'UPDATE private', parameters: [] }])).rejects.toThrow('Account storage is unavailable.');
  });
});

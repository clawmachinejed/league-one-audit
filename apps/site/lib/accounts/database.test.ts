import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn(), neon: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: mock.neon }));
import { ACCOUNT_DATABASE_GUARD, AccountWriteRateLimitError, accountDatabaseUrl, createAccountDatabase, createAccountAuthorityDatabase } from './database';

const url = 'postgresql://league_one_account:test-secret@ep-isolated.example.neon.tech/test?sslmode=require';
const identity = { projectId: 'synthetic-project-123', branchId: 'br-synthetic', tenantId: 'd'.repeat(32), timelineId: 'e'.repeat(32), databaseName: 'test', databaseOid: '123', clockDomain: 'neon:'+ 'd'.repeat(32)+':'+ 'e'.repeat(32)+':123' };
const environment = { ACCOUNTS_ENABLED: 'true', ACCOUNT_DATABASE_URL: url, ACCOUNTS_DATABASE_IDENTITY: JSON.stringify(identity) };
const receipt = { sessionId: 'session', subject: 'subject', expiresAt: '2030-01-01T00:00:00.000Z',
  issuer: 'https://example.test/api/auth', admissionEpochRevision: '1', configHash: 'a'.repeat(64),
  clockDomain: identity.clockDomain, admittedEmailDigest: 'b'.repeat(64), sessionTokenDigest: 'c'.repeat(64) };
afterEach(() => vi.clearAllMocks());
describe('private database composition', () => {
  it.each([
    url.replace('ep-isolated.example.neon.tech','unexpected.example.test'),
    url.replace('ep-isolated.example.neon.tech','localhost'),
    url.replace('neon.tech','neon.tech.evil.test'),
    url+'&sslmode=disable',url+'&sslmode=require',url+'&host=unexpected.example.test',
    url+'&options=-crole=owner',url+'&channel_binding=require&channel_binding=require',
    url+'&channel_binding=disable',url.replace('/test?','/%2ftest?'),url.replace('/test?','/?'),
    url.replace('.tech/','.tech:6543/'),url+'#fragment',
  ])('blocks ambiguous or external credential destinations before constructing the driver %#',value=>{
    const invalid={...environment,ACCOUNT_DATABASE_URL:value};
    expect(accountDatabaseUrl(invalid)).toBeNull();
    expect(()=>createAccountAuthorityDatabase(receipt,invalid)).toThrow('unavailable');
    expect(mock.neon).not.toHaveBeenCalled();
  });
  it('samples final SQL authority after domain work in the same committing transaction', async () => {
    const timing = { dbSampleAt: '2026-10-06T00:00:00.000Z', minimumAuthorityExpiresAt: receipt.expiresAt,
      remainingLifetimeMs: '102211200000' };
    mock.neon.mockReturnValue({ transaction: mock.transaction });
    mock.transaction.mockImplementation(async callback => {
      callback({ query: mock.query });
      return [[], [], [], [], [{}], [{ value: 7 }], [{ timing }]];
    });
    const result = await createAccountAuthorityDatabase(receipt, environment).finalTransaction([
      { statement: 'SELECT private_value', parameters: [] },
    ], { actorUserId: '10000000-0000-4000-8000-000000000001', requestId: '20000000-0000-4000-8000-000000000001' });
    expect(result).toEqual({ results: [[{ value: 7 }]], decisionTiming: timing });
    expect(mock.query.mock.calls[5][0]).toBe('SELECT private_value');
    expect(mock.query.mock.calls[6][0]).toBe('SELECT public.read_account_authority_timing_v2($1::jsonb) AS timing');
    expect(mock.transaction).toHaveBeenCalledOnce();
  });
  it('does not release an apparent result when final authority fails or timing is missing', async () => {
    mock.neon.mockReturnValue({ transaction: mock.transaction });
    const database = createAccountAuthorityDatabase(receipt, environment);
    const context = { actorUserId: '10000000-0000-4000-8000-000000000001', requestId: '20000000-0000-4000-8000-000000000001' };
    mock.transaction.mockRejectedValueOnce(new Error('expired final authority'));
    await expect(database.finalTransaction([{ statement: 'SELECT private_value', parameters: [] }], context)).rejects.toThrow('unavailable');
    mock.transaction.mockResolvedValueOnce([[], [], [], [], [{}], [{ sensitive: true }], []]);
    await expect(database.finalTransaction([{ statement: 'SELECT private_value', parameters: [] }], context)).rejects.toThrow('unavailable');
  });
  it('owns session locks in the same transaction as target SQL and strips authority sidecars', async () => {
    mock.neon.mockReturnValue({ transaction: mock.transaction });
    mock.query.mockImplementation((statement, parameters) => ({ statement, parameters }));
    mock.transaction.mockImplementation(async callback => {
      callback({ query: mock.query });
      return [[], [], [], [], [{ session_expires_at: receipt.expiresAt }], [{ value: 7 }]];
    });
    const database = createAccountAuthorityDatabase(receipt, environment);
    expect(await database.transaction([{ statement: 'SELECT target_helper()', parameters: [] }])).toEqual([[{ value: 7 }]]);
    expect(mock.transaction).toHaveBeenCalledOnce();
    expect(mock.query.mock.calls[3][0]).toContain("set_config('app.session_receipt_v2',$1,true)");
    expect(mock.query.mock.calls[4]).toEqual(['SELECT * FROM public.lock_account_session_authority_v2($1::jsonb)', [JSON.stringify(receipt)]]);
    expect(mock.query.mock.calls[5][0]).toBe('SELECT target_helper()');
  });
  it('does not return target data after failed or absent authority validation', async () => {
    mock.neon.mockReturnValue({ transaction: mock.transaction });
    mock.transaction.mockResolvedValue([[], [], [], [], [], [{ sensitive: true }]]);
    await expect(createAccountAuthorityDatabase(receipt, environment).transaction([
      { statement: 'SELECT target_helper()', parameters: [] },
    ])).rejects.toThrow('Account storage is unavailable.');
    mock.transaction.mockRejectedValue(new Error('synthetic credential-bearing failure'));
    await expect(createAccountAuthorityDatabase(receipt, environment).transaction([
      { statement: 'SELECT target_helper()', parameters: [] },
    ])).rejects.toThrow('Account storage is unavailable.');
  });
  it('binds and locks the actual actor and login for stored reads, not just DML', async () => {
    mock.neon.mockReturnValue({ transaction: mock.transaction });
    mock.transaction.mockImplementation(async callback => {
      callback({ query: mock.query });
      return [[], [], [], [], [{}], [{ value: 7 }]];
    });
    await createAccountAuthorityDatabase(receipt, environment).transaction([
      { statement: 'SELECT private_value', parameters: [] },
    ], { actorUserId: '10000000-0000-4000-8000-000000000001', requestId: '20000000-0000-4000-8000-000000000001' });
    expect(mock.query.mock.calls[4]).toEqual(['SELECT public.lock_account_actor_authority_v2($1::jsonb,$2::boolean)', [JSON.stringify(receipt), false]]);
    expect(mock.query.mock.calls[5][0]).toBe('SELECT private_value');
  });
  it('requests actor write ownership before a mutation instead of upgrading a shared actor lock', async () => {
    mock.neon.mockReturnValue({ transaction: mock.transaction });
    mock.transaction.mockImplementation(async callback => {
      callback({ query: mock.query });
      return [[], [], [], [], [{}], [{ value: 7 }]];
    });
    await createAccountAuthorityDatabase(receipt, environment).transaction([
      { statement: 'UPDATE private_value', parameters: [] },
    ], { actorUserId: '10000000-0000-4000-8000-000000000001', requestId: '20000000-0000-4000-8000-000000000001', access: 'write' });
    expect(mock.query.mock.calls[4]).toEqual(['SELECT public.lock_account_actor_authority_v2($1::jsonb,$2::boolean)', [JSON.stringify(receipt), true]]);
  });
  it('rejects an extra receipt field before connecting', () => {
    expect(() => createAccountAuthorityDatabase({ ...receipt, leakedToken: 'synthetic' } as typeof receipt, environment)).toThrow('unavailable');
    expect(mock.neon).not.toHaveBeenCalled();
  });
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

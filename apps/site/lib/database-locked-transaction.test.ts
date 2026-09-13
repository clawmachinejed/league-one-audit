import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ neon: vi.fn(), query: vi.fn(), transaction: vi.fn(),
  transactionQuery: vi.fn(), eagerAwait: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@neondatabase/serverless', () => ({ neon: calls.neon }));

import { createDatabase, withDatabaseAbortSignal } from './database';

const lock = { statement: 'SELECT fixture_lock($1)', parameters: ['owner'] };
const results = [[{ checked: true }], [{ stored: true }]];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VERCEL_ENV', 'production');
  calls.neon.mockReturnValue({ query: calls.query, transaction: calls.transaction });
  calls.transactionQuery.mockImplementation((statement: string, parameters: unknown[]) => ({
    statement, parameters,
    then: calls.eagerAwait.mockImplementation(() => { throw new Error('Query was awaited outside the transaction.'); }),
  }));
  calls.transaction.mockImplementation((build: (sql: { query: typeof calls.transactionQuery }) => unknown[]) => {
    const queries = build({ query: calls.transactionQuery });
    expect(queries).not.toBeInstanceOf(Promise);
    expect(queries).toHaveLength(2);
    return Promise.resolve(results);
  });
});
afterEach(() => vi.unstubAllEnvs());

function database() {
  const value = createDatabase('postgresql://fixture:fictional@localhost/transaction_test');
  if (!value.enabled || !value.queryAfterLock) throw new Error('Missing test transaction capability.');
  return value;
}

describe('Neon locked batch transaction', () => {
  it('submits lazy lock and batch queries in one explicit READ COMMITTED HTTP transaction', async () => {
    const controller = new AbortController();
    await expect(database().queryAfterLock!('INSERT fixture VALUES ($1)', [42], lock,
      { signal: controller.signal })).resolves.toEqual(results);
    expect(calls.transactionQuery.mock.calls).toEqual([
      [lock.statement, lock.parameters], ['INSERT fixture VALUES ($1)', [42]],
    ]);
    expect(calls.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted', fetchOptions: { signal: controller.signal },
    });
    expect(calls.query).not.toHaveBeenCalled();
    expect(calls.eagerAwait).not.toHaveBeenCalled();
  });

  it('propagates a rejected transaction without retries or unlocked fallback', async () => {
    calls.transaction.mockRejectedValueOnce(new Error('synthetic atomic rejection'));
    await expect(database().queryAfterLock!('INSERT fixture', [], lock))
      .rejects.toThrow('synthetic atomic rejection');
    expect(calls.transaction).toHaveBeenCalledOnce();
    expect(calls.query).not.toHaveBeenCalled();
  });

  it.each(['operation', 'caller'] as const)('forwards both deadlines when %s cancellation wins', async (winner) => {
    const operation = new AbortController();
    const caller = new AbortController();
    const scoped = withDatabaseAbortSignal(database(), operation.signal);
    if (!scoped.enabled) throw new Error('Missing scoped database.');
    await scoped.queryAfterLock!('INSERT fixture', [], lock, { signal: caller.signal });
    const options = calls.transaction.mock.calls[0][1];
    const signal = options.fetchOptions.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    (winner === 'operation' ? operation : caller).abort();
    expect(signal.aborted).toBe(true);
    expect(calls.query).not.toHaveBeenCalled();
  });

  it('does not start a transaction after the operation has already expired', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(database().queryAfterLock!('INSERT fixture', [], lock, { signal: controller.signal }))
      .rejects.toThrow();
    expect(calls.transaction).not.toHaveBeenCalled();
  });

  it('does not invent locked-transaction support on a query-only deadline view', () => {
    const scoped = withDatabaseAbortSignal({ enabled: true, query: async () => [] }, new AbortController().signal);
    expect(scoped.enabled && scoped.queryAfterLock).toBeUndefined();
  });

  it('rejects malformed transaction results', async () => {
    calls.transaction.mockResolvedValueOnce([[]]);
    await expect(database().queryAfterLock!('INSERT fixture', [], lock))
      .rejects.toThrow('invalid results');
  });
});

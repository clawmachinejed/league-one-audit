import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, withDatabaseAbortSignal } from './database';

const mock = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@neondatabase/serverless', () => ({ neon: () => mock }));
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('VERCEL_ENV', 'development'); });

describe('atomic locked database assertions', () => {
  it.each([false, true])('keeps two public result sets with postcondition=%s', async enabled => {
    mock.query.mockImplementation((statement: string, parameters: unknown[]) => ({ statement, parameters }));
    mock.transaction.mockImplementation(async (build: (client: typeof mock) => unknown[]) =>
      build(mock).map((_, index) => [{ index }]));
    const database = createDatabase('postgresql://fixture:synthetic@localhost/fixture');
    if (!database.enabled) throw new Error('Missing fixture database.');
    const signal = new AbortController().signal;
    const lock = { statement: 'lock', parameters: [1],
      ...(enabled ? { verifyAfter: { statement: 'assert-live', parameters: [3] } } : {}) };
    await expect(withDatabaseAbortSignal(database, signal).enabled).toBe(true);
    const view = withDatabaseAbortSignal(database, signal);
    if (!view.enabled) throw new Error('Missing fixture view.');
    await expect(view.queryAfterLock!('mutate', [2], lock)).resolves.toEqual([[{ index: 0 }], [{ index: 1 }]]);
    expect(mock.query.mock.calls).toEqual([['lock', [1]], ['mutate', [2]], ...(enabled ? [['assert-live', [3]]] : [])]);
    expect(mock.transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'ReadCommitted', fetchOptions: { signal } });
  });
  it('propagates a server postcondition rejection as failure of the whole transaction', async () => {
    mock.query.mockImplementation((statement: string) => statement);
    mock.transaction.mockImplementation(async (build: (client: typeof mock) => unknown[]) => {
      expect(build(mock)).toEqual(['lock', 'mutate', 'assert-live']);
      throw new Error('server rolled back: expired fence');
    });
    const database = createDatabase('postgresql://fixture:synthetic@localhost/fixture');
    if (!database.enabled) throw new Error('Missing fixture database.');
    await expect(database.queryAfterLock!('mutate', [], { statement: 'lock', parameters: [],
      verifyAfter: { statement: 'assert-live', parameters: [] } })).rejects.toThrow('expired fence');
  });
});

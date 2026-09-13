import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neonConfig } from '@neondatabase/serverless';

vi.mock('server-only', () => ({}));
import { createDatabase } from './database';

const previousFetch = neonConfig.fetchFunction;
const fetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network request'); }));
  neonConfig.fetchFunction = fetch;
});
afterEach(() => {
  neonConfig.fetchFunction = previousFetch;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function database() {
  const value = createDatabase('postgresql://fixture:fictional@ep-http-fixture.example.test/test?sslmode=require');
  if (!value.enabled || !value.queryAfterLock) throw new Error('Missing test transaction capability.');
  return value;
}

describe('installed Neon HTTP transaction transport', () => {
  it('sends both ordered statements in one HTTP request with isolation and cancellation', async () => {
    fetch.mockResolvedValueOnce(Response.json({ results: [
      { fields: [{ name: 'checked', dataTypeID: 16 }], rows: [['t']], rowCount: 1, command: 'SELECT' },
      { fields: [{ name: 'stored', dataTypeID: 23 }], rows: [['42']], rowCount: 1, command: 'SELECT' },
    ] }));
    const controller = new AbortController();
    const result = await database().queryAfterLock!('SELECT $1::integer AS stored', [42], {
      statement: 'SELECT fixture_lock($1) AS checked', parameters: ['owner'],
    }, { signal: controller.signal });
    expect(result).toEqual([[{ checked: true }], [{ stored: 42 }]]);
    expect(fetch).toHaveBeenCalledOnce();
    const options = fetch.mock.calls[0][1]!;
    expect(options.method).toBe('POST');
    expect(options.signal).toBe(controller.signal);
    expect(new Headers(options.headers).get('Neon-Batch-Isolation-Level')).toBe('ReadCommitted');
    expect(JSON.parse(String(options.body))).toEqual({ queries: [
      { query: 'SELECT fixture_lock($1) AS checked', params: ['owner'] },
      { query: 'SELECT $1::integer AS stored', params: ['42'] },
    ] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('propagates the atomic server rejection without making a second HTTP request', async () => {
    fetch.mockResolvedValueOnce(Response.json({ message: 'synthetic atomic rejection', code: '22012' }, { status: 400 }));
    await expect(database().queryAfterLock!('SELECT invalid_batch()', [], {
      statement: 'SELECT fixture_lock()', parameters: [],
    })).rejects.toMatchObject({ message: 'synthetic atomic rejection', code: '22012' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

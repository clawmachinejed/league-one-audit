import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handler: vi.fn(), query: vi.fn(), end: vi.fn(), release: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@neondatabase/serverless', () => ({ Pool: class {
  options = {};
  on() { return this; }
  async connect() { return { query: mocks.query, release: mocks.release }; }
  end = mocks.end;
} }));
vi.mock('better-auth', () => ({ betterAuth: () => ({ handler: mocks.handler }) }));

import { handleAccountAuth, type AccountAuthConfiguration } from './auth-runtime';

const config: AccountAuthConfiguration = {
  issuer: 'https://app.example.test/api/auth', appOrigin: 'https://app.example.test',
  secret: 'synthetic-secret-never-used-outside-this-test', databaseUrl: 'synthetic-unused-url',
  invitedEmails: new Set(['invited@example.test']), emailApiKey: 'synthetic-key', emailFrom: 'accounts@example.test',
};
const request = (path: string) => new Request(`${config.issuer}/${path}`, { method: 'POST' });
const statements = () => mocks.query.mock.calls.map(([statement]) => String(statement));

beforeEach(() => {
  mocks.handler.mockReset(); mocks.query.mockReset(); mocks.end.mockReset(); mocks.release.mockReset();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0, command: 'SELECT' });
  mocks.end.mockResolvedValue(undefined);
});

// These tests prove request/transaction orchestration and cleanup only. The
// isolated PostgreSQL suite proves lock concurrency and real atomic rollback.
describe('auth request transaction boundary', () => {
  it.each(['sign-in/email', 'reset-password'])('locks %s before entering the maintained handler and commits before returning success', async path => {
    mocks.handler.mockImplementation(async () => {
      expect(statements().some(value => value.includes('pg_advisory_xact_lock'))).toBe(true);
      return Response.json({ status: true });
    });
    expect((await handleAccountAuth(config, request(path))).status).toBe(200);
    expect(statements()[0]).toBe('begin');
    expect(statements().slice(-2)).toEqual(['select 1', 'commit']);
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('rolls back a maintained 500 response and releases the request connection', async () => {
    mocks.handler.mockResolvedValueOnce(Response.json({ code: 'INTERNAL_SERVER_ERROR' }, { status: 500 }));
    expect((await handleAccountAuth(config, request('reset-password'))).status).toBe(500);
    expect(statements().at(-1)).toBe('rollback');
    expect(statements()).not.toContain('commit');
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('rolls back thrown adapter failures without replacing them with success', async () => {
    mocks.handler.mockRejectedValueOnce(new Error('Synthetic adapter failure'));
    await expect(handleAccountAuth(config, request('reset-password'))).rejects.toThrow('Synthetic adapter failure');
    expect(statements().at(-1)).toBe('rollback');
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it.each([400, 401, 403, 429])('commits maintained HTTP %s so rate and OTP attempt counters survive rejection', async status => {
    mocks.handler.mockResolvedValueOnce(new Response(null, { status }));
    expect((await handleAccountAuth(config, request('sign-in/email'))).status).toBe(status);
    expect(statements().at(-1)).toBe('commit');
    expect(statements()).not.toContain('rollback');
  });
  it('rejects a transaction aborted by a swallowed driver failure before commit', async () => {
    mocks.handler.mockResolvedValueOnce(Response.json({ success: true }));
    mocks.query.mockImplementation(async statement => {
      if (statement === 'select 1') throw new Error('Synthetic aborted transaction');
      return { rows: [], rowCount: 0, command: 'SELECT' };
    });
    await expect(handleAccountAuth(config, request('sign-out'))).rejects.toThrow('Synthetic aborted transaction');
    expect(statements().at(-1)).toBe('rollback');
    expect(statements()).not.toContain('commit');
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('does not hold the credential lock during awaited reset-link delivery', async () => {
    mocks.handler.mockResolvedValueOnce(Response.json({ status: true }));
    await handleAccountAuth(config, request('request-password-reset'));
    expect(statements().some(value => value.includes('pg_advisory_xact_lock'))).toBe(false);
    expect(statements().at(-1)).toBe('commit');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocked = vi.hoisted(() => ({ preflight: vi.fn(), ownerQuery: vi.fn(), ownerClose: vi.fn(),
  query: vi.fn(), release: vi.fn(), end: vi.fn(), connect: vi.fn(), pool: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ Pool: mocked.pool }));
vi.mock('./neon-integration-harness', () => ({
  assertSafeIntegrationDatabase: mocked.preflight,
  createPinnedIntegrationDatabase: async () => ({ database: { query: mocked.ownerQuery }, close: mocked.ownerClose }),
  withAccountActor: vi.fn(),
}));
import { ACCOUNT_DATABASE_GUARD } from '../lib/accounts/neon/database';
import { createRealAccountLoginFixture, prepareSyntheticAccountSession } from './account-authority-fixture';

const receipt = { fixtureOnly: 'synthetic authority' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL', 'postgresql://league_one_account:synthetic@ep-test.example.test/integration_test?sslmode=require');
  mocked.preflight.mockResolvedValue(undefined);
  mocked.ownerClose.mockResolvedValue(undefined); mocked.end.mockResolvedValue(undefined);
  mocked.ownerQuery.mockImplementation(async (sql: string) => sql.startsWith('SELECT jsonb_build_object') ? [{ receipt }] : []);
  mocked.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT current_user')
    ? [{ current_role: 'league_one_account', session_role: 'league_one_account', pid: 101 }] : [] }));
  mocked.connect.mockResolvedValue({ query: mocked.query, release: mocked.release });
  mocked.pool.mockImplementation(function () { return { connect: mocked.connect, end: mocked.end, on: vi.fn() }; });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('no-network account race fixture safety (not SQL qualification)', () => {
  it('does not publish receipt until the synthetic auth transaction has committed', async () => {
    let commit!: () => void; let published = false;
    mocked.ownerQuery.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') await new Promise<void>(resolve => { commit = resolve; });
      return sql.startsWith('SELECT jsonb_build_object') ? [{ receipt }] : [];
    });
    const preparation = prepareSyntheticAccountSession('https://issuer.test', 'subject').then(result => { published = true; return result; });
    await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
    expect(published).toBe(false);
    commit();
    expect(await preparation).toBe(receipt);
    expect(mocked.ownerClose).toHaveBeenCalledOnce();
  });

  it('rolls back failed auth preparation instead of publishing uncommitted authority', async () => {
    mocked.ownerQuery.mockRejectedValueOnce(new Error('begin failed'));
    await expect(prepareSyntheticAccountSession('https://issuer.test', 'subject')).rejects.toThrow('begin failed');
    expect(mocked.ownerQuery).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocked.ownerClose).toHaveBeenCalledOnce();
  });

  it('does not open a pool when the guarded target preflight fails', async () => {
    mocked.preflight.mockRejectedValueOnce(new Error('unsafe target'));
    await expect(createRealAccountLoginFixture()).rejects.toThrow('unsafe target');
    expect(mocked.pool).not.toHaveBeenCalled();
  });

  it('has no owner credential or SET ROLE fallback for an absent real account credential', async () => {
    vi.stubEnv('ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL', '');
    await expect(createRealAccountLoginFixture()).rejects.toThrow('Actual account LOGIN');
    expect(mocked.pool).not.toHaveBeenCalled();
  });

  it('submits the application guard and validates both role results before the contender callback', async () => {
    const fixture = await createRealAccountLoginFixture();
    try {
      const callback = vi.fn(async (_query, pid) => {
        expect(mocked.query.mock.calls.map(([sql]) => sql)).toContain(ACCOUNT_DATABASE_GUARD);
        expect(mocked.query.mock.calls.some(([sql]) => /SET (LOCAL )?ROLE/u.test(sql))).toBe(false);
        return pid;
      });
      expect(await fixture.transaction({ receipt }, callback)).toBe(101);
      expect(mocked.query).toHaveBeenLastCalledWith('COMMIT');
      expect(mocked.release).toHaveBeenCalledExactlyOnceWith(false);
    } finally { await fixture.close(); }
  });

  it.each(['current_role', 'session_role'])('refuses an owner %s even if the other role is restricted', async role => {
    mocked.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT current_user')
      ? [{ current_role: 'league_one_account', session_role: 'league_one_account', pid: 101, [role]: 'neondb_owner' }] : [] }));
    const fixture = await createRealAccountLoginFixture(); const callback = vi.fn();
    try {
      await expect(fixture.transaction({ receipt }, callback)).rejects.toThrow('Isolated account LOGIN operation failed.');
      expect(callback).not.toHaveBeenCalled();
      expect(mocked.query).toHaveBeenLastCalledWith('ROLLBACK');
    } finally { await fixture.close(); }
  });

  it('rolls back and emits only the SQLSTATE when a contender fails', async () => {
    const fixture = await createRealAccountLoginFixture();
    try {
      await expect(fixture.transaction({ receipt }, async () => {
        throw Object.assign(new Error('sensitive driver context'), { code: '22012', detail: 'synthetic-secret' });
      })).rejects.toMatchObject({ code: '22012', message: 'Isolated account LOGIN operation failed.' });
      expect(mocked.query).toHaveBeenLastCalledWith('ROLLBACK');
    } finally { await fixture.close(); }
  });

  it('destroys a client whose rollback fails rather than returning an unknown transaction to the pool', async () => {
    const fixture = await createRealAccountLoginFixture();
    try {
      await expect(fixture.transaction({ receipt }, async () => {
        mocked.query.mockRejectedValueOnce(new Error('rollback connection lost'));
        throw new Error('operation failed');
      })).rejects.toThrow('Isolated account LOGIN operation failed.');
      expect(mocked.release).toHaveBeenCalledExactlyOnceWith(true);
    } finally { await fixture.close(); }
  });
});

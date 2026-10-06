import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ pool: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ Pool: mocked.pool }));
import { createIntegrationDatabaseOwnership, INTEGRATION_MUTEX } from './integration-database-ownership';

const environment = { ownerDatabaseUrl: 'postgresql://owner:fictional@ep-fixture.example.test/integration_test?sslmode=require',
  expectedDatabase: 'integration_test', expectedBranchId: 'br-integration-fixture' };
type Backend = EventEmitter & { pid: number; start: string; applicationName: string; query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>; end: () => void };
let backends: Map<number, Backend>;
let exclusive: number | undefined;
let shared: Set<number>;
let mutations: string[];
let sequence: number;
function backend(): Backend {
  const item = Object.assign(new EventEmitter(), { pid: ++sequence, start: '2026-09-23T00:00:00.000Z',
    applicationName: '', release: vi.fn(), query: vi.fn(), end: () => undefined });
  item.end = () => {
    backends.delete(item.pid); shared.delete(item.pid); if (exclusive === item.pid) exclusive = undefined;
    item.emit('end');
  };
  item.query.mockImplementation(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('pg_try_advisory_lock_shared')) {
      const owned = exclusive === undefined || exclusive === item.pid;
      if (owned) shared.add(item.pid);
      return { rows: [{ owned }] };
    }
    if (sql.includes('pg_try_advisory_lock(')) {
      const owned = (exclusive === undefined || exclusive === item.pid) && [...shared].every(pid => pid === item.pid);
      if (owned) exclusive = item.pid;
      return { rows: [{ owned }] };
    }
    if (sql.includes('pg_advisory_unlock_shared')) return { rows: [{ unlocked: shared.delete(item.pid) }] };
    if (sql.includes('pg_advisory_unlock(')) {
      const unlocked = exclusive === item.pid; if (unlocked) exclusive = undefined;
      return { rows: [{ unlocked }] };
    }
    if (sql.includes("set_config('application_name'")) item.applicationName = String(parameters[0]);
    if (sql.startsWith('SELECT pid,')) return { rows: [{ pid: item.pid, backendStart: item.start }] };
    if (sql.startsWith('SELECT EXISTS')) {
      const owner = backends.get(Number(parameters[0]));
      return { rows: [{ owned: Boolean(owner && owner.applicationName === parameters[1] && owner.start === parameters[2]
        && parameters[3] === INTEGRATION_MUTEX && parameters[4] === environment.expectedDatabase
        && parameters[5] === environment.expectedBranchId
        && (parameters[6] === 'ShareLock' ? shared.has(owner.pid) : exclusive === owner.pid)) }] };
    }
    if (sql.startsWith('DROP ')) mutations.push(sql);
    return { rows: [] };
  });
  backends.set(item.pid, item);
  return item;
}
function parentProof(parent: Backend, mode = 'ShareLock') {
  parent.applicationName = 'capacity-owner-12345678-1234-1234-1234-123456789abc';
  return JSON.stringify({ database: environment.expectedDatabase, branch: environment.expectedBranchId,
    pid: parent.pid, backendStart: parent.start, applicationName: parent.applicationName, lockMode: mode });
}

function abortTransactionOn(item: Backend, statement: string, failure: Error) {
  const execute = item.query.getMockImplementation()!;
  let aborted = false;
  item.query.mockImplementation(async (sql: string, parameters: unknown[] = []) => {
    if (sql === statement) { aborted = true; throw failure; }
    if (sql === 'ROLLBACK') aborted = false;
    if (aborted) throw Object.assign(new Error('current transaction is aborted'), { code: '25P02' });
    return Reflect.apply(execute, undefined, [sql, parameters]);
  });
}

beforeEach(() => {
  vi.resetAllMocks(); backends = new Map(); exclusive = undefined; shared = new Set(); mutations = []; sequence = 0;
  mocked.pool.mockImplementation(function () {
    const item = backend();
    return Object.assign(new EventEmitter(), { connect: vi.fn(async () => item), end: vi.fn(async () => item.end()) });
  });
});

describe('shared destructive integration ownership', () => {
  it('does not issue DROP after cancellation during the delegated ownership verification await', async () => {
    const parent = backend(); shared.add(parent.pid);
    const owner = createIntegrationDatabaseOwnership();
    const controller = new AbortController();
    const session = await owner.acquire(environment, parentProof(parent), controller.signal);
    const pinned = [...backends.values()].find(item => item !== parent)!;
    const execute = pinned.query.getMockImplementation()!;
    pinned.query.mockImplementation(async (sql: string, parameters: unknown[] = []) => {
      const result = await Reflect.apply(execute, undefined, [sql, parameters]);
      if (sql.startsWith('SELECT EXISTS')) controller.abort(new Error('phase deadline'));
      return result;
    });
    await expect(session.query('DROP SCHEMA fixture_after_deadline')).rejects.toThrow('phase deadline');
    expect(mutations).toEqual([]);
    await owner.release();
  });

  it('rejects a second ordinary preparation before a reset and retains ownership through cleanup', async () => {
    const first = createIntegrationDatabaseOwnership(); const second = createIntegrationDatabaseOwnership();
    const session = await first.acquire(environment);
    await session.query('DROP SCHEMA fixture_first');
    expect(await first.acquire(environment)).toBe(session);
    await expect(second.acquire(environment)).rejects.toMatchObject({ code: 'INTEGRATION_DATABASE_BUSY' });
    expect(mutations).toEqual(['DROP SCHEMA fixture_first']);
    await session.query('DROP SCHEMA fixture_cleanup');
    expect(exclusive).toBeDefined();
    await first.release();
    await second.acquire(environment); await second.release();
    expect(exclusive).toBeUndefined(); expect(backends.size).toBe(0);
  });

  it('uses the same pinned connection for migration transactions without releasing its lock', async () => {
    const owner = createIntegrationDatabaseOwnership(); const session = await owner.acquire(environment);
    expect(mocked.pool).toHaveBeenCalledWith({ connectionString: environment.ownerDatabaseUrl, max: 1,
      connectionTimeoutMillis: 10_000, statement_timeout: 60_000, query_timeout: 75_000 });
    const migration = await session.connect();
    await migration.query('BEGIN'); await migration.query('COMMIT'); migration.release();
    expect(exclusive).toBe(1); expect(backends.get(1)?.release).not.toHaveBeenCalled();
    await owner.release(); expect(backends.size).toBe(0);
  });

  it('pins a delegated shared lock so parent loss cannot allow a competing reset', async () => {
    const parent = backend(); shared.add(parent.pid);
    const child = createIntegrationDatabaseOwnership();
    const session = await child.acquire(environment, parentProof(parent));
    expect(shared.size).toBe(2);
    parent.end();
    await expect(createIntegrationDatabaseOwnership().acquire(environment))
      .rejects.toMatchObject({ code: 'INTEGRATION_DATABASE_BUSY' });
    await expect(session.query('DROP SCHEMA must_not_run')).rejects.toThrow();
    expect(mutations).toEqual([]); expect(shared.size).toBe(1);
    await child.release(); expect(shared.size).toBe(0);
    await expect(child.acquire(environment)).rejects.toThrow('session was lost');
  });

  it('rolls back an aborted delegated transaction on its pinned session and preserves the migration error', async () => {
    const parent = backend(); shared.add(parent.pid);
    const child = createIntegrationDatabaseOwnership();
    const session = await child.acquire(environment, parentProof(parent));
    const pinned = backends.get(2)!;
    const failure = Object.assign(new Error('syntax error at end of input'), { code: '42601' });
    abortTransactionOn(pinned, 'invalid migration', failure);
    const migration = await session.connect();
    const apply = async () => {
      try { await migration.query('BEGIN'); await migration.query('invalid migration'); }
      catch (error) { await migration.query('ROLLBACK'); throw error; }
      finally { migration.release(); }
    };
    await expect(apply()).rejects.toBe(failure);
    expect(pinned.query.mock.calls.slice(-2).map(call => call[0])).toEqual(['invalid migration', 'ROLLBACK']);
    expect(shared.size).toBe(2);
    await session.query('DROP SCHEMA fixture_cleanup');
    expect(pinned.query.mock.calls.at(-2)?.[0]).toMatch(/^SELECT EXISTS/u);
    expect(mutations).toEqual(['DROP SCHEMA fixture_cleanup']);
    await child.release(); parent.end();
    expect(mocked.pool).toHaveBeenCalledTimes(1); expect(backends.size).toBe(0);
  });

  it('permits only local rollback after delegated parent loss and still blocks the next schema operation', async () => {
    const parent = backend(); shared.add(parent.pid);
    const child = createIntegrationDatabaseOwnership();
    const session = await child.acquire(environment, parentProof(parent));
    const pinned = backends.get(2)!;
    abortTransactionOn(pinned, 'invalid migration', new Error('migration failed'));
    await expect(session.query('invalid migration')).rejects.toThrow('migration failed');
    parent.end();
    await session.query('ROLLBACK');
    expect(shared.size).toBe(1);
    await expect(session.query('DROP SCHEMA must_not_run')).rejects.toThrow();
    expect(() => session.query('ROLLBACK')).toThrow('session was lost');
    await child.release();
    await expect(child.acquire(environment)).rejects.toThrow('session was lost');
    expect(mocked.pool).toHaveBeenCalledTimes(1); expect(mutations).toEqual([]);
  });

  it.each(['ROLLBACK; DROP SCHEMA must_not_run', 'ROLLBACK TO SAVEPOINT fixture', { text: 'ROLLBACK' }])
    ('does not bypass ownership for a rollback variant %j', async statement => {
      const parent = backend(); shared.add(parent.pid);
      const child = createIntegrationDatabaseOwnership();
      const session = await child.acquire(environment, parentProof(parent));
      const pinned = backends.get(2)!;
      parent.end();
      await expect(session.query(statement)).rejects.toThrow();
      expect(pinned.query.mock.calls.some(call => call[0] === statement)).toBe(false);
      expect(mutations).toEqual([]);
      await child.release();
    });

  it('does not reset for a missing owner, stale proof or old exclusive-only wrapper', async () => {
    const parent = backend(); exclusive = parent.pid;
    await expect(createIntegrationDatabaseOwnership().acquire(environment, parentProof(parent, 'ExclusiveLock')))
      .rejects.toThrow();
    await expect(createIntegrationDatabaseOwnership().acquire(environment, parentProof(parent)))
      .rejects.toThrow();
    parent.end();
    await expect(createIntegrationDatabaseOwnership().acquire(environment, parentProof(parent)))
      .rejects.toThrow();
    expect(mutations).toEqual([]); expect(shared.size).toBe(0);
  });

  it.each(['error', 'end'])('makes a lost pinned %s session terminal instead of reconnecting', async event => {
    const owner = createIntegrationDatabaseOwnership(); const session = await owner.acquire(environment);
    const item = backends.get(1)!; item.emit(event, new Error('synthetic loss'));
    expect(() => session.query('DROP SCHEMA must_not_run')).toThrow('session was lost');
    await owner.release();
    await expect(owner.acquire(environment)).rejects.toThrow('session was lost');
    expect(mocked.pool).toHaveBeenCalledTimes(1); expect(mutations).toEqual([]);
  });

  it.each(['ep-fixture-pooler.', 'EP-FIXTURE-POOLER.'])('rejects pooled owner endpoint %s before constructing a session', async pooledHost => {
    await expect(createIntegrationDatabaseOwnership().acquire({ ...environment,
      ownerDatabaseUrl: environment.ownerDatabaseUrl.replace('ep-fixture.', pooledHost) })).rejects.toThrow('direct owner');
    expect(mocked.pool).not.toHaveBeenCalled();
  });

  it('does not silently switch target or delegation while a test body owns the session', async () => {
    const owner = createIntegrationDatabaseOwnership(); await owner.acquire(environment);
    await expect(owner.acquire({ ...environment, expectedDatabase: 'other_test' })).rejects.toThrow('target changed');
    const targetError = await owner.acquire({ ...environment,
      ownerDatabaseUrl: environment.ownerDatabaseUrl.replace('fictional', 'different-secret') }).catch(error => error);
    expect(targetError).toBeInstanceOf(Error);
    expect(`${targetError.message}\n${inspect(targetError)}`).not.toContain(environment.ownerDatabaseUrl);
    expect(`${targetError.message}\n${inspect(targetError)}`).not.toMatch(/fictional|different-secret|postgresql:/u);
    await expect(owner.acquire(environment, '{}')).rejects.toThrow('delegation changed');
    expect(mutations).toEqual([]); await owner.release();
  });
});

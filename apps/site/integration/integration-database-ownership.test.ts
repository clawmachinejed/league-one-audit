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

beforeEach(() => {
  vi.resetAllMocks(); backends = new Map(); exclusive = undefined; shared = new Set(); mutations = []; sequence = 0;
  mocked.pool.mockImplementation(function () {
    const item = backend();
    return Object.assign(new EventEmitter(), { connect: vi.fn(async () => item), end: vi.fn(async () => item.end()) });
  });
});

describe('shared destructive integration ownership', () => {
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

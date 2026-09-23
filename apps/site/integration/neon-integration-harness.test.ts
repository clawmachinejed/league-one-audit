import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn(), end: vi.fn(),
  connect: vi.fn(), sessionQuery: vi.fn(), release: vi.fn(), readdir: vi.fn(), readFile: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ Pool: mocked.pool }));
vi.mock('node:fs/promises', () => ({ readdir: mocked.readdir, readFile: mocked.readFile }));

import {
  accountQuery,
  assertSafeIntegrationDatabase,
  cleanIntegrationDatabase,
  createIndependentDatabase,
  createPinnedIntegrationDatabase,
  integrationEnvironment,
  prepareIntegrationDatabase,
  withAccountActor,
  withAuthRole,
  type IntegrationEnvironment,
} from './neon-integration-harness';

// Fictional targets only. This suite must never instantiate a real database client.
const ownerUrl = 'postgresql://fixture_owner:fixture_password@ep-integration-fixture.example.test/projection_test?sslmode=require';
const runtimeUrl = ownerUrl.replace('fixture_owner', 'league_one_runtime').replace('ep-integration-fixture.', 'ep-integration-fixture-pooler.');
const fixture: IntegrationEnvironment = {
  ownerDatabaseUrl: ownerUrl,
  runtimeDatabaseUrl: runtimeUrl,
  expectedDatabase: 'projection_test',
  expectedBranchId: 'br-integration-fixture',
  expectedBranchName: 'projection-integration-test',
  databaseSentinel: 'fictional-integration-sentinel-only',
  productionDenylist: new Set(['main', 'neondb', 'br-production-fixture', 'ep-production-fixture.example.test']),
};

function configureEnvironment() {
  for (const [name, value] of Object.entries({
    ENV_FILE: '.env.integration.local',
    AUTHORIZATION: 'I_ACKNOWLEDGE_THIS_RESETS_AN_ISOLATED_DATABASE',
    OWNER_DATABASE_URL: ownerUrl,
    RUNTIME_DATABASE_URL: runtimeUrl,
    EXPECTED_DATABASE: fixture.expectedDatabase,
    EXPECTED_BRANCH_ID: fixture.expectedBranchId,
    EXPECTED_BRANCH_NAME: fixture.expectedBranchName,
    DATABASE_SENTINEL: fixture.databaseSentinel,
    PRODUCTION_DENYLIST: [...fixture.productionDenylist].join(','),
  })) vi.stubEnv(`PROJECTION_INTEGRATION_${name}`, value);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PROJECTION_INTEGRATION_SETUP_PROOF', undefined);
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PRODUCTION_DATABASE_URL',
    'ACCOUNT_DATABASE_URL', 'ACCOUNTS_AUTH_DATABASE_URL']) {
    vi.stubEnv(name, undefined);
  }
  configureEnvironment();
  mocked.end.mockResolvedValue(undefined);
  mocked.sessionQuery.mockImplementation(async (statement: string) => ({
    rows: statement === 'SHOW transaction_isolation' ? [{ transaction_isolation: 'read committed' }] : [],
  }));
  mocked.connect.mockResolvedValue({ query: mocked.sessionQuery, release: mocked.release });
  mocked.pool.mockImplementation(function (configuration: { connectionString: string }) {
    const user = new URL(configuration.connectionString).username;
    return {
      query: (statement: string) => mocked.query(statement, user),
      connect: mocked.connect,
      end: mocked.end,
    };
  });
  mocked.query.mockImplementation(async (_statement: string, user: string) => ({ rows: [{
    database_name: fixture.expectedDatabase,
    database_user: user,
    database_comment: JSON.stringify({
      purpose: 'league-one-projection-store-integration',
      sentinel: fixture.databaseSentinel,
      branchId: fixture.expectedBranchId,
      branchName: fixture.expectedBranchName,
    }),
  }] }));
});

afterEach(() => vi.unstubAllEnvs());

function mockAccountProvisioning(options: { ownerRole?: string; canSetRole?: boolean; includeAuth?: boolean } = {}) {
  mocked.readdir.mockResolvedValue(['001_fixture.sql', '020_account_foundation.sql',
    ...(options.includeAuth ? ['021_website_auth.sql'] : [])]);
  mocked.readFile.mockImplementation(async (filename: string) => {
    if (filename.endsWith('provision-runtime-role.sql')) return 'fixture-runtime-provision';
    if (filename.endsWith('provision-account-role.sql')) return 'fixture-account-provision';
    if (filename.endsWith('provision-auth-role.sql')) return 'fixture-auth-provision';
    return 'fixture-migration';
  });
  const identityQuery = mocked.query.getMockImplementation()!;
  mocked.query.mockImplementation(async (statement: string, user: string) => {
    if (statement.includes('AS relation_count')) return { rows: [{ relation_count: 0 }] };
    if (statement.includes('AS owner_role')) return { rows: [{ owner_role: options.ownerRole ?? decodeURIComponent(user) }] };
    if (statement.includes('AS can_set_private_role')) return { rows: [{ can_set_private_role: options.canSetRole ?? true }] };
    return identityQuery(statement, user);
  });
}

describe('isolated account-role transactions', () => {
  it.each([
    { options: {}, expectedAccountProvision: true },
    { options: { throughMigration: '001_fixture.sql' }, expectedAccountProvision: false },
    { options: { provisionAccountRole: false }, expectedAccountProvision: false },
  ])('provisions account permissions only for an included account schema (%j)', async ({ options, expectedAccountProvision }) => {
    mockAccountProvisioning();
    await prepareIntegrationDatabase(options);
    const statements = mocked.query.mock.calls.map(([statement]) => statement);
    const runtimeIndex = statements.indexOf('fixture-runtime-provision');
    expect(runtimeIndex).toBeGreaterThan(-1);
    expect(statements.includes('fixture-account-provision')).toBe(expectedAccountProvision);
    if (expectedAccountProvision) {
      expect(statements.indexOf('fixture-account-provision')).toBeGreaterThan(runtimeIndex);
      const grantIndex = statements.indexOf('GRANT league_one_account TO "fixture_owner" WITH SET TRUE');
      expect(grantIndex).toBeGreaterThan(statements.indexOf('fixture-account-provision'));
      expect(statements.findIndex(statement => statement.includes('AS can_set_private_role'))).toBeGreaterThan(grantIndex);
    } else {
      expect(statements.some(statement => statement.startsWith('GRANT league_one_account'))).toBe(false);
    }
  });

  it('quotes the catalog-verified owner identifier without changing grant direction', async () => {
    vi.stubEnv('PROJECTION_INTEGRATION_OWNER_DATABASE_URL', ownerUrl.replace('fixture_owner', 'fixture%22owner'));
    mockAccountProvisioning();
    await prepareIntegrationDatabase();
    const grants = mocked.query.mock.calls.map(([statement]) => statement)
      .filter(statement => statement.startsWith('GRANT '));
    expect(grants).toEqual(['GRANT league_one_account TO "fixture""owner" WITH SET TRUE']);
  });

  it('rejects an unexpected catalog owner before granting account role access', async () => {
    mockAccountProvisioning({ ownerRole: 'unexpected_owner' });
    await expect(prepareIntegrationDatabase()).rejects.toThrow('does not match the verified owner identity');
    expect(mocked.query.mock.calls.some(([statement]) => statement.startsWith('GRANT '))).toBe(false);
    expect(process.env.PROJECTION_INTEGRATION_SETUP_PROOF).toBeUndefined();
  });

  it('requires positive server verification of account SET permission before claiming setup success', async () => {
    mockAccountProvisioning({ canSetRole: false });
    await expect(prepareIntegrationDatabase()).rejects.toThrow('could not verify permission');
    expect(process.env.PROJECTION_INTEGRATION_SETUP_PROOF).toBeUndefined();
    expect(mocked.end).toHaveBeenCalledTimes(3);
  });

  it.each([{}, { actorUserId: 'fixture-actor', requestId: 'fixture-request' }])(
    'pins role, local context, and query until commit (%j)', async (context) => {
      mocked.sessionQuery.mockImplementation(async (statement: string) => ({
        rows: statement === 'SELECT fixture_value WHERE id = $1' ? [{ fixture_value: 7 }] : [],
      }));
      await expect(accountQuery('SELECT fixture_value WHERE id = $1', [5], context))
        .resolves.toEqual([{ fixture_value: 7 }]);
      expect(mocked.sessionQuery.mock.calls).toEqual([
        ['BEGIN ISOLATION LEVEL READ COMMITTED'],
        ['SET LOCAL ROLE league_one_account'],
        ["SELECT set_config('app.actor_user_id', $1, true), set_config('app.request_id', $2, true)",
          [context.actorUserId ?? '', context.requestId ?? '']],
        ['SELECT fixture_value WHERE id = $1', [5]],
        ['COMMIT'],
      ]);
      expect(mocked.query).toHaveBeenCalledTimes(2);
      expect(mocked.pool).toHaveBeenLastCalledWith({ connectionString: ownerUrl, max: 1 });
      expect(mocked.connect).toHaveBeenCalledOnce();
      expect(mocked.release).toHaveBeenCalledOnce();
      expect(mocked.end).toHaveBeenCalledTimes(3);
    },
  );

  it.each(['SET LOCAL ROLE league_one_account', 'SELECT set_config', 'account-write'])(
    'rolls back and closes the pinned connection after a failure in %s', async (failure) => {
      mocked.sessionQuery.mockImplementation(async (statement: string) => {
        if (statement.startsWith(failure)) throw new Error('synthetic account rejection');
        return { rows: [] };
      });
      await expect(accountQuery('account-write')).rejects.toThrow('synthetic account rejection');
      const statements = mocked.sessionQuery.mock.calls.map(([statement]) => statement);
      expect(statements.at(-1)).toBe('ROLLBACK');
      expect(statements).not.toContain('COMMIT');
      expect(mocked.release).toHaveBeenCalledOnce();
      expect(mocked.end).toHaveBeenCalledTimes(3);
    },
  );

  it('rolls back callback failures even when prior SQL succeeded', async () => {
    await expect(withAccountActor({}, async (query) => {
      await query('account-write');
      throw new Error('synthetic application rejection');
    })).rejects.toThrow('synthetic application rejection');
    expect(mocked.sessionQuery).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocked.release).toHaveBeenCalledOnce();
  });

  it('requires the existing explicit authorization before opening connections', async () => {
    vi.stubEnv('PROJECTION_INTEGRATION_AUTHORIZATION', undefined);
    const run = vi.fn();
    await expect(withAccountActor({}, run)).rejects.toThrow('authorization');
    expect(mocked.pool).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('requires both server identity guards before starting an account transaction', async () => {
    mocked.query.mockResolvedValue({ rows: [{
      database_name: fixture.expectedDatabase,
      database_user: 'fixture_owner',
      database_comment: JSON.stringify({
        purpose: 'league-one-projection-store-integration', sentinel: 'wrong-sentinel',
        branchId: fixture.expectedBranchId, branchName: fixture.expectedBranchName,
      }),
    }] });
    const run = vi.fn();
    await expect(withAccountActor({}, run)).rejects.toThrow('database-reported integration identity');
    expect(mocked.query).toHaveBeenCalledTimes(2);
    expect(mocked.connect).not.toHaveBeenCalled();
    expect(mocked.end).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });

  it('closes the owner pool when checking out an account connection fails', async () => {
    mocked.connect.mockRejectedValueOnce(new Error('synthetic connection failure'));
    await expect(accountQuery('account-write')).rejects.toThrow('synthetic connection failure');
    expect(mocked.end).toHaveBeenCalledTimes(3);
    expect(mocked.release).not.toHaveBeenCalled();
  });

  it('keeps concurrent actor contexts on separate pinned sessions', async () => {
    const sessions: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }[] = [];
    mocked.connect.mockImplementation(async () => {
      let actorUserId: unknown;
      const session = {
        query: vi.fn(async (statement: string, parameters: unknown[] = []) => {
          if (statement.startsWith('SELECT set_config')) actorUserId = parameters[0];
          return { rows: statement === 'read-actor' ? [{ actorUserId }] : [] };
        }),
        release: vi.fn(),
      };
      sessions.push(session);
      return session;
    });
    const ready = Promise.withResolvers<void>();
    let arrived = 0;
    const results = await Promise.all(['fixture-alice', 'fixture-bob'].map((actorUserId) => (
      withAccountActor({ actorUserId }, async (query) => {
        arrived += 1;
        if (arrived === 2) ready.resolve();
        await ready.promise;
        return query('read-actor');
      })
    )));
    expect(results).toEqual([[{ actorUserId: 'fixture-alice' }], [{ actorUserId: 'fixture-bob' }]]);
    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      expect(session.query).toHaveBeenLastCalledWith('COMMIT');
      expect(session.release).toHaveBeenCalledOnce();
    }
    expect(mocked.end).toHaveBeenCalledTimes(6);
  });
});

describe('isolated maintained-auth database boundaries', () => {
  it.each([
    { options: {}, expected: true },
    { options: { throughMigration: '020_account_foundation.sql' }, expected: false },
    { options: { provisionAuthRole: false }, expected: false },
  ])('grants auth role only when its migration and provisioning are selected (%j)', async ({ options, expected }) => {
    mockAccountProvisioning({ includeAuth: true });
    await prepareIntegrationDatabase(options);
    const statements = mocked.query.mock.calls.map(([statement]) => statement);
    expect(statements.includes('fixture-auth-provision')).toBe(expected);
    expect(statements.includes('GRANT league_one_auth TO "fixture_owner" WITH SET TRUE')).toBe(expected);
    if (expected) {
      expect(statements.indexOf('fixture-auth-provision')).toBeGreaterThan(statements.indexOf('fixture-account-provision'));
    }
    expect(JSON.parse(process.env.PROJECTION_INTEGRATION_SETUP_PROOF!)).toMatchObject({
      emptyBeforeMigration: true, resetSchemas: ['public', 'website_auth'],
    });
  });

  it('cleans both fixed application schemas after revalidating identity, without touching managed auth', async () => {
    await cleanIntegrationDatabase();
    const statements = mocked.query.mock.calls.map(([statement]) => statement);
    expect(statements.slice(2)).toEqual(['DROP SCHEMA IF EXISTS website_auth CASCADE',
      'DROP SCHEMA IF EXISTS public CASCADE', 'CREATE SCHEMA public', 'REVOKE CREATE ON SCHEMA public FROM PUBLIC']);
    expect(statements.some(statement => statement.includes('neon_auth'))).toBe(false);
  });

  it('does not clean either schema when the target authorization is absent', async () => {
    vi.stubEnv('PROJECTION_INTEGRATION_AUTHORIZATION', undefined);
    await expect(cleanIntegrationDatabase()).rejects.toThrow('authorization');
    expect(mocked.pool).not.toHaveBeenCalled();
  });

  it('refuses residual objects from either schema before applying any migration', async () => {
    mockAccountProvisioning({ includeAuth: true });
    const query = mocked.query.getMockImplementation()!;
    mocked.query.mockImplementation(async (statement: string, user: string) => statement.includes('AS relation_count')
      ? { rows: [{ relation_count: 1 }] } : query(statement, user));
    await expect(prepareIntegrationDatabase()).rejects.toThrow('schemas were not empty');
    expect(mocked.sessionQuery).not.toHaveBeenCalled();
    expect(process.env.PROJECTION_INTEGRATION_SETUP_PROOF).toBeUndefined();
  });

  it.each([false, true])('pins auth role through commit or rollback without account actor context (failure=%s)', async failure => {
    mocked.sessionQuery.mockImplementation(async (statement: string) => {
      if (failure && statement === 'auth-write') throw new Error('synthetic auth rejection');
      return { rows: [] };
    });
    const result = withAuthRole(query => query('auth-write'));
    if (failure) await expect(result).rejects.toThrow('synthetic auth rejection');
    else await expect(result).resolves.toEqual([]);
    expect(mocked.sessionQuery.mock.calls.map(([statement]) => statement)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', 'SET LOCAL ROLE league_one_auth', 'auth-write',
      failure ? 'ROLLBACK' : 'COMMIT',
    ]);
    expect(mocked.release).toHaveBeenCalledOnce();
    expect(mocked.end).toHaveBeenCalledTimes(3);
  });
});

describe('existing isolated integration harness safety', () => {
  it.each([false, true])('pins an independent locked transaction through completion (failure=%s)', async (failure) => {
    const session = createIndependentDatabase();
    const statements: string[] = [];
    mocked.sessionQuery.mockImplementation(async (statement: string) => {
      statements.push(statement);
      if (failure && statement === 'batch') throw new Error('synthetic batch failure');
      return { rows: [{ stage: statement }] };
    });
    const result = session.database.queryAfterLock!('batch', [2], { statement: 'lock', parameters: [1] });
    if (failure) await expect(result).rejects.toThrow('synthetic batch failure');
    else await expect(result).resolves.toEqual([[{ stage: 'lock' }], [{ stage: 'batch' }]]);
    expect(statements).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', 'lock', 'batch', failure ? 'ROLLBACK' : 'COMMIT']);
    expect(mocked.connect).toHaveBeenCalledOnce();
    expect(mocked.release).toHaveBeenCalledOnce();
    expect(mocked.query).not.toHaveBeenCalled();
    await session.close();
  });

  it.each([false, true])('preserves a pinned caller transaction with a nested savepoint (failure=%s)', async (failure) => {
    const session = await createPinnedIntegrationDatabase('owner');
    await session.database.query('BEGIN');
    const defaultQuery = mocked.sessionQuery.getMockImplementation()!;
    mocked.sessionQuery.mockImplementation(async (statement: string, parameters: unknown[]) => {
      if (failure && statement === 'batch') throw new Error('synthetic batch failure');
      return defaultQuery(statement, parameters);
    });
    const result = session.database.queryAfterLock!('batch', [], { statement: 'lock', parameters: [] });
    if (failure) await expect(result).rejects.toThrow('synthetic batch failure');
    else await expect(result).resolves.toEqual([[], []]);
    const statements = mocked.sessionQuery.mock.calls.map(([statement]) => statement);
    expect(statements).toEqual(['BEGIN', 'SHOW transaction_isolation', 'SAVEPOINT all_player_locked_batch_1',
      'lock', 'batch', ...(failure ? ['ROLLBACK TO SAVEPOINT all_player_locked_batch_1'] : []),
      'RELEASE SAVEPOINT all_player_locked_batch_1']);
    expect(mocked.release).not.toHaveBeenCalled();
    await session.database.query('ROLLBACK');
    await session.close();
  });

  it('rejects a nested locked query whose outer snapshot is not READ COMMITTED', async () => {
    const session = await createPinnedIntegrationDatabase('owner');
    await session.database.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    mocked.sessionQuery.mockResolvedValueOnce({ rows: [{ transaction_isolation: 'repeatable read' }] });
    await expect(session.database.queryAfterLock!('batch', [], { statement: 'lock', parameters: [] }))
      .rejects.toThrow('READ COMMITTED isolation');
    expect(mocked.sessionQuery.mock.calls.map(([statement]) => statement))
      .toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ', 'SHOW transaction_isolation']);
    await session.database.query('ROLLBACK');
    await session.close();
  });

  it.each(['owner','runtime'] as const)('pins the configured %s connection across expected transaction errors', async (role) => {
    const session = await createPinnedIntegrationDatabase(role);
    expect(mocked.pool).toHaveBeenCalledExactlyOnceWith({ connectionString: role === 'owner' ? ownerUrl : runtimeUrl, max: 1 });
    await session.database.query('BEGIN');
    await session.database.query('SAVEPOINT expected_failure');
    mocked.sessionQuery.mockRejectedValueOnce(new Error('synthetic SQL rejection'));
    await expect(session.database.query('synthetic-invalid-statement')).rejects.toThrow('synthetic SQL rejection');
    expect(mocked.release).not.toHaveBeenCalled();
    await session.database.query('ROLLBACK TO SAVEPOINT expected_failure');
    await session.database.query('ROLLBACK');
    await session.close();
    await session.close();
    expect(mocked.connect).toHaveBeenCalledOnce();
    expect(mocked.release).toHaveBeenCalledOnce();
    expect(mocked.end).toHaveBeenCalledOnce();
    expect(mocked.query).not.toHaveBeenCalled();
  });

  it('rejects missing integration authorization before opening a pinned connection', async () => {
    vi.stubEnv('PROJECTION_INTEGRATION_AUTHORIZATION', undefined);
    await expect(createPinnedIntegrationDatabase('owner')).rejects.toThrow();
    expect(mocked.pool).not.toHaveBeenCalled();
  });

  it('closes a pinned pool if obtaining its connection fails', async () => {
    mocked.connect.mockRejectedValueOnce(new Error('synthetic connection failure'));
    await expect(createPinnedIntegrationDatabase('runtime')).rejects.toThrow('synthetic connection failure');
    expect(mocked.end).toHaveBeenCalledOnce();
    expect(mocked.release).not.toHaveBeenCalled();
  });

  it('accepts matching direct and pooled identities only after both server sentinels pass', async () => {
    await expect(assertSafeIntegrationDatabase(fixture)).resolves.toBeUndefined();
    expect(mocked.pool).toHaveBeenCalledTimes(2);
    expect(mocked.query).toHaveBeenCalledTimes(2);
    expect(mocked.end).toHaveBeenCalledTimes(2);
    expect(mocked.query.mock.calls.every(([sql]) => !/DROP|CREATE|INSERT|UPDATE|DELETE/u.test(sql))).toBe(true);
  });

  it.each(['ENV_FILE', 'AUTHORIZATION', 'DATABASE_SENTINEL', 'PRODUCTION_DENYLIST'])(
    'refuses missing %s before constructing clients', async (name) => {
      vi.stubEnv(`PROJECTION_INTEGRATION_${name}`, undefined);
      await expect(prepareIntegrationDatabase()).rejects.toThrow();
      expect(mocked.pool).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['TLS', { ownerDatabaseUrl: ownerUrl.replace('sslmode=require', 'sslmode=disable') }],
    ['target equality', { runtimeDatabaseUrl: runtimeUrl.replace('projection_test', 'different_test') }],
    ['distinct roles', { ownerDatabaseUrl: ownerUrl.replace('fixture_owner', 'league_one_runtime') }],
    ['restricted runtime role', { runtimeDatabaseUrl: runtimeUrl.replace('league_one_runtime', 'fixture_admin') }],
    ['safe branch name', { expectedBranchName: 'main' }],
    ['safe database name', { expectedDatabase: 'neondb', ownerDatabaseUrl: ownerUrl.replace('projection_test', 'neondb'), runtimeDatabaseUrl: runtimeUrl.replace('projection_test', 'neondb') }],
    ['denied branch ID', { expectedBranchId: 'br-production-fixture' }],
    ['denied endpoint', { ownerDatabaseUrl: ownerUrl.replace('ep-integration-fixture.', 'ep-production-fixture.'), runtimeDatabaseUrl: runtimeUrl.replace('ep-integration-fixture-pooler.', 'ep-production-fixture-pooler.') }],
    ['denied database', { productionDenylist: new Set(['projection_test']) }],
  ] as const)('refuses %s violations before constructing clients', async (_name, overrides) => {
    await expect(assertSafeIntegrationDatabase({ ...fixture, ...overrides })).rejects.toThrow();
    expect(mocked.pool).not.toHaveBeenCalled();
  });

  it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PRODUCTION_DATABASE_URL',
    'ACCOUNT_DATABASE_URL', 'ACCOUNTS_AUTH_DATABASE_URL'])(
    'refuses a configured Production target despite different role and pooler spelling in %s', async (name) => {
      vi.stubEnv(name, runtimeUrl.replace('league_one_runtime', 'production_fixture_role'));
      await expect(assertSafeIntegrationDatabase(fixture)).rejects.toThrow('configured production database URL');
      expect(mocked.pool).not.toHaveBeenCalled();
    },
  );

  it.each(['purpose', 'sentinel', 'branchId', 'branchName'])('refuses server %s mismatch before any reset', async (field) => {
    mocked.query.mockImplementation(async (_statement: string, user: string) => ({ rows: [{
      database_name: fixture.expectedDatabase, database_user: user,
      database_comment: JSON.stringify({
        purpose: 'league-one-projection-store-integration', sentinel: fixture.databaseSentinel,
        branchId: fixture.expectedBranchId, branchName: fixture.expectedBranchName,
        [field]: 'mismatched-fixture',
      }),
    }] }));
    await expect(prepareIntegrationDatabase()).rejects.toThrow('database-reported integration identity');
    expect(mocked.query).toHaveBeenCalledTimes(2);
    expect(mocked.query.mock.calls.every(([sql]) => !/DROP|CREATE|INSERT|UPDATE|DELETE/u.test(sql))).toBe(true);
  });

  it('rejects server-reported runtime role substitution before reset', async () => {
    mocked.query.mockImplementation(async () => ({ rows: [{
      database_name: fixture.expectedDatabase, database_user: 'fixture_owner',
      database_comment: JSON.stringify({ purpose: 'league-one-projection-store-integration',
        sentinel: fixture.databaseSentinel, branchId: fixture.expectedBranchId, branchName: fixture.expectedBranchName }),
    }] }));
    await expect(prepareIntegrationDatabase()).rejects.toThrow('same isolated database identity');
    expect(mocked.query).toHaveBeenCalledTimes(2);
  });

  it('keeps the original configured authorization and production identities in the parsed contract', () => {
    expect(integrationEnvironment()).toEqual(fixture);
    expect(mocked.pool).not.toHaveBeenCalled();
  });
});

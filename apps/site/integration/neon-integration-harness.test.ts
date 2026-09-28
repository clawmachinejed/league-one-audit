import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn(), end: vi.fn(),
  connect: vi.fn(), sessionQuery: vi.fn(), release: vi.fn(), readdir: vi.fn(), readFile: vi.fn(),
  acquireOwnership: vi.fn(), releaseOwnership: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ Pool: mocked.pool }));
vi.mock('node:fs/promises', () => ({ readdir: mocked.readdir, readFile: mocked.readFile }));
vi.mock('./integration-database-ownership', () => ({
  INTEGRATION_OWNER_ENV: 'PROJECTION_INTEGRATION_OWNER_PROOF',
  createIntegrationDatabaseOwnership: () => ({ acquire: mocked.acquireOwnership, release: mocked.releaseOwnership }),
}));

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
const authUrl = runtimeUrl.replace('league_one_runtime', 'league_one_auth');
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
  vi.stubEnv('PROJECTION_INTEGRATION_OWNER_PROOF', undefined);
  vi.stubEnv('COLLECTION_CAPACITY_OWNER_PROOF', undefined);
  vi.stubEnv('AUTH_RESET_INTEGRATION_DATABASE_URL', undefined);
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PRODUCTION_DATABASE_URL',
    'ACCOUNT_DATABASE_URL', 'ACCOUNTS_AUTH_DATABASE_URL']) {
    vi.stubEnv(name, undefined);
  }
  configureEnvironment();
  mocked.end.mockResolvedValue(undefined);
  mocked.releaseOwnership.mockImplementation(() => mocked.end());
  mocked.acquireOwnership.mockImplementation(async (environment: { ownerDatabaseUrl: string }) => ({
    query: (statement: string) => mocked.query(statement, decodeURIComponent(new URL(environment.ownerDatabaseUrl).username)),
    connect: mocked.connect,
  }));
  mocked.sessionQuery.mockImplementation(async (statement: string) => ({
    rows: statement === 'SHOW transaction_isolation' ? [{ transaction_isolation: 'read committed' }] : [],
  }));
  mocked.connect.mockResolvedValue({ query: mocked.sessionQuery, release: mocked.release });
  mocked.pool.mockImplementation(function (configuration: { connectionString: string }) {
    const user = decodeURIComponent(new URL(configuration.connectionString).username);
    return {
      query: (statement: string) => mocked.query(statement, user),
      connect: mocked.connect,
      end: mocked.end,
    };
  });
  mocked.query.mockImplementation(async (statement: string, user: string) => ({ rows: [statement.includes('AS has_memberships') ? {
    rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
    rolreplication: false, rolinherit: false, rolbypassrls: false, has_memberships: false,
  } : {
    database_name: fixture.expectedDatabase,
    database_user: user,
    session_user: user,
    branch_id: fixture.expectedBranchId,
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
  it('lets the verified owner enter the runtime role in a rollback-only enrollment fixture', async () => {
    mockAccountProvisioning();
    const assumableRoles = new Set<string>();
    const query = mocked.query.getMockImplementation()!;
    mocked.query.mockImplementation(async (statement: string, user: string) => {
      const grant = /^GRANT (league_one_\w+) TO "fixture_owner" WITH SET TRUE$/u.exec(statement);
      if (grant) assumableRoles.add(grant[1]);
      const verification = /pg_has_role\(current_user, '(league_one_\w+)', 'SET'\)/u.exec(statement);
      if (verification) return { rows: [{ can_set_private_role: assumableRoles.has(verification[1]) }] };
      return query(statement, user);
    });
    mocked.sessionQuery.mockImplementation(async (statement: string) => {
      const role = /^SET LOCAL ROLE (league_one_\w+)$/u.exec(statement)?.[1];
      if (role && !assumableRoles.has(role)) {
        throw Object.assign(new Error(`permission denied to set role "${role}"`), { code: '42501' });
      }
      return { rows: [] };
    });

    await prepareIntegrationDatabase();
    mocked.sessionQuery.mockClear();
    const rollback = new Error('rollback-only onboarding fixture');
    const enrollment = vi.fn();
    await expect(withAccountActor({}, async query => {
      await query('RESET ROLE');
      await query('DELETE FROM public.league_administration_enrollments');
      await query('SET LOCAL ROLE league_one_runtime');
      enrollment();
      throw rollback;
    })).rejects.toBe(rollback);
    expect(enrollment).toHaveBeenCalledOnce();
    expect(mocked.sessionQuery).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocked.sessionQuery.mock.calls.some(([statement]) => statement === 'COMMIT')).toBe(false);
    const statements = mocked.query.mock.calls.map(([statement]) => statement);
    expect(statements.indexOf('GRANT league_one_runtime TO "fixture_owner" WITH SET TRUE'))
      .toBeGreaterThan(statements.indexOf('fixture-runtime-provision'));
  });

  it('does not grant runtime SET permission when runtime provisioning is disabled', async () => {
    mockAccountProvisioning();
    await prepareIntegrationDatabase({ provisionRuntimeRole: false });
    const statements = mocked.query.mock.calls.map(([statement]) => statement);
    expect(statements).not.toContain('fixture-runtime-provision');
    expect(statements.some(statement => statement.startsWith('GRANT league_one_runtime '))).toBe(false);
    expect(statements.some(statement => statement.includes("pg_has_role(current_user, 'league_one_runtime', 'SET')"))).toBe(false);
    expect(statements).toContain('GRANT league_one_account TO "fixture_owner" WITH SET TRUE');
  });

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
      expect(statements.findIndex(statement => statement.includes("pg_has_role(current_user, 'league_one_account', 'SET')")))
        .toBeGreaterThan(grantIndex);
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
    expect(grants).toEqual([
      'GRANT league_one_runtime TO "fixture""owner" WITH SET TRUE',
      'GRANT league_one_account TO "fixture""owner" WITH SET TRUE',
    ]);
  });

  const isolatedRoleCases = [
    { role: 'runtime', options: {} },
    { role: 'account', options: { provisionRuntimeRole: false } },
    { role: 'auth', options: { provisionRuntimeRole: false, provisionAccountRole: false } },
  ];

  it.each(isolatedRoleCases)('rejects an unexpected catalog owner before granting $role access', async ({ options }) => {
    mockAccountProvisioning({ ownerRole: 'unexpected_owner', includeAuth: true });
    await expect(prepareIntegrationDatabase(options)).rejects.toThrow('does not match the verified owner identity');
    expect(mocked.query.mock.calls.some(([statement]) => statement.startsWith('GRANT '))).toBe(false);
    expect(process.env.PROJECTION_INTEGRATION_SETUP_PROOF).toBeUndefined();
  });

  it.each(isolatedRoleCases)('requires positive server verification of $role SET permission before claiming setup success', async ({ role, options }) => {
    mockAccountProvisioning({ canSetRole: false, includeAuth: true });
    await expect(prepareIntegrationDatabase(options)).rejects.toThrow('could not verify permission');
    expect(mocked.query.mock.calls.map(([statement]) => statement).filter(statement => statement.startsWith('GRANT ')))
      .toEqual([`GRANT league_one_${role} TO "fixture_owner" WITH SET TRUE`]);
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
      session_user: 'fixture_owner', branch_id: fixture.expectedBranchId,
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
  it.each(['prepare', 'cleanup'])('refuses %s before any schema statement when ownership conflicts', async action => {
    mocked.acquireOwnership.mockRejectedValue(Object.assign(new Error('occupied'), { code: 'INTEGRATION_DATABASE_BUSY' }));
    await expect(action === 'prepare' ? prepareIntegrationDatabase() : cleanIntegrationDatabase())
      .rejects.toMatchObject({ code: 'INTEGRATION_DATABASE_BUSY' });
    expect(mocked.query.mock.calls.some(([statement]) => statement.startsWith('DROP '))).toBe(false);
    expect(mocked.sessionQuery).not.toHaveBeenCalled();
  });

  it('passes explicit delegated ownership to both preparation and cleanup', async () => {
    mockAccountProvisioning();
    await prepareIntegrationDatabase({ ownerProof: 'server-verified-by-ownership-module' });
    expect(mocked.releaseOwnership).not.toHaveBeenCalled();
    await cleanIntegrationDatabase({ ownerProof: 'server-verified-by-ownership-module' });
    expect(mocked.acquireOwnership.mock.calls.map(([, proof]) => proof))
      .toEqual(['server-verified-by-ownership-module', 'server-verified-by-ownership-module']);
    expect(mocked.releaseOwnership).toHaveBeenCalledOnce();
  });

  it('releases existing ownership even when cleanup authorization is removed', async () => {
    mockAccountProvisioning(); await prepareIntegrationDatabase();
    mocked.query.mockClear(); vi.stubEnv('PROJECTION_INTEGRATION_AUTHORIZATION', undefined);
    await expect(cleanIntegrationDatabase()).rejects.toThrow('authorization');
    expect(mocked.releaseOwnership).toHaveBeenCalledOnce(); expect(mocked.query).not.toHaveBeenCalled();
  });

  it('releases the pinned owner when final post-migration identity verification fails', async () => {
    mockAccountProvisioning();
    const query = mocked.query.getMockImplementation()!; let identities = 0;
    mocked.query.mockImplementation(async (statement: string, user: string) => {
      if (statement.includes('shobj_description') && ++identities > 2) throw new Error('synthetic identity failure');
      return query(statement, user);
    });
    await expect(prepareIntegrationDatabase()).rejects.toThrow();
    expect(mocked.releaseOwnership).toHaveBeenCalledOnce();
  });

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

describe('configured auth credential preflight', () => {
  const expectNoReset = () => {
    expect(mocked.acquireOwnership).not.toHaveBeenCalled();
    expect(mocked.query.mock.calls.some(([statement]) => /^(?:DROP|CREATE|GRANT|REVOKE) /u.test(statement))).toBe(false);
    expect(mocked.sessionQuery).not.toHaveBeenCalled();
  };

  it('authenticates the pooled auth login and verifies its flags without requiring auth tables', async () => {
    vi.stubEnv('AUTH_RESET_INTEGRATION_DATABASE_URL', authUrl);
    await assertSafeIntegrationDatabase();
    expect(mocked.pool).toHaveBeenCalledTimes(3);
    for (const [configuration] of mocked.pool.mock.calls) {
      expect(configuration).toMatchObject({ connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000, query_timeout: 20_000 });
    }
    expect(mocked.query.mock.calls.filter(([, user]) => user === 'league_one_auth')).toHaveLength(2);
    expect(mocked.query.mock.calls.some(([statement]) => statement.includes('FROM pg_auth_members'))).toBe(true);
    expect(mocked.end).toHaveBeenCalledTimes(3);
    expectNoReset();
  });

  it.each([
    ['invalid URL', 'not-a-database-url'],
    ['different database', authUrl.replace('projection_test', 'retained_test')],
    ['different endpoint', authUrl.replace('ep-integration-fixture', 'ep-other-fixture')],
    ['owner login', authUrl.replace('league_one_auth', 'fixture_owner')],
    ['runtime login', authUrl.replace('league_one_auth', 'league_one_runtime')],
    ['missing password', authUrl.replace(':fixture_password', '')],
    ['disabled TLS', authUrl.replace('sslmode=require', 'sslmode=disable')],
    ['unexpected port', authUrl.replace('.test/', '.test:5433/')],
    ['URL fragment', `${authUrl}#fragment`],
  ])('refuses %s before opening clients or resetting schemas', async (_label, value) => {
    vi.stubEnv('AUTH_RESET_INTEGRATION_DATABASE_URL', value);
    await expect(prepareIntegrationDatabase()).rejects.toThrow();
    expect(mocked.pool).not.toHaveBeenCalled();
    expectNoReset();
  });

  it.each([
    ['wrong database', { database_name: 'retained_test' }],
    ['wrong branch', { branch_id: 'br-retained-fixture' }],
    ['missing branch', { branch_id: null }],
    ['wrong current role', { database_user: 'fixture_owner' }],
    ['wrong authenticated role', { session_user: 'fixture_owner' }],
    ['missing safety comment', { database_comment: null }],
    ['wrong safety comment', { database_comment: JSON.stringify({ purpose: 'league-one-projection-store-integration',
      sentinel: 'wrong-sentinel', branchId: fixture.expectedBranchId, branchName: fixture.expectedBranchName }) }],
  ])('refuses auth server identity with %s before reset', async (_label, overrides) => {
    vi.stubEnv('AUTH_RESET_INTEGRATION_DATABASE_URL', authUrl);
    const query = mocked.query.getMockImplementation()!;
    mocked.query.mockImplementation(async (statement: string, user: string) => {
      const result = await query(statement, user);
      return user === 'league_one_auth' && statement.includes('shobj_description')
        ? { rows: [{ ...result.rows[0], ...overrides }] } : result;
    });
    await expect(prepareIntegrationDatabase()).rejects.toThrow();
    expect(mocked.end).toHaveBeenCalledTimes(4); // Three identity pools and released harness ownership.
    expectNoReset();
  });

  it.each(['rolcanlogin', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication',
    'rolinherit', 'rolbypassrls', 'has_memberships'])(
    'refuses unsafe auth catalog flag %s before reset', async flag => {
      vi.stubEnv('AUTH_RESET_INTEGRATION_DATABASE_URL', authUrl);
      const query = mocked.query.getMockImplementation()!;
      mocked.query.mockImplementation(async (statement: string, user: string) => {
        const result = await query(statement, user);
        return statement.includes('AS has_memberships')
          ? { rows: [{ ...result.rows[0], [flag]: flag !== 'rolcanlogin' }] } : result;
      });
      await expect(prepareIntegrationDatabase()).rejects.toThrow('unprivileged standalone LOGIN role');
      expectNoReset();
    },
  );

  it.each(['identity', 'privileges'])('sanitizes auth %s query failures and closes clients before reset', async stage => {
    vi.stubEnv('AUTH_RESET_INTEGRATION_DATABASE_URL', authUrl);
    const query = mocked.query.getMockImplementation()!;
    mocked.query.mockImplementation(async (statement: string, user: string) => {
      if (user === 'league_one_auth' && (stage === 'identity' || statement.includes('AS has_memberships'))) {
        throw new Error(`credential-bearing failure: ${authUrl}`);
      }
      return query(statement, user);
    });
    const error = await prepareIntegrationDatabase().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('The auth connection could not verify');
    expect((error as Error).message).not.toContain(authUrl);
    expect(mocked.end).toHaveBeenCalledTimes(4);
    expectNoReset();
  });

  it('refuses cleanup when the configured auth credential is invalid', async () => {
    vi.stubEnv('AUTH_RESET_INTEGRATION_DATABASE_URL', authUrl.replace('league_one_auth', 'fixture_owner'));
    await expect(cleanIntegrationDatabase()).rejects.toThrow('restricted role');
    expectNoReset();
  });

  it.each(['fixture_owner', 'league_one_runtime'])('requires the actual server branch from %s before reset', async selectedUser => {
    const query = mocked.query.getMockImplementation()!;
    mocked.query.mockImplementation(async (statement: string, user: string) => {
      const result = await query(statement, user);
      return user === selectedUser ? { rows: [{ ...result.rows[0], branch_id: 'br-other-fixture' }] } : result;
    });
    await expect(prepareIntegrationDatabase()).rejects.toThrow('database-reported integration identity');
    expectNoReset();
  });

  it('allows historical pre-021 preparation without an auth credential', async () => {
    mockAccountProvisioning();
    await prepareIntegrationDatabase({ throughMigration: '020_account_foundation.sql' });
    expect(mocked.pool.mock.calls.every(([configuration]) => !configuration.connectionString.includes('league_one_auth'))).toBe(true);
    expect(mocked.query.mock.calls.some(([statement]) => statement.startsWith('DROP '))).toBe(true);
  });
});

describe('built-in protection for retained integration targets', () => {
  const targets = [
    { expectedBranchId: 'br-rapid-boat-avgeevye' },
    { expectedBranchId: 'br-still-breeze-avaibago' },
    { expectedDatabase: 'projection_refactor_test' },
    { expectedDatabase: 'account_reset_integration_test' },
  ];
  const environmentFor = (target: { expectedBranchId?: string; expectedDatabase?: string }) => ({
    ...fixture, ...target,
    ownerDatabaseUrl: ownerUrl.replace('projection_test', target.expectedDatabase ?? fixture.expectedDatabase),
    runtimeDatabaseUrl: runtimeUrl.replace('projection_test', target.expectedDatabase ?? fixture.expectedDatabase),
  });

  it.each(targets.flatMap(target => [false, true].map(empty => ({ target, empty }))))(
    'rejects protected target $target before connections even with empty=$empty caller denylist', async ({ target, empty }) => {
      await expect(assertSafeIntegrationDatabase({ ...environmentFor(target),
        productionDenylist: new Set(empty ? [] : ['unrelated-production-identity']) }))
        .rejects.toThrow('protected production or retained identity');
      expect(mocked.pool).not.toHaveBeenCalled();
      expect(mocked.acquireOwnership).not.toHaveBeenCalled();
      expect(mocked.query).not.toHaveBeenCalled();
    },
  );

  it.each(targets.flatMap(target => ['prepare', 'cleanup'].map(action => ({ target, action }))))(
    'refuses $action on protected target $target despite its old valid sentinel', async ({ target, action }) => {
      const environment = environmentFor(target);
      vi.stubEnv('PROJECTION_INTEGRATION_EXPECTED_DATABASE', environment.expectedDatabase);
      vi.stubEnv('PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID', environment.expectedBranchId);
      vi.stubEnv('PROJECTION_INTEGRATION_OWNER_DATABASE_URL', environment.ownerDatabaseUrl);
      vi.stubEnv('PROJECTION_INTEGRATION_RUNTIME_DATABASE_URL', environment.runtimeDatabaseUrl);
      vi.stubEnv('PROJECTION_INTEGRATION_PRODUCTION_DENYLIST', 'unrelated-production-identity');
      mockAccountProvisioning();
      const query = mocked.query.getMockImplementation()!;
      mocked.query.mockImplementation(async (statement: string, user: string) => statement.includes('shobj_description')
        ? { rows: [{ database_name: environment.expectedDatabase, database_user: user, session_user: user,
          branch_id: environment.expectedBranchId, database_comment: JSON.stringify({
            purpose: 'league-one-projection-store-integration', sentinel: environment.databaseSentinel,
            branchId: environment.expectedBranchId, branchName: environment.expectedBranchName,
          }) }] } : query(statement, user));
      await expect(action === 'prepare' ? prepareIntegrationDatabase() : cleanIntegrationDatabase())
        .rejects.toThrow('protected production or retained identity');
      expect(mocked.pool).not.toHaveBeenCalled();
      expect(mocked.acquireOwnership).not.toHaveBeenCalled();
      expect(mocked.query).not.toHaveBeenCalled();
      expect(mocked.sessionQuery).not.toHaveBeenCalled();
    },
  );

  it.each(['fixture_owner', 'league_one_runtime', 'league_one_auth'])(
    'rejects the actual retained branch reported by %s despite misleading configured branch metadata', async selectedUser => {
      if (selectedUser === 'league_one_auth') vi.stubEnv('AUTH_RESET_INTEGRATION_DATABASE_URL', authUrl);
      vi.stubEnv('PROJECTION_INTEGRATION_PRODUCTION_DENYLIST', 'unrelated-production-identity');
      const query = mocked.query.getMockImplementation()!;
      mocked.query.mockImplementation(async (statement: string, user: string) => {
        const result = await query(statement, user);
        return user === selectedUser && statement.includes('shobj_description')
          ? { rows: [{ ...result.rows[0], branch_id: 'br-still-breeze-avaibago' }] } : result;
      });
      await expect(prepareIntegrationDatabase()).rejects.toThrow('protected production or retained identity');
      expect(mocked.acquireOwnership).not.toHaveBeenCalled();
      expect(mocked.query.mock.calls.every(([statement]) => statement.includes('shobj_description'))).toBe(true);
      expect(mocked.sessionQuery).not.toHaveBeenCalled();
    },
  );
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
      session_user: user, branch_id: fixture.expectedBranchId,
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
      session_user: 'fixture_owner', branch_id: fixture.expectedBranchId,
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

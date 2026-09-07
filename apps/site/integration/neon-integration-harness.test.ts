import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn(), end: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ Pool: mocked.pool }));

import {
  assertSafeIntegrationDatabase,
  integrationEnvironment,
  prepareIntegrationDatabase,
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
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PRODUCTION_DATABASE_URL']) {
    vi.stubEnv(name, undefined);
  }
  configureEnvironment();
  mocked.end.mockResolvedValue(undefined);
  mocked.pool.mockImplementation(function (configuration: { connectionString: string }) {
    const user = new URL(configuration.connectionString).username;
    return {
      query: (statement: string) => mocked.query(statement, user),
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

describe('existing isolated integration harness safety', () => {
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

  it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PRODUCTION_DATABASE_URL'])(
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

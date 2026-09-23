import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getAuthTables } from 'better-auth/db';
import { describe, expect, it } from 'vitest';
import { accountQuery, createPinnedIntegrationDatabase, ownerQuery, runtimeQuery, withAuthRole } from './neon-integration-harness';

const tables = ['account', 'rateLimit', 'session', 'user', 'verification'];

describe.sequential('maintained auth schema in the guarded disposable database', () => {
  it('matches the installed maintained library schema and keeps all auth foreign keys inside its schema', async () => {
    const schema = getAuthTables({ rateLimit: { storage: 'database' } });
    const expected = Object.entries(schema).flatMap(([model, definition]) => [
      { table_name: definition.modelName ?? model, column_name: 'id', data_type: 'text', is_nullable: 'NO' },
      ...Object.entries(definition.fields).map(([field, attribute]) => {
        const type = attribute.type === 'date' ? 'timestamp with time zone'
          : attribute.type === 'boolean' ? 'boolean' : attribute.type === 'string' ? 'text'
            : attribute.type === 'number' ? attribute.bigint ? 'bigint' : 'integer' : 'unsupported';
        return { table_name: definition.modelName ?? model, column_name: attribute.fieldName ?? field,
          data_type: type, is_nullable: attribute.required === false ? 'YES' : 'NO' };
      }),
    ]).sort((a, b) => `${a.table_name}.${a.column_name}`.localeCompare(`${b.table_name}.${b.column_name}`));
    const actual = await ownerQuery<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(`
      SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
      WHERE table_schema='website_auth'
    `);
    expect([...actual].sort((a, b) => `${a.table_name}.${a.column_name}`.localeCompare(`${b.table_name}.${b.column_name}`)))
      .toEqual(expected);
    expect(await ownerQuery(`SELECT count(*)::int AS invalid_auth_foreign_keys FROM pg_constraint constraint_row
      JOIN pg_class source ON source.oid=constraint_row.conrelid JOIN pg_namespace source_schema ON source_schema.oid=source.relnamespace
      JOIN pg_class target ON target.oid=constraint_row.confrelid JOIN pg_namespace target_schema ON target_schema.oid=target.relnamespace
      WHERE constraint_row.contype='f' AND source_schema.nspname='website_auth' AND target_schema.nspname<>'website_auth'`))
      .toEqual([{ invalid_auth_foreign_keys: 0 }]);
  });

  it('allows auth CRUD while rejecting access to website identities, league data, DDL and privileged functions', async () => {
    const id = `auth-schema-${randomUUID()}`;
    await expect(withAuthRole(async query => {
      await query(`INSERT INTO website_auth."user"(id,name,email,"emailVerified") VALUES ($1,'Synthetic',$2,false)`,
        [id, `${id}@example.test`]);
      await query(`INSERT INTO website_auth.session(id,"expiresAt",token,"updatedAt","userId")
        VALUES ($1,now()+interval '1 hour',$2,now(),$3)`, [`${id}-session`, `${id}-token`, id]);
      await query(`INSERT INTO website_auth.account(id,"accountId","providerId","userId","updatedAt")
        VALUES ($1,$2,'credential',$2,now())`, [`${id}-account`, id]);
      await query(`INSERT INTO website_auth.verification(id,identifier,value,"expiresAt") VALUES ($1,$1,'synthetic',now())`, [id]);
      await query(`INSERT INTO website_auth."rateLimit"(id,key,count,"lastRequest") VALUES ($1,$1,1,1)`, [id]);
      await query(`UPDATE website_auth."user" SET name='Updated synthetic' WHERE id=$1`, [id]);
      expect(await query('SELECT name FROM website_auth."user" WHERE id=$1', [id])).toEqual([{ name: 'Updated synthetic' }]);
      for (const statement of [
        `INSERT INTO website_auth."user"(id,name,email,"emailVerified")
          SELECT id||'-duplicate',name,email,false FROM website_auth."user" WHERE id=$1`,
        `INSERT INTO website_auth.session(id,"expiresAt",token,"updatedAt","userId")
          SELECT id||'-duplicate',"expiresAt",token,now(),"userId" FROM website_auth.session WHERE "userId"=$1`,
        `INSERT INTO website_auth."rateLimit"(id,key,count,"lastRequest")
          SELECT id||'-duplicate',key,count,"lastRequest" FROM website_auth."rateLimit" WHERE id=$1`,
      ]) {
        await query('SAVEPOINT expected_auth_uniqueness');
        await expect(query(statement, [id])).rejects.toThrow(/unique|duplicate/iu);
        await query('ROLLBACK TO SAVEPOINT expected_auth_uniqueness');
        await query('RELEASE SAVEPOINT expected_auth_uniqueness');
      }
      for (const statement of [
        'SELECT * FROM public.app_users',
        'SELECT * FROM public.app_login_identities',
        'SELECT * FROM public.leagues',
        'SELECT * FROM public.app_schema_migrations',
        "SELECT public.resolve_app_login_identity('issuer','subject','name',gen_random_uuid())",
        'CREATE TABLE website_auth.unexpected_auth_table(id text)',
        'CREATE TABLE public.unexpected_auth_table(id text)',
        'TRUNCATE website_auth.session',
      ]) {
        await query('SAVEPOINT expected_auth_denial');
        await expect(query(statement)).rejects.toThrow(/permission/iu);
        await query('ROLLBACK TO SAVEPOINT expected_auth_denial');
        await query('RELEASE SAVEPOINT expected_auth_denial');
      }
      await query('DELETE FROM website_auth."user" WHERE id=$1', [id]);
      expect(await query('SELECT count(*)::int AS count FROM website_auth.session WHERE "userId"=$1', [id]))
        .toEqual([{ count: 0 }]);
      expect(await query('SELECT count(*)::int AS count FROM website_auth.account WHERE "userId"=$1', [id]))
        .toEqual([{ count: 0 }]);
      // This catalog/privilege probe leaves no synthetic data for other cases.
      throw new Error('rollback synthetic auth schema probe');
    })).rejects.toThrow('rollback synthetic auth schema probe');
    expect(await ownerQuery('SELECT count(*)::int AS count FROM website_auth."user" WHERE id=$1', [id]))
      .toEqual([{ count: 0 }]);
  });

  it('prevents account and worker credentials from reading or mutating every auth table', async () => {
    for (const table of tables) {
      const rows = await ownerQuery(`SELECT
        has_any_column_privilege('league_one_account',oid,'SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege('league_one_account',oid,'DELETE,TRUNCATE,TRIGGER') AS account_access,
        has_any_column_privilege('league_one_runtime',oid,'SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege('league_one_runtime',oid,'DELETE,TRUNCATE,TRIGGER') AS worker_access
        FROM pg_class WHERE oid=to_regclass($1)`, [`website_auth."${table}"`]);
      expect(rows).toEqual([{ account_access: false, worker_access: false }]);
      await expect(accountQuery(`SELECT * FROM website_auth."${table}"`)).rejects.toThrow(/permission/iu);
      await expect(runtimeQuery(`SELECT * FROM website_auth."${table}"`)).rejects.toThrow(/permission/iu);
    }
    expect(await ownerQuery(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolinherit,rolbypassrls
      FROM pg_roles WHERE rolname='league_one_auth'`)).toEqual([{
      rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
      rolreplication: false, rolinherit: false, rolbypassrls: false,
    }]);
    // SET ROLE authorization uses session_user. The guarded test session is the
    // owner, so check the actual auth role's memberships rather than asserting
    // owner-session behavior represents a restricted auth login.
    expect(await ownerQuery(`SELECT pg_has_role('league_one_auth','league_one_account','MEMBER') AS can_be_account,
      pg_has_role('league_one_auth','league_one_runtime','MEMBER') AS can_be_worker,
      pg_has_role('league_one_account','league_one_auth','MEMBER') AS account_can_be_auth,
      pg_has_role('league_one_runtime','league_one_auth','MEMBER') AS worker_can_be_auth`))
      .toEqual([{ can_be_account: false, can_be_worker: false, account_can_be_auth: false, worker_can_be_auth: false }]);
  });

  it.for([
    { grant: 'GRANT USAGE ON SCHEMA public TO PUBLIC', file: 'provision-auth-role.sql', error: /inherits access to the public schema/u, maintain: false },
    { grant: 'GRANT MAINTAIN ON public.leagues TO PUBLIC', file: 'provision-auth-role.sql', error: /access outside auth tables/u, maintain: true },
    { grant: 'GRANT MAINTAIN ON website_auth."user" TO league_one_account', file: 'provision-account-role.sql', error: /auth object privileges/u, maintain: true },
    { grant: 'GRANT MAINTAIN ON website_auth."user" TO league_one_runtime', file: 'provision-runtime-role.sql', error: /auth object privileges/u, maintain: true },
  ])('refuses preexisting effective privileges: $grant', async ({ grant, file, error, maintain }, context) => {
    if (maintain) {
      const version = await ownerQuery<{ version: number }>("SELECT current_setting('server_version_num')::int AS version");
      if (version[0].version < 170000) return context.skip();
    }
    const session = await createPinnedIntegrationDatabase('owner');
    // The test owns rollback. Remove only the script's outer transaction lines,
    // retaining its actual grant resets and fail-closed catalog assertions.
    const script = (await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8'))
      .replace(/^BEGIN;\r?$/mu, '').replace(/^COMMIT;\r?$/mu, '');
    try {
      await session.database.query('BEGIN');
      await session.database.query(grant);
      await expect(session.database.query(script)).rejects.toThrow(error);
    } finally {
      await session.database.query('ROLLBACK');
      await session.close();
    }
  });
});

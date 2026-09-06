import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createIndependentDatabase, ownerQuery } from './neon-integration-harness';

const callableFunctions = new Set([
  'get_or_create_scoring_profile',
  'record_game_state_observations',
  'get_or_create_projection_run',
]);

describe('B3 function ownership and execution boundaries', () => {
  it('gives each new function the schema owner, trusted search path, and only exact execution rights', async () => {
    const migration = await readFile(new URL('../migrations/008_additive_write_guards.sql', import.meta.url), 'utf8');
    const functionNames = [...migration.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/giu)]
      .map((match) => match[1]);
    expect(functionNames.length).toBeGreaterThan(callableFunctions.size);
    expect(new Set(functionNames).size).toBe(functionNames.length);
    const rows = await ownerQuery<{
      name: string; signature: string; owner_matches: boolean; owner_is_runtime: boolean;
      security_definer: boolean; configuration: string[]; runtime_execute: boolean;
      public_execute: boolean; unexpected_grantees: number; runtime_grant_option: boolean;
    }>(`
      SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS signature,
        p.proowner = c.relowner AS owner_matches,
        pg_get_userbyid(p.proowner) = 'league_one_runtime' AS owner_is_runtime,
        p.prosecdef AS security_definer, p.proconfig AS configuration,
        has_function_privilege('league_one_runtime',p.oid,'EXECUTE') AS runtime_execute,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
        (SELECT count(*)::integer FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>p.proowner AND a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='league_one_runtime')) AS unexpected_grantees,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='league_one_runtime') AND a.is_grantable) AS runtime_grant_option
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN pg_class c
      WHERE n.nspname='public' AND p.proname=ANY($1::text[])
        AND c.oid='public.scoring_profiles'::regclass ORDER BY p.proname
    `, [functionNames]);
    expect(rows).toHaveLength(functionNames.length);
    for (const row of rows) {
      expect(row, row.name).toMatchObject({
        owner_matches: true, owner_is_runtime: false,
        security_definer: callableFunctions.has(row.name),
        configuration: ['search_path=pg_catalog, public, pg_temp'],
        runtime_execute: callableFunctions.has(row.name),
        public_execute: false, unexpected_grantees: 0, runtime_grant_option: false,
      });
    }
    expect(rows.filter((row) => row.runtime_execute).map((row) => row.name).sort())
      .toEqual([...callableFunctions].sort());
  });

  it('resolves owner-controlled writes against public tables despite temporary shadow names', async () => {
    const connection = createIndependentDatabase();
    const rules = { b3_shadow_fixture: 1 };
    const hash = createHash('sha256').update(JSON.stringify(rules) + randomUUID()).digest('hex');
    try {
      await connection.database.query('BEGIN');
      await connection.database.query('CREATE TEMP TABLE scoring_profiles (id uuid, rules_hash text, rules jsonb)');
      const rows = await connection.database.query<{ id: string }>(
        'SELECT public.get_or_create_scoring_profile($1::text,$2::jsonb)::text AS id', [hash, JSON.stringify(rules)],
      );
      expect(rows).toHaveLength(1);
      const actual = await connection.database.query<{ public_count: number; shadow_count: number }>(`
        SELECT (SELECT count(*)::integer FROM public.scoring_profiles WHERE rules_hash=$1) AS public_count,
          (SELECT count(*)::integer FROM pg_temp.scoring_profiles) AS shadow_count
      `, [hash]);
      expect(actual).toEqual([{ public_count: 1, shadow_count: 0 }]);
    } finally {
      try { await connection.database.query('ROLLBACK'); } finally { await connection.close(); }
    }
  });
});

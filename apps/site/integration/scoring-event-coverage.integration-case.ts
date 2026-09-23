import { describe, expect, it } from 'vitest';
import fixture from '../test-support/fixtures/sleeper-scoring-event-coverage.json';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../lib/projections/adapters/sleeper/scoring-profile';
import { ownerQuery } from './neon-integration-harness';

async function supported(rules: unknown, provider = 'sleeper', scorerVersion = 'sleeper-actual-v1') {
  const [result] = await ownerQuery<{ supported: boolean }>(`
    SELECT public.all_player_scoring_contract_supported($1, $2, $3::jsonb) AS supported
  `, [provider, scorerVersion, JSON.stringify(rules)]);
  return result.supported;
}

describe('additive native Sleeper actual-scoring contract', () => {
  it('accepts exactly the application native-key contract and the captured league profiles', async () => {
    const rows = await ownerQuery<{ key: string; supported: boolean }>(`
      SELECT rule_key AS key, public.all_player_scoring_contract_supported(
        'sleeper', 'sleeper-actual-v1', jsonb_build_object(rule_key, 1)
      ) AS supported FROM unnest($1::text[]) AS rule_key
    `, [[...SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS]]);
    expect(rows).toHaveLength(SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS.size);
    expect(rows.every((row) => row.supported)).toBe(true);
    for (const league of fixture.leagues) expect(await supported(league.rules)).toBe(true);
  });

  it('keeps inactive unknown rules inert and active unknown rules rejected', async () => {
    expect(await supported({ pass_int_td: -2, future_rule: 0 })).toBe(true);
    expect(await supported({ pass_int_td: -2, future_rule: 1 })).toBe(false);
    expect(await supported({ future_rule: 0 })).toBe(false);
    expect(await supported({})).toBe(false);
  });

  it('continues to reject invalid weights and unrelated provider/scorer contracts', async () => {
    for (const weight of ['2', null, true]) {
      expect(await supported({ pass_int_td: weight, pass_yd: 0.04 })).toBe(false);
    }
    expect(await supported({ pass_int_td: -2 }, 'other')).toBe(false);
    expect(await supported({ pass_int_td: -2 }, 'sleeper', 'sleeper-actual-v2')).toBe(false);
    expect(await supported({ pass_int_td: -2 }, 'sleeper', 'unknown')).toBe(false);
  });

  it('retains the immutable validator signature and denies direct runtime and public execution', async () => {
    const [row] = await ownerQuery<{
      immutable: boolean; definer: boolean; runtime_execute: boolean; public_execute: boolean;
    }>(`
      SELECT p.provolatile = 'i' AS immutable, p.prosecdef AS definer,
        has_function_privilege('league_one_runtime', p.oid, 'EXECUTE') AS runtime_execute,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS public_execute
      FROM pg_proc p WHERE p.oid = 'public.all_player_scoring_contract_supported(text,text,jsonb)'::regprocedure
    `);
    expect(row).toEqual({ immutable: true, definer: false, runtime_execute: false, public_execute: false });
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('../../migrations/046_official_brackets.sql', import.meta.url), 'utf8');
const provisioner = readFileSync(new URL('../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
const late = provisioner.split('-- BEGIN OPTIONAL TYPED BRACKET GRANTS')[1]?.split('-- END OPTIONAL TYPED BRACKET GRANTS')[0];
const body = sql.replace(/--[^\n]*/gu, '');
const tables = ['contents', 'rounds', 'matches', 'entrants', 'results', 'edges'];
const helpers = ['bracket_native_field(jsonb,text,text)', 'project_bracket_native(jsonb,text,jsonb)', 'bracket_typed_value(uuid)',
  'validate_bracket_typed_lineage()', 'validate_bracket_acceptance_fence()', 'guard_bracket_child_insert()', 'capture_bracket_typed(uuid,uuid,jsonb)', 'record_league_administration_observation_v45(jsonb)'];
describe('CP11 migration boundary guards', () => {
  it('extends the sole writer only for explicit bracket acceptance and preserves prior partial manager evidence', () => {
    expect(body).toContain('RENAME TO record_league_administration_observation_v45');
    expect(body).toContain("IF addition IS NULL THEN RETURN public.record_league_administration_observation_v45(p_input)");
    expect(body).toContain("sleeper-current-all-teams-manager-evidence-v2");
    expect(body).toContain("THEN scope.identity->'scope'->>'entityId'");
    expect(body).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:public_data_|projection_jobs|league_configuration)/iu);
  });
  it('makes whole relational parity deferred once and disallows late child additions', () => {
    expect(body).toContain('capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id()');
    expect(body).toContain('header.capture_transaction=pg_current_xact_id()');
    expect(body).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_bracket_typed_lineage()');
    expect(body).toContain('public.bracket_typed_value(content.id) IS DISTINCT FROM expected');
    expect(body).toContain('bracket_history_immutable BEFORE UPDATE OR DELETE');
    expect(body).not.toContain('WITH RECURSIVE');
  });
  it('checks the original worker fence before and after deferred parity as well as materialization', () => {
    const deferred = body.split('CREATE FUNCTION public.validate_bracket_typed_lineage()')[1].split('CREATE FUNCTION public.guard_bracket_child_insert()')[0];
    expect(deferred).toContain('SELECT attempt.write_fence INTO STRICT fence');
    expect(deferred.match(/assert_roster_player_link_fence\(fence\)/gu)).toHaveLength(2);
    expect(body).toContain('PERFORM public.capture_bracket_typed(content.id,acceptance_id,expected);');
    expect(body).toContain("'reason','exact_receipt_replay'");
    expect(body).toContain('bracket_acceptance_fence AFTER INSERT ON public.league_roster_resource_acceptances');
    expect(body).toContain("scope.identity->'scope'->>'family'='playoff-brackets') THEN RETURN NEW");
  });
  it('grants only typed reads and the existing writer/reservation while keeping helpers private', () => {
    for (const table of tables) { expect(body).toContain(`public.league_bracket_${table}`); expect(late).toContain(`'league_bracket_${table}'`); }
    const revokes = [...body.matchAll(/REVOKE ALL ON FUNCTION ([\s\S]*?) FROM (PUBLIC|league_one_runtime);/gu)];
    for (const helper of helpers) {
      for (const role of ['PUBLIC', 'league_one_runtime']) expect(revokes.some(match => match[2] === role && match[1].includes(`public.${helper}`))).toBe(true);
      expect(late).toContain(`public.${helper}`);
    }
    expect(late).toContain("denied_privileges text:='INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'");
    expect(late).toContain('public.begin_bracket_attempt(jsonb,text,uuid,jsonb)');
  });
});

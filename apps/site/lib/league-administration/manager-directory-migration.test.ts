import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../migrations/043_manager_directory_facts.sql', import.meta.url), 'utf8');
const provisioner = readFileSync(new URL('../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
const lateRole = provisioner.split('-- BEGIN OPTIONAL MANAGER DIRECTORY FACTS GRANTS')[1]
  ?.split('-- END OPTIONAL MANAGER DIRECTORY FACTS GRANTS')[0];
const body = sql.replace(/--[^\n]*/gu, '');
const helpers = ['project_manager_commissioner_fact(jsonb)', 'validate_manager_directory_lineage()',
  'validate_manager_directory_population()', 'record_league_administration_observation_v42(jsonb)'];

describe('CP7 additive manager directory migration source guards', () => {
  it('retains the existing writer chain and changes no ownership, acceptance or intake owner', () => {
    expect(body).toContain('RENAME TO record_league_administration_observation_v42');
    expect(body).toContain("result:=public.record_league_administration_observation_v42(p_input-'managerDirectory')");
    expect(body).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:league_team_manager|league_administration_memberships|league_roster_|public_data_|projection_jobs)/iu);
    expect(body).not.toMatch(/CREATE\s+(?:OR REPLACE\s+)?FUNCTION\s+public\.(?:begin_|admit_|checkpoint_|select_|configure_)/iu);
  });

  it('distinguishes complete empty versions from missing typed evidence and checks transaction completeness', () => {
    expect(body).toContain('manager_count integer NOT NULL CHECK(manager_count>=0)');
    expect(body).toContain('FOREIGN KEY(content_id,manager_id) REFERENCES public.league_administration_manager_entries(content_id,manager_id)');
    expect(body).toContain('FOREIGN KEY(content_id,normalizer_version,league_season_id)');
    expect(body).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_manager_directory_population()');
    expect(body.match(/BEFORE UPDATE OR DELETE ON public\.league_manager_directory_/gu)).toHaveLength(2);
    expect(body).toContain("content.family<>'users'");
    expect(body).toContain('NEW.league_season_id<>content.league_season_id');
  });

  it('proves typed state/value/raw against exact native evidence and the whole projection', () => {
    expect(body).toContain("commissioner_state IN ('known','absent','null','invalid')");
    expect(body).toContain("jsonb_typeof(raw->'is_owner')='boolean'");
    expect(body).toContain("NEW.invalid_raw IS DISTINCT FROM fact->'raw'");
    expect(body).toContain("to_jsonb(NEW.commissioner_value) IS DISTINCT FROM NULLIF(fact->'value','null'::jsonb)");
    expect(body).toContain("IF projection IS DISTINCT FROM expected THEN RAISE EXCEPTION 'manager directory projection mismatch'");
    expect(body).toContain("jsonb_typeof(value->'user_id') IS DISTINCT FROM 'string'");
    expect(body).toContain("count(DISTINCT value->>'user_id')");
    expect(body).toContain("stored.normalized_value IS NOT DISTINCT FROM p_input->'value'");
  });

  it('preserves failed directory facts and fences completion of the added writes', () => {
    expect(body).toContain("p_input->>'status' IS DISTINCT FROM 'accepted'");
    expect(body).toContain("p_input->'envelope'->>'completeness' IS DISTINCT FROM 'complete' THEN RETURN result");
    expect(body).toContain("job.lease_owner=p_input->'writeFence'->>'workerId'");
    expect(body).toContain("job.attempt_count=(p_input->'writeFence'->>'generation')::integer");
    expect(body).toContain("(p_input->'writeFence'->>'deadlineAt')::timestamptz>clock_timestamp()");
    expect(body).not.toMatch(/UPDATE\s+public\.league_manager_directory_/iu);
  });

  it('makes new evidence SELECT-only and every helper private in both provisioning orders', () => {
    expect(body).toContain('REVOKE ALL ON public.league_manager_directory_versions,public.league_manager_directory_entries FROM PUBLIC');
    expect(body).toContain('GRANT SELECT ON public.league_manager_directory_versions,public.league_manager_directory_entries TO league_one_runtime');
    const migrationRevokes = [...body.matchAll(/REVOKE ALL ON FUNCTION ([\s\S]*?) FROM (PUBLIC|league_one_runtime);/gu)];
    for (const helper of helpers) {
      for (const role of ['PUBLIC', 'league_one_runtime']) {
        expect(migrationRevokes.some(match => match[2] === role && match[1].includes(`public.${helper}`))).toBe(true);
      }
      expect(lateRole).toContain(`public.${helper}`);
    }
    expect(lateRole).toContain("IF to_regclass('public.league_manager_directory_versions') IS NOT NULL");
    expect(lateRole).toContain("EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime',directory_table)");
    expect(lateRole).toContain("EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime',directory_table)");
    expect(lateRole).toContain("has_function_privilege('league_one_runtime',helper,'EXECUTE')");
    expect(lateRole).toContain("denied_privileges text:='INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'");
    expect(lateRole).toContain("current_setting('server_version_num')::integer>=170000");
    const grants = [...body.matchAll(/GRANT EXECUTE ON FUNCTION ([\s\S]*?) TO league_one_runtime;/gu)];
    expect(grants.map(match => match[1].trim())).toEqual(['public.record_league_administration_observation(jsonb)']);
  });
});

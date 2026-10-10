import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../migrations/044_public_data_period_inventory.sql', import.meta.url), 'utf8');
const previous = readFileSync(new URL('../../migrations/038_public_data_exact_periods.sql', import.meta.url), 'utf8');
const provisioner = readFileSync(new URL('../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
const body = sql.replace(/--[^\n]*/gu, '');
const lateRole = provisioner.split('-- BEGIN OPTIONAL PUBLIC PERIOD INVENTORY GRANTS')[1]
  ?.split('-- END OPTIONAL PUBLIC PERIOD INVENTORY GRANTS')[0];
const helpers = ['public_data_inventory_periods()', 'canonical_public_data_period_scope(jsonb,integer[],text)',
  'bind_public_data_inventory_task()', 'public_data_inventory_native_fields(jsonb)', 'validate_public_data_inventory_plan()',
  'validate_public_data_inventory_source()', 'preserve_public_data_inventory_bootstrap()', 'validate_public_data_inventory_population()',
  'checkpoint_public_data_intake_v43(jsonb,jsonb,jsonb)'];
const checkpoint = body.split('CREATE FUNCTION public.checkpoint_public_data_intake(p_work')[1]?.split('END; $$;')[0];

describe('CP8 additive public period inventory migration source guards', () => {
  it('preserves the strict legacy canonical helper and opts in only to the exact 2026 inventory', () => {
    expect(previous).toContain('jsonb_array_length(p_value)>3');
    expect(previous).toContain('season_value=ANY(seen)');
    expect(body).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION public\.canonical_public_data_exact_periods\(/u);
    expect(body).toContain('IF p_mode IS NULL THEN RETURN public.canonical_public_data_exact_periods(p_value,p_seasons); END IF;');
    expect(body).toContain("p_mode<>'sleeper-2026-native-period-inventory-v1' OR p_seasons IS DISTINCT FROM ARRAY[2026]");
    expect(body).toContain('p_value IS DISTINCT FROM public.public_data_inventory_periods()');
    expect(body).toContain('generate_series(1,18)');
    expect(body.match(/OR inventory<>'sleeper-2026-native-period-inventory-v1' OR p_input \? 'exactPeriods'/gu)).toHaveLength(2);
    expect(body).toContain("prevent_projection_stable_field_change('period_inventory')");
  });

  it('binds replay, configuration updates and refresh continuation to the immutable mode', () => {
    expect(body).toContain('retained.period_inventory IS DISTINCT FROM inventory');
    expect(body).toContain('configuration.period_inventory IS NOT DISTINCT FROM inventory');
    expect(body).toContain('current_request.period_inventory IS DISTINCT FROM inventory');
    expect(body).toContain('request.period_inventory IS DISTINCT FROM configuration.period_inventory');
    expect(body).toContain('request.period_inventory IS DISTINCT FROM (SELECT period_inventory');
    expect(body).toContain("CASE WHEN configuration.period_inventory IS NULL THEN jsonb_build_object('exactPeriods',configuration.exact_periods) ELSE jsonb_build_object('periodInventory',configuration.period_inventory) END");
    expect(body).toContain("configuration.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'public refresh approval expired during selection'");
  });

  it('keys tasks by exact week and keeps legacy and opted-in task bounds distinct', () => {
    expect(body).toContain('UNIQUE(intake_id,season,external_league_id,native_week)');
    expect(body).toContain('CHECK(ordinal BETWEEN 1 AND 360)');
    expect(body).toContain("NEW.ordinal NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'legacy public period task capacity exceeded'");
    expect(body).toContain('candidate_rank NOT BETWEEN 1 AND 20 OR NEW.season<>2026');
    expect(body).toContain('NEW.ordinal:=(candidate_rank-1)*18+NEW.native_week');
    expect(body).toContain('candidates>1000 OR admitted>20');
    expect(body).toContain('SELECT * FROM expected EXCEPT SELECT * FROM actual');
    expect(body).toContain('SELECT * FROM actual EXCEPT SELECT * FROM expected');
    expect(body).toContain('dense_rank() OVER(ORDER BY plan.season,plan.external_league_id)');
    expect(body).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_inventory_population()');
  });

  it('retains raw source states and immutable capture bindings without inventing period availability', () => {
    expect(body).toContain("IF NOT(p_payload ? 'settings') THEN RETURN jsonb_build_object('settingsPresent',false)");
    expect(body).toContain("jsonb_typeof(fields)='object'");
    expect(body).toContain("key IN ('leg','last_scored_leg','start_week','playoff_week_start')");
    expect(body).toContain("jsonb_build_object('settingsPresent',true,'settings',fields)");
    expect(body).toContain('PRIMARY KEY(intake_id,season,external_league_id,source_kind,source_ordinal)');
    expect(body).toContain("CHECK(source_kind<>'bootstrap' OR source_ordinal=1)");
    expect(body).toContain('WITH ORDINALITY AS native(entry,source_ordinal)');
    expect(body).toContain('list.payload->(NEW.source_ordinal-1)');
    expect(body).toContain("raw->>'league_id' IS DISTINCT FROM NEW.external_league_id");
    expect(body).toContain("public period inventory source population incomplete");
    expect(body).toContain('NEW.acquisition IS DISTINCT FROM (SELECT capture_acquisition');
    expect(body).toContain('NEW.native_fields IS DISTINCT FROM public.public_data_inventory_native_fields(raw)');
    expect(body).toContain('NEW.request_started_at IS DISTINCT FROM started OR NEW.request_completed_at IS DISTINCT FROM completed');
    expect(body).toContain('NEW.bootstrap_payload IS DISTINCT FROM OLD.bootstrap_payload');
    expect(body.match(/BEFORE UPDATE OR DELETE ON public\.public_data_period_inventory_/gu)).toHaveLength(2);
    expect(body).not.toMatch(/(?:UPDATE|DELETE FROM) public\.public_data_period_inventory_(?:plans|sources)/u);
  });

  it('delegates the effective witness checkpoint then fences all appended evidence in its transaction', () => {
    expect(body).toContain('RENAME TO checkpoint_public_data_intake_v43');
    expect(checkpoint).toContain('PERFORM public.checkpoint_public_data_intake_v43(p_work,p_capture,p_fence)');
    expect(checkpoint).toContain("IF jsonb_typeof(acquisition) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'inventory requires witnessed source capture'");
    expect(checkpoint?.indexOf('checkpoint_public_data_intake_v43')).toBeLessThan(checkpoint!.indexOf('INSERT INTO public.public_data_period_inventory_plans'));
    expect(checkpoint?.lastIndexOf('INSERT INTO public.public_data_period_inventory_sources')).toBeLessThan(checkpoint!.lastIndexOf('PERFORM public.assert_public_data_owner(request_id,p_fence)'));
    expect(checkpoint).toContain('IF mode_value IS NULL THEN RETURN; END IF;');
    expect(checkpoint?.match(/THEN RETURN;/gu)).toHaveLength(1);
    expect(checkpoint).toContain("p_capture->'failed' IS DISTINCT FROM 'true'::jsonb");
    const flush = 'SET CONSTRAINTS public_period_inventory_list_population,public_period_inventory_bootstrap_population IMMEDIATE';
    expect(checkpoint).toContain(flush);
    expect(checkpoint?.indexOf(flush)).toBeGreaterThan(checkpoint!.lastIndexOf('INSERT INTO public.public_data_period_inventory_sources'));
    expect(checkpoint?.indexOf(flush)).toBeLessThan(checkpoint!.lastIndexOf('PERFORM public.assert_public_data_owner(request_id,p_fence)'));
    expect(checkpoint?.trim()).toMatch(/PERFORM public\.assert_public_data_owner\(request_id,p_fence\);$/u);
    expect(body).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION public\.(?:admit_|recover_|record_league_administration|begin_roster)/u);
    expect(body).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:league_roster_|league_administration_|league_manager_|league_roster_player_)/u);
  });

  it('exposes only SELECT on metadata and denies every helper including the renamed predecessor in both role orders', () => {
    expect(body).toContain('REVOKE ALL ON public.public_data_period_inventory_plans,public.public_data_period_inventory_sources FROM PUBLIC');
    expect(body).toContain('GRANT SELECT ON public.public_data_period_inventory_plans,public.public_data_period_inventory_sources TO league_one_runtime');
    const revokes = [...body.matchAll(/REVOKE ALL ON FUNCTION ([\s\S]*?) FROM (PUBLIC|league_one_runtime);/gu)];
    for (const helper of helpers) {
      for (const role of ['PUBLIC', 'league_one_runtime']) {
        expect(revokes.some(match => match[2] === role && match[1].includes(`public.${helper}`))).toBe(true);
      }
      expect(lateRole).toContain(`public.${helper}`);
    }
    expect(lateRole).toContain("has_function_privilege('league_one_runtime',helper,'EXECUTE')");
    expect(lateRole).toContain("has_table_privilege('league_one_runtime','public.'||inventory_table,denied_privileges)");
    expect(lateRole).toContain("current_setting('server_version_num')::integer>=170000");
    const grants = [...body.matchAll(/GRANT EXECUTE ON FUNCTION ([\s\S]*?) TO league_one_runtime;/gu)];
    expect(grants.map(match => match[1].trim())).toEqual(['public.checkpoint_public_data_intake(jsonb,jsonb,jsonb)']);
  });
});

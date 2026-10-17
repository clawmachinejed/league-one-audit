import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'migrations/060_public_data_correction_cycle_admission.sql'), 'utf8');
const previous = readFileSync(resolve(process.cwd(), 'migrations/059_public_data_resource_schedule.sql'), 'utf8');
const provisioner = readFileSync(resolve(process.cwd(), 'scripts/provision-runtime-role.sql'), 'utf8');
function body(source: string, name: string) {
  const start = source.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.' + name + '\\('));
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('$$;', start);
  expect(end, name).toBeGreaterThan(start);
  return source.slice(start, end + 3);
}
const helper = body(migration, 'select_public_data_refresh_mode');
const selector = body(migration, 'select_public_data_resource_work');
const legacy = body(previous, 'select_public_data_refresh');

describe('R060 correction cycle admission source safety', () => {
  it('shares one existing creation algorithm through a private invoker helper', () => {
    expect(helper).toContain('p_prepare_only boolean');
    expect(helper).not.toContain('SECURITY DEFINER');
    expect(helper).toContain("p_prepare_only IS NULL THEN RAISE EXCEPTION");
    expect((migration.match(/PERFORM public\.submit_public_data_intake\(/gu) ?? [])).toHaveLength(1);
    expect(migration).not.toContain('CREATE TABLE');
    expect(migration).not.toContain('ALTER TABLE');
  });

  it('preserves the public legacy signature and original first-selection response', () => {
    const wrapper = body(migration, 'select_public_data_refresh');
    expect(wrapper).toContain('p_fence jsonb) RETURNS jsonb');
    expect(wrapper).toContain('SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp');
    expect(wrapper).toContain('SELECT public.select_public_data_refresh_mode(p_fence,false)');
    expect(helper).toContain("selected:=jsonb_build_object('status','selected','targetId',target.id,'configurationRevision',target.configuration_revision,");
    expect(helper).toContain("'cycleConfigurationRevision',cycle_row.configuration_revision,'cycle',cycle_row.cycle,'requestId',request.id)");
    expect(helper).toContain("payload=payload||jsonb_build_object('requestId',request.id,'refreshSelection',selected)");
    expect(helper).toContain("RETURN jsonb_build_object('status',CASE WHEN has_capacity THEN 'capacity' WHEN has_backoff THEN 'backoff' ELSE 'idle' END,");
    expect(helper).toContain("RAISE EXCEPTION 'refresh request scope changed'");
  });

  it('returns durable selection replay and abandoned recovery before preparation', () => {
    const prepare = selector.indexOf('PERFORM public.select_public_data_refresh_mode(p_fence,true)');
    expect(selector.indexOf('RETURN public.public_data_resource_selection_json(selected)')).toBeLessThan(prepare);
    expect(selector.indexOf('WHERE NOT EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes')).toBeLessThan(prepare);
    expect(selector.indexOf("'resourceSelection',public.public_data_resource_selection_json(selected)) WHERE job_key=job.job_key")).toBeLessThan(prepare);
    expect(selector.indexOf('SELECT resource.* INTO active_resource FROM public.public_data_resources resource')).toBeGreaterThan(prepare);
    expect(selector.indexOf('FROM public.public_data_intakes request\n   LEFT JOIN public.public_data_history_service')).toBeGreaterThan(prepare);
  });

  it('prepares history independently of active or queued imports without a temporary binding', () => {
    expect(selector).not.toContain('IF active_resource.id IS NULL AND history_request IS NULL THEN');
    expect(selector).not.toContain('legacy_selection');
    expect(selector).not.toContain('public.select_public_data_refresh(p_fence)');
    expect(helper).toContain('public correction preparation cannot replace a refresh selection');
    const skip = helper.indexOf('IF p_prepare_only THEN\n      -- A current unfinished cycle');
    expect(skip).toBeGreaterThan(helper.indexOf("RAISE EXCEPTION 'refresh request scope changed'"));
    expect(helper.slice(skip, helper.indexOf('selected:=jsonb_build_object', skip))).toContain('CONTINUE;');
  });

  it('bounds target work and new cycles while still reconciling later terminal targets', () => {
    expect(helper).toContain('LIMIT 16 FOR UPDATE SKIP LOCKED LOOP');
    const terminal = helper.indexOf('IF request.terminal THEN');
    const limit = helper.indexOf('IF p_prepare_only AND created_cycles>=1 THEN CONTINUE; END IF;');
    const insert = helper.indexOf('INSERT INTO public.public_data_refresh_cycles');
    expect(terminal).toBeLessThan(limit);
    expect(limit).toBeLessThan(insert);
    expect(helper.indexOf('created_cycles:=created_cycles+1')).toBeGreaterThan(insert);
    expect(helper).toContain("'checkedTargets',checked,'createdCycles',created_cycles");
  });

  it('retains original owner and admission deadline before, during and after metadata writes', () => {
    expect(helper).toContain("SELECT (payload->>'batchAdmissionDeadlineAt')::timestamptz INTO STRICT admission_deadline");
    expect((helper.match(/public\.assert_public_data_resource_owner\(p_fence\)/gu) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((helper.match(/admission_deadline<=clock_timestamp\(\)/gu) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(helper.indexOf('admission_deadline<=clock_timestamp()')).toBeLessThan(helper.indexOf('pg_advisory_xact_lock'));
    expect(helper.lastIndexOf('admission_deadline<=clock_timestamp()')).toBeGreaterThan(helper.indexOf('END LOOP;'));
    expect(migration).not.toContain('lease_until=');
    expect(migration).not.toContain('batchAdmissionDeadlineAt\',clock_timestamp');
  });

  it('keeps current and original cycle scope validation before skipping unfinished work', () => {
    for (const column of ['draft_picks', 'transaction_history', 'weekly_reports', 'playoff_brackets', 'period_inventory', 'exact_periods']) {
      expect(helper).toContain('request.' + column + ' IS DISTINCT FROM configuration.' + column);
      expect(helper).toContain('SELECT ' + column + ' FROM public.public_data_refresh_configurations');
    }
    expect(helper).toContain('request.seasons IS DISTINCT FROM configuration.seasons');
    expect(helper).toContain('request.transaction_period IS NOT NULL');
    expect(helper).toContain('public.record_public_data_resource_target_failure(target.id,target.configuration_revision,cycle_row.cycle,p_fence)');
    expect(helper).not.toContain('EXCEPTION WHEN OTHERS');
  });

  it('retains pause, expiry, target backoff and ordinary sixteen-request capacity', () => {
    for (const statement of [
      'IF configuration.paused OR configuration.expires_at<=clock_timestamp() THEN CONTINUE; END IF;',
      'IF target.selection_next_eligible_at>clock_timestamp() THEN has_backoff:=true; CONTINUE; END IF;',
      'WHERE NOT terminal AND resource_occurrence_id IS NULL)>=16',
      'pg_advisory_xact_lock(hashtextextended(\'public-data-intake-admission\',0))',
    ]) {
      expect(helper).toContain(statement);
      expect(legacy).toContain(statement);
    }
    expect(helper).not.toContain('SET terminal=false');
    expect(helper).not.toContain('SET revision=0');
  });

  it('retains immutable terminal outcomes and the existing cadence calculation', () => {
    const start = '          terminal_time:=clock_timestamp();';
    const end = '          target.next_due_at:=next_due;';
    const clock = (source: string) => source.slice(source.indexOf(start), source.indexOf(end) + end.length).replace(/\r/gu, '');
    expect(clock(helper)).toEqual(clock(legacy));
    expect(helper).toContain('IF NOT EXISTS(SELECT 1 FROM public.public_data_refresh_cycle_outcomes');
    expect(helper).not.toContain('UPDATE public.public_data_refresh_cycle_outcomes');
  });

  it('does not charge metadata or change normal history service arbitration', () => {
    expect(helper).not.toContain('public_data_dispatches');
    expect(helper).not.toContain('public_data_resource_service');
    expect(helper).not.toContain('history_credit');
    expect(helper).not.toContain('SET last_served_at');
    expect(selector).toContain('credit>=4*history_cost');
    expect(selector).toContain('ORDER BY service.last_served_at NULLS FIRST,request.created_at,request.id');
    expect(selector).toContain('ORDER BY resource.due_at,resource.last_served_at NULLS FIRST,resource.id');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.admit_public_data_batch_dispatch');
  });

  it('denies direct helper execution to public and all restricted roles, including late roles', () => {
    const signature = 'public.select_public_data_refresh_mode(jsonb,boolean)';
    for (const source of [migration, provisioner]) {
      expect(source).toContain('REVOKE ALL ON FUNCTION ' + signature + ' FROM PUBLIC');
      expect(source).toContain("ARRAY['league_one_runtime','league_one_account','league_one_auth']");
      expect(source).toContain("has_function_privilege(role_name,'" + signature + "','EXECUTE')");
      expect(source).not.toContain('GRANT EXECUTE ON FUNCTION ' + signature);
    }
    expect(provisioner).toContain("privilege.grantee=0 AND privilege.privilege_type='EXECUTE'");
    expect(migration).not.toContain('REVOKE ALL ON FUNCTION public.select_public_data_refresh(jsonb)');
  });
});

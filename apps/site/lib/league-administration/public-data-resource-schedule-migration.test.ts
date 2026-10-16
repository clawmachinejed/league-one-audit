import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'migrations/059_public_data_resource_schedule.sql'), 'utf8');
const provisioner = readFileSync(resolve(process.cwd(), 'scripts/provision-runtime-role.sql'), 'utf8');
function body(name: string) {
  const start = migration.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.' + name + '\\('));
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf('$$;', start);
  expect(end, name).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}

describe('R059 public resource schedule source safety', () => {
  it('is an explicit capability using the existing owner and original R058 bounds', () => {
    expect(body('public_data_resource_schedule_capability')).toContain("'public-data-resource-schedule-v1'");
    expect(body('begin_public_data_resource_batch')).toContain('public.begin_public_data_batch(p_worker,p_invocation_started_at,NULL)');
    expect(body('assert_public_data_resource_owner')).toContain('public.assert_public_data_batch_owner(p_fence)');
    expect(migration).not.toContain("lease_until=clock_timestamp()+");
    expect(migration).not.toContain('CREATE TABLE public.projection_jobs');
  });
  it('keeps internal identity and discovery rows as marked inherited FK support', () => {
    const seed = body('seed_public_data_resource_occurrence');
    expect(seed).toContain("'inheritedFromIntakeId',origin.intake_id,'resourceOccurrenceId',request_id");
    expect(seed).toContain("SELECT request_id,season,'[]'::jsonb,request_started_at,request_completed_at");
    expect(seed).not.toContain('SELECT request_id,season,payload');
    expect(migration).toContain("prevent_projection_stable_field_change('resource_occurrence_id')");
    expect(migration).toContain('resource_occurrence_id IS NULL OR resource_occurrence_id=id');
    const validation = body('validate_public_data_resource_occurrence');
    expect(validation).toContain("identity_row.payload IS DISTINCT FROM jsonb_build_object");
    expect(validation).toContain("list_row.payload IS DISTINCT FROM '[]'::jsonb");
    expect(validation).toContain('original_list.request_completed_at');
    expect(validation).toContain('original_identity.request_completed_at');
    expect(validation).toContain('occurrence.source_mapping IS DISTINCT FROM resource.source_mapping');
  });
  it('rejects synthetic origins, public replay, approval and direct work', () => {
    expect(body('configure_public_data_refresh')).toContain('internal occurrence cannot authorize public identity');
    expect(body('submit_public_data_intake')).toContain('retained.resource_occurrence_id IS NOT NULL');
    expect(body('begin_public_data_batch')).toContain('internal occurrence requires scheduled authority');
    expect(body('seed_public_data_resource_occurrence')).toContain('resource occurrence cannot be an origin');
    expect(body('guard_public_data_intake')).toContain('internal occurrence selection required');
  });
  it('does not charge internal occurrences to the ordinary sixteen-intake capacity', () => {
    expect(body('submit_public_data_intake')).toContain('WHERE NOT terminal AND resource_occurrence_id IS NULL)>=16');
    expect(body('select_public_data_refresh')).toContain('WHERE NOT terminal AND resource_occurrence_id IS NULL)>=16');
    expect(body('select_public_data_resource_work')).toContain('request.resource_occurrence_id IS NULL');
  });
  it('keeps ordinary selection intact and core-only occurrence work explicit', () => {
    const next = body('next_public_data_intake');
    expect(next).toContain('RETURN public.next_public_data_intake_v58(p_id)');
    expect(next).toContain("WHEN 'users' THEN 'complete'");
    expect(next).toContain("resource.kind<>'core'");
    expect(next).not.toContain("'kind','identity'");
    expect(next).not.toContain("'kind','leagues'");
    expect(next).not.toContain("'kind','bootstrap'");
    expect(next).not.toContain("'kind','users'");
  });
  it('reuses typed checkpoints and ordinary revision-based abandoned-dispatch recovery', () => {
    expect(body('checkpoint_public_data_intake')).toContain('public.checkpoint_public_data_intake_v58(p_work,p_capture,p_fence)');
    expect(body('recover_public_data_dispatch')).toContain('public.recover_public_data_dispatch_v58(p_selected,p_fence)');
    expect(migration).not.toContain('UPDATE public.league_roster_capture_receipts');
    expect(migration).not.toContain('INSERT INTO public.league_roster_capture_receipts');
    expect(migration).not.toContain('SET terminal=false');
    expect(migration).not.toContain('SET revision=0');
  });
  it('derives each due clock from its successfully checkpointed native family receipt', () => {
    const reconcile = body('reconcile_public_data_resource_request');
    expect(reconcile).toContain("resource.kind='core' THEN SELECT players_receipt_id");
    expect(reconcile).toContain("resource.kind='exact-matchups' THEN SELECT matchups_receipt_id");
    expect(reconcile).toContain('SELECT transaction_receipt_id');
    expect(reconcile).toContain("outcome.outcome='checkpoint-committed'");
    expect(reconcile).toContain("receipt.provenance->>'sourceObservedAt'=receipt.provenance->>'requestCompletedAt'");
    expect(reconcile).toContain("due_at=observed_at+interval '4 minutes'");
    expect(reconcile).not.toContain('original_identity');
    expect(reconcile).not.toContain('settings_receipt_id');
  });
  it('requires explicit current native period and current approval/mapping', () => {
    const configure = body('configure_public_data_resource_schedule');
    expect(configure).toContain('target.configuration_revision<>revision_value');
    expect(configure).toContain('public resource configuration replay mismatch');
    expect(configure).toContain('configuration.transaction_history IS NULL');
    expect(configure).toContain('configuration.exact_periods @>');
    expect(configure).not.toContain('UPDATE public.public_data_resources');
    expect(configure).not.toContain('UPDATE public.public_data_resource_service');
    const authority = body('public_data_resource_authority_valid');
    expect(authority).toContain("content.payload->>'status'='in_season'");
    expect(authority).toContain("content.payload->'settings'->>'leg'=authority.active_native_week::text");
    expect(authority).toContain('connection.current_mapping_revision_id=resource.mapping_revision_id');
    expect(authority).toContain('configuration.expires_at>clock_timestamp()');
  });
  it('validates complete current and cycle historical selector authority', () => {
    const authority = body('public_data_history_authority_valid');
    for (const column of ['seasons', 'exact_periods', 'period_inventory', 'playoff_brackets', 'weekly_reports', 'transaction_history', 'draft_picks']) {
      expect(authority).toContain('current_config.' + column);
      expect(authority).toContain('cycle_config.' + column);
    }
    expect(body('admit_public_data_batch_dispatch')).toContain('public.public_data_history_authority_valid(selected.intake_id)');
  });
  it('reserves HTTP and records service atomically only after duplicate and quota checks', () => {
    const admit = body('admit_public_data_batch_dispatch');
    const insertion = admit.indexOf('INSERT INTO public.public_data_dispatches');
    expect(admit.indexOf('IF EXISTS(SELECT 1 FROM public.public_data_dispatches')).toBeLessThan(insertion);
    expect(admit.indexOf('public.public_data_batch_budget_available(request_cost)')).toBeLessThan(insertion);
    expect(admit.indexOf('history_credit=least(10,history_credit+request_cost)')).toBeGreaterThan(insertion);
    expect(admit).toContain('history_credit=greatest(0,history_credit-4*request_cost)');
    expect(admit).toContain("selected.lane='history' AND selected.target_id IS NOT NULL");
    expect(body('fail_public_data_resource_selection')).not.toContain('history_credit=');
    expect(body('reconcile_public_data_resource_request')).not.toContain('history_credit=');
  });
  it('carries cost rounding and orders eligible history independently of username target churn', () => {
    const select = body('select_public_data_resource_work');
    expect(select).toContain('credit>=4*history_cost');
    expect(select).toContain('ORDER BY service.last_served_at NULLS FIRST,request.created_at,request.id');
    expect(select).toContain('ORDER BY resource.due_at,resource.last_served_at NULLS FIRST,resource.id');
    expect(migration).toContain('history_credit BETWEEN 0 AND 10');
    // At credit7 a2-HTTP active step owes9, then2-HTTP history owes1.
    // A cap8 would incorrectly forgive1 credit and deliver9:2 service forever.
    expect(Math.min(10, 7 + 2) - 4 * 2).toBe(1);
  });
  it('can bind abandoned work for recovery after permission or active period changes', () => {
    const select = body('select_public_data_resource_work');
    expect(select.indexOf('Recovery authority is distinct')).toBeLessThan(select.indexOf('public.public_data_resource_authority_valid'));
    expect(select).toContain('WHERE NOT EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes');
    expect(body('guard_public_data_intake')).not.toContain('public_data_resource_authority_valid');
    expect(body('admit_public_data_batch_dispatch')).toContain('public.public_data_resource_authority_valid');
    expect(body('advance_public_data_batch_owner')).toContain("ARRAY['requestId','refreshSelection','resourceSelection']");
    expect(body('advance_public_data_batch_owner')).toContain('public batch prior task is not fully checkpointed');
  });
  it('isolates identified malformed legacy scopes with a real owner journal and target-local backoff', () => {
    const legacy = body('select_public_data_refresh');
    expect(legacy).toContain('public.record_public_data_resource_target_failure');
    expect(legacy).toContain('CONTINUE;');
    expect(legacy).toContain("RAISE EXCEPTION 'refresh request scope changed'");
    const journal = body('record_public_data_resource_target_failure');
    expect(journal).toContain('public.assert_public_data_resource_owner(p_fence)');
    expect(journal).toContain('INSERT INTO public.public_data_resource_target_failures');
    expect(journal).toContain('selection_next_eligible_at=retry_at');
    expect(body('select_public_data_resource_work')).not.toContain('EXCEPTION WHEN OTHERS');
  });
  it('preserves the single controlled submission algorithm and durable capacity receipts', () => {
    const submit = body('submit_public_data_intake');
    expect(submit).toContain('p_retain_capacity_receipt boolean');
    expect(submit).toContain("jsonb_typeof(p_input) IS DISTINCT FROM 'object'");
    expect(submit).toContain('retained.resource_occurrence_id IS NOT NULL');
    expect(submit).toContain('WHERE NOT terminal AND resource_occurrence_id IS NULL)>=16');
    expect(submit).toContain('retained.submission_capacity IS NOT NULL AND NOT p_retain_capacity_receipt');
    expect(submit).toContain("capacity_reason:='pending-request-limit'");
    expect(migration).toContain('PERFORM public.submit_public_data_intake(p_input,false)');
  });
  it('terminalizes exhausted occurrences through existing failure handlers and clears their open pointer', () => {
    expect(body('next_public_data_intake')).toContain(`IF task_status<>'pending' OR request.terminal THEN RETURN '"partial"'::jsonb`);
    const reconcile = body('reconcile_public_data_resource_request');
    expect(reconcile).toContain('ELSIF request.terminal THEN');
    expect(reconcile).toContain('SET open_intake_id=NULL,failure_count=least(7,failure_count+1)');
    expect(reconcile).toContain("next_eligible_at=clock_timestamp()+interval '60 seconds'");
  });
  it('rejects worker UUID reuse after a target failure without a dispatch', () => {
    expect(body('begin_public_data_batch')).toContain('public.public_data_resource_target_failures WHERE worker_id=p_worker');
    expect(body('advance_public_data_batch_owner')).toContain('public.public_data_resource_target_failures WHERE worker_id=p_next_worker');
  });
  it('closes renamed entry points and provisions matching late-role grants', () => {
    for (const signature of ['public.begin_public_data_resource_batch(text,timestamptz)',
      'public.configure_public_data_resource_schedule(jsonb)', 'public.select_public_data_resource_work(jsonb)',
      'public.fail_public_data_resource_selection(jsonb,text,jsonb)', 'public.checkpoint_public_data_intake_v58(jsonb,jsonb,jsonb)',
      'public.guard_public_data_intake_v58(jsonb,jsonb)', 'public.recover_public_data_dispatch_v58(uuid,jsonb)',
      'public.seed_public_data_resource_occurrence(uuid,uuid,bigint,jsonb)']) {
      expect(migration).toContain("'" + signature + "'");
      expect(provisioner).toContain("'" + signature + "'");
    }
    expect(provisioner).toContain('runtime can execute private resource schedule helper');
    expect(provisioner).toContain('incorrect resource scheduling table privileges');
    expect(provisioner).toContain("privilege.grantee=0 AND privilege.privilege_type='EXECUTE'");
  });
});

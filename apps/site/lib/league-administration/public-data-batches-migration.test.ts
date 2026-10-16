import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// These checks freeze the reviewed source safety contract. They do not execute
// PostgreSQL or qualify installed constraints, privileges, concurrency or clocks.
const sql = readFileSync(new URL('../../migrations/058_public_data_batches.sql', import.meta.url), 'utf8');
function body(name: string): string {
  const start = sql.indexOf('FUNCTION public.' + name + '(');
  if (start < 0) throw new Error('Missing SQL function ' + name);
  const begin = sql.indexOf('AS $$', start);
  return sql.slice(begin + 5, sql.indexOf('$$;', begin));
}

describe('CP26 bounded DATA batching migration source contract', () => {
  it('adds an explicit capability without replacing the singleton or historical identity schemas', () => {
    expect(body('public_data_batch_capability')).toContain("'public-data-batch-v1'::text");
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|TRUNCATE|DELETE FROM|ADD COLUMN/u);
    expect(sql).not.toMatch(/UPDATE public\.(?:league_roster_capture_receipts|league_roster_resource_acceptances|public_data_dispatches|public_data_dispatch_outcomes)/u);
    expect(sql).not.toContain('dispatchId');
    expect(sql).not.toContain('childGeneration');
  });

  it('rejects future or late origins and derives all four deadlines from the original invocation', () => {
    const begin = body('begin_public_data_batch');
    expect(begin).toContain('p_invocation_started_at>current_time_value');
    expect(begin).toContain("p_invocation_started_at+interval '5 seconds'<current_time_value");
    for (const seconds of [10, 20, 22, 25]) expect(begin).toContain("p_invocation_started_at+interval '" + seconds + " seconds'");
    expect(begin).toContain("date_trunc('minute',p_invocation_started_at)");
    expect(begin).toContain("projection_jobs.state='completed' AND EXCLUDED.scheduled_for>projection_jobs.scheduled_for");
    expect(begin).not.toContain("clock_timestamp()+interval '25 seconds'");
    expect(begin).toContain('public.assert_public_data_batch_owner');
  });

  it('preserves the existing four-field witness fence and validates stored absolute bounds', () => {
    const result = body('public_data_batch_claim_result');
    expect(result).toContain("'jobKey',p_job.job_key,'workerId',p_job.lease_owner,'generation',p_job.attempt_count");
    expect(result).toContain("'deadlineAt',p_job.payload->>'batchWorkDeadlineAt'");
    expect(result).not.toContain('parent');
    const owner = body('assert_public_data_batch_owner');
    expect(owner).toContain('FOR UPDATE');
    expect(owner).toContain("job.payload->>'batchPolicy' IS DISTINCT FROM 'public-data-batch-v1'");
    expect(owner).toContain("job.lease_until IS DISTINCT FROM origin+interval '25 seconds'");
    expect(owner).toContain("(p_fence->>'deadlineAt')::timestamptz IS DISTINCT FROM origin+interval '20 seconds'");
    expect(owner).toContain('job.attempt_count IS DISTINCT FROM');
    expect(owner).toContain("p_fence->>'generation' !~ '^[1-9][0-9]*$'");
    expect(owner).toContain('count(*) FROM jsonb_object_keys(p_fence))<>4');
    expect(owner).toContain('OR NOT isfinite(origin) OR origin>clock_timestamp()');
  });

  it('advances only fully committed work with no open typed reservation and rotates both owner and generation', () => {
    const advance = body('advance_public_data_batch_owner');
    expect(advance).toContain("outcome.outcome='checkpoint-committed'");
    expect(advance).toContain('attempt.write_fence=p_fence');
    expect(advance).toContain('receipt.attempt_id=attempt.id');
    expect(advance).toContain('p_next_worker=job.lease_owner');
    expect(advance).toContain('worker_id=p_next_worker');
    expect(advance).toContain('lease_owner=p_next_worker,attempt_count=attempt_count+1');
    expect(advance).toContain('lease_owner=job.lease_owner AND attempt_count=job.attempt_count');
    const assignment = advance.slice(advance.indexOf('UPDATE public.projection_jobs SET'), advance.indexOf('RETURNING * INTO STRICT job'));
    expect(assignment).not.toMatch(/SET[\s\S]*(?:lease_until|scheduled_for|completed_at)\s*=/u);
    expect(advance).toContain("THEN RETURN jsonb_build_object('kind','deadline')");
  });

  it('keeps direct request binding while clearing only a recurring step selection', () => {
    const begin = body('begin_public_data_batch');
    expect(begin).toContain("jsonb_build_object('policy','public-data-intake-v1','requestId',p_request,'batchMode','direct')");
    expect(begin).toContain("jsonb_build_object('policy','public-data-refresh-v1','mode','recurring','batchMode','recurring')");
    const advance = body('advance_public_data_batch_owner');
    expect(advance).toContain("THEN job.payload-ARRAY['requestId','refreshSelection'] ELSE job.payload END");
    expect(advance).toContain("job.payload->'refreshSelection'->>'requestId' IS DISTINCT FROM dispatch.intake_id::text");
  });

  it('charges all admitted physical-request maxima including failures and the shared catalog without refunds', () => {
    const budget = body('public_data_batch_budget_available');
    expect(budget).toContain("reserved.at_time>budget_now-interval '80 seconds'");
    expect(budget).toContain("dispatch.admitted_at>budget_now-interval '3620 seconds'");
    expect(budget).toContain('dispatch.max_requests AS cost');
    expect(budget).toContain('UNION ALL SELECT attempt.reserved_at,1 FROM public.league_player_directory_attempts');
    expect(budget).toContain('minute_total+p_cost<=40 AND hour_total+p_cost<=1800');
    expect(budget).not.toMatch(/outcome|checkpoint|status|refund/u);
    const admission = body('admit_public_data_batch_dispatch');
    expect(admission).toContain("IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END");
    expect(admission.indexOf('public.public_data_batch_budget_available')).toBeLessThan(admission.indexOf('INSERT INTO public.public_data_dispatches'));
    expect(sql).toContain('Reports are POST');
  });

  it('retains legacy admission and catalog rules behind a common protective budget interlock', () => {
    const admission = body('admit_public_data_dispatch');
    expect(admission).toContain('public.assert_public_data_owner');
    expect(admission).toContain('explicit public batch admission required');
    expect(admission.indexOf('public.public_data_batch_budget_available')).toBeLessThan(admission.indexOf('RETURN public.admit_public_data_dispatch_v57'));
    const catalog = body('begin_player_directory_attempt');
    expect(catalog.indexOf('public.assert_player_directory_owner')).toBeLessThan(catalog.indexOf('public.public_data_batch_budget_available'));
    expect(catalog).toContain('RETURN public.begin_player_directory_attempt_v57(p_id,p_fence)');
    expect(sql).toContain('ALTER FUNCTION public.admit_public_data_dispatch(jsonb,jsonb) RENAME TO admit_public_data_dispatch_v57');
    expect(sql).toContain('ALTER FUNCTION public.begin_player_directory_attempt(uuid,jsonb) RENAME TO begin_player_directory_attempt_v57');
  });

  it('preserves the legacy task order and current-head receipt semantics without new priority', () => {
    const next = body('next_public_data_batch_intake');
    expect(next.replace(/--[^\n]*/gu, '').trim()).toBe('SELECT public.next_public_data_intake(p_id)');
    expect(next).not.toContain('public_data_league_candidates');
    expect(next).not.toMatch(/UPDATE|INSERT INTO|DELETE FROM/u);
    expect(next).not.toContain('sourceObservedAt');
  });

  it('freezes exact admitted work under its live owner instead of reranking after typed writes', () => {
    const guard = body('guard_public_data_intake');
    expect(guard).toContain("public.assert_public_data_batch_owner(p_fence-'reserveCollection')");
    expect(guard).toContain("p_fence ? 'reserveCollection' AND (p_work->>'kind' IS DISTINCT FROM 'bootstrap'");
    expect(guard).toContain("p_fence->'reserveCollection' IS DISTINCT FROM 'true'::jsonb");
    expect(body('assert_public_data_batch_owner')).toContain('count(*) FROM jsonb_object_keys(p_fence))<>4');
    expect(guard).toContain('dispatch.work IS DISTINCT FROM p_work');
    expect(guard).toContain('dispatch.revision<>request.revision');
    expect(guard).toContain('public_data_dispatch_outcomes outcome');
    expect(guard).toContain('ELSIF public.next_public_data_batch_intake(request.id) IS DISTINCT FROM p_work');
    expect(guard).toContain('ELSIF public.next_public_data_intake(request.id) IS DISTINCT FROM p_work');
    expect(guard).toContain('public.assert_league_collection_capacity(native)');
  });

  it('keeps recurring approval, cycle CAS, target fairness and incomplete-dispatch recovery guards', () => {
    const admission = body('admit_public_data_batch_dispatch');
    for (const required of ["configuration.paused", 'configuration.expires_at<=clock_timestamp()',
      'target.selection_next_eligible_at>clock_timestamp()', 'target.current_cycle<>cycle_row.cycle',
      "'cycleConfigurationRevision',cycle_row.configuration_revision", 'public dispatch recovery required',
      'last_served_at=clock_timestamp()', "batchAdmissionDeadlineAt", 'public.guard_public_data_intake']) {
      expect(admission).toContain(required);
    }
  });

  it('preserves the same interface and denies private bypasses when the runtime role is provisioned later', () => {
    const provisioning = readFileSync(new URL('../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
    const start = provisioning.indexOf('-- BEGIN OPTIONAL PUBLIC DATA BATCH GRANTS');
    const block = provisioning.slice(start, provisioning.indexOf('-- END OPTIONAL PUBLIC DATA BATCH GRANTS', start));
    expect(start).toBeGreaterThan(0);
    expect(block).toContain("to_regprocedure('public.public_data_batch_capability()') IS NOT NULL");
    for (const entry of ['public_data_batch_capability()', 'begin_public_data_batch(text,timestamptz,uuid)',
      'advance_public_data_batch_owner(jsonb,text)', 'next_public_data_batch_intake(uuid)',
      'admit_public_data_batch_dispatch(jsonb,jsonb)']) expect(block).toContain(entry);
    for (const helper of ['public_data_batch_claim_result(public.projection_jobs)', 'assert_public_data_batch_owner(jsonb)',
      'public_data_batch_budget_available(integer)', 'admit_public_data_dispatch_v57(jsonb,jsonb)',
      'begin_player_directory_attempt_v57(uuid,jsonb)']) expect(block).toContain(helper);
    expect(block).toContain('REVOKE ALL ON FUNCTION %s FROM PUBLIC,league_one_runtime');
    expect(block).toContain("has_function_privilege('league_one_runtime',helper,'EXECUTE')");
    expect(block).toContain('GRANT EXECUTE ON FUNCTION %s TO league_one_runtime');
    expect(block).toContain("NOT has_function_privilege('league_one_runtime',entry_point,'EXECUTE')");
    expect(block).toContain("privilege.grantee=0 AND privilege.privilege_type='EXECUTE'");
  });

  it('exposes only deliberate runtime entry points and keeps internal and renamed bypass helpers private', () => {
    const privileges = sql.slice(sql.indexOf('REVOKE ALL ON FUNCTION public.public_data_batch_capability'));
    for (const helper of ['public_data_batch_claim_result(public.projection_jobs)', 'assert_public_data_batch_owner(jsonb)',
      'public_data_batch_budget_available(integer)', 'admit_public_data_dispatch_v57(jsonb,jsonb)', 'begin_player_directory_attempt_v57(uuid,jsonb)']) {
      expect(privileges).toContain(helper);
    }
    expect(privileges).toContain('FROM PUBLIC');
    expect(privileges).toContain('FROM league_one_runtime');
    const grant = privileges.slice(privileges.indexOf('GRANT EXECUTE'));
    expect(grant).toContain('begin_public_data_batch(text,timestamptz,uuid)');
    expect(grant).toContain('advance_public_data_batch_owner(jsonb,text)');
    expect(grant).not.toContain('public_data_batch_budget_available');
    expect(grant).not.toContain('_v57');
  });
});

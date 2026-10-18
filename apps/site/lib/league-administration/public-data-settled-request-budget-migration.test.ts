import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source invariants only. Installed-SQL diagnostics separately exercise arithmetic,
// privilege, clock, capture, status and atomic-service behavior.
const sql = readFileSync(new URL('../../migrations/062_public_data_settled_request_budget.sql', import.meta.url), 'utf8');
const provisioner = readFileSync(new URL('../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
function body(name: string) {
  const begin = sql.indexOf('CREATE FUNCTION public.' + name + '(');
  if (begin < 0) throw new Error('Missing reviewed function ' + name);
  const end = sql.indexOf('$$;', begin);
  return sql.slice(begin, end + 3);
}
const settled = body('public_data_settled_capture_upper_bound');
const trigger = body('record_public_data_settled_request_bound');
const budget = body('public_data_settled_request_budget');
const direct = body('admit_public_data_settled_direct_status');
const scheduled = body('admit_public_data_batch_dispatch_status');
const policy = 'public-data-settled-request-budget-v1';

describe('R062 settled request reservation source invariants', () => {
  it('adds only explicit append-only metadata and a closed capability', () => {
    expect(body('public_data_settled_request_budget_capability')).toContain("SELECT '" + policy + "'::text");
    expect(sql).toContain('ALTER TABLE public.public_data_dispatches ADD COLUMN request_budget_policy text');
    expect(sql).toContain('ALTER TABLE public.public_data_dispatch_outcomes ADD COLUMN settled_request_upper_bound_at timestamptz');
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|TRUNCATE|DELETE FROM|DISABLE TRIGGER/u);
    expect(sql).not.toMatch(/UPDATE public\.(?:public_data_dispatches|public_data_dispatch_outcomes|league_roster_capture_receipts)/u);
  });
  it('does not replace legacy boolean admission, the original budget or the catalog', () => {
    expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public\.(?:public_data_batch_budget_available|admit_public_data_dispatch|admit_public_data_batch_dispatch|begin_player_directory_attempt)\(/u);
    expect(sql).not.toContain('RENAME TO');
    expect(sql).not.toContain('next_network_at');
    expect(sql).not.toContain('minimumIntervalSeconds');
  });
  it('derives the bound once in a private BEFORE INSERT trigger and overwrites caller input', () => {
    expect(trigger).toContain('NEW.settled_request_upper_bound_at:=NULL');
    expect(trigger).toContain('public.public_data_settled_capture_upper_bound(dispatch_row,NEW)');
    expect(trigger).not.toContain('SECURITY DEFINER');
    expect(sql).toContain('BEFORE INSERT ON public.public_data_dispatch_outcomes');
    expect(budget).not.toContain('public_data_settled_capture_upper_bound');
    expect(budget).not.toContain('league_roster_capture_receipts');
  });
  it('requires marked genuine checkpoint success and original exact witness identity', () => {
    for (const fragment of ["p_dispatch.request_budget_policy IS DISTINCT FROM '" + policy + "'", "p_outcome.outcome IS DISTINCT FROM 'checkpoint-committed'",
      "acquisition->'work' IS DISTINCT FROM p_dispatch.work", "acquisition->>'dispatchNonce' IS DISTINCT FROM p_dispatch.capture_nonce::text",
      "fence->>'workerId' IS DISTINCT FROM p_dispatch.worker_id", "fence->>'generation' IS DISTINCT FROM p_dispatch.generation::text",
      'p_outcome.recorded_at<p_dispatch.admitted_at', 'p_outcome.recorded_at>clock_timestamp()']) expect(settled).toContain(fragment);
    expect(settled).not.toContain('assert_public_data_owner');
    expect(settled).not.toContain('validate_current_roster_mapping');
  });
  it('requires every unique reservation role and exact receipt acquisition before settlement', () => {
    for (const fragment of ['managersV2', "ARRAY['settings','matchups']", "ARRAY['winners_bracket','losers_bracket']",
      'weekly_report', 'draftMetadata', 'draftSelections', 'tradedPicks', "count(DISTINCT value->>'id')", "count(DISTINCT value->>'nonce')",
      'attempt.write_fence=fence', 'attempt_row.capture_nonce::text', "receipt_row.provenance->'acquisition' IS DISTINCT FROM acquisition",
      'accepted_time<receipt_row.recorded_at', 'accepted_time>p_outcome.recorded_at']) expect(settled).toContain(fragment);
  });
  it('binds non-typed captures to the same original request and native scope', () => {
    for (const fragment of ['public.public_data_identity_observations WHERE intake_id=p_dispatch.intake_id',
      'public.public_data_league_lists WHERE intake_id=p_dispatch.intake_id', "external_league_id=p_dispatch.work->>'externalLeagueId'",
      'worker_id=p_dispatch.worker_id AND generation=p_dispatch.generation AND intake_id=p_dispatch.intake_id',
      "directory_row.source_mapping IS DISTINCT FROM acquisition->'mapping'"]) expect(settled).toContain(fragment);
  });
  it('preserves both clock domains and includes every successful completion and SQL time in the bound', () => {
    for (const fragment of ['upper_bound:=greatest(p_dispatch.admitted_at,p_outcome.recorded_at)',
      'upper_bound:=greatest(upper_bound,accepted_time)', 'upper_bound:=greatest(upper_bound,completed_time,checked_time,reserved_time,recorded_time)',
      'started_time>completed_time', 'observed_time IS DISTINCT FROM completed_time', 'checked_time<completed_time',
      'reserved_time<p_dispatch.admitted_at', 'recorded_time<reserved_time', 'recorded_time>p_outcome.recorded_at',
      'NOT isfinite(started_time)', 'EXCEPTION WHEN invalid_text_representation']) expect(settled).toContain(fragment);
  });
  it('retains full reservation weight and conservative legacy/catalog fallback windows', () => {
    expect(budget).toContain('dispatch.max_requests AS cost');
    expect(budget).toContain('minute_cost+p_cost<=30');
    expect(budget).toContain('hour_cost+p_cost<=1800');
    expect(budget).not.toContain('minute_cost+p_cost<=40');
    expect(budget).toContain('UNION ALL SELECT 1,attempt.reserved_at');
    expect(budget).toContain("ELSE dispatch.admitted_at+interval '80 seconds'");
    expect(budget).toContain("ELSE dispatch.admitted_at+interval '3620 seconds'");
    expect(budget).toContain("least(dispatch.admitted_at+interval '80 seconds',outcome.settled_request_upper_bound_at+interval '60 seconds')");
    expect(budget).toContain("least(dispatch.admitted_at+interval '3620 seconds',outcome.settled_request_upper_bound_at+interval '3600 seconds')");
    expect(budget).not.toMatch(/count\(\*\)|providerRequests|actual_requests|refund\s*=/u);
  });
  it('uses weighted half-open expirations for both limits and a positive relative wait', () => {
    for (const fragment of ['minute_until>budget_now', 'hour_until>budget_now', 'sum(cost) OVER(ORDER BY expires_at)',
      'released>=minute_cost+p_cost-30', 'released>=hour_cost+p_cost-1800', 'retry_at:=greatest(minute_ready,hour_ready)',
      "'retryAfterMs',ceil(extract(epoch FROM retry_at-budget_now)*1000)::bigint"]) expect(budget).toContain(fragment);
    expect(budget).toContain("IF retry_at<=budget_now THEN RETURN jsonb_build_object('status','admitted')");
  });
  it.each([['direct', direct], ['scheduled', scheduled]] as const)('keeps %s authority and exact current work ahead of budget status', (_name, source) => {
    const position = source.indexOf('budget_status:=public.public_data_settled_request_budget');
    expect(position).toBeGreaterThan(0);
    for (const check of ['public.assert_public_data_batch_owner', 'public.guard_public_data_intake', 'public dispatch recovery required', 'configuration.paused']) {
      expect(source.indexOf(check)).toBeGreaterThanOrEqual(0); expect(source.indexOf(check)).toBeLessThan(position);
    }
    expect(source.indexOf("budget_status->>'status'='budget-backoff'")).toBeLessThan(source.indexOf('INSERT INTO public.public_data_dispatches'));
    expect(source).toContain("THEN RETURN jsonb_build_object('status','deadline')");
    expect(source).toContain("THEN RETURN jsonb_build_object('status','denied')");
    expect(source).toContain("p_work,request_cost,'" + policy + "'");
    expect(source).not.toContain('EXCEPTION WHEN');
    expect(source).not.toMatch(/UPDATE public\.projection_jobs|lease_until\s*=|batchWorkDeadlineAt/u);
  });
  it('retains scheduled approval, occurrence, mapping and history checks without a second fairness debit', () => {
    for (const fragment of ['target.configuration_revision<>selected.configuration_revision', 'public.public_data_resource_authority_valid',
      'resource.open_intake_id=occurrence.id', 'occurrence.source_mapping=resource.source_mapping', 'public.validate_current_roster_mapping',
      'public.public_data_history_authority_valid', 'cycle.cycle=target.current_cycle']) expect(scheduled).toContain(fragment);
    expect(scheduled.match(/active_reserved_http=active_reserved_http\+request_cost/gu)).toHaveLength(1);
    expect(scheduled.match(/history_reserved_http=history_reserved_http\+request_cost/gu)).toHaveLength(1);
    expect(scheduled).toContain('history_credit=least(10,history_credit+request_cost)');
    expect(scheduled).toContain('history_credit=greatest(0,history_credit-4*request_cost)');
  });
  it('exposes only capability and status to runtime and denies private helpers for late roles', () => {
    for (const helper of ['public_data_settled_capture_upper_bound', 'record_public_data_settled_request_bound',
      'public_data_settled_request_budget(integer)', 'admit_public_data_settled_direct_status']) {
      expect(provisioner).toContain(helper); expect(sql).toContain(helper);
    }
    expect(provisioner).toContain("has_any_column_privilege('league_one_runtime','public.'||table_name,'INSERT,UPDATE,REFERENCES')");
    expect(provisioner).toContain('restricted role can execute private settled budget helper');
    expect(sql).toContain("ARRAY['league_one_runtime','league_one_account','league_one_auth']");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.public_data_settled_request_budget_capability(),');
    expect(sql).toContain('public.admit_public_data_batch_dispatch_status(jsonb,jsonb) TO league_one_runtime');
  });
});
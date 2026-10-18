import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'migrations/061_public_data_active_brackets.sql'), 'utf8');
const previous = readFileSync(resolve(process.cwd(), 'migrations/059_public_data_resource_schedule.sql'), 'utf8');
const coordinator = readFileSync(resolve(process.cwd(), 'lib/league-administration/public-intake.ts'), 'utf8');
function body(name: string) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf('$$;', start);
  expect(end, name).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}

describe('R061 active bracket scheduling uses existing resource owners', () => {
  it('extends only the canonical resource kind and period scope', () => {
    expect(migration).toContain("CHECK(kind IN ('core','exact-matchups','transactions','playoff-brackets'))");
    expect(migration).toContain("CHECK((kind IN ('core','playoff-brackets'))=(native_week=0))");
    expect(migration).not.toMatch(/CREATE TABLE|DROP TABLE|ALTER FUNCTION|GRANT EXECUTE/u);
    expect(migration.match(/CREATE OR REPLACE FUNCTION/gu)).toHaveLength(5);
    expect(migration).not.toMatch(/INSERT INTO public\.league_roster_capture_receipts|UPDATE public\.league_roster_capture_receipts/u);
  });
  it('requires explicit bracket approval and current active native source authority', () => {
    const authority = body('public_data_resource_authority_valid');
    expect(authority).toContain("resource.kind<>'playoff-brackets' OR configuration.playoff_brackets='sleeper-2026-playoff-brackets-v1'");
    for (const invariant of ["NOT configuration.paused", 'configuration.expires_at>clock_timestamp()',
      'connection.current_mapping_revision_id=resource.mapping_revision_id', "content.payload->>'status'='in_season'",
      "content.payload->'settings'->>'leg'=authority.active_native_week::text", 'head.read_conflict IS NULL']) {
      expect(authority).toContain(invariant);
    }
  });
  it('adds no resource without an explicit current configuration or exact replay', () => {
    const configure = body('configure_public_data_resource_schedule');
    expect(configure).toContain('target.configuration_revision<>revision_value');
    expect(configure).toContain('retained IS DISTINCT FROM canonical');
    expect(configure).toContain("configuration.playoff_brackets='sleeper-2026-playoff-brackets-v1' THEN ARRAY['playoff-brackets']");
    expect(configure).toContain("IF configuration.playoff_brackets IS NULL THEN\n      RETURN".replaceAll('\n', migration.includes('\r\n') ? '\r\n' : '\n'));
    expect(configure).toContain('IF replayed AND EXISTS');
    expect(configure).toContain("resource.kind='playoff-brackets'");
    expect(configure).toContain("kinds:=CASE WHEN replayed THEN ARRAY['playoff-brackets']");
    expect(configure).not.toMatch(/UPDATE public\.public_data_resources|UPDATE public\.public_data_resource_service/u);
  });
  it('preserves inherited immutable provenance and seeds only one native paired task', () => {
    const seed = body('seed_public_data_resource_occurrence');
    expect(seed).toContain('public.assert_public_data_resource_owner(p_fence)');
    expect(seed).toContain('public.public_data_resource_authority_valid(p_resource,p_target,p_revision)');
    expect(seed).toContain("'inheritedFromIntakeId',origin.intake_id,'resourceOccurrenceId',request_id");
    expect(seed).toContain("SELECT request_id,season,'[]'::jsonb,request_started_at,request_completed_at");
    expect(seed).toContain("CASE WHEN resource.kind='playoff-brackets' THEN 'sleeper-2026-playoff-brackets-v1' ELSE NULL END");
    expect(seed).toContain('INSERT INTO public.public_data_bracket_tasks(intake_id,ordinal,season,external_league_id,write_fence)');
    expect(seed).toContain('VALUES(request_id,1,origin.season,origin.external_league_id,p_fence)');
    expect(seed).not.toContain('SELECT request_id,season,payload');
  });
  it('returns the existing period-free bracket work and preserves ordinary ordering', () => {
    const next = body('next_public_data_intake');
    expect(next).toContain('RETURN public.next_public_data_intake_v58(p_id)');
    expect(next).toContain('FROM public.public_data_bracket_tasks WHERE intake_id=p_id AND ordinal=1');
    expect(next).toContain("IF resource.kind IN ('exact-matchups','transactions') THEN result:=result||jsonb_build_object('nativeWeek'");
    expect(next).toContain("IF task_status<>'pending' OR request.terminal THEN RETURN '\"partial\"'::jsonb");
    expect(next).not.toContain("'kind','identity'");
    expect(next).not.toContain("'kind','leagues'");
  });
  it('reconciles both native receipts under the exact paired committed dispatch', () => {
    const reconcile = body('reconcile_public_data_resource_request');
    expect(reconcile).toContain('ARRAY[bracket.winners_bracket_receipt_id,bracket.losers_bracket_receipt_id]');
    for (const invariant of ['attempt.source_mapping=resource.source_mapping',
      'dispatch.worker_id=bracket.worker_id AND dispatch.generation=bracket.generation',
      "dispatch.intake_id=p_request AND dispatch.resource='playoff-brackets' AND dispatch.max_requests=2",
      "scope.identity->'scope'->>'family'='playoff-brackets'", "THEN 'winners_bracket' ELSE 'losers_bracket' END",
      "outcome.outcome='checkpoint-committed'", "receipt.provenance->'acquisition'=outcome.capture_acquisition",
      "receipt.provenance->>'origin'='network'"]) expect(reconcile).toContain(invariant);
  });
  it('uses the older genuine source clock plus twelve minutes without resetting original family clocks', () => {
    const reconcile = body('reconcile_public_data_resource_request');
    expect(reconcile).toContain("cadence interval:=interval '4 minutes'");
    expect(reconcile).toContain('paired_at<observed_at THEN observed_at:=paired_at; receipt_id:=paired_receipt');
    expect(reconcile).toContain('paired_at IS NULL OR NOT isfinite(paired_at) OR paired_at>clock_timestamp()');
    expect(reconcile).toContain("receipt.provenance->>'sourceObservedAt'=receipt.provenance->>'requestCompletedAt'");
    expect(reconcile).toContain("cadence:=interval '12 minutes'");
    expect(reconcile).toContain('due_at=observed_at+cadence');
    expect(reconcile).not.toContain('due_at=clock_timestamp()');
    expect(reconcile).not.toContain('original_identity');
  });
  it('retains terminal exhaustion, backoff and unchanged original checkpoint/recovery wrappers', () => {
    const reconcile = body('reconcile_public_data_resource_request');
    expect(reconcile).toContain('ELSIF request.terminal THEN');
    expect(reconcile).toContain("next_eligible_at=clock_timestamp()+interval '60 seconds'");
    expect(reconcile).toContain('open_intake_id=NULL');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.checkpoint_public_data_intake(');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.recover_public_data_dispatch(');
    expect(migration).not.toContain('SET terminal=false');
    expect(migration).not.toContain('lease_until=');
    expect(migration).not.toContain('batchAdmissionDeadlineAt');
  });
  it('reuses existing two-request admission and cost-weighted fairness unchanged', () => {
    expect(previous).toContain("request_cost:=CASE WHEN p_work->>'kind' IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END");
    expect(previous).toContain('public.public_data_batch_budget_available(request_cost)');
    expect(previous).toContain('history_credit=least(10,history_credit+request_cost)');
    expect(previous).toContain('history_credit=greatest(0,history_credit-4*request_cost)');
    expect(coordinator).toContain("const families = ['winners_bracket', 'losers_bracket'] as const");
    expect(coordinator).toContain('Promise.allSettled(families.map');
    expect(coordinator).toContain('await intake.completeBrackets(work');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.admit_public_data_batch_dispatch(');
  });
  it('introduces no new function signature or privilege surface', () => {
    const names = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/gu)].map(match => match[1]);
    expect(names).toEqual(['public_data_resource_authority_valid', 'configure_public_data_resource_schedule',
      'next_public_data_intake', 'seed_public_data_resource_occurrence', 'reconcile_public_data_resource_request']);
    for (const name of names) expect(previous).toContain(`CREATE FUNCTION public.${name}(`);
    expect(migration).not.toContain('SECURITY INVOKER');
    expect(migration).not.toContain('ALTER DEFAULT PRIVILEGES');
    expect(migration).not.toMatch(/(?:GRANT|REVOKE)\s/u);
  });
});
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('../../migrations/049_weekly_reports.sql', import.meta.url), 'utf8');
const bracket = readFileSync(new URL('../../migrations/046_official_brackets.sql', import.meta.url), 'utf8');

describe('report migration source boundaries (not PostgreSQL qualification)', () => {
  it('extends native family and positive exact-week checks without changing prior family scopes', () => {
    expect(sql).toContain("family=''weekly_report'' AND week BETWEEN 1 AND 18");
    expect(sql).toContain("family=''matchups'' AND week>0");
    expect(sql).toContain("OR family=''transactions''");
    expect(sql).toContain("found_count<>1");
    expect(sql).toContain("'weekly-reports','entityId','league_report','scoringPeriodId','sleeper:report-week:'");
  });
  it('preserves the prior generic lineage body except the explicit report family additions', () => {
    const first = (source: string) => source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public.validate_current_roster_lineage()'),
      source.indexOf('END; $$;', source.indexOf('CREATE OR REPLACE FUNCTION public.validate_current_roster_lineage()')) + 8);
    const restored = first(sql)
      .replace("WHEN scope.identity->'scope'->>'family'='weekly-reports' AND scope.identity->'scope'->>'entityId'='league_report' THEN 'weekly_report'\n          ", '')
      .replace("WHEN scope.identity->'scope'->>'family'='weekly-reports'\n          THEN substring(scope.identity->'scope'->>'scoringPeriodId' FROM '^sleeper:report-week:([0-9]+)$')::integer\n          ", '')
      .replaceAll(",'weekly-reports'", '');
    expect(restored).toBe(first(bracket));
  });
  it('retains independent SQL native identity, GraphQL, count, decimal and serialization gates', () => {
    expect(sql).toContain("metadata->>'key' IS DISTINCT FROM p_external_league_id||'_'||p_week::text");
    expect(sql).toContain("report->'week' IS DISTINCT FROM to_jsonb(p_week)");
    expect(sql).toContain("jsonb_array_length(p_payload->'errors')<>0");
    expect(sql).toContain("IF native_id=ANY(seen)");
    expect(sql).toContain("jsonb_array_length(report->'standings')>20");
    expect(sql).toContain('to_jsonb(trim_scale(amount)::text)');
    expect(sql).toContain("convert_to(p_payload::text,'UTF8'))>8388608");
    expect(sql).toContain("convert_to(result::text,'UTF8'))>1048576");
    expect(sql).not.toContain('fpts_decimal');
  });
  it('keeps typed rows immutable and rechecks the original attempt fence at commit', () => {
    expect(sql).toContain('header.capture_transaction<>pg_current_xact_id()');
    expect(sql).toContain('header.capture_transaction=pg_current_xact_id()');
    expect(sql).toContain('weekly_report_receipt_fence AFTER INSERT ON public.league_roster_capture_receipts');
    expect(sql).toContain('weekly_report_acceptance_fence AFTER INSERT ON public.league_roster_resource_acceptances');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain("attempt.write_fence IS DISTINCT FROM p_input->'writeFence'");
    expect(sql).not.toMatch(/UPDATE\s+public\.league_roster_resource_attempts/iu);
  });
  it('bounds every report raw body before either generic writer delegation path', () => {
    const writer = sql.slice(sql.indexOf('CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)'));
    const guard = writer.slice(writer.indexOf('BEGIN'), writer.indexOf('IF addition IS NULL'));
    expect(guard).toContain("IF family_value='weekly_report'");
    expect(guard).toContain("octet_length(convert_to((p_input->'envelope'->'payload')::text,'UTF8'))>8388608");
    expect(guard).toContain("RAISE EXCEPTION 'report payload byte limit exceeded'");
    expect(guard).not.toMatch(/projection|addition|record_league_administration_observation_v48/u);
    expect(writer.indexOf('IF addition IS NULL')).toBeLessThan(writer.indexOf('record_league_administration_observation_v48(p_input)'));
  });
  it('uses one observation writer with private predecessors and no direct runtime mutation grants', () => {
    expect(sql).toContain('RENAME TO record_league_administration_observation_v48');
    expect(sql).toContain("p_input-'weeklyReportAcceptance'-'weeklyReportProjection'-'sourceMapping'");
    expect(sql).toContain('public.assert_public_capture_input_shape(p_input)');
    expect(sql).toContain('public.assert_public_capture_observation(p_input,family_value)');
    expect(sql).toContain('GRANT SELECT ON public.league_weekly_report_contents,public.league_weekly_report_teams TO league_one_runtime');
    expect(sql).toContain('public.record_league_administration_observation_v48(jsonb) FROM league_one_runtime');
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)/iu);
  });
});

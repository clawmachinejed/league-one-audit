import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../migrations/053_draft_metadata.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const previous = readFileSync(new URL('../../migrations/049_weekly_reports.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const functionBody = (source: string, name: string) => source.split(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`))[1].split('END; $$;')[0];

describe('additive draft metadata migration source boundaries (not SQL qualification)', () => {
  it('preserves every effective shared lineage rule except the three explicit draft extensions', () => {
    const original = functionBody(previous, 'validate_current_roster_lineage');
    const updated = functionBody(migration, 'validate_current_roster_lineage')
      .replace("\n          WHEN scope.identity->'scope'->>'family'='drafts' AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb THEN 'drafts'", '')
      .replaceAll("'weekly-reports','drafts'", "'weekly-reports'");
    expect(updated).toBe(original);
    expect(migration).toContain("NOT IN ('league-season','transactions','playoff-brackets','weekly-reports','drafts')");
  });
  it('wraps the effective shared writer once and preserves job-before-resource lock ordering', () => {
    expect(migration.match(/ALTER FUNCTION public\.record_league_administration_observation\(jsonb\) RENAME/gu)).toHaveLength(1);
    const body = functionBody(migration, 'record_league_administration_observation');
    expect(body).toContain('RETURN public.record_league_administration_observation_v52(p_input);');
    const delegation = body.indexOf("result:=public.record_league_administration_observation_v52(p_input-'draftMetadataAcceptance'-'draftMetadataProjection'-'sourceMapping')");
    expect(delegation).toBeGreaterThan(0);
    expect(delegation).toBeLessThan(body.indexOf('PERFORM public.validate_current_roster_mapping'));
    expect(delegation).toBeLessThan(body.indexOf('WHERE scope_id=attempt.scope_id FOR UPDATE'));
    expect(body).not.toContain('legacy_current');
    expect(body).toContain('AND NOT stored.accepted');
  });
  it('rejects mixed acceptance and acquisition evidence before delegating', () => {
    const body = functionBody(migration, 'record_league_administration_observation');
    expect(body).toContain("OR provenance ? 'acquisition'");
    for (const key of ['rosterAcceptance', 'teamManagerAcceptance', 'teamManagerEvidenceAcceptance', 'leagueSettingsAcceptance', 'matchupAcceptance',
      'calendarEvidence', 'calculationCapture', 'transactionAcceptance', 'bracketAcceptance', 'weeklyReportAcceptance']) expect(body).toContain(`'${key}'`);
    expect(body.indexOf('mixed or oversized')).toBeLessThan(body.indexOf('result:=public.record_league_administration_observation_v52'));
    expect(body.indexOf('invalid draft metadata ISO clock')).toBeLessThan(body.indexOf('result:=public.record_league_administration_observation_v52'));
    expect(body).toContain("jsonb_typeof(provenance->clock_key) IS DISTINCT FROM 'string'");
    expect(body).toContain('NOT isfinite((provenance->>clock_key)::timestamptz)');
  });
  it('fences rejected receipts and reused-content acceptance at deferred commit', () => {
    for (const event of ['receipt', 'acceptance']) expect(migration).toMatch(new RegExp(`CREATE CONSTRAINT TRIGGER draft_metadata_${event}_fence[\\s\\S]*?DEFERRABLE INITIALLY DEFERRED`));
    expect(migration).toContain('header.capture_transaction=pg_current_xact_id()');
    expect(migration).toContain('public.draft_metadata_typed_value(content.id) IS DISTINCT FROM expected');
    expect(migration).toContain('draft metadata attempt receipt conflict');
    expect(migration).toContain('draft_metadata_source_not_newer');
  });
  it('uses grouped catalog identities and ordered aggregation rather than quadratic prefix concatenation', () => {
    expect(functionBody(migration, 'draft_metadata_facts')).not.toContain('||jsonb_build_array');
    expect(functionBody(migration, 'project_draft_metadata_native')).toContain('jsonb_object_agg(counts.id,counts.amount)');
    expect(functionBody(migration, 'project_draft_metadata_native')).not.toContain('entries:=entries||');
  });
  it('refuses unreadable framing expansion before delegated writes and keeps native payload ceilings aligned', () => {
    const body = functionBody(migration, 'record_league_administration_observation');
    expect(body.indexOf('draft metadata persistence budget exceeded')).toBeLessThan(body.indexOf('result:=public.record_league_administration_observation_v52'));
    expect(body).toContain("+octet_length((p_input->'sourceMapping')::text)+octet_length(provenance::text)+65536");
    expect(body).toContain('octet_length(p_input::text)>33488896');
    expect(functionBody(migration, 'project_draft_metadata_native')).toContain('octet_length(p_payload::text)>8454144');
    expect(functionBody(migration, 'project_draft_metadata_native')).toContain('octet_length(result::text)>33488896');
  });
  it('keeps canonical drafts scoped to season/provider/league and ordered links in separate relations', () => {
    expect(migration).toContain('UNIQUE(league_season_id,provider,external_league_id,external_draft_id)');
    expect(migration).toContain('PRIMARY KEY(content_id,source_kind,external_draft_id,external_user_id)');
    expect(migration).toContain('PRIMARY KEY(content_id,source_kind,external_draft_id,slot_key)');
    expect(migration).not.toMatch(/CREATE (?:TABLE|FUNCTION).*public_data_draft/iu);
  });
  it('keeps runtime read-only table access and closes the renamed/private function boundary', () => {
    const acl = migration.slice(migration.lastIndexOf('REVOKE ALL ON public.league_season_drafts'));
    expect(migration).toContain('public.record_league_administration_observation_v52(jsonb) FROM league_one_runtime');
    expect(acl).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)/u);
    expect(acl).toContain('GRANT EXECUTE ON FUNCTION public.begin_draft_metadata_attempt(jsonb,jsonb,uuid,jsonb),public.record_league_administration_observation(jsonb) TO league_one_runtime');
  });
});

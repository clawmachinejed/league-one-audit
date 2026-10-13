import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/gu, '\n');
const sql = read('048_official_standings.sql');
const prior = read('039_public_data_capture_witness.sql');
const guardPrior = read('047_public_data_brackets.sql');
const provisioner = readFileSync(new URL('../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
const late = provisioner.split('-- BEGIN OPTIONAL OFFICIAL STANDINGS GRANTS')[1]?.split('-- END OPTIONAL OFFICIAL STANDINGS GRANTS')[0];
const body = sql.replace(/--[^\n]*/gu, '');
function declaration(source: string, name: string): string {
  const start = source.search(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\(`, 'u'));
  if (start < 0) throw new Error(`Missing ${name}`);
  return source.slice(start, source.indexOf('END; $$;', start) + 8).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
}
const helpers = ['official_standings_native_fact(jsonb,text,boolean,integer)', 'official_standings_native_points(jsonb,text,text)',
  'project_official_standings_native(jsonb,text)', 'official_standings_typed_value(uuid)', 'official_standings_receipt_coverage(uuid)',
  'guard_official_standings_insert()', 'validate_official_standings_capture()', 'record_league_administration_observation_v47(jsonb)'];

describe('CP13 immutable receipt supplement boundaries', () => {
  it('changes installed roster population fallback only for witnessed captures', () => {
    for (const [oldName, newName] of [['record_league_administration_observation_v29', 'record_league_administration_observation_v29'],
      ['record_league_administration_observation', 'record_league_administration_observation_v42']]) {
      const expected = declaration(prior, oldName).replace(`public.${oldName}(`, `public.${newName}(`)
        .replace("  ELSE\n    -- Existing changed-cache network verification", "  ELSIF provenance->'acquisition' IS NULL THEN\n    -- Existing changed-cache network verification");
      expect(declaration(sql, newName)).toBe(expected);
    }
  });
  it('relaxes only truly absent roster population in the original witness guards', () => {
    for (const name of ['assert_public_capture_observation', 'assert_public_capture_input_shape']) {
      const expected = declaration(guardPrior, name).replace("family_value IN ('rosters','matchups') AND addition->'population'",
        "(family_value='matchups' OR (family_value='rosters'\n      AND (witness->'work'->>'season' IS DISTINCT FROM '2026' OR addition ? 'population')))\n      AND addition->'population'");
      expect(declaration(sql, name)).toBe(expected);
    }
  });
  it('strips the extension before predecessor hashing and refuses historical marker backfill', () => {
    expect(body).toContain("result:=public.record_league_administration_observation_v47(p_input-'officialStandings')");
    expect(body).toContain("IF projection IS NULL THEN RETURN result");
    expect(body).toContain("IF result->'rosterAcceptance'->>'reason'='exact_receipt_replay'");
    expect(body).toContain("'status','legacy-unqualified'");
    expect(body).toContain('stored.xmin=((pg_current_xact_id()::text::numeric % 4294967296)::text)::xid');
  });
  it('checks raw typed parity and every fresh receipt original fence at commit', () => {
    expect(body).toContain('official_standings_capture_fence AFTER INSERT ON public.league_official_standings_captures');
    expect(body).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_official_standings_capture()');
    expect(body).toContain('public.project_official_standings_native(content.payload,content.external_league_id)');
    expect(body).toContain('PERFORM public.assert_roster_player_link_fence(original_fence)');
    expect(body).toContain('header.capture_transaction=pg_current_xact_id()');
    for (const kind of ['content', 'team', 'capture']) expect(body).toContain(`official_standings_${kind}_immutable BEFORE UPDATE OR DELETE`);
  });
  it('does not add resource attempts, heads, checkpoints, a worker or provider admission', () => {
    const extension = body.slice(body.indexOf('CREATE TABLE public.league_official_standings_contents'));
    expect(extension).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:league_roster_resource_|public_data_|projection_jobs|league_administration_team_entries)/iu);
    expect(extension).toContain('INSERT INTO public.league_season_teams');
    expect(extension).toContain("receipt.population_evidence->'provenance'->'acquisition' IS NOT DISTINCT FROM receipt.provenance->'acquisition'");
  });
  it('qualifies population from fresh native league evidence without the legacy scoring count', () => {
    const coverage = declaration(sql, 'official_standings_receipt_coverage');
    expect(coverage).not.toContain('expected:=receipt.expected_team_count');
    expect(coverage).toContain("candidate.content_hash=receipt.population_evidence->>'contentHash'");
    expect(coverage).toContain("candidate.accepted AND candidate.completeness='complete'");
    expect(coverage).toContain("expected:=(configuration.payload->>'total_rosters')::integer");
    expect(coverage).toContain("requestStartedAt')::timestamptz>=attempt.reserved_at");
    expect(coverage).toContain("observation.content_id=candidate.id");
  });
  it('keeps the three tables SELECT-only and all predecessor/projection helpers private in either provision order', () => {
    for (const table of ['contents', 'teams', 'captures']) expect(late).toContain(`'league_official_standings_${table}'`);
    const revokes = [...body.matchAll(/REVOKE ALL ON FUNCTION ([\s\S]*?) FROM (PUBLIC|league_one_runtime);/gu)];
    for (const helper of helpers) {
      for (const role of ['PUBLIC', 'league_one_runtime']) expect(revokes.some(match => match[2] === role && match[1].includes(`public.${helper}`))).toBe(true);
      expect(late).toContain(`public.${helper}`);
    }
    expect(late).toContain("denied_privileges text:='INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'");
    expect(late).toContain("denied_privileges:=denied_privileges||',MAINTAIN'");
  });
});

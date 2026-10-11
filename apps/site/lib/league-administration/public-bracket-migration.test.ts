import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('../../migrations/047_public_data_brackets.sql', import.meta.url), 'utf8');
const provisioner = readFileSync(new URL('../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
const body = sql.replace(/--[^\n]*/gu, '');
const provision = provisioner.split('-- BEGIN OPTIONAL PUBLIC BRACKET INTAKE GRANTS')[1]?.split('-- END OPTIONAL PUBLIC BRACKET INTAKE GRANTS')[0];
const functionBody = (name: string) => {
  const match = body.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*?END; \\$\\$;`, 'u'));
  expect(match, `missing ${name}`).not.toBeNull();
  return match![0];
};
const helpers = ['validate_public_data_bracket_task_fence()', 'fail_public_data_bracket_work(jsonb,jsonb)', 'validate_public_data_bracket_task()', 'validate_public_data_bracket_checkpoint()',
  'validate_public_data_bracket_checkpoint_fence()', 'checkpoint_public_data_intake_v46(jsonb,jsonb,jsonb)'];

describe('CP12 additive ordinary bracket SQL boundaries', () => {
  it('requires an immutable opt-in 2026 scope and copies it through replay and refresh cycles', () => {
    expect(body.match(/ADD COLUMN playoff_brackets text/gu)).toHaveLength(2);
    expect(body.match(/seasons=ARRAY\[2026\]/gu)).toHaveLength(3);
    expect(body).toContain("prevent_projection_stable_field_change('playoff_brackets')");
    expect(functionBody('submit_public_data_intake')).toContain('retained.playoff_brackets IS DISTINCT FROM brackets');
    const configure = functionBody('configure_public_data_refresh');
    expect(configure).toContain('configuration.playoff_brackets IS NOT DISTINCT FROM brackets');
    expect(configure).toContain('current_request.playoff_brackets IS DISTINCT FROM brackets');
    const select = functionBody('select_public_data_refresh');
    expect(select).toContain("jsonb_build_object('playoffBrackets',configuration.playoff_brackets)");
    expect(select).toContain('request.playoff_brackets IS DISTINCT FROM configuration.playoff_brackets');
    expect(select).toContain('revision=cycle_row.configuration_revision');
  });
  it('keeps admission and backoff bounds while making bracket failures resource-local', () => {
    expect(functionBody('admit_public_data_dispatch_v34')).toContain("interval '60 seconds'");
    expect(functionBody('admit_public_data_dispatch_v34')).toContain("IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END");
    const failure = functionBody('fail_public_data_bracket_work');
    expect(failure).toContain('least(3600,60*(2^least(failure_count,5))::integer)');
    const branch = failure.split("IF p_work->>'kind'='playoff-brackets' THEN")[1].split('  IF failures>=5 AND brackets_selected')[0];
    expect(branch).toContain("'bracket-capture-exhausted'");
    expect(branch).not.toContain('UPDATE public.public_data_league_candidates');
    expect(body).not.toMatch(/UPDATE\s+public\.projection_jobs\s+SET[^;]*(?:lease_until|attempt_count)/iu);
  });
  it('binds complete paired checkpoint to exact admitted task, mapping, nonce group and current typed receipts', () => {
    const checkpoint = functionBody('validate_public_data_bracket_checkpoint');
    for (const guard of ['dispatch.max_requests<>2', "dispatch.resource<>'playoff-brackets'", 'attempt.ordinal=head.latest_ordinal',
      'attempt.reserved_at>=dispatch.admitted_at', 'attempt.write_fence=winner_attempt.write_fence',
      'attempt.source_mapping=NEW.source_mapping', 'loser.provenance', 'public.public_capture_after_reservation(receipt.provenance,attempt.id)',
      'JOIN public.league_bracket_contents typed', "receipt.coverage->>'completeness'='complete'"]) expect(checkpoint).toContain(guard);
    expect(checkpoint.match(/assert_public_data_owner\(NEW.intake_id,winner_attempt.write_fence\)/gu)).toHaveLength(2);
    expect(functionBody('derive_public_data_capture_witness')).toContain("role_names<>ARRAY['losers_bracket','winners_bracket']");
    expect(body).toContain('UNIQUE(worker_id,generation)');
    expect(body).toContain('CHECK(winners_bracket_receipt_id<>losers_bracket_receipt_id)');
  });
  it('preserves original checkpoint evidence while adding a deferred original fence at COMMIT', () => {
    expect(body).toContain('public_bracket_checkpoint_immutable BEFORE UPDATE OR DELETE');
    expect(body).toContain('public_bracket_task_no_delete BEFORE DELETE');
    expect(body).toContain('public_bracket_checkpoint_fence AFTER INSERT');
    expect(body).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_bracket_checkpoint_fence()');
    expect(functionBody('validate_public_data_bracket_checkpoint_fence')).toContain('SELECT attempt.write_fence INTO STRICT fence');
    expect(functionBody('validate_public_data_bracket_checkpoint_fence')).toContain('public.assert_roster_player_link_fence(fence)');
  });
  it('retains each task mutation deadline and binds recovery to the new owner while omitted requests use the old failure path', () => {
    expect(body).toContain('write_fence jsonb NOT NULL');
    expect(body).toContain('public_bracket_task_fence AFTER INSERT OR UPDATE');
    expect(body).toContain('DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_bracket_task_fence()');
    expect(functionBody('validate_public_data_bracket_task_fence')).toContain('public.assert_roster_player_link_fence(NEW.write_fence)');
    expect(functionBody('validate_public_data_bracket_task')).toContain("OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD");
    expect(body).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION public\.fail_public_data_work\(/u);
    const recovery = functionBody('recover_public_data_dispatch');
    expect(recovery).toContain('public.fail_public_data_bracket_work(prior.work,p_fence)');
    expect(recovery).toContain('ELSE PERFORM public.fail_public_data_work(prior.work)');
    expect(recovery).toContain('id=prior.intake_id AND playoff_brackets IS NOT NULL');
    expect(functionBody('fail_public_data_bracket_work')).toContain('SET write_fence=p_fence,failure_count=failures');
    expect(functionBody('checkpoint_public_data_intake')).toContain('public.fail_public_data_bracket_work(p_work,p_fence)');
    expect(body).toContain('candidate.season,candidate.external_league_id,p_fence');
    expect(body).toContain("SET write_fence=p_fence,status='unavailable',reason='bootstrap-capacity'");
  });
  it('rejects bare public witnessed brackets, keeps acquisition, and preserves exact replay before live dispatch checks', () => {
    const writer = functionBody('record_league_administration_observation');
    expect(writer.indexOf('witnessed public bracket requires typed acceptance')).toBeLessThan(writer.indexOf('RETURN public.record_league_administration_observation_v45(p_input)'));
    expect(writer.indexOf('public.assert_public_capture_input_shape(p_input)')).toBeLessThan(writer.indexOf('result:=public.record_league_administration_observation_v45'));
    const replay = writer.indexOf("'reason','exact_receipt_replay'");
    expect(replay).toBeGreaterThan(writer.indexOf('receipt.evidence_hash<>evidence_hash_value'));
    expect(writer.indexOf('public.assert_public_capture_observation(p_input,family_value)')).toBeGreaterThan(replay);
    expect(writer.indexOf('public.assert_public_capture_observation(p_input,family_value)')).toBeLessThan(writer.indexOf('INSERT INTO public.league_roster_capture_receipts'));
    expect(writer).toContain("provenance->'acquisition' IS NULL AND (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at");
    expect(writer).not.toMatch(/-\s*'acquisition'|#-\s*[^;]*acquisition/iu);
    expect(writer).toContain('public.capture_bracket_typed(content.id,acceptance_id,expected)');
  });
  it('keeps runtime read-only tables and private predecessor/helper denials on both install paths', () => {
    for (const table of ['public_data_bracket_tasks', 'public_data_bracket_checkpoints']) {
      expect(body).toContain(`public.${table}`); expect(provision).toContain(`'${table}'`);
    }
    const revokes = [...body.matchAll(/REVOKE ALL ON FUNCTION ([\s\S]*?) FROM (PUBLIC|league_one_runtime);/gu)];
    for (const helper of helpers) {
      for (const role of ['PUBLIC', 'league_one_runtime']) expect(revokes.some(match => match[2] === role && match[1].includes(`public.${helper}`))).toBe(true);
      expect(provision).toContain(`public.${helper}`);
    }
    expect(provision).toContain("denied_privileges text:='INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'");
    expect(provision).not.toMatch(/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|CREATE)/u);
    expect(provision).toContain('public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) TO league_one_runtime');
  });
});

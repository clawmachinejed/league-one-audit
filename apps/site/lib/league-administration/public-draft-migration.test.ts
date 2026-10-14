import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('migrations/056_public_draft_intake.sql');
const functionSource = (source: string, name: string) => {
  const start = source.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`));
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('END; $$;', start) + 8).replace(/^CREATE FUNCTION/u, 'CREATE OR REPLACE FUNCTION');
};

describe('CP19 additive draft DATA SQL boundaries (not installed SQL qualification)', () => {
  it.each([
    ['053_draft_metadata.sql', 'record_league_administration_observation_v53', 'draftMetadata'],
    ['054_draft_selections.sql', 'record_league_administration_observation_v54', 'draftSelections'],
    ['055_traded_pick_ownership.sql', 'record_league_administration_observation', 'tradedPicks'],
  ])('preserves %s acceptance except the validated original acquisition extension', (file, name, role) => {
    const before = functionSource(read(`migrations/${file}`), 'record_league_administration_observation');
    const after = functionSource(migration, name)
      .replace(`FUNCTION public.${name}(`, 'FUNCTION public.record_league_administration_observation(')
      .replace('    OR octet_length', "    OR provenance ? 'acquisition' OR octet_length")
      .replace(`  IF provenance ? 'acquisition' THEN PERFORM public.assert_public_draft_capture(p_input,'${role}'); END IF;\n`, '')
      .replace("  IF provenance->'acquisition' IS NULL AND (provenance->>'requestStartedAt')", "  IF (provenance->>'requestStartedAt')");
    expect(after).toBe(before);
    expect(migration).not.toContain("provenance'-'acquisition'");
    expect(migration).not.toMatch(/UPDATE public\.league_roster_capture_receipts/u);
  });

  it('keeps one endpoint per existing admission and exact native resource identity', () => {
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public\.admit_public_data_dispatch/u);
    const witness = functionSource(migration, 'derive_public_data_capture_witness');
    expect(witness).toContain('dispatch.max_requests<>1');
    expect(witness).toContain('reserved.identity=public.public_data_draft_identity(p_work,p_mapping)');
    expect(migration).toContain("WHEN 'selections' THEN 'draft:'||(p_work->>'externalDraftId')||':selections'");
    expect(migration).toContain("WHEN 'league-trades' THEN 'league'");
    expect(migration).not.toMatch(/INSERT INTO public\.(?:projection_jobs|league_seasons)/u);
  });

  it('reuses exact immutable same-cycle catalog rows without a mutable-head reader', () => {
    const reader = functionSource(migration, 'read_public_data_draft_catalog');
    expect(reader).toContain('checkpoint.draft_receipt_id=task.catalog_receipt_id');
    expect(reader).toContain('checkpoint.source_mapping=p_mapping');
    expect(reader).toContain("parent.resource='catalog' AND parent.status='complete'");
    expect(reader).not.toContain('league_roster_resource_heads');
    expect(functionSource(migration, 'assert_public_draft_capture')).toContain("payload->'catalog' IS DISTINCT FROM native_row");
    expect(functionSource(migration, 'validate_public_data_draft_task')).toContain("candidate.stage<>'capacity' OR EXISTS(SELECT 1 FROM public.public_data_draft_tasks root");
    expect(functionSource(migration, 'validate_public_data_draft_task')).toContain("root.external_league_id=candidate.external_league_id AND root.resource='catalog'");
    expect(migration).toContain('UNIQUE NULLS NOT DISTINCT(intake_id,season,external_league_id,resource,external_draft_id)');
    expect(migration).toContain("CHECK(ordinal BETWEEN 1 AND 520)");
  });

  it('retains failed-capture backoff and old recovery routing after the new draft branch', () => {
    const failure = functionSource(migration, 'fail_public_data_draft_work');
    expect(failure).toContain('least(3600,60*(2^least(failure_count,5))::integer)');
    expect(failure).toContain("status=CASE WHEN failures>=5 THEN 'unavailable' ELSE 'pending' END");
    expect(failure).toContain('PERFORM public.fail_public_data_transaction_work(p_work,p_fence)');
    const prior = functionSource(read('migrations/052_public_transaction_history.sql'), 'recover_public_data_dispatch');
    const recovery = functionSource(migration, 'recover_public_data_dispatch').replace(
      "    IF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=prior.intake_id AND draft_picks IS NOT NULL) THEN\n      PERFORM public.fail_public_data_draft_work(prior.work,p_fence);\n    ELSIF EXISTS(",
      '    IF EXISTS(');
    expect(recovery).toBe(prior);
  });

  it('binds complete receipt acceptance and original post-lock/deferred-commit fences', () => {
    const checkpoint = functionSource(migration, 'validate_public_data_draft_checkpoint');
    expect(checkpoint).toContain('dispatch.work IS DISTINCT FROM public.public_data_draft_work(task,dispatch.revision)');
    expect(checkpoint).toContain('head.accepted_id=accepted.id AND head.generation=accepted.generation');
    expect(checkpoint).toContain("receipt.coverage->>'completeness'='complete'");
    expect(checkpoint).toContain('public.public_capture_after_reservation(receipt.provenance,attempt.id)');
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER public_draft_task_fence[\s\S]*?DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER public_draft_checkpoint_fence[\s\S]*?DEFERRABLE INITIALLY DEFERRED/u);
    expect(functionSource(migration, 'next_public_data_intake').match(/request\.draft_picks IS NOT NULL AND EXISTS/gu)).toHaveLength(2);
  });

  it('keeps omitted selectors unchanged and binds refresh replay and unfinished cycles', () => {
    const selector = functionSource(migration, 'canonical_public_data_draft_picks');
    expect(selector).toContain('IF p_value IS NULL THEN RETURN NULL');
    expect(selector).toContain('p_seasons IS DISTINCT FROM ARRAY[2026]');
    expect(functionSource(migration, 'submit_public_data_intake')).toContain('retained.draft_picks IS DISTINCT FROM drafts');
    expect(functionSource(migration, 'configure_public_data_refresh')).toContain('current_request.draft_picks IS DISTINCT FROM drafts');
    expect(functionSource(migration, 'select_public_data_refresh')).toContain('request.draft_picks IS DISTINCT FROM (SELECT draft_picks');
  });

  it('closes runtime helper and DML access for existing and freshly provisioned roles', () => {
    const provisioning = read('scripts/provision-runtime-role.sql').split('-- BEGIN OPTIONAL PUBLIC DRAFT INTAKE GRANTS')[1];
    expect(provisioning).toContain('GRANT SELECT ON TABLE');
    expect(provisioning).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)/u);
    expect(provisioning).toContain("'public.checkpoint_public_data_intake_v55(jsonb,jsonb,jsonb)'");
    expect(provisioning).toContain('public.read_public_data_draft_catalog(jsonb,jsonb,jsonb)');
    expect(provisioning).toContain('REVOKE ALL ON FUNCTION %s FROM PUBLIC,league_one_runtime');
    expect(provisioning).toContain("denied:=denied||',MAINTAIN'");
  });
});

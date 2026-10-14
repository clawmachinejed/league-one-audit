-- CP19: explicit 2026 draft intake/refresh through the existing DATA owner.
-- A catalog is acquired once successfully per cycle; failed attempts retain the
-- existing cadence. Each child reuses its immutable catalog receipt, never a new
-- catalog GET. Partial/capped catalogs retain evidence and cannot imply complete
-- child coverage. No activation, new worker, scheduler or migration execution.
CREATE FUNCTION public.canonical_public_data_draft_picks(p_value jsonb,p_seasons integer[]) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  IF p_seasons IS DISTINCT FROM ARRAY[2026] OR p_value IS DISTINCT FROM '"sleeper-2026-draft-picks-v1"'::jsonb THEN
    RAISE EXCEPTION 'invalid public draft selection'; END IF;
  RETURN p_value#>>'{}';
END; $$;
ALTER TABLE public.public_data_intakes ADD COLUMN draft_picks text
  CHECK(draft_picks IS NOT DISTINCT FROM public.canonical_public_data_draft_picks(to_jsonb(draft_picks),seasons));
ALTER TABLE public.public_data_refresh_configurations ADD COLUMN draft_picks text
  CHECK(draft_picks IS NOT DISTINCT FROM public.canonical_public_data_draft_picks(to_jsonb(draft_picks),seasons));
CREATE TRIGGER public_intake_draft_selection_immutable BEFORE UPDATE ON public.public_data_intakes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change('draft_picks');

CREATE TABLE public.public_data_draft_tasks (
  intake_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 520),
  season integer NOT NULL CHECK(season=2026), external_league_id text NOT NULL,
  resource text NOT NULL CHECK(resource IN ('catalog','detail','selections','league-trades','draft-trades')),
  external_draft_id text, catalog_receipt_id uuid REFERENCES public.league_roster_capture_receipts(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','unavailable')),
  failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count BETWEEN 0 AND 5), reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), write_fence jsonb NOT NULL CHECK(jsonb_typeof(write_fence)='object'),
  PRIMARY KEY(intake_id,ordinal), UNIQUE NULLS NOT DISTINCT(intake_id,season,external_league_id,resource,external_draft_id),
  FOREIGN KEY(intake_id,season,external_league_id) REFERENCES public.public_data_league_candidates(intake_id,season,external_league_id),
  CHECK((resource IN ('catalog','league-trades') AND external_draft_id IS NULL AND catalog_receipt_id IS NULL)
    OR (resource IN ('detail','selections','draft-trades') AND external_draft_id IS NOT NULL
      AND external_draft_id ~ '^[A-Za-z0-9_-]{1,128}$' AND catalog_receipt_id IS NOT NULL)),
  CHECK((status='unavailable')=(reason IS NOT NULL)),
  CHECK(reason IS NULL OR reason IN ('draft-capture-exhausted','bootstrap-unavailable','bootstrap-capacity','discovery-unavailable')),
  CHECK(status<>'pending' OR failure_count<5)
);
CREATE TABLE public.public_data_draft_checkpoints (
  intake_id uuid NOT NULL, task_ordinal integer NOT NULL, worker_id text NOT NULL, generation integer NOT NULL,
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id), source_mapping jsonb NOT NULL,
  draft_receipt_id uuid NOT NULL REFERENCES public.league_roster_capture_receipts(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(intake_id,task_ordinal), UNIQUE(worker_id,generation),
  FOREIGN KEY(intake_id,task_ordinal) REFERENCES public.public_data_draft_tasks(intake_id,ordinal),
  FOREIGN KEY(worker_id,generation) REFERENCES public.public_data_dispatches(worker_id,generation)
);
CREATE FUNCTION public.public_data_draft_work(p_task public.public_data_draft_tasks,p_revision integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('requestId',p_task.intake_id,'revision',p_revision,'kind','drafts','resource',p_task.resource,
    'externalLeagueId',p_task.external_league_id,'season',p_task.season)||CASE WHEN p_task.external_draft_id IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('externalDraftId',p_task.external_draft_id,'catalogReceiptId',p_task.catalog_receipt_id) END
$$;
CREATE FUNCTION public.public_data_draft_identity(p_work jsonb,p_mapping jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',p_mapping->>'connectionId',
    'leagueSeasonId',p_mapping->>'leagueSeasonId','family','drafts','entityId',CASE p_work->>'resource'
      WHEN 'catalog' THEN 'catalog' WHEN 'detail' THEN 'draft:'||(p_work->>'externalDraftId')
      WHEN 'selections' THEN 'draft:'||(p_work->>'externalDraftId')||':selections'
      WHEN 'league-trades' THEN 'league' WHEN 'draft-trades' THEN 'draft:'||(p_work->>'externalDraftId')||':traded-picks' END,
    'scoringPeriodId',NULL,'audienceId','public','coverageSpecId',version),'policy',jsonb_build_object('audienceId','public',
    'coverageSpecId',version,'canonicalNormalizerVersion',version,'validationVersion','latest-network-attempt-v1'))
  FROM (SELECT CASE p_work->>'resource' WHEN 'catalog' THEN 'sleeper-draft-metadata-v1' WHEN 'detail' THEN 'sleeper-draft-metadata-v1'
    WHEN 'selections' THEN 'sleeper-draft-selections-v1' WHEN 'league-trades' THEN 'sleeper-traded-picks-v1'
    WHEN 'draft-trades' THEN 'sleeper-traded-picks-v1' END AS version) resource
$$;
CREATE FUNCTION public.validate_public_data_draft_task() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate_rank integer; native_ordinal integer; catalog_payload jsonb;
BEGIN
  IF NEW.write_fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake' THEN
    RAISE EXCEPTION 'public draft task requires public owner fence'; END IF;
  PERFORM public.assert_roster_player_link_fence(NEW.write_fence);
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','failure_count','reason','write_fence']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','failure_count','reason','write_fence']) OR NEW.failure_count<OLD.failure_count
    OR (OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD)) THEN
    RAISE EXCEPTION 'public draft task identity or terminal state is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.public_data_intakes request WHERE request.id=NEW.intake_id
    AND request.seasons=ARRAY[2026] AND request.draft_picks='sleeper-2026-draft-picks-v1') THEN
    RAISE EXCEPTION 'public draft task outside immutable selection'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT ranked.rank INTO candidate_rank FROM (SELECT candidate.season,candidate.external_league_id,
      row_number() OVER(ORDER BY candidate.season,candidate.external_league_id)::integer AS rank
      FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=NEW.intake_id
        AND (candidate.stage<>'capacity' OR EXISTS(SELECT 1 FROM public.public_data_draft_tasks root
          WHERE root.intake_id=candidate.intake_id AND root.season=candidate.season AND root.external_league_id=candidate.external_league_id AND root.resource='catalog'))) ranked
      WHERE ranked.season=NEW.season AND ranked.external_league_id=NEW.external_league_id;
    IF candidate_rank IS NULL OR candidate_rank NOT BETWEEN 1 AND 20 OR NEW.status<>'pending'
      OR NEW.failure_count<>0 OR NEW.reason IS NOT NULL THEN RAISE EXCEPTION 'public draft task requires admitted candidate'; END IF;
    IF NEW.resource IN ('catalog','league-trades') THEN
      IF NEW.ordinal<>(candidate_rank-1)*26+(CASE NEW.resource WHEN 'catalog' THEN 1 ELSE 2 END) THEN
        RAISE EXCEPTION 'public draft root task ordinal mismatch'; END IF;
    ELSE
      SELECT content.payload INTO STRICT catalog_payload FROM public.public_data_draft_checkpoints checkpoint
        JOIN public.public_data_draft_tasks parent ON parent.intake_id=checkpoint.intake_id AND parent.ordinal=checkpoint.task_ordinal
        JOIN public.league_roster_capture_receipts receipt ON receipt.id=checkpoint.draft_receipt_id
        JOIN public.league_administration_contents content ON content.id=receipt.content_id
        WHERE checkpoint.intake_id=NEW.intake_id AND parent.season=NEW.season AND parent.external_league_id=NEW.external_league_id
          AND parent.resource='catalog' AND checkpoint.draft_receipt_id=NEW.catalog_receipt_id;
      SELECT ordinality::integer INTO STRICT native_ordinal FROM jsonb_array_elements(catalog_payload->'catalog') WITH ORDINALITY
        WHERE value->>'draft_id'=NEW.external_draft_id AND public.draft_metadata_owns(value,NEW.external_league_id,NEW.external_draft_id);
      IF native_ordinal NOT BETWEEN 1 AND 8 OR NEW.ordinal<>(candidate_rank-1)*26+3+(native_ordinal-1)*3
        +(CASE NEW.resource WHEN 'detail' THEN 0 WHEN 'selections' THEN 1 ELSE 2 END) THEN
        RAISE EXCEPTION 'public draft child ordinal or catalog mismatch'; END IF;
    END IF;
  END IF;
  IF NEW.status='complete' AND NOT EXISTS(SELECT 1 FROM public.public_data_draft_checkpoints checkpoint
    WHERE checkpoint.intake_id=NEW.intake_id AND checkpoint.task_ordinal=NEW.ordinal) THEN
    RAISE EXCEPTION 'public draft completion requires immutable checkpoint'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_draft_task_lineage BEFORE INSERT OR UPDATE ON public.public_data_draft_tasks
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_draft_task();
CREATE CONSTRAINT TRIGGER public_draft_task_fence AFTER INSERT OR UPDATE ON public.public_data_draft_tasks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_transaction_task_fence();
CREATE TRIGGER public_draft_task_no_delete BEFORE DELETE ON public.public_data_draft_tasks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_draft_checkpoint_immutable BEFORE UPDATE OR DELETE ON public.public_data_draft_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

CREATE OR REPLACE FUNCTION public.submit_public_data_intake(p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wanted integer[]; periods jsonb; inventory text; brackets text; reports jsonb; transaction_period_value jsonb; history text; drafts text; retained public.public_data_intakes%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR (p_input->>'username') !~ '^[a-zA-Z0-9_]{1,100}$' THEN RAISE EXCEPTION 'invalid public intake'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO wanted FROM jsonb_array_elements_text(p_input->'seasons');
  IF EXISTS(SELECT 1 FROM unnest(wanted) value WHERE value NOT BETWEEN 1920 AND 2200)
    OR cardinality(wanted)<>(SELECT count(DISTINCT value) FROM unnest(wanted) value) THEN
    RAISE EXCEPTION 'invalid public season scope';
  END IF;
  drafts:=public.canonical_public_data_draft_picks(p_input->'draftPicks',wanted);
  history:=public.canonical_public_data_transaction_history(p_input->'transactionHistory',wanted);
  IF p_input ? 'transactionHistory' AND p_input ? 'transactionPeriod' THEN
    RAISE EXCEPTION 'public transaction selectors are mutually exclusive'; END IF;
  transaction_period_value:=public.canonical_public_data_transaction_period(p_input->'transactionPeriod',wanted);
  reports:=public.canonical_public_data_weekly_reports(CASE WHEN p_input ? 'weeklyReports' THEN p_input->'weeklyReports' ELSE '[]'::jsonb END,wanted);
  brackets:=p_input->>'playoffBrackets';
  IF p_input ? 'playoffBrackets' AND (jsonb_typeof(p_input->'playoffBrackets') IS DISTINCT FROM 'string'
    OR brackets<>'sleeper-2026-playoff-brackets-v1' OR wanted IS DISTINCT FROM ARRAY[2026]) THEN
    RAISE EXCEPTION 'invalid public bracket selector'; END IF;
  inventory:=p_input->>'periodInventory';
  IF p_input ? 'periodInventory' THEN
    IF jsonb_typeof(p_input->'periodInventory') IS DISTINCT FROM 'string'
      OR inventory<>'sleeper-2026-native-period-inventory-v1' OR p_input ? 'exactPeriods' THEN RAISE EXCEPTION 'invalid public period inventory selector'; END IF;
    periods:=public.canonical_public_data_period_scope(public.public_data_inventory_periods(),wanted,inventory);
  ELSE
    periods:=public.canonical_public_data_exact_periods(CASE WHEN p_input ? 'exactPeriods' THEN p_input->'exactPeriods' ELSE '[]'::jsonb END,wanted);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public-data-intake-admission',0));
  SELECT * INTO retained FROM public.public_data_intakes WHERE id=(p_input->>'id')::uuid;
  IF FOUND THEN
    IF retained.username IS DISTINCT FROM p_input->>'username' OR retained.seasons IS DISTINCT FROM wanted OR retained.exact_periods IS DISTINCT FROM periods OR retained.period_inventory IS DISTINCT FROM inventory OR retained.playoff_brackets IS DISTINCT FROM brackets OR retained.weekly_reports IS DISTINCT FROM reports OR retained.transaction_period IS DISTINCT FROM transaction_period_value OR retained.transaction_history IS DISTINCT FROM history OR retained.draft_picks IS DISTINCT FROM drafts THEN
      RAISE EXCEPTION 'public intake replay mismatch';
    END IF;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal)>=16 THEN
    RAISE EXCEPTION 'public intake capacity reached';
  END IF;
  INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,period_inventory,playoff_brackets,weekly_reports,transaction_period,transaction_history,draft_picks) VALUES((p_input->>'id')::uuid,p_input->>'username',wanted,periods,inventory,brackets,reports,transaction_period_value,history,drafts);
END; $$;

CREATE OR REPLACE FUNCTION public.configure_public_data_refresh(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  target_id uuid:=(p_input->>'id')::uuid; identity_id uuid:=(p_input->>'identityRequestId')::uuid;
  periods jsonb; inventory text; brackets text; reports jsonb; history text; drafts text; expected bigint:=(p_input->>'expectedRevision')::bigint; manager_id uuid; wanted integer[];
  cadence integer:=(p_input->>'cadenceSeconds')::integer; expiry timestamptz:=(p_input->>'expiresAt')::timestamptz;
  paused_value boolean; next_revision bigint; current_request public.public_data_intakes%ROWTYPE;
BEGIN
  IF target_id IS NULL OR identity_id IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 9007199254740990
    OR jsonb_typeof(p_input->'expectedRevision') IS DISTINCT FROM 'number'
    OR (p_input->>'expectedRevision') !~ '^(0|[1-9][0-9]*)$'
    OR jsonb_typeof(p_input->'cadenceSeconds') IS DISTINCT FROM 'number'
    OR (p_input->>'cadenceSeconds') !~ '^[1-9][0-9]*$' OR cadence NOT BETWEEN 60 AND 604800
    OR jsonb_typeof(p_input->'paused') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR expiry IS NULL OR NOT isfinite(expiry) OR expiry>clock_timestamp()+interval '90 days' THEN
    RAISE EXCEPTION 'invalid public refresh configuration'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'seasons') entry
    WHERE jsonb_typeof(entry)<>'number' OR entry::text !~ '^[1-9][0-9]*$') THEN
    RAISE EXCEPTION 'invalid public refresh seasons'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO wanted FROM jsonb_array_elements_text(p_input->'seasons');
  IF EXISTS(SELECT 1 FROM unnest(wanted) season WHERE season NOT BETWEEN 1920 AND 2200)
    OR cardinality(wanted)<>(SELECT count(DISTINCT season) FROM unnest(wanted) season) THEN
    RAISE EXCEPTION 'invalid public refresh seasons'; END IF;
  drafts:=public.canonical_public_data_draft_picks(p_input->'draftPicks',wanted);
  history:=public.canonical_public_data_transaction_history(p_input->'transactionHistory',wanted);
  IF p_input ? 'transactionHistory' AND p_input ? 'transactionPeriod' THEN
    RAISE EXCEPTION 'public transaction selectors are mutually exclusive'; END IF;
  reports:=public.canonical_public_data_weekly_reports(CASE WHEN p_input ? 'weeklyReports' THEN p_input->'weeklyReports' ELSE '[]'::jsonb END,wanted);
  brackets:=p_input->>'playoffBrackets';
  IF p_input ? 'playoffBrackets' AND (jsonb_typeof(p_input->'playoffBrackets') IS DISTINCT FROM 'string'
    OR brackets<>'sleeper-2026-playoff-brackets-v1' OR wanted IS DISTINCT FROM ARRAY[2026]) THEN
    RAISE EXCEPTION 'invalid public bracket selector'; END IF;
  inventory:=p_input->>'periodInventory';
  IF p_input ? 'periodInventory' THEN
    IF jsonb_typeof(p_input->'periodInventory') IS DISTINCT FROM 'string'
      OR inventory<>'sleeper-2026-native-period-inventory-v1' OR p_input ? 'exactPeriods' THEN RAISE EXCEPTION 'invalid public period inventory selector'; END IF;
    periods:=public.canonical_public_data_period_scope(public.public_data_inventory_periods(),wanted,inventory);
  ELSE
    periods:=public.canonical_public_data_exact_periods(CASE WHEN p_input ? 'exactPeriods' THEN p_input->'exactPeriods' ELSE '[]'::jsonb END,wanted);
  END IF;
  paused_value:=(p_input->>'paused')::boolean;
  SELECT account.id INTO STRICT manager_id FROM public.public_data_identity_observations identity
    JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id
    WHERE identity.intake_id=identity_id AND account.provider='sleeper'
      AND account.external_manager_id ~ '^[1-9][0-9]{0,31}$';
  -- Serializes total target capacity and canonical stable-manager uniqueness.
  PERFORM pg_advisory_xact_lock(hashtextextended('public-data-refresh-configuration',0));
  SELECT * INTO target FROM public.public_data_refresh_targets WHERE id=target_id FOR UPDATE;
  IF FOUND THEN
    IF target.source_manager_account_id<>manager_id THEN RAISE EXCEPTION 'refresh target identity is immutable'; END IF;
    SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations
      WHERE public_data_refresh_configurations.target_id=target.id AND revision=target.configuration_revision;
    IF target.configuration_revision=expected+1 AND configuration.identity_request_id=identity_id
      AND configuration.seasons=wanted AND configuration.exact_periods=periods AND configuration.period_inventory IS NOT DISTINCT FROM inventory AND configuration.playoff_brackets IS NOT DISTINCT FROM brackets AND configuration.weekly_reports=reports AND configuration.transaction_history IS NOT DISTINCT FROM history AND configuration.draft_picks IS NOT DISTINCT FROM drafts AND configuration.cadence_seconds=cadence
      AND configuration.expires_at=expiry AND configuration.paused=paused_value THEN
      RETURN jsonb_build_object('status','replayed','targetId',target.id,'configurationRevision',target.configuration_revision);
    END IF;
    IF target.configuration_revision<>expected THEN RAISE EXCEPTION 'refresh configuration revision changed'; END IF;
    SELECT request.* INTO current_request FROM public.public_data_refresh_cycles cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id
      WHERE cycle.target_id=target.id AND cycle.cycle=target.current_cycle;
    IF FOUND AND NOT current_request.terminal AND (current_request.seasons IS DISTINCT FROM wanted OR current_request.exact_periods IS DISTINCT FROM periods OR current_request.period_inventory IS DISTINCT FROM inventory OR current_request.playoff_brackets IS DISTINCT FROM brackets OR current_request.weekly_reports IS DISTINCT FROM reports OR current_request.transaction_history IS DISTINCT FROM history OR current_request.draft_picks IS DISTINCT FROM drafts) THEN
      RAISE EXCEPTION 'unfinished refresh cycle retains its explicit season scope'; END IF;
  ELSE
    IF expected<>0 THEN RAISE EXCEPTION 'refresh configuration revision changed'; END IF;
    IF (SELECT count(*) FROM public.public_data_refresh_targets)>=16 THEN RAISE EXCEPTION 'public refresh target capacity reached'; END IF;
    IF EXISTS(SELECT 1 FROM public.public_data_refresh_targets WHERE provider='sleeper' AND source_manager_account_id=manager_id) THEN
      RAISE EXCEPTION 'public manager already has a refresh target'; END IF;
    INSERT INTO public.public_data_refresh_targets(id,provider,source_manager_account_id,configuration_revision)
      VALUES(target_id,'sleeper',manager_id,1);
  END IF;
  IF expiry<=clock_timestamp() THEN RAISE EXCEPTION 'public refresh approval expired'; END IF;
  next_revision:=expected+1;
  INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,cadence_seconds,expires_at,paused,exact_periods,period_inventory,playoff_brackets,weekly_reports,transaction_history,draft_picks)
    VALUES(target_id,next_revision,identity_id,wanted,cadence,expiry,paused_value,periods,inventory,brackets,reports,history,drafts);
  UPDATE public.public_data_refresh_targets SET configuration_revision=next_revision,
    selection_failure_count=0,selection_failed_at=NULL,selection_next_eligible_at=clock_timestamp()
    WHERE id=target_id;
  RETURN jsonb_build_object('status','configured','targetId',target_id,'configurationRevision',next_revision);
END; $$;

CREATE OR REPLACE FUNCTION public.select_public_data_refresh(p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  cycle_row public.public_data_refresh_cycles%ROWTYPE; request public.public_data_intakes%ROWTYPE;
  selected jsonb; disposition jsonb; request_id uuid; cycle_number bigint; native text; due timestamptz;
  next_due timestamptz; terminal_time timestamptz; has_backoff boolean:=false; has_capacity boolean:=false; checked integer:=0;
BEGIN
  -- Lock order: global public job, shared intake-capacity lock, target, request.
  -- Configuration never locks the job/request; ordinary submit only takes capacity.
  PERFORM public.assert_public_refresh_owner(p_fence);
  SELECT payload->'refreshSelection' INTO selected FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF selected IS NOT NULL THEN
    -- Unknown acknowledgement: the same owner receives the exact durable binding.
    -- Admission still rechecks the latest approval; this is never another cycle.
    PERFORM public.assert_public_refresh_owner(p_fence);
    RETURN selected;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public-data-intake-admission',0));
  PERFORM public.assert_public_refresh_owner(p_fence);
  FOR target IN SELECT candidate.* FROM public.public_data_refresh_targets candidate
    ORDER BY candidate.last_served_at NULLS FIRST,candidate.created_at,candidate.id LIMIT 16 FOR UPDATE SKIP LOCKED LOOP
    checked:=checked+1;
    PERFORM public.assert_public_refresh_owner(p_fence);
    SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations
      WHERE target_id=target.id AND revision=target.configuration_revision;
    IF configuration.paused OR configuration.expires_at<=clock_timestamp() THEN CONTINUE; END IF;
    IF target.selection_next_eligible_at>clock_timestamp() THEN has_backoff:=true; CONTINUE; END IF;
    cycle_row:=NULL; request:=NULL;
    IF target.current_cycle IS NOT NULL THEN
      SELECT * INTO STRICT cycle_row FROM public.public_data_refresh_cycles WHERE target_id=target.id AND cycle=target.current_cycle;
      SELECT * INTO request FROM public.public_data_intakes WHERE id=cycle_row.intake_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN has_backoff:=true; CONTINUE; END IF;
      IF request.terminal THEN
        IF NOT EXISTS(SELECT 1 FROM public.public_data_refresh_cycle_outcomes WHERE target_id=target.id AND cycle=cycle_row.cycle) THEN
          disposition:=public.next_public_data_intake(request.id);
          IF disposition NOT IN ('"complete"'::jsonb,'"partial"'::jsonb,'"unavailable"'::jsonb) THEN
            RAISE EXCEPTION 'terminal public refresh cycle has no terminal disposition'; END IF;
          -- Store once: recomputing a future slot on every poll would never run.
          terminal_time:=clock_timestamp();
          next_due:=cycle_row.due_at+make_interval(secs=>
            (floor(greatest(0,extract(epoch FROM terminal_time-cycle_row.due_at))/configuration.cadence_seconds)+1)*configuration.cadence_seconds);
          INSERT INTO public.public_data_refresh_cycle_outcomes(target_id,cycle,disposition,recorded_at,next_due_at)
            VALUES(target.id,cycle_row.cycle,disposition#>>'{}',terminal_time,next_due);
          UPDATE public.public_data_refresh_targets SET next_due_at=next_due WHERE id=target.id;
          target.next_due_at:=next_due;
        END IF;
        request:=NULL;
      ELSIF request.next_attempt_at>clock_timestamp() THEN has_backoff:=true; CONTINUE;
      END IF;
    END IF;
    IF request.id IS NULL THEN
      IF target.next_due_at>clock_timestamp() THEN has_backoff:=true; CONTINUE; END IF;
      IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal)>=16 THEN has_capacity:=true; CONTINUE; END IF;
      SELECT external_manager_id INTO STRICT native FROM public.league_source_manager_accounts
        WHERE id=target.source_manager_account_id AND provider=target.provider;
      request_id:=gen_random_uuid(); cycle_number:=COALESCE(target.current_cycle,0)+1;
      -- One new ordinary request. No reset or mutation of previous cycle evidence.
      PERFORM public.submit_public_data_intake(jsonb_build_object('id',request_id,'username',native,'seasons',configuration.seasons)||CASE WHEN configuration.period_inventory IS NULL THEN jsonb_build_object('exactPeriods',configuration.exact_periods) ELSE jsonb_build_object('periodInventory',configuration.period_inventory) END||CASE WHEN configuration.playoff_brackets IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('playoffBrackets',configuration.playoff_brackets) END||CASE WHEN configuration.weekly_reports='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('weeklyReports',configuration.weekly_reports) END||CASE WHEN configuration.transaction_history IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('transactionHistory',configuration.transaction_history) END||CASE WHEN configuration.draft_picks IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('draftPicks',configuration.draft_picks) END);
      due:=target.next_due_at+make_interval(secs=>
        floor(greatest(0,extract(epoch FROM clock_timestamp()-target.next_due_at))/configuration.cadence_seconds)*configuration.cadence_seconds);
      INSERT INTO public.public_data_refresh_cycles(target_id,cycle,configuration_revision,intake_id,due_at)
        VALUES(target.id,cycle_number,target.configuration_revision,request_id,due) RETURNING * INTO cycle_row;
      UPDATE public.public_data_refresh_targets SET current_cycle=cycle_number WHERE id=target.id;
      SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=request_id;
    END IF;
    IF request.username IS DISTINCT FROM (SELECT external_manager_id FROM public.league_source_manager_accounts
      WHERE id=target.source_manager_account_id AND provider=target.provider)
      OR request.seasons IS DISTINCT FROM configuration.seasons OR request.exact_periods IS DISTINCT FROM configuration.exact_periods
      OR request.draft_picks IS DISTINCT FROM configuration.draft_picks
      OR request.draft_picks IS DISTINCT FROM (SELECT draft_picks FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.transaction_period IS NOT NULL
      OR request.transaction_history IS DISTINCT FROM configuration.transaction_history
      OR request.transaction_history IS DISTINCT FROM (SELECT transaction_history FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.weekly_reports IS DISTINCT FROM configuration.weekly_reports
      OR request.weekly_reports IS DISTINCT FROM (SELECT weekly_reports FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.playoff_brackets IS DISTINCT FROM configuration.playoff_brackets
      OR request.playoff_brackets IS DISTINCT FROM (SELECT playoff_brackets FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.period_inventory IS DISTINCT FROM configuration.period_inventory
      OR request.period_inventory IS DISTINCT FROM (SELECT period_inventory FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.exact_periods IS DISTINCT FROM (SELECT exact_periods FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision) THEN RAISE EXCEPTION 'refresh request scope changed'; END IF;
    selected:=jsonb_build_object('status','selected','targetId',target.id,'configurationRevision',target.configuration_revision,
      'cycleConfigurationRevision',cycle_row.configuration_revision,'cycle',cycle_row.cycle,'requestId',request.id);
    PERFORM public.assert_public_refresh_owner(p_fence);
    IF configuration.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'public refresh approval expired during selection'; END IF;
    UPDATE public.projection_jobs SET payload=payload||jsonb_build_object('requestId',request.id,'refreshSelection',selected)
      WHERE job_key=p_fence->>'jobKey';
    PERFORM public.assert_public_data_owner(request.id,p_fence);
    RETURN selected;
  END LOOP;
  PERFORM public.assert_public_refresh_owner(p_fence);
  RETURN jsonb_build_object('status',CASE WHEN has_capacity THEN 'capacity' WHEN has_backoff THEN 'backoff' ELSE 'idle' END,
    'checkedTargets',checked);
END; $$;

CREATE OR REPLACE FUNCTION public.next_public_data_intake(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.public_data_intakes%ROWTYPE; manager text; missing_season integer;
  candidate public.public_data_league_candidates%ROWTYPE; task public.public_data_exact_period_tasks%ROWTYPE; bracket_task public.public_data_bracket_tasks%ROWTYPE; report_task public.public_data_report_tasks%ROWTYPE; transaction_task public.public_data_transaction_tasks%ROWTYPE; base jsonb; draft_task public.public_data_draft_tasks%ROWTYPE;
BEGIN
  SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=p_id;
  IF request.terminal THEN
    IF NOT EXISTS(SELECT 1 FROM public.public_data_identity_observations WHERE intake_id=p_id)
      OR EXISTS(SELECT 1 FROM unnest(request.seasons) AS wanted(season) WHERE NOT EXISTS(
        SELECT 1 FROM public.public_data_league_lists list WHERE list.intake_id=p_id AND list.season=wanted.season)) THEN
      RETURN '"unavailable"'::jsonb;
    END IF;
    IF EXISTS(SELECT 1 FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('unavailable','capacity')) THEN
      RETURN '"partial"'::jsonb;
    END IF;
    IF request.exact_periods<>'[]'::jsonb THEN
      IF EXISTS(SELECT 1 FROM public.public_data_exact_period_tasks WHERE intake_id=p_id AND status<>'complete') THEN
        RETURN '"partial"'::jsonb;
      END IF;
    END IF;
    IF (request.transaction_period IS NOT NULL OR request.transaction_history IS NOT NULL) AND EXISTS(SELECT 1 FROM public.public_data_transaction_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    IF request.weekly_reports<>'[]'::jsonb AND EXISTS(SELECT 1 FROM public.public_data_report_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    IF request.playoff_brackets IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_bracket_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    IF request.draft_picks IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_draft_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    RETURN '"complete"'::jsonb;
  END IF;
  IF request.next_attempt_at>clock_timestamp() THEN RETURN '"backoff"'::jsonb; END IF;
  base:=jsonb_build_object('requestId',p_id,'revision',request.revision);
  SELECT account.external_manager_id INTO manager FROM public.public_data_identity_observations identity
    JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id
    WHERE identity.intake_id=p_id AND account.provider='sleeper';
  IF manager IS NULL THEN RETURN base||jsonb_build_object('kind','identity','username',request.username); END IF;
  SELECT wanted.season INTO missing_season FROM unnest(request.seasons) AS wanted(season)
    WHERE NOT EXISTS(SELECT 1 FROM public.public_data_league_lists list WHERE list.intake_id=p_id AND list.season=wanted.season)
    ORDER BY wanted.season LIMIT 1;
  IF missing_season IS NOT NULL THEN RETURN base||jsonb_build_object('kind','leagues','userId',manager,'season',missing_season); END IF;
  IF request.draft_picks IS NOT NULL THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO draft_task FROM public.public_data_draft_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN public.public_data_draft_work(draft_task,request.revision); END IF;
  END IF;
  IF (request.transaction_period IS NOT NULL OR request.transaction_history IS NOT NULL) THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO transaction_task FROM public.public_data_transaction_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','transactions','externalLeagueId',transaction_task.external_league_id,
      'season',transaction_task.season,'nativeWeek',transaction_task.native_week); END IF;
  END IF;
  IF request.weekly_reports<>'[]'::jsonb THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO report_task FROM public.public_data_report_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','weekly-report','externalLeagueId',report_task.external_league_id,
      'season',report_task.season,'nativeWeek',report_task.native_week); END IF;
  END IF;
  IF request.playoff_brackets IS NOT NULL THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO bracket_task FROM public.public_data_bracket_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','playoff-brackets','externalLeagueId',bracket_task.external_league_id,'season',bracket_task.season); END IF;
  END IF;
  IF request.exact_periods<>'[]'::jsonb THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO task FROM public.public_data_exact_period_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','exact-matchups','externalLeagueId',task.external_league_id,'season',task.season,'nativeWeek',task.native_week); END IF;
  END IF;
  SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('bootstrap','core','users')
    ORDER BY CASE stage WHEN 'users' THEN 1 ELSE 0 END,season,external_league_id LIMIT 1;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('unavailable','capacity')) THEN
      RETURN '"partial"'::jsonb;
    END IF;
    IF request.exact_periods<>'[]'::jsonb THEN
      IF EXISTS(SELECT 1 FROM public.public_data_exact_period_tasks WHERE intake_id=p_id AND status<>'complete') THEN
        RETURN '"partial"'::jsonb;
      END IF;
    END IF;
    IF (request.transaction_period IS NOT NULL OR request.transaction_history IS NOT NULL) AND EXISTS(SELECT 1 FROM public.public_data_transaction_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    IF request.weekly_reports<>'[]'::jsonb AND EXISTS(SELECT 1 FROM public.public_data_report_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    IF request.playoff_brackets IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_bracket_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    IF request.draft_picks IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_draft_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    RETURN '"complete"'::jsonb;
  END IF;
  RETURN base||jsonb_build_object('kind',candidate.stage,'externalLeagueId',candidate.external_league_id,'season',candidate.season);
END; $$;

CREATE FUNCTION public.fail_public_data_draft_work(p_work jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; failures integer;
BEGIN
  PERFORM public.assert_roster_player_link_fence(p_fence);
  IF p_work->>'kind' IS DISTINCT FROM 'drafts' THEN
    SELECT failure_count+1 INTO STRICT failures FROM public.public_data_intakes WHERE id=request_id;
    IF failures>=5 AND p_work->>'kind' IN ('bootstrap','identity','leagues') THEN
      UPDATE public.public_data_draft_tasks SET write_fence=p_fence,status='unavailable',
        reason=CASE WHEN p_work->>'kind'='bootstrap' THEN 'bootstrap-unavailable' ELSE 'discovery-unavailable' END
      WHERE intake_id=request_id AND status='pending' AND (p_work->>'kind'<>'bootstrap'
        OR (season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId'));
    END IF;
    PERFORM public.fail_public_data_transaction_work(p_work,p_fence);
    RETURN;
  END IF;
  UPDATE public.public_data_intakes SET failure_count=failure_count+1,revision=revision+1,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,60*(2^least(failure_count,5))::integer))
    WHERE id=request_id AND revision=(p_work->>'revision')::integer AND draft_picks IS NOT NULL RETURNING failure_count INTO failures;
  IF NOT FOUND THEN RAISE EXCEPTION 'public draft intake checkpoint changed'; END IF;
  UPDATE public.public_data_draft_tasks SET write_fence=p_fence,failure_count=failures,
    status=CASE WHEN failures>=5 THEN 'unavailable' ELSE 'pending' END,
    reason=CASE WHEN failures>=5 THEN 'draft-capture-exhausted' ELSE NULL END
    WHERE intake_id=request_id AND status='pending' AND public.public_data_draft_work(public_data_draft_tasks,(p_work->>'revision')::integer)=p_work;
  IF NOT FOUND THEN RAISE EXCEPTION 'public draft task changed'; END IF;
  IF failures>=5 THEN
    UPDATE public.public_data_intakes SET failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
    IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
      UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id; END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.recover_public_data_dispatch(p_selected uuid,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.public_data_dispatches%ROWTYPE; retained_revision integer; disposition text;
BEGIN
  PERFORM public.assert_public_data_owner(p_selected,p_fence);
  SELECT dispatch.* INTO prior FROM public.public_data_dispatches dispatch WHERE NOT EXISTS(
    SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)
    ORDER BY dispatch.admitted_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF prior.worker_id=p_fence->>'workerId' AND prior.generation=(p_fence->>'generation')::integer THEN
    RAISE EXCEPTION 'current public dispatch cannot recover itself';
  END IF;
  SELECT revision INTO STRICT retained_revision FROM public.public_data_intakes WHERE id=prior.intake_id FOR UPDATE;
  PERFORM public.assert_public_data_owner(p_selected,p_fence);
  IF retained_revision=prior.revision THEN
    -- Recovery mutates the abandoned request under this new cleanup owner's
    -- original fence, never under the old dispatch's already expired fence.
    IF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=prior.intake_id AND draft_picks IS NOT NULL) THEN
      PERFORM public.fail_public_data_draft_work(prior.work,p_fence);
    ELSIF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=prior.intake_id AND (transaction_period IS NOT NULL OR transaction_history IS NOT NULL)) THEN
      PERFORM public.fail_public_data_transaction_work(prior.work,p_fence);
    ELSIF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=prior.intake_id AND weekly_reports<>'[]'::jsonb) THEN
      PERFORM public.fail_public_data_report_work(prior.work,p_fence);
    ELSIF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=prior.intake_id AND playoff_brackets IS NOT NULL) THEN
      PERFORM public.fail_public_data_bracket_work(prior.work,p_fence);
    ELSE PERFORM public.fail_public_data_work(prior.work); END IF;
    disposition:='recovered';
  ELSIF retained_revision>prior.revision THEN disposition:='checkpoint-committed';
  ELSE RAISE EXCEPTION 'public dispatch revision regressed'; END IF;
  PERFORM public.assert_public_data_owner(p_selected,p_fence);
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome) VALUES(prior.worker_id,prior.generation,disposition);
END; $$;

CREATE OR REPLACE FUNCTION public.derive_public_data_capture_witness(p_work jsonb,p_mapping jsonb,p_fence jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE dispatch public.public_data_dispatches%ROWTYPE; reserved record;
  role_name text; attempts jsonb:='{}'::jsonb; role_names text[]; kind text:=p_work->>'kind'; witness jsonb;
BEGIN
  IF p_fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake'
    OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_fence))<>4
    OR NOT(p_fence ?& ARRAY['jobKey','workerId','generation','deadlineAt']) THEN
    RAISE EXCEPTION 'public capture requires exact owner fence'; END IF;
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches
    WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
  IF dispatch.work IS DISTINCT FROM p_work OR dispatch.capture_nonce IS NULL
    OR dispatch.intake_id IS DISTINCT FROM (p_work->>'requestId')::uuid
    OR dispatch.resource IS DISTINCT FROM kind
    OR dispatch.admitted_at>clock_timestamp() OR dispatch.admitted_at<clock_timestamp()-interval '30 seconds'
    OR EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome
      WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation) THEN
    RAISE EXCEPTION 'current original public dispatch required'; END IF;
  IF kind IN ('core','users','exact-matchups','playoff-brackets','weekly-report','transactions','drafts') THEN
    IF p_mapping IS NULL OR jsonb_typeof(p_mapping) IS DISTINCT FROM 'object'
      OR p_mapping->'scope'->>'externalLeagueId' IS DISTINCT FROM p_work->>'externalLeagueId'
      OR p_mapping->'scope'->>'season' IS DISTINCT FROM p_work->>'season' THEN
      RAISE EXCEPTION 'public capture mapping mismatch'; END IF;
    PERFORM public.validate_current_roster_mapping(p_mapping);
  ELSIF kind IN ('identity','leagues','bootstrap') THEN
    IF p_mapping IS NOT NULL THEN RAISE EXCEPTION 'unmapped public capture expected'; END IF;
  ELSE RAISE EXCEPTION 'unsupported public capture kind'; END IF;
  FOR reserved IN SELECT attempt.*,scope.identity FROM public.league_roster_resource_attempts attempt
    JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
    WHERE attempt.write_fence=p_fence ORDER BY attempt.id LOOP
    IF kind NOT IN ('core','exact-matchups','playoff-brackets','weekly-report','transactions','drafts') OR reserved.source_mapping IS DISTINCT FROM p_mapping
      OR reserved.capture_nonce IS NULL OR reserved.reserved_at<dispatch.admitted_at
      OR reserved.reserved_at>clock_timestamp() THEN
      RAISE EXCEPTION 'public capture reservation mismatch'; END IF;
    role_name:=CASE reserved.identity->'policy'->>'canonicalNormalizerVersion'
      WHEN 'sleeper-league-settings-v1' THEN 'settings'
      WHEN 'sleeper-current-players-v1' THEN 'players'
      WHEN 'sleeper-current-team-managers-v1' THEN 'managers'
      WHEN 'sleeper-current-team-manager-evidence-v2' THEN 'managersV2'
      WHEN 'sleeper-exact-matchups-v1' THEN 'matchups'
      WHEN 'sleeper-transactions-v1' THEN CASE WHEN reserved.identity->'scope'->>'family'='transactions'
        AND reserved.identity->'scope'->'entityId'='null'::jsonb
        AND reserved.identity->'scope'->>'scoringPeriodId'='sleeper:transaction-week:'||(p_work->>'nativeWeek') THEN 'transactions' END
      WHEN 'sleeper-weekly-report-v1' THEN CASE WHEN reserved.identity->'scope'->>'family'='weekly-reports'
        AND reserved.identity->'scope'->>'entityId'='league_report'
        AND reserved.identity->'scope'->>'scoringPeriodId'='sleeper:report-week:'||(p_work->>'nativeWeek') THEN 'weekly_report' END
      WHEN 'sleeper-playoff-brackets-v1' THEN CASE WHEN reserved.identity->'scope'->>'family'='playoff-brackets'
        AND reserved.identity->'scope'->>'entityId' IN ('winners_bracket','losers_bracket')
        AND reserved.identity->'scope'->'scoringPeriodId'='null'::jsonb THEN reserved.identity->'scope'->>'entityId' END
      WHEN 'sleeper-draft-metadata-v1' THEN CASE WHEN kind='drafts'
        AND reserved.identity=public.public_data_draft_identity(p_work,p_mapping) THEN 'draftMetadata' END
      WHEN 'sleeper-draft-selections-v1' THEN CASE WHEN kind='drafts'
        AND reserved.identity=public.public_data_draft_identity(p_work,p_mapping) THEN 'draftSelections' END
      WHEN 'sleeper-traded-picks-v1' THEN CASE WHEN kind='drafts'
        AND reserved.identity=public.public_data_draft_identity(p_work,p_mapping) THEN 'tradedPicks' END
      ELSE NULL END;
    IF role_name IS NULL OR attempts ? role_name
      OR (role_name='matchups' AND reserved.identity->'scope'->>'scoringPeriodId'
        IS DISTINCT FROM 'sleeper:matchup-week:'||(p_work->>'nativeWeek')) THEN
      RAISE EXCEPTION 'public capture resource group mismatch'; END IF;
    attempts:=attempts||jsonb_build_object(role_name,jsonb_build_object('id',reserved.id,'nonce',reserved.capture_nonce));
  END LOOP;
  SELECT COALESCE(array_agg(key ORDER BY key COLLATE "C"),ARRAY[]::text[]) INTO role_names FROM jsonb_object_keys(attempts) key;
  IF (kind='core' AND role_names NOT IN (ARRAY['managers','players','settings'],ARRAY['managers','managersV2','players','settings']))
    OR (kind='exact-matchups' AND role_names<>ARRAY['matchups','settings'])
    OR (kind='playoff-brackets' AND role_names<>ARRAY['losers_bracket','winners_bracket'])
    OR (kind='weekly-report' AND role_names<>ARRAY['weekly_report'])
    OR (kind='transactions' AND role_names<>ARRAY['transactions'])
    OR (kind='drafts' AND (dispatch.max_requests<>1 OR role_names<>CASE p_work->>'resource'
      WHEN 'catalog' THEN ARRAY['draftMetadata'] WHEN 'detail' THEN ARRAY['draftMetadata'] WHEN 'selections' THEN ARRAY['draftSelections']
      WHEN 'league-trades' THEN ARRAY['tradedPicks'] WHEN 'draft-trades' THEN ARRAY['tradedPicks'] ELSE ARRAY[]::text[] END))
    OR (kind NOT IN ('core','exact-matchups','playoff-brackets','weekly-report','transactions','drafts') AND cardinality(role_names)<>0) THEN
    RAISE EXCEPTION 'complete public capture group required'; END IF;
  -- Recheck after every preceding source/job lock wait. The original DB admission
  -- bounds freshness even when identical content later deduplicates to an old row.
  PERFORM public.assert_public_data_owner(dispatch.intake_id,p_fence);
  IF dispatch.admitted_at<clock_timestamp()-interval '30 seconds' THEN
    RAISE EXCEPTION 'public capture admission expired'; END IF;
  witness:=jsonb_build_object('version','public-network-capture-v1','work',p_work,'fence',p_fence,
    'dispatchNonce',dispatch.capture_nonce,'mapping',p_mapping,'attempts',attempts);
  RETURN witness;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_public_data_capture_witness(p_witness jsonb,p_fence jsonb,p_family text,p_week integer,p_mapping jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE work jsonb:=p_witness->'work'; kind text:=work->>'kind'; mapping jsonb:=NULLIF(p_witness->'mapping','null'::jsonb);
BEGIN
  IF jsonb_typeof(p_witness) IS DISTINCT FROM 'object'
    OR p_witness->>'version' IS DISTINCT FROM 'public-network-capture-v1'
    OR p_witness->'fence' IS DISTINCT FROM p_fence
    OR (p_mapping IS NOT NULL AND p_mapping IS DISTINCT FROM mapping)
    OR p_witness IS DISTINCT FROM public.derive_public_data_capture_witness(work,mapping,p_fence) THEN
    RAISE EXCEPTION 'invalid original public capture witness'; END IF;
  IF ((kind='identity' AND p_family='identity' AND p_week IS NULL)
    OR (kind='leagues' AND p_family='leagues' AND p_week IS NULL)
    OR (kind='bootstrap' AND p_family='league' AND p_week IS NULL)
    OR (kind='core' AND p_family IN ('league','rosters') AND p_week IS NULL)
    OR (kind='users' AND p_family='users' AND p_week IS NULL)
    OR (kind='drafts' AND p_family='drafts' AND p_week IS NULL)
    OR (kind='transactions' AND p_family='transactions' AND p_week=(work->>'nativeWeek')::integer)
    OR (kind='weekly-report' AND p_family='weekly_report' AND p_week=(work->>'nativeWeek')::integer)
    OR (kind='playoff-brackets' AND p_family IN ('winners_bracket','losers_bracket') AND p_week IS NULL)
    OR (kind='exact-matchups' AND ((p_family='league' AND p_week IS NULL)
      OR (p_family='matchups' AND p_week=(work->>'nativeWeek')::integer)))) IS NOT TRUE THEN
    RAISE EXCEPTION 'public capture family or period mismatch'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.public_capture_after_reservation(p_provenance jsonb,p_attempt uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_roster_resource_attempts%ROWTYPE; identity_value jsonb; witness jsonb:=p_provenance->'acquisition';
  family_value text; native_week integer;
BEGIN
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=p_attempt;
  IF witness IS NULL THEN RETURN (p_provenance->>'requestStartedAt')::timestamptz>=attempt.reserved_at; END IF;
  SELECT identity INTO STRICT identity_value FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  family_value:=CASE identity_value->'scope'->>'family' WHEN 'league-season' THEN 'league'
    WHEN 'teams' THEN 'rosters' WHEN 'roster-membership' THEN 'rosters' WHEN 'matchups' THEN 'matchups'
    WHEN 'drafts' THEN 'drafts'
    WHEN 'transactions' THEN 'transactions'
    WHEN 'weekly-reports' THEN 'weekly_report'
    WHEN 'playoff-brackets' THEN identity_value->'scope'->>'entityId' ELSE NULL END;
  native_week:=CASE WHEN family_value IN ('matchups','weekly_report','transactions') THEN (witness->'work'->>'nativeWeek')::integer ELSE NULL END;
  PERFORM public.assert_public_data_capture_witness(witness,attempt.write_fence,family_value,native_week,attempt.source_mapping);
  IF attempt.capture_nonce IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_each(witness->'attempts') item
    WHERE item.value=jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce)) THEN
    RAISE EXCEPTION 'public capture attempt witness mismatch'; END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_public_capture_input_shape(p_input jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE witness jsonb:=p_input->'envelope'->'provenance'->'acquisition'; family_value text:=p_input->'envelope'->>'family';
  roles text[]; role_name text; input_key text; addition jsonb;
  internal_bracket boolean:=family_value IN ('winners_bracket','losers_bracket')
    AND NOT(p_input ?| ARRAY['bracketAcceptance','bracketProjection','sourceMapping']);
  internal_draft boolean:=family_value='drafts' AND NOT(p_input ?| ARRAY['draftMetadataAcceptance','draftMetadataProjection',
    'draftSelectionsAcceptance','draftSelectionsProjection','tradedPicksAcceptance','tradedPicksProjection','sourceMapping']);
  internal_report boolean:=family_value='weekly_report'
    AND NOT(p_input ?| ARRAY['weeklyReportAcceptance','weeklyReportProjection','sourceMapping']);
BEGIN
  IF witness IS NULL THEN
    IF EXISTS(SELECT 1 FROM jsonb_each(p_input) entry WHERE entry.key IN
      ('rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','matchupAcceptance')
      AND entry.value->'population'->'envelope'->'provenance'->'acquisition' IS NOT NULL) THEN
      RAISE EXCEPTION 'unwitnessed capture cannot borrow witnessed population'; END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(witness) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid public capture shape'; END IF;
  IF witness->>'version' IS DISTINCT FROM 'public-network-capture-v1'
    OR (SELECT count(*) FROM jsonb_object_keys(witness))<>6
    OR NOT(witness ?& ARRAY['version','work','fence','dispatchNonce','mapping','attempts'])
    OR witness->'fence' IS DISTINCT FROM p_input->'writeFence'
    OR (family_value<>'users' AND NOT internal_bracket AND NOT internal_report AND NOT internal_draft AND witness->'mapping' IS DISTINCT FROM p_input->'sourceMapping')
    OR p_input->'envelope'->'provenance'->>'origin' IS DISTINCT FROM 'network'
    OR jsonb_typeof(witness->'attempts') IS DISTINCT FROM 'object'
    OR witness->'mapping'->'scope' IS DISTINCT FROM p_input->'envelope'->'scope' THEN
    RAISE EXCEPTION 'invalid public capture shape'; END IF;
  roles:=CASE family_value WHEN 'league' THEN ARRAY['settings']
    WHEN 'rosters' THEN CASE WHEN witness->'attempts' ? 'managersV2' THEN ARRAY['players','managers','managersV2'] ELSE ARRAY['players','managers'] END
    WHEN 'drafts' THEN CASE witness->'work'->>'resource' WHEN 'catalog' THEN ARRAY['draftMetadata'] WHEN 'detail' THEN ARRAY['draftMetadata'] WHEN 'selections' THEN ARRAY['draftSelections'] ELSE ARRAY['tradedPicks'] END
    WHEN 'transactions' THEN ARRAY['transactions']
    WHEN 'weekly_report' THEN ARRAY['weekly_report'] WHEN 'matchups' THEN ARRAY['matchups'] WHEN 'users' THEN ARRAY[]::text[]
    WHEN 'winners_bracket' THEN ARRAY['winners_bracket'] WHEN 'losers_bracket' THEN ARRAY['losers_bracket'] ELSE NULL END;
  IF family_value='drafts' AND (witness->'work'->>'kind' IS DISTINCT FROM 'drafts'
    OR witness->'work'->>'season' IS DISTINCT FROM '2026'
    OR witness->'work'->>'resource' IS NULL OR witness->'work'->>'resource' NOT IN ('catalog','detail','selections','league-trades','draft-trades')
    OR witness->'work'->>'externalLeagueId' IS DISTINCT FROM p_input->'envelope'->'scope'->>'externalLeagueId'
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR (SELECT count(*) FROM jsonb_object_keys(witness->'attempts'))<>1 OR NOT(witness->'attempts' ? roles[1])) THEN
    RAISE EXCEPTION 'complete witnessed draft group required'; END IF;
  IF family_value IN ('winners_bracket','losers_bracket') AND (
    witness->'work'->>'kind' IS DISTINCT FROM 'playoff-brackets'
    OR witness->'work'->>'season' IS DISTINCT FROM '2026'
    OR witness->'work'->>'externalLeagueId' IS DISTINCT FROM p_input->'envelope'->'scope'->>'externalLeagueId'
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR (SELECT count(*) FROM jsonb_object_keys(witness->'attempts'))<>2
    OR NOT(witness->'attempts' ?& ARRAY['winners_bracket','losers_bracket'])) THEN
    RAISE EXCEPTION 'complete witnessed bracket group required'; END IF;
  IF family_value='transactions' AND (
    witness->'work'->>'kind' IS DISTINCT FROM 'transactions'
    OR witness->'work'->>'season' IS DISTINCT FROM '2026'
    OR witness->'work'->>'externalLeagueId' IS DISTINCT FROM p_input->'envelope'->'scope'->>'externalLeagueId'
    OR witness->'work'->'nativeWeek' IS DISTINCT FROM p_input->'envelope'->'week'
    OR (SELECT count(*) FROM jsonb_object_keys(witness->'attempts'))<>1
    OR NOT(witness->'attempts' ? 'transactions')
    OR p_input ?| ARRAY['rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','leagueSettingsAcceptance',
      'matchupAcceptance','bracketAcceptance','bracketProjection','weeklyReportAcceptance','weeklyReportProjection',
      'officialStandings','calendarEvidence','calculationCapture']) THEN
    RAISE EXCEPTION 'complete witnessed transaction group required'; END IF;
  IF family_value='weekly_report' AND (
    witness->'work'->>'kind' IS DISTINCT FROM 'weekly-report'
    OR witness->'work'->>'season' IS DISTINCT FROM '2026'
    OR witness->'work'->>'externalLeagueId' IS DISTINCT FROM p_input->'envelope'->'scope'->>'externalLeagueId'
    OR witness->'work'->'nativeWeek' IS DISTINCT FROM p_input->'envelope'->'week'
    OR (SELECT count(*) FROM jsonb_object_keys(witness->'attempts'))<>1
    OR NOT(witness->'attempts' ? 'weekly_report')) THEN
    RAISE EXCEPTION 'complete witnessed report group required'; END IF;
  IF roles IS NULL THEN RAISE EXCEPTION 'unsupported witnessed capture'; END IF;
  FOREACH role_name IN ARRAY roles LOOP
    -- Only revoked predecessor functions receive this stripped legacy form.
    -- The public entry validates its full addition first; acquisition is retained.
    IF internal_bracket OR internal_report OR internal_draft THEN CONTINUE; END IF;
    input_key:=CASE role_name WHEN 'draftMetadata' THEN 'draftMetadataAcceptance' WHEN 'draftSelections' THEN 'draftSelectionsAcceptance' WHEN 'tradedPicks' THEN 'tradedPicksAcceptance' WHEN 'settings' THEN 'leagueSettingsAcceptance' WHEN 'players' THEN 'rosterAcceptance'
      WHEN 'managers' THEN 'teamManagerAcceptance' WHEN 'managersV2' THEN 'teamManagerEvidenceAcceptance'
      WHEN 'transactions' THEN 'transactionAcceptance' WHEN 'weekly_report' THEN 'weeklyReportAcceptance' WHEN 'winners_bracket' THEN 'bracketAcceptance' WHEN 'losers_bracket' THEN 'bracketAcceptance' ELSE 'matchupAcceptance' END;
    addition:=p_input->input_key;
    IF addition->'attempt'->>'id' IS NULL
      OR addition->'attempt'->>'id' IS DISTINCT FROM witness->'attempts'->role_name->>'id'
      OR ((family_value='matchups' OR (family_value='rosters'
      AND (witness->'work'->>'season' IS DISTINCT FROM '2026' OR addition ? 'population')))
      AND addition->'population'->'envelope'->'provenance'->'acquisition' IS DISTINCT FROM witness) THEN
      RAISE EXCEPTION 'complete witnessed writer input required'; END IF;
  END LOOP;
END; $$;

CREATE FUNCTION public.read_public_data_draft_catalog(p_work jsonb,p_mapping jsonb,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; original_payload jsonb;
BEGIN
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  PERFORM public.validate_current_roster_mapping(p_mapping);
  IF p_work->>'kind' IS DISTINCT FROM 'drafts' OR p_work->>'resource' IS NULL OR p_work->>'resource' NOT IN ('detail','selections','draft-trades') THEN
    RAISE EXCEPTION 'draft child catalog required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE dispatch.work=p_work AND dispatch.worker_id=p_fence->>'workerId'
    AND dispatch.generation=(p_fence->>'generation')::integer AND dispatch.max_requests=1 AND NOT EXISTS(
      SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
    RAISE EXCEPTION 'draft catalog requires admitted original dispatch'; END IF;
  SELECT jsonb_build_object('receiptId',receipt.id,'observationId',receipt.legacy_observation_id,'sourceMapping',checkpoint.source_mapping,
    'provenance',receipt.provenance,'payload',content.payload),content.payload INTO STRICT result,original_payload
    FROM public.public_data_draft_tasks task JOIN public.public_data_draft_checkpoints checkpoint ON checkpoint.intake_id=task.intake_id
      AND checkpoint.draft_receipt_id=task.catalog_receipt_id
    JOIN public.public_data_draft_tasks parent ON parent.intake_id=checkpoint.intake_id AND parent.ordinal=checkpoint.task_ordinal
    JOIN public.league_roster_capture_receipts receipt ON receipt.id=checkpoint.draft_receipt_id
    JOIN public.league_administration_contents content ON content.id=receipt.content_id
    WHERE task.intake_id=(p_work->>'requestId')::uuid AND public.public_data_draft_work(task,(p_work->>'revision')::integer)=p_work
      AND parent.resource='catalog' AND parent.status='complete' AND checkpoint.source_mapping=p_mapping
      AND parent.season=task.season AND parent.external_league_id=task.external_league_id AND task.status='pending';
  IF (SELECT count(*) FROM jsonb_array_elements(original_payload->'catalog') row
    WHERE public.draft_metadata_owns(row,p_work->>'externalLeagueId',p_work->>'externalDraftId'))<>1 THEN
    RAISE EXCEPTION 'draft catalog must retain exact unique native identity'; END IF;
  PERFORM public.assert_public_data_owner((p_work->>'requestId')::uuid,p_fence);
  RETURN result;
END; $$;
CREATE FUNCTION public.assert_public_draft_capture(p_input jsonb,p_role text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE witness jsonb:=p_input->'envelope'->'provenance'->'acquisition'; work jsonb:=witness->'work';
  payload jsonb:=p_input->'envelope'->'payload'; addition jsonb; retained_catalog jsonb; native_row jsonb; expected_role text; expected_kind text;
BEGIN
  IF witness IS NULL THEN RETURN; END IF;
  PERFORM public.assert_public_capture_input_shape(p_input);
  expected_role:=CASE work->>'resource' WHEN 'catalog' THEN 'draftMetadata' WHEN 'detail' THEN 'draftMetadata'
    WHEN 'selections' THEN 'draftSelections' WHEN 'league-trades' THEN 'tradedPicks' WHEN 'draft-trades' THEN 'tradedPicks' END;
  expected_kind:=CASE work->>'resource' WHEN 'league-trades' THEN 'league' WHEN 'draft-trades' THEN 'draft' ELSE work->>'resource' END;
  addition:=p_input->(p_role||'Acceptance');
  IF p_role IS DISTINCT FROM expected_role OR payload->>'kind' IS DISTINCT FROM expected_kind
    OR addition->'attempt'->>'id' IS NULL OR addition->'attempt'->>'id' IS DISTINCT FROM witness->'attempts'->p_role->>'id' THEN
    RAISE EXCEPTION 'draft capture endpoint or attempt mismatch'; END IF;
  PERFORM public.assert_public_data_capture_witness(witness,p_input->'writeFence','drafts',NULL,p_input->'sourceMapping');
  PERFORM public.public_capture_after_reservation(p_input->'envelope'->'provenance',(addition->'attempt'->>'id')::uuid);
  IF work->>'resource' IN ('detail','selections','draft-trades') THEN
    retained_catalog:=public.read_public_data_draft_catalog(work,p_input->'sourceMapping',p_input->'writeFence');
    SELECT row INTO STRICT native_row FROM jsonb_array_elements(retained_catalog->'payload'->'catalog') row
      WHERE public.draft_metadata_owns(row,work->>'externalLeagueId',work->>'externalDraftId');
    IF payload->>'externalDraftId' IS DISTINCT FROM work->>'externalDraftId' OR payload->'catalog' IS DISTINCT FROM native_row THEN
      RAISE EXCEPTION 'draft capture must retain same-cycle catalog row'; END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.record_league_administration_observation_v53(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE addition jsonb:=p_input->'draftMetadataAcceptance'; projection jsonb:=p_input->'draftMetadataProjection'; result jsonb; expected jsonb; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; resource_entity text; evidence_hash_value text;
  covered boolean:=false; acceptance_id uuid; prior_provenance jsonb; prior_content uuid; source_current boolean:=true; clock_key text;
BEGIN
  IF addition IS NULL THEN
    IF p_input ? 'draftMetadataProjection' THEN RAISE EXCEPTION 'draft projection requires metadata acceptance'; END IF;
    RETURN public.record_league_administration_observation_v52(p_input);
  END IF;
  IF p_input ?| ARRAY['rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','leagueSettingsAcceptance','matchupAcceptance',
      'calendarEvidence','calculationCapture','transactionAcceptance','bracketAcceptance','bracketProjection','weeklyReportAcceptance','weeklyReportProjection','officialStandings']
    OR octet_length(p_input::text)>33488896 THEN RAISE EXCEPTION 'mixed or oversized draft metadata acceptance'; END IF;
  IF provenance ? 'acquisition' THEN PERFORM public.assert_public_draft_capture(p_input,'draftMetadata'); END IF;
  -- Timestamp casts alone admit locale/space forms rejected by the unchanged
  -- TypeScript normalizer. Require explicit ISO network clocks independently.
  IF jsonb_typeof(provenance) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid draft metadata provenance'; END IF;
  FOREACH clock_key IN ARRAY ARRAY['requestStartedAt','requestCompletedAt','checkedAt','sourceObservedAt'] LOOP
    IF clock_key='sourceObservedAt' AND provenance->clock_key='null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(provenance->clock_key) IS DISTINCT FROM 'string'
      OR provenance->>clock_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-4]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'invalid draft metadata ISO clock'; END IF;
    IF NOT isfinite((provenance->>clock_key)::timestamptz) THEN RAISE EXCEPTION 'nonfinite draft metadata clock'; END IF;
  END LOOP;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'drafts' OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' OR p_input->'sourceMapping' IS NULL
    OR projection->>'version' IS DISTINCT FROM 'sleeper-draft-metadata-v1' OR projection->>'status' IS NULL OR projection->>'status' NOT IN ('accepted','rejected')
    OR p_input->'envelope'->'payload'->>'metadataVersion' IS DISTINCT FROM 'sleeper-draft-metadata-v1'
    OR p_input->'envelope'->'payload'->>'kind' IS NULL OR p_input->'envelope'->'payload'->>'kind' NOT IN ('catalog','detail')
    OR p_input->>'status' IS DISTINCT FROM 'rejected' OR p_input->'value' IS DISTINCT FROM 'null'::jsonb OR p_input->'semanticHash' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(p_input->'diagnostics') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'diagnostics')<>1
    OR p_input->'diagnostics'->0->>'code' IS DISTINCT FROM 'invalid_array' OR p_input->'diagnostics'->0->>'path' IS DISTINCT FROM 'payload'
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR ((provenance->>'sourceObservedAt')::timestamptz IS NULL AND projection->>'status'='accepted' AND projection->'value'->>'complete'='true')
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz<(provenance->>'requestStartedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid mapped draft metadata network capture'; END IF;
  resource_entity:=CASE WHEN p_input->'envelope'->'payload'->>'kind'='catalog' THEN 'catalog' ELSE 'draft:'||(p_input->'envelope'->'payload'->>'externalDraftId') END;
  IF resource_entity IS NULL THEN RAISE EXCEPTION 'missing draft resource identity'; END IF;
  -- Expanded JSON text conservatively bounds the compact stored reader. Tuple
  -- children are smaller than projected children; <=8 facts add bounded UUID,
  -- native-ID and header framing. Account separately for native league strings.
  IF octet_length((p_input->'envelope'->'payload')::text)+octet_length((projection->'value')::text)
    +octet_length((p_input->'sourceMapping')::text)+octet_length(provenance::text)+65536
    +8*octet_length((p_input->'envelope'->'scope'->'externalLeagueId')::text)>33554432 THEN
    RAISE EXCEPTION 'draft metadata persistence budget exceeded'; END IF;
  -- The prior writer owns job -> league/source -> legacy-head locking. Preserve
  -- that order before obtaining the typed resource head; all later failures roll
  -- back this same SQL transaction, including the delegated legacy observation.
  result:=public.record_league_administration_observation_v52(p_input-'draftMetadataAcceptance'-'draftMetadataProjection'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt';
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF provenance->'acquisition' IS NULL AND (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RAISE EXCEPTION 'draft request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',attempt.source_mapping->>'connectionId',
        'leagueSeasonId',attempt.source_mapping->>'leagueSeasonId','family','drafts','entityId',resource_entity,'scoringPeriodId',NULL,
        'audienceId','public','coverageSpecId','sleeper-draft-metadata-v1'),'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-draft-metadata-v1',
        'canonicalNormalizerVersion','sleeper-draft-metadata-v1','validationVersion','latest-network-attempt-v1'))) THEN RAISE EXCEPTION 'draft metadata attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND AND receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'draft metadata attempt receipt conflict'; END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId' AND stored.family='drafts' AND stored.week=0
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness' AND NOT stored.accepted
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  IF projection->>'status'='accepted' THEN
    expected:=public.project_draft_metadata_native(content.payload,content.external_league_id,content.completeness='complete');
    IF expected IS NULL OR projection->'value' IS DISTINCT FROM expected OR projection->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'draft metadata projection mismatch'; END IF;
    covered:=(expected->>'complete')::boolean;
  ELSIF projection->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(projection->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(projection->'diagnostics')=0 THEN RAISE EXCEPTION 'invalid draft metadata rejection evidence'; END IF;
  IF receipt.id IS NOT NULL THEN
    IF receipt.content_id<>content.id THEN RAISE EXCEPTION 'draft replay content mismatch'; END IF;
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    RETURN result||jsonb_build_object('draftMetadataAcceptance',jsonb_build_object('status',CASE WHEN EXISTS(
      SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
      THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
      jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
        'fields','["draft_id","league_id","season","type","status","settings","draft_order","slot_to_roster_id","metadata","start_time","created","last_picked"]'::jsonb,
        'pagination',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,'nextCursor',NULL,
        'completeness',CASE WHEN covered THEN 'complete' ELSE 'partial' END,
        'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE '["draft_metadata_incomplete"]'::jsonb END)) RETURNING * INTO receipt;
  IF expected IS NOT NULL THEN PERFORM public.capture_draft_metadata_typed(content.id,receipt.id,expected); END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT previous.provenance,previous.content_id INTO prior_provenance,prior_content FROM public.league_roster_resource_acceptances accepted
    JOIN public.league_roster_capture_receipts previous ON previous.id=accepted.receipt_id WHERE accepted.id=head.accepted_id;
  IF FOUND THEN source_current:=(provenance->>'sourceObservedAt')::timestamptz>(prior_provenance->>'sourceObservedAt')::timestamptz
    OR ((provenance->>'sourceObservedAt')::timestamptz=(prior_provenance->>'sourceObservedAt')::timestamptz AND content.id=prior_content); END IF;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered AND source_current THEN
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1) RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1 WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN result||jsonb_build_object('draftMetadataAcceptance',jsonb_build_object('status',CASE WHEN acceptance_id IS NULL THEN 'preserved' ELSE 'accepted' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed' WHEN NOT covered THEN 'draft_metadata_incomplete' ELSE 'draft_metadata_source_not_newer' END,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

CREATE OR REPLACE FUNCTION public.record_league_administration_observation_v54(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE addition jsonb:=p_input->'draftSelectionsAcceptance'; projection jsonb:=p_input->'draftSelectionsProjection'; result jsonb; expected jsonb; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; resource_entity text; evidence_hash_value text;
  covered boolean:=false; acceptance_id uuid; prior_provenance jsonb; prior_content uuid; source_current boolean:=true; clock_key text;
BEGIN
  IF addition IS NULL THEN
    IF p_input ? 'draftSelectionsProjection' THEN RAISE EXCEPTION 'draft projection requires selections acceptance'; END IF;
    RETURN public.record_league_administration_observation_v53(p_input);
  END IF;
  IF p_input ?| ARRAY['rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','leagueSettingsAcceptance','matchupAcceptance',
      'calendarEvidence','calculationCapture','transactionAcceptance','bracketAcceptance','bracketProjection','weeklyReportAcceptance','weeklyReportProjection','officialStandings','draftMetadataAcceptance','draftMetadataProjection']
    OR octet_length(p_input::text)>33488896 THEN RAISE EXCEPTION 'mixed or oversized draft selections acceptance'; END IF;
  IF provenance ? 'acquisition' THEN PERFORM public.assert_public_draft_capture(p_input,'draftSelections'); END IF;
  -- Timestamp casts alone admit locale/space forms rejected by the unchanged
  -- TypeScript normalizer. Require explicit ISO network clocks independently.
  IF jsonb_typeof(provenance) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid draft selections provenance'; END IF;
  FOREACH clock_key IN ARRAY ARRAY['requestStartedAt','requestCompletedAt','checkedAt','sourceObservedAt'] LOOP
    IF clock_key='sourceObservedAt' AND provenance->clock_key='null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(provenance->clock_key) IS DISTINCT FROM 'string'
      OR provenance->>clock_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-4]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'invalid draft selections ISO clock'; END IF;
    IF NOT isfinite((provenance->>clock_key)::timestamptz) THEN RAISE EXCEPTION 'nonfinite draft selections clock'; END IF;
  END LOOP;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'drafts' OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' OR p_input->'sourceMapping' IS NULL
    OR projection->>'version' IS DISTINCT FROM 'sleeper-draft-selections-v1' OR projection->>'status' IS NULL OR projection->>'status' NOT IN ('accepted','rejected')
    OR p_input->'envelope'->'payload'->>'selectionsVersion' IS DISTINCT FROM 'sleeper-draft-selections-v1'
    OR p_input->'envelope'->'payload'->>'kind' IS NULL OR p_input->'envelope'->'payload'->>'kind' NOT IN ('catalog','selections')
    OR p_input->>'status' IS DISTINCT FROM 'rejected' OR p_input->'value' IS DISTINCT FROM 'null'::jsonb OR p_input->'semanticHash' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(p_input->'diagnostics') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'diagnostics')<>1
    OR p_input->'diagnostics'->0->>'code' IS DISTINCT FROM 'invalid_array' OR p_input->'diagnostics'->0->>'path' IS DISTINCT FROM 'payload'
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR ((provenance->>'sourceObservedAt')::timestamptz IS NULL AND projection->>'status'='accepted' AND projection->'value'->>'complete'='true')
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz<(provenance->>'requestStartedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid mapped draft selections network capture'; END IF;
  resource_entity:=CASE WHEN p_input->'envelope'->'payload'->>'kind'='catalog' THEN 'catalog' ELSE 'draft:'||(p_input->'envelope'->'payload'->>'externalDraftId')||':selections' END;
  IF resource_entity IS NULL THEN RAISE EXCEPTION 'missing draft resource identity'; END IF;
  -- Expanded JSON text bounds native and typed reader evidence. Reserve a separate
  -- 8 MiB for frozen player links before delegated writes; actual link materialization
  -- enforces that same bound. Per-entry framing covers relational IDs and column
  -- names; native league/draft strings are measured separately to prevent row amplification.
  IF octet_length((p_input->'envelope'->'payload')::text)+octet_length((projection->'value')::text)
    +octet_length((p_input->'sourceMapping')::text)+octet_length(provenance::text)+65536
    +COALESCE(jsonb_array_length(projection->'value'->'entries'),0)*(1536
      +2*COALESCE(octet_length((p_input->'envelope'->'scope'->'externalLeagueId')::text),0)
      +2*COALESCE(octet_length((p_input->'envelope'->'payload'->'externalDraftId')::text),0))+8388608>33554432 THEN
    RAISE EXCEPTION 'draft selections persistence budget exceeded'; END IF;
  -- The prior writer owns job -> league/source -> legacy-head locking. Preserve
  -- that order before obtaining the typed resource head; all later failures roll
  -- back this same SQL transaction, including the delegated legacy observation.
  result:=public.record_league_administration_observation_v53(p_input-'draftSelectionsAcceptance'-'draftSelectionsProjection'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt';
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF provenance->'acquisition' IS NULL AND (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RAISE EXCEPTION 'draft request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',attempt.source_mapping->>'connectionId',
        'leagueSeasonId',attempt.source_mapping->>'leagueSeasonId','family','drafts','entityId',resource_entity,'scoringPeriodId',NULL,
        'audienceId','public','coverageSpecId','sleeper-draft-selections-v1'),'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-draft-selections-v1',
        'canonicalNormalizerVersion','sleeper-draft-selections-v1','validationVersion','latest-network-attempt-v1'))) THEN RAISE EXCEPTION 'draft selections attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND AND receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'draft selections attempt receipt conflict'; END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId' AND stored.family='drafts' AND stored.week=0
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness' AND NOT stored.accepted
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  IF projection->>'status'='accepted' THEN
    expected:=public.project_draft_selections_native(content.payload,content.external_league_id,content.completeness='complete');
    IF expected IS NULL OR projection->'value' IS DISTINCT FROM expected OR projection->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'draft selections projection mismatch'; END IF;
    covered:=(expected->>'complete')::boolean;
  ELSIF projection->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(projection->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(projection->'diagnostics')=0 THEN RAISE EXCEPTION 'invalid draft selections rejection evidence'; END IF;
  IF receipt.id IS NOT NULL THEN
    IF receipt.content_id<>content.id THEN RAISE EXCEPTION 'draft replay content mismatch'; END IF;
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    RETURN result||jsonb_build_object('draftSelectionsAcceptance',jsonb_build_object('status',CASE WHEN EXISTS(
      SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
      THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
      jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
        'fields','["draft_id","pick_no","round","draft_slot","player_id","roster_id","picked_by","is_keeper","metadata"]'::jsonb,
        'pagination',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,'nextCursor',NULL,
        'completeness',CASE WHEN covered THEN 'complete' ELSE 'partial' END,
        'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE '["draft_selections_incomplete"]'::jsonb END)) RETURNING * INTO receipt;
  IF expected IS NOT NULL THEN PERFORM public.capture_draft_selections_typed(content.id,receipt.id,expected); END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT previous.provenance,previous.content_id INTO prior_provenance,prior_content FROM public.league_roster_resource_acceptances accepted
    JOIN public.league_roster_capture_receipts previous ON previous.id=accepted.receipt_id WHERE accepted.id=head.accepted_id;
  IF FOUND THEN source_current:=(provenance->>'sourceObservedAt')::timestamptz>(prior_provenance->>'sourceObservedAt')::timestamptz
    OR ((provenance->>'sourceObservedAt')::timestamptz=(prior_provenance->>'sourceObservedAt')::timestamptz AND content.id=prior_content); END IF;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered AND source_current THEN
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1) RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1 WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN result||jsonb_build_object('draftSelectionsAcceptance',jsonb_build_object('status',CASE WHEN acceptance_id IS NULL THEN 'preserved' ELSE 'accepted' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed' WHEN NOT covered THEN 'draft_selections_incomplete' ELSE 'draft_selections_source_not_newer' END,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

CREATE OR REPLACE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE addition jsonb:=p_input->'tradedPicksAcceptance'; projection jsonb:=p_input->'tradedPicksProjection'; result jsonb; expected jsonb; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; resource_entity text; evidence_hash_value text;
  covered boolean:=false; acceptance_id uuid; prior_provenance jsonb; prior_content uuid; source_current boolean:=true; clock_key text;
BEGIN
  IF addition IS NULL THEN
    IF p_input ? 'tradedPicksProjection' THEN RAISE EXCEPTION 'draft projection requires selections acceptance'; END IF;
    RETURN public.record_league_administration_observation_v54(p_input);
  END IF;
  IF p_input ?| ARRAY['rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','leagueSettingsAcceptance','matchupAcceptance',
      'calendarEvidence','calculationCapture','transactionAcceptance','bracketAcceptance','bracketProjection','weeklyReportAcceptance','weeklyReportProjection','officialStandings','draftMetadataAcceptance','draftMetadataProjection','draftSelectionsAcceptance','draftSelectionsProjection']
    OR octet_length(p_input::text)>33488896 THEN RAISE EXCEPTION 'mixed or oversized traded picks acceptance'; END IF;
  IF provenance ? 'acquisition' THEN PERFORM public.assert_public_draft_capture(p_input,'tradedPicks'); END IF;
  -- Timestamp casts alone admit locale/space forms rejected by the unchanged
  -- TypeScript normalizer. Require explicit ISO network clocks independently.
  IF jsonb_typeof(provenance) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid traded picks provenance'; END IF;
  FOREACH clock_key IN ARRAY ARRAY['requestStartedAt','requestCompletedAt','checkedAt','sourceObservedAt'] LOOP
    IF clock_key='sourceObservedAt' AND provenance->clock_key='null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(provenance->clock_key) IS DISTINCT FROM 'string'
      OR provenance->>clock_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-](0[0-9]|1[0-5]):[0-5][0-9])$' THEN
      RAISE EXCEPTION 'invalid traded picks ISO clock'; END IF;
    IF NOT isfinite((provenance->>clock_key)::timestamptz) THEN RAISE EXCEPTION 'nonfinite traded picks clock'; END IF;
  END LOOP;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'drafts' OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' OR p_input->'sourceMapping' IS NULL
    OR projection->>'version' IS DISTINCT FROM 'sleeper-traded-picks-v1' OR projection->>'status' IS NULL OR projection->>'status' NOT IN ('accepted','rejected')
    OR p_input->'envelope'->'payload'->>'tradedPicksVersion' IS DISTINCT FROM 'sleeper-traded-picks-v1'
    OR p_input->'envelope'->'payload'->>'kind' IS NULL OR p_input->'envelope'->'payload'->>'kind' NOT IN ('catalog','league','draft')
    OR p_input->>'status' IS DISTINCT FROM 'rejected' OR p_input->'value' IS DISTINCT FROM 'null'::jsonb OR p_input->'semanticHash' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(p_input->'diagnostics') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'diagnostics')<>1
    OR p_input->'diagnostics'->0->>'code' IS DISTINCT FROM 'invalid_array' OR p_input->'diagnostics'->0->>'path' IS DISTINCT FROM 'payload'
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR ((provenance->>'sourceObservedAt')::timestamptz IS NULL AND projection->>'status'='accepted' AND projection->'value'->>'complete'='true')
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz<(provenance->>'requestStartedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid mapped traded picks network capture'; END IF;
  resource_entity:=CASE WHEN p_input->'envelope'->'payload'->>'kind'='draft' THEN 'draft:'||(p_input->'envelope'->'payload'->>'externalDraftId')||':traded-picks' ELSE p_input->'envelope'->'payload'->>'kind' END;
  IF resource_entity IS NULL THEN RAISE EXCEPTION 'missing draft resource identity'; END IF;
  -- Expanded JSON budgets raw, typed, mapping and provenance plus per-row relational framing.
  IF octet_length((p_input->'envelope'->'payload')::text)+octet_length((projection->'value')::text)
    +octet_length((p_input->'sourceMapping')::text)+octet_length(provenance::text)+65536
    +COALESCE(jsonb_array_length(projection->'value'->'entries'),0)*(2048
      +2*COALESCE(octet_length((p_input->'envelope'->'scope'->'externalLeagueId')::text),0)
      +2*COALESCE(octet_length((p_input->'envelope'->'payload'->'externalDraftId')::text),0))>33554432 THEN
    RAISE EXCEPTION 'traded picks persistence budget exceeded'; END IF;
  -- The prior writer owns job -> league/source -> legacy-head locking. Preserve
  -- that order before obtaining the typed resource head; all later failures roll
  -- back this same SQL transaction, including the delegated legacy observation.
  result:=public.record_league_administration_observation_v54(p_input-'tradedPicksAcceptance'-'tradedPicksProjection'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt';
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF provenance->'acquisition' IS NULL AND (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RAISE EXCEPTION 'draft request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',attempt.source_mapping->>'connectionId',
        'leagueSeasonId',attempt.source_mapping->>'leagueSeasonId','family','drafts','entityId',resource_entity,'scoringPeriodId',NULL,
        'audienceId','public','coverageSpecId','sleeper-traded-picks-v1'),'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-traded-picks-v1',
        'canonicalNormalizerVersion','sleeper-traded-picks-v1','validationVersion','latest-network-attempt-v1'))) THEN RAISE EXCEPTION 'traded picks attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND AND receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'traded picks attempt receipt conflict'; END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId' AND stored.family='drafts' AND stored.week=0
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness' AND NOT stored.accepted
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  IF projection->>'status'='accepted' THEN
    expected:=public.project_traded_picks_native(content.payload,content.external_league_id,content.completeness='complete');
    IF expected IS NULL OR projection->'value' IS DISTINCT FROM expected OR projection->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'traded picks projection mismatch'; END IF;
    covered:=(expected->>'complete')::boolean;
  ELSIF projection->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(projection->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(projection->'diagnostics')=0 THEN RAISE EXCEPTION 'invalid traded picks rejection evidence'; END IF;
  IF receipt.id IS NOT NULL THEN
    IF receipt.content_id<>content.id THEN RAISE EXCEPTION 'draft replay content mismatch'; END IF;
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    RETURN result||jsonb_build_object('tradedPicksAcceptance',jsonb_build_object('status',CASE WHEN EXISTS(
      SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
      THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
      jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
        'fields','["season","round","roster_id","owner_id","previous_owner_id"]'::jsonb,
        'pagination',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,'nextCursor',NULL,
        'completeness',CASE WHEN covered THEN 'complete' ELSE 'partial' END,
        'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE '["traded_picks_incomplete"]'::jsonb END)) RETURNING * INTO receipt;
  IF expected IS NOT NULL THEN PERFORM public.capture_traded_picks_typed(content.id,receipt.id,expected); END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT previous.provenance,previous.content_id INTO prior_provenance,prior_content FROM public.league_roster_resource_acceptances accepted
    JOIN public.league_roster_capture_receipts previous ON previous.id=accepted.receipt_id WHERE accepted.id=head.accepted_id;
  IF FOUND THEN source_current:=(provenance->>'sourceObservedAt')::timestamptz>(prior_provenance->>'sourceObservedAt')::timestamptz
    OR ((provenance->>'sourceObservedAt')::timestamptz=(prior_provenance->>'sourceObservedAt')::timestamptz AND content.id=prior_content); END IF;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered AND source_current THEN
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1) RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1 WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN result||jsonb_build_object('tradedPicksAcceptance',jsonb_build_object('status',CASE WHEN acceptance_id IS NULL THEN 'preserved' ELSE 'accepted' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed' WHEN NOT covered THEN 'traded_picks_incomplete' ELSE 'traded_picks_source_not_newer' END,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

CREATE OR REPLACE FUNCTION public.validate_public_data_draft_checkpoint() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE task public.public_data_draft_tasks%ROWTYPE; dispatch public.public_data_dispatches%ROWTYPE;
  captured_receipt public.league_roster_capture_receipts%ROWTYPE; reserved public.league_roster_resource_attempts%ROWTYPE;
  identity_value jsonb; acquisition jsonb;
BEGIN
  SELECT * INTO STRICT task FROM public.public_data_draft_tasks WHERE intake_id=NEW.intake_id AND ordinal=NEW.task_ordinal;
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches WHERE worker_id=NEW.worker_id AND generation=NEW.generation;
  SELECT * INTO STRICT captured_receipt FROM public.league_roster_capture_receipts WHERE id=NEW.draft_receipt_id;
  SELECT * INTO STRICT reserved FROM public.league_roster_resource_attempts WHERE id=captured_receipt.attempt_id;
  acquisition:=captured_receipt.provenance->'acquisition';
  IF task.status<>'pending' OR dispatch.intake_id<>NEW.intake_id OR dispatch.resource<>'drafts' OR dispatch.max_requests<>1
    OR dispatch.work IS DISTINCT FROM public.public_data_draft_work(task,dispatch.revision)
    OR reserved.write_fence->>'workerId' IS DISTINCT FROM NEW.worker_id
    OR reserved.write_fence->>'generation' IS DISTINCT FROM NEW.generation::text
    OR reserved.source_mapping IS DISTINCT FROM NEW.source_mapping
    OR NEW.source_mapping->>'leagueSeasonId' IS DISTINCT FROM NEW.league_season_id::text
    OR jsonb_typeof(acquisition) IS DISTINCT FROM 'object'
    OR NOT EXISTS(SELECT 1 FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=task.intake_id
      AND candidate.season=task.season AND candidate.external_league_id=task.external_league_id AND candidate.league_season_id=NEW.league_season_id)
    OR EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=NEW.worker_id AND outcome.generation=NEW.generation) THEN
    RAISE EXCEPTION 'public draft checkpoint dispatch or task mismatch'; END IF;
  PERFORM public.guard_public_data_intake(dispatch.work,reserved.write_fence);
  PERFORM public.validate_current_roster_mapping(NEW.source_mapping);
  PERFORM public.assert_public_data_owner(NEW.intake_id,reserved.write_fence);
  identity_value:=public.public_data_draft_identity(dispatch.work,NEW.source_mapping);
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
    JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id AND scope.identity=identity_value
    JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id AND head.accepted_id=accepted.id AND head.generation=accepted.generation
    JOIN public.league_administration_contents content ON content.id=receipt.content_id
    JOIN public.league_administration_observations observed ON observed.id=receipt.legacy_observation_id AND observed.content_id=content.id
    WHERE receipt.id=captured_receipt.id AND accepted.scope_id=scope.id AND accepted.source_mapping_revision_id=(NEW.source_mapping->>'revisionId')::uuid
      AND attempt.source_mapping=NEW.source_mapping AND attempt.write_fence=reserved.write_fence
      AND attempt.ordinal=head.latest_ordinal AND attempt.reserved_at>=dispatch.admitted_at
      AND content.league_season_id=NEW.league_season_id AND content.provider='sleeper' AND content.external_league_id=task.external_league_id
      AND content.family='drafts' AND content.week=0 AND NOT content.accepted AND content.completeness='complete'
      AND receipt.configuration_content_id IS NULL AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL
      AND receipt.coverage->>'completeness'='complete'
      AND receipt.coverage->'periodIds'='[]'::jsonb
      AND receipt.provenance->>'origin'='network' AND receipt.provenance->'acquisition'=acquisition
      AND public.public_capture_after_reservation(receipt.provenance,attempt.id)
      AND receipt.recorded_at BETWEEN reserved.reserved_at AND clock_timestamp()
      AND (receipt.provenance->>'requestStartedAt')::timestamptz<=(receipt.provenance->>'requestCompletedAt')::timestamptz
      AND (receipt.provenance->>'sourceObservedAt')::timestamptz=(receipt.provenance->>'requestCompletedAt')::timestamptz) THEN
    RAISE EXCEPTION 'current dispatch-bound draft receipt required'; END IF;
  PERFORM public.assert_public_data_owner(NEW.intake_id,reserved.write_fence);
  RETURN NEW;
END; $$;

CREATE TRIGGER public_draft_checkpoint_lineage BEFORE INSERT ON public.public_data_draft_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_draft_checkpoint();

CREATE OR REPLACE FUNCTION public.validate_public_data_draft_checkpoint_fence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fence jsonb;
BEGIN
  SELECT attempt.write_fence INTO STRICT fence FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    WHERE receipt.id=NEW.draft_receipt_id;
  IF fence IS NULL THEN RAISE EXCEPTION 'public draft checkpoint requires original fence'; END IF;
  PERFORM public.assert_roster_player_link_fence(fence);
  RETURN NEW;
END; $$;

CREATE CONSTRAINT TRIGGER public_draft_checkpoint_fence AFTER INSERT ON public.public_data_draft_checkpoints
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_draft_checkpoint_fence();
ALTER FUNCTION public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) RENAME TO checkpoint_public_data_intake_v55;
CREATE FUNCTION public.checkpoint_public_data_intake(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; selected text; task public.public_data_draft_tasks%ROWTYPE;
  acquisition jsonb; native_catalog jsonb;
BEGIN
  SELECT draft_picks INTO STRICT selected FROM public.public_data_intakes WHERE id=request_id;
  IF selected IS NOT NULL AND p_capture->'failed'='true'::jsonb THEN
    PERFORM public.guard_public_data_intake(p_work,p_fence);
    IF NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE dispatch.worker_id=p_fence->>'workerId'
      AND dispatch.generation=(p_fence->>'generation')::integer AND dispatch.work=p_work AND NOT EXISTS(
        SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
      RAISE EXCEPTION 'matching admitted public dispatch required'; END IF;
    PERFORM public.fail_public_data_draft_work(p_work,p_fence);
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome)
      VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'failed');
    RETURN;
  END IF;
  IF p_work->>'kind' IS DISTINCT FROM 'drafts' THEN
    PERFORM public.checkpoint_public_data_intake_v55(p_work,p_capture,p_fence);
    IF selected IS NULL THEN RETURN; END IF;
    IF p_work->>'kind'='leagues' AND p_capture->'failed' IS DISTINCT FROM 'true'::jsonb
      AND p_capture->>'diagnostic' IS DISTINCT FROM 'invalid-source' THEN
      INSERT INTO public.public_data_draft_tasks(intake_id,ordinal,season,external_league_id,resource,write_fence)
        SELECT request_id,(ranked.rank-1)*26+root.ordinal,ranked.season,ranked.external_league_id,root.resource,p_fence
        FROM (SELECT candidate.season,candidate.external_league_id,row_number() OVER(ORDER BY candidate.season,candidate.external_league_id)::integer AS rank
          FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=request_id AND candidate.stage<>'capacity') ranked
        CROSS JOIN (VALUES(1,'catalog'),(2,'league-trades')) AS root(ordinal,resource);
    ELSIF p_work->>'kind'='bootstrap' AND p_capture->>'capacity'='roster-count-unqualified' THEN
      UPDATE public.public_data_draft_tasks SET write_fence=p_fence,status='unavailable',reason='bootstrap-capacity'
        WHERE intake_id=request_id AND season=(p_work->>'season')::integer
          AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
    END IF;
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    RETURN;
  END IF;
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  IF selected IS NULL OR jsonb_typeof(p_capture) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_capture))<>3
    OR NOT(p_capture ?& ARRAY['mapping','observations','receipts'])
    OR jsonb_typeof(p_capture->'observations') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_capture->'receipts') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'public draft checkpoint incomplete'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>1 OR NOT(p_capture->'observations' ? 'drafts')
    OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'receipts'))<>1 OR NOT(p_capture->'receipts' ? 'drafts') THEN
    RAISE EXCEPTION 'public draft checkpoint incomplete'; END IF;
  SELECT * INTO STRICT task FROM public.public_data_draft_tasks WHERE intake_id=request_id AND status='pending'
    AND public.public_data_draft_work(public_data_draft_tasks,(p_work->>'revision')::integer)=p_work;
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    WHERE receipt.id=(p_capture->'receipts'->>'drafts')::uuid AND attempt.write_fence=p_fence
      AND receipt.legacy_observation_id=(p_capture->'observations'->>'drafts')::uuid) THEN
    RAISE EXCEPTION 'public draft observation mismatch'; END IF;
  INSERT INTO public.public_data_draft_checkpoints(intake_id,task_ordinal,worker_id,generation,league_season_id,source_mapping,draft_receipt_id)
    VALUES(request_id,task.ordinal,p_fence->>'workerId',(p_fence->>'generation')::integer,(p_capture->'mapping'->>'leagueSeasonId')::uuid,
      p_capture->'mapping',(p_capture->'receipts'->>'drafts')::uuid);
  SELECT receipt.provenance->'acquisition',content.payload->'catalog' INTO STRICT acquisition,native_catalog
    FROM public.league_roster_capture_receipts receipt JOIN public.league_administration_contents content ON content.id=receipt.content_id
    WHERE receipt.id=(p_capture->'receipts'->>'drafts')::uuid;
  IF task.resource='catalog' THEN
    -- Checkpoint trigger proves complete, accepted, bounded/unique 2026 inventory.
    -- Materialize every child atomically with its exact parent receipt, no GET.
    INSERT INTO public.public_data_draft_tasks(intake_id,ordinal,season,external_league_id,resource,external_draft_id,catalog_receipt_id,write_fence)
      SELECT request_id,task.ordinal+2+(native.ordinality::integer-1)*3+child.resource_offset,task.season,task.external_league_id,
        child.resource,native.value->>'draft_id',(p_capture->'receipts'->>'drafts')::uuid,p_fence
      FROM jsonb_array_elements(native_catalog) WITH ORDINALITY native
      CROSS JOIN (VALUES(0,'detail'),(1,'selections'),(2,'draft-trades')) AS child(resource_offset,resource);
  END IF;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  UPDATE public.public_data_draft_tasks SET write_fence=p_fence,status='complete' WHERE intake_id=request_id AND ordinal=task.ordinal;
  UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
  IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
    UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id; END IF;
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome,capture_acquisition)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed',acquisition);
  PERFORM public.assert_public_data_owner(request_id,p_fence);
END; $$;

REVOKE ALL ON public.public_data_draft_tasks,public.public_data_draft_checkpoints FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_public_data_draft_picks(jsonb,integer[]),public.public_data_draft_work(public.public_data_draft_tasks,integer),public.public_data_draft_identity(jsonb,jsonb),public.validate_public_data_draft_task(),public.fail_public_data_draft_work(jsonb,jsonb),public.assert_public_draft_capture(jsonb,text),public.validate_public_data_draft_checkpoint(),public.validate_public_data_draft_checkpoint_fence(),public.checkpoint_public_data_intake_v55(jsonb,jsonb,jsonb),public.read_public_data_draft_catalog(jsonb,jsonb,jsonb),public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) FROM PUBLIC;
-- BEGIN OPTIONAL PUBLIC DRAFT INTAKE GRANTS
DO $$ DECLARE value_table text; helper text; denied text:='INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'; BEGIN
  IF current_setting('server_version_num')::integer>=170000 THEN denied:=denied||',MAINTAIN'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    FOREACH value_table IN ARRAY ARRAY['public_data_draft_tasks','public_data_draft_checkpoints'] LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,league_one_runtime',value_table);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime',value_table);
      IF NOT has_table_privilege('league_one_runtime','public.'||value_table,'SELECT') OR has_table_privilege('league_one_runtime','public.'||value_table,denied) THEN
        RAISE EXCEPTION 'runtime has incorrect public draft privileges'; END IF;
    END LOOP;
    FOREACH helper IN ARRAY ARRAY['public.canonical_public_data_draft_picks(jsonb,integer[])','public.public_data_draft_work(public.public_data_draft_tasks,integer)','public.public_data_draft_identity(jsonb,jsonb)','public.validate_public_data_draft_task()','public.fail_public_data_draft_work(jsonb,jsonb)','public.assert_public_draft_capture(jsonb,text)','public.validate_public_data_draft_checkpoint()','public.validate_public_data_draft_checkpoint_fence()','public.checkpoint_public_data_intake_v55(jsonb,jsonb,jsonb)'] LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,league_one_runtime',helper);
      IF has_function_privilege('league_one_runtime',helper,'EXECUTE') THEN RAISE EXCEPTION 'runtime can execute private public draft helper'; END IF;
    END LOOP;
    REVOKE ALL ON FUNCTION public.read_public_data_draft_catalog(jsonb,jsonb,jsonb),public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.read_public_data_draft_catalog(jsonb,jsonb,jsonb),public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) TO league_one_runtime;
  END IF;
END; $$;
-- END OPTIONAL PUBLIC DRAFT INTAKE GRANTS

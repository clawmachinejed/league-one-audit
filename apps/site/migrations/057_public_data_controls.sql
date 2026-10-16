-- CP24: controlled submission uses the existing request, replay lock and worker.
-- Source only; no retained installation, DATA activation or production authority.
ALTER TABLE public.public_data_intakes ADD COLUMN submission_capacity text
  CHECK(submission_capacity IS NULL OR submission_capacity='pending-request-limit');
ALTER TABLE public.public_data_intakes ADD CONSTRAINT public_intake_capacity_terminal
  CHECK(submission_capacity IS NULL OR (terminal AND revision=0 AND failure_count=0));
CREATE TRIGGER public_intake_submission_capacity_stable BEFORE UPDATE ON public.public_data_intakes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change('submission_capacity');
CREATE TRIGGER public_intake_capacity_receipt_immutable BEFORE UPDATE OR DELETE ON public.public_data_intakes
  FOR EACH ROW WHEN (OLD.submission_capacity IS NOT NULL)
  EXECUTE FUNCTION public.prevent_league_administration_history_change();

-- This is the only submission algorithm. The legacy wrapper below keeps its
-- capacity exception; explicitly controlled callers receive a durable receipt.
CREATE FUNCTION public.submit_public_data_intake(p_input jsonb,p_retain_capacity_receipt boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wanted integer[]; periods jsonb; inventory text; brackets text; reports jsonb; transaction_period_value jsonb; history text; drafts text; retained public.public_data_intakes%ROWTYPE; capacity_reason text;
BEGIN
  IF p_retain_capacity_receipt IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_input->'id') IS DISTINCT FROM 'string'
    OR (p_input->>'id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_input->'username') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR (p_input->>'username') !~ '^[a-zA-Z0-9_]{1,100}$' THEN RAISE EXCEPTION 'invalid public intake'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'seasons') entry
    WHERE jsonb_typeof(entry) IS DISTINCT FROM 'number' OR entry::text !~ '^[1-9][0-9]{3}$') THEN
    RAISE EXCEPTION 'invalid public season scope'; END IF;
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
    IF retained.submission_capacity IS NOT NULL AND NOT p_retain_capacity_receipt THEN
      RAISE EXCEPTION 'public intake capacity reached'; END IF;
    RETURN jsonb_build_object('status',CASE WHEN retained.submission_capacity IS NULL THEN 'retained' ELSE 'capacity' END,'requestId',retained.id);
  END IF;
  IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal)>=16 THEN
    IF NOT p_retain_capacity_receipt THEN RAISE EXCEPTION 'public intake capacity reached'; END IF;
    capacity_reason:='pending-request-limit';
  END IF;
  INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,period_inventory,playoff_brackets,weekly_reports,transaction_period,transaction_history,draft_picks,submission_capacity,terminal) VALUES((p_input->>'id')::uuid,p_input->>'username',wanted,periods,inventory,brackets,reports,transaction_period_value,history,drafts,capacity_reason,capacity_reason IS NOT NULL);
  RETURN jsonb_build_object('status',CASE WHEN capacity_reason IS NULL THEN 'retained' ELSE 'capacity' END,'requestId',(p_input->>'id')::uuid);
END; $$;

CREATE OR REPLACE FUNCTION public.submit_public_data_intake(p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.submit_public_data_intake(p_input,false);
END; $$;

CREATE OR REPLACE FUNCTION public.configure_public_data_refresh(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  target_id uuid; identity_id uuid;
  periods jsonb; inventory text; brackets text; reports jsonb; history text; drafts text; expected bigint:=(p_input->>'expectedRevision')::bigint; manager_id uuid; wanted integer[];
  cadence integer:=(p_input->>'cadenceSeconds')::integer; expiry timestamptz;
  paused_value boolean; next_revision bigint; current_request public.public_data_intakes%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_input->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'identityRequestId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'expiresAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'invalid public refresh configuration'; END IF;
  target_id:=(p_input->>'id')::uuid;
  identity_id:=(p_input->>'identityRequestId')::uuid;
  expiry:=(p_input->>'expiresAt')::timestamptz;
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
  IF p_input ? 'transactionPeriod' THEN
    RAISE EXCEPTION 'public refresh does not support an exact transaction-period selector'; END IF;
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

REVOKE ALL ON FUNCTION public.submit_public_data_intake(jsonb,boolean) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.submit_public_data_intake(jsonb,boolean) TO league_one_runtime;
  END IF;
END; $$;

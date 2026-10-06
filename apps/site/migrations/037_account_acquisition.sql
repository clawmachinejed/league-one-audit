-- BC-M1 additive durable acquisition. No policy/context is seeded or activated.
-- Existing projection_jobs remains the only queue. SQL qualification pending.
-- No active legacy claimant is selected or displaced. Conflicts must be
-- reconciled by independently authorized D03 release before installation.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.app_provider_account_links WHERE revoked_at IS NULL
    GROUP BY source_manager_account_id HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM public.app_provider_account_links l
      JOIN public.league_source_manager_accounts m ON m.id=l.source_manager_account_id
      WHERE l.revoked_at IS NULL GROUP BY l.app_user_id,m.provider HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Existing provider claims require reviewed conflict reconciliation';
  END IF;
END; $$;
CREATE TABLE public.provider_access_contexts (
 id uuid PRIMARY KEY,
 provider text NOT NULL CHECK(provider='sleeper'),
 audience_id text COLLATE "C" NOT NULL CHECK(btrim(audience_id)<>''),
 kind text NOT NULL CHECK(kind IN ('public','private')),
 state text NOT NULL CHECK(state IN ('active','revoked','unavailable')),
 revision bigint NOT NULL CHECK(revision>0),
 authority_expires_at timestamptz,
 CHECK(authority_expires_at IS NULL OR isfinite(authority_expires_at)),
 CHECK(kind<>'private' OR state<>'active' OR authority_expires_at IS NOT NULL)
);
CREATE UNIQUE INDEX provider_access_public_v2_unique
 ON public.provider_access_contexts(provider,audience_id,kind) WHERE kind='public';
-- First slice uses public Sleeper context only. No private credentials are stored.
-- Revision changes are locked and monotonic; immutable captures retain old revisions.

-- S02P / RD14: explicit pre-enrollment interpretation qualification.
CREATE TABLE public.provider_request_policy_qualifications (
 id uuid PRIMARY KEY,
 provider text NOT NULL CHECK(provider='sleeper'),
 family text NOT NULL CHECK(family IN ('identity-lookup','league-list','league-candidate','nfl-state')),
 normalizer_version text NOT NULL CHECK(btrim(normalizer_version)<>''),
 validation_version text NOT NULL CHECK(btrim(validation_version)<>''),
 coverage_spec_id text NOT NULL CHECK(btrim(coverage_spec_id)<>''),
 state text NOT NULL CHECK(state IN ('qualified','suspended')),
 revision bigint NOT NULL CHECK(revision>0),
 evidence_ref text NOT NULL CHECK(btrim(evidence_ref)<>''),
 UNIQUE(provider,family,normalizer_version,validation_version,coverage_spec_id)
);
-- Configuration owner qualifies exact semantics; version strings are immutable.
-- State/revision changes use the same ordered policy lock and invalidate new
-- dispatch/acceptance. Captured historical revision remains evidence, not FK to
-- a mutable current revision. No unenrolled league/resource-scope IDs invented.

-- S03 / RD04: requestId pins the purpose/scope/context/interpretation tuple.
CREATE TABLE public.provider_request_attempts (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL,
 access_context_id uuid NOT NULL REFERENCES public.provider_access_contexts(id),
 access_revision bigint NOT NULL CHECK(access_revision>0),
 policy_qualification_id uuid NOT NULL REFERENCES public.provider_request_policy_qualifications(id),
 policy_qualification_revision bigint NOT NULL CHECK(policy_qualification_revision>0),
 scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object'),
 ordinal bigint NOT NULL CHECK(ordinal>0),
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(reserved_at)),
 job_key text,
 lease_owner text,
 lease_until timestamptz,
 job_attempt_count integer,
 request_payload jsonb NOT NULL CHECK(jsonb_typeof(request_payload)='object'),
 normalizer_version text NOT NULL CHECK(btrim(normalizer_version)<>''),
 validation_version text NOT NULL CHECK(btrim(validation_version)<>''),
 UNIQUE(request_id,ordinal),
 CHECK(((job_key IS NULL AND lease_owner IS NULL AND lease_until IS NULL AND job_attempt_count IS NULL)
    OR (job_key IS NOT NULL AND btrim(lease_owner)<>'' AND lease_until IS NOT NULL
        AND isfinite(lease_until) AND job_attempt_count IS NOT NULL AND job_attempt_count>0)) IS TRUE)
);
CREATE INDEX provider_attempt_context_v2 ON public.provider_request_attempts(access_context_id,request_id);
-- NULL-sensitive cross-field predicates are additionally checked IS TRUE by the
-- exact reservation guard. Request equality is serialized on typed requestId,
-- not asserted by a mutable cross-table CHECK.

CREATE TABLE public.provider_capture_receipts (
 id uuid PRIMARY KEY,
 attempt_id uuid NOT NULL UNIQUE REFERENCES public.provider_request_attempts(id),
 origin text NOT NULL CHECK(origin='network'),
 outcome text NOT NULL CHECK(outcome IN ('normalized','normalization-failed','transport-failure')),
 raw_value jsonb,
 normalized_value jsonb,
 normalizer_version text NOT NULL CHECK(btrim(normalizer_version)<>''),
 validation_version text NOT NULL CHECK(btrim(validation_version)<>''),
 request_started_at timestamptz,
 request_completed_at timestamptz,
 source_observed_at timestamptz,
 normalized_at timestamptz,
 checked_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(checked_at)),
 coverage jsonb NOT NULL CHECK(jsonb_typeof(coverage)='object'),
 provider_account_id uuid REFERENCES public.league_source_manager_accounts(id),
 CHECK(request_started_at IS NULL OR isfinite(request_started_at)),
 CHECK(request_completed_at IS NULL OR isfinite(request_completed_at)),
 CHECK(source_observed_at IS NULL OR isfinite(source_observed_at)),
 CHECK(normalized_at IS NULL OR isfinite(normalized_at)),
 CHECK(request_completed_at IS NULL OR
       (request_started_at IS NOT NULL AND request_completed_at>=request_started_at)),
 CHECK(outcome<>'transport-failure' OR
       (raw_value IS NULL AND normalized_value IS NULL AND source_observed_at IS NULL
        AND normalized_at IS NULL AND provider_account_id IS NULL)),
 CHECK(outcome<>'normalized' OR
       (normalized_value IS NOT NULL AND normalized_at IS NOT NULL
        AND request_started_at IS NOT NULL AND request_completed_at IS NOT NULL)),
 CHECK(outcome<>'normalization-failed' OR (normalized_value IS NULL AND provider_account_id IS NULL))
);
-- outcome is a storage discriminator, not a replacement for foundation result
-- status. Guard maps exact RecordProviderCapture alternatives and records failed
-- qualification honestly. Failure observed-none coverage is derived, not supplied.

CREATE TABLE public.provider_identity_evidence (
 id uuid PRIMARY KEY,
 manager_id uuid NOT NULL REFERENCES public.league_source_manager_accounts(id),
 kind text NOT NULL CHECK(kind IN ('lookup','qualified-role')),
 lookup_capture_id uuid REFERENCES public.provider_capture_receipts(id),
 manager_acceptance_id uuid REFERENCES public.league_roster_resource_acceptances(id),
 CHECK((kind='lookup' AND lookup_capture_id IS NOT NULL AND manager_acceptance_id IS NULL)
    OR (kind='qualified-role' AND lookup_capture_id IS NULL AND manager_acceptance_id IS NOT NULL)),
 UNIQUE(lookup_capture_id),
 UNIQUE(lookup_capture_id,manager_id),
 UNIQUE(manager_id,manager_acceptance_id)
);
-- Nonpartial unique constraints support FKs; NULLs permit multiple role evidence
-- rows. A lookup guard verifies normalized exact identity, never username equality.

CREATE TABLE public.app_discovery_scans (
 id uuid PRIMARY KEY,
 association_id uuid NOT NULL REFERENCES public.app_provider_account_links(id),
 association_revision bigint NOT NULL CHECK(association_revision>0),
 strategy_version text NOT NULL CHECK(btrim(strategy_version)<>''),
 query_set_hash text NOT NULL CHECK(btrim(query_set_hash)<>''),
 status text NOT NULL CHECK(status IN ('pending','partial','complete','failed')),
 continuation jsonb CHECK(continuation IS NULL OR jsonb_typeof(continuation)='object'),
 revision bigint NOT NULL CHECK(revision>0),
 job_key text,
 finished_at timestamptz CHECK(finished_at IS NULL OR isfinite(finished_at)),
 CHECK(status<>'complete' OR finished_at IS NOT NULL),
 CHECK(finished_at IS NULL OR continuation IS NULL)
);
CREATE UNIQUE INDEX discovery_unfinished_v2_unique
 ON public.app_discovery_scans(association_id,association_revision,strategy_version,query_set_hash)
 WHERE finished_at IS NULL;
CREATE TABLE public.app_discovery_scan_seasons (
 scan_id uuid NOT NULL REFERENCES public.app_discovery_scans(id),
 season smallint NOT NULL CHECK(season BETWEEN 1920 AND 2200),
 status text NOT NULL CHECK(status IN ('pending','partial','complete','failed')),
 list_capture_id uuid REFERENCES public.provider_capture_receipts(id),
 PRIMARY KEY(scan_id,season),
 CHECK(status<>'complete' OR list_capture_id IS NOT NULL)
);
CREATE TABLE public.app_discovery_candidates (
 scan_id uuid NOT NULL,
 source_season_namespace text COLLATE "C" NOT NULL CHECK(btrim(source_season_namespace)<>''),
 native_league_id text COLLATE "C" NOT NULL CHECK(btrim(native_league_id)<>''),
 season smallint NOT NULL CHECK(season BETWEEN 1920 AND 2200),
 sport text NOT NULL CHECK(sport='nfl'),
 list_capture_id uuid NOT NULL REFERENCES public.provider_capture_receipts(id),
 candidate_capture_id uuid REFERENCES public.provider_capture_receipts(id),
 PRIMARY KEY(scan_id,source_season_namespace,native_league_id,list_capture_id),
 FOREIGN KEY(scan_id,season) REFERENCES public.app_discovery_scan_seasons(scan_id,season)
);
CREATE INDEX discovery_candidates_season_v2 ON public.app_discovery_candidates(scan_id,season);
-- Guards validate list scope+membership and candidate identity. No fake enrolled
-- league IDs are required. Only all required season receipts can complete a scan.

CREATE TABLE public.provider_request_gates (
 provider text PRIMARY KEY CHECK(provider='sleeper'),
 policy_version text NOT NULL CHECK(policy_version='sleeper-admission-v1'),
 enabled boolean NOT NULL DEFAULT false,
 cooldown_until timestamptz CHECK(cooldown_until IS NULL OR isfinite(cooldown_until)),
 import_drr_cursor smallint NOT NULL DEFAULT 0 CHECK(import_drr_cursor BETWEEN 0 AND 2),
 circuit_open boolean NOT NULL DEFAULT false,
 circuit_reason text CHECK(circuit_reason IN ('rate-limit','invalid-retry-after','operator')),
 CHECK(circuit_open=(circuit_reason IS NOT NULL))
);
CREATE TABLE public.provider_request_lane_limits (
 provider text NOT NULL REFERENCES public.provider_request_gates(provider),
 lane text NOT NULL CHECK(lane IN ('live-score','role-roster','transactions','metadata','interactive','import','retry')),
 limit_per_60s integer NOT NULL CHECK(limit_per_60s>0),
 max_in_flight integer NOT NULL CHECK(max_in_flight BETWEEN 1 AND 32),
 PRIMARY KEY(provider,lane),
 CHECK(limit_per_60s=CASE lane WHEN 'live-score' THEN 680
       WHEN 'role-roster' THEN 55 WHEN 'transactions' THEN 100 WHEN 'metadata' THEN 20 ELSE 15 END),
 CHECK(max_in_flight=CASE lane WHEN 'interactive' THEN 8 ELSE 32 END)
);
-- Operator-owned configuration must contain exactly seven rows, sum900, no
-- borrowing. Global logical transport ownership cap32; interactive cap8; target
-- actor cap1. These are selected engineering admission ceilings, not measured
-- throughput, provider promise, or guaranteed remote-provider concurrency.
-- Actual starts are conservatively charged for61s for a1s dispatch window.
-- Target actor additionally <=5 grants/61s and <=60 grants/3601s; no refunds.

CREATE TABLE public.app_acquisition_demands (
 id uuid PRIMARY KEY,
 actor_user_id uuid NOT NULL REFERENCES public.app_users(id),
 command_id uuid NOT NULL,
 command_input_hash text NOT NULL CHECK(command_input_hash ~ '^[0-9a-f]{64}$'),
 kind text NOT NULL CHECK(kind IN ('identify','discover','recover')),
 association_id uuid REFERENCES public.app_provider_account_links(id),
 association_revision bigint,
 scope jsonb CHECK(scope IS NULL OR jsonb_typeof(scope)='object'),
 scope_hash text NOT NULL CHECK(scope_hash ~ '^[0-9a-f]{64}$'),
 policy_version text NOT NULL CHECK(policy_version='sleeper-admission-v1'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 not_before timestamptz NOT NULL CHECK(isfinite(not_before)),
 state text NOT NULL CHECK(state IN ('pending','running','completed','failed','cancelled')),
 job_key text NOT NULL UNIQUE,
 result_ref jsonb CHECK(result_ref IS NULL OR jsonb_typeof(result_ref)='object'),
 terminal_outcome text CHECK(terminal_outcome IN ('completed','failed','cancelled','expired')),
 terminal_at timestamptz CHECK(terminal_at IS NULL OR isfinite(terminal_at)),
 UNIQUE(actor_user_id,command_id),
 UNIQUE(id,actor_user_id,job_key),
 CHECK(expires_at=created_at+interval '15 minutes' AND not_before>=created_at AND not_before<expires_at),
 CHECK(((state IN ('pending','running') AND terminal_outcome IS NULL AND terminal_at IS NULL AND scope IS NOT NULL)
    OR (state='completed' AND terminal_outcome='completed' AND terminal_at IS NOT NULL)
    OR (state='failed' AND terminal_outcome IN ('failed','expired') AND terminal_at IS NOT NULL)
    OR (state='cancelled' AND terminal_outcome='cancelled' AND terminal_at IS NOT NULL)) IS TRUE),
 CHECK((kind='identify' AND association_id IS NULL AND association_revision IS NULL)
    OR (kind IN ('discover','recover') AND association_id IS NOT NULL
        AND association_revision IS NOT NULL AND association_revision>0))
);
CREATE UNIQUE INDEX acquisition_unfinished_scope_v2_unique
 ON public.app_acquisition_demands(actor_user_id,kind,scope_hash)
 WHERE state IN ('pending','running');
CREATE INDEX acquisition_pending_v2 ON public.app_acquisition_demands(state,not_before,expires_at);
-- Actor lock + global gate lock enforce <=2 unfinished/actor and <=128 global.
-- Work intent uses existing projection_jobs in the SAME account transaction;
-- the helper owner has fixed purpose-only job insertion, never account table DML.
-- Demand carries admitted purpose/scope, not cached serving authority, auth receipt,
-- session identity, token/email digest or membership allow.

CREATE TABLE public.provider_http_permits (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE,
 provider text NOT NULL,
 lane text NOT NULL,
 policy_version text NOT NULL CHECK(policy_version='sleeper-admission-v1'),
 actor_user_id uuid REFERENCES public.app_users(id),
 demand_id uuid,
 job_key text,
 job_attempt_count integer,
 lease_owner text,
 lease_until timestamptz,
 scope_hash text NOT NULL CHECK(scope_hash ~ '^[0-9a-f]{64}$'),
 request_context jsonb NOT NULL CHECK(jsonb_typeof(request_context)='object'),
 granted_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(granted_at)),
 dispatch_before timestamptz NOT NULL CHECK(isfinite(dispatch_before)),
 occupied_until timestamptz NOT NULL CHECK(isfinite(occupied_until)),
 completed_at timestamptz CHECK(completed_at IS NULL OR isfinite(completed_at)),
 response_observed_at timestamptz CHECK(response_observed_at IS NULL OR isfinite(response_observed_at)),
 quarantined boolean NOT NULL DEFAULT false,
 retry_after_seconds integer CHECK(retry_after_seconds BETWEEN -1 AND 86400),
 outcome text CHECK(outcome IN ('success','invalid','http429','http503','http5xx','http4xx','network','cancelled','unknown')),
 retry_of uuid REFERENCES public.provider_http_permits(id),
 FOREIGN KEY(provider,lane) REFERENCES public.provider_request_lane_limits(provider,lane),
 FOREIGN KEY(demand_id,actor_user_id,job_key)
  REFERENCES public.app_acquisition_demands(id,actor_user_id,job_key),
 CHECK(dispatch_before=granted_at+interval '1 second'),
 CHECK(occupied_until=granted_at+interval '60 seconds'),
 CHECK((completed_at IS NULL AND outcome IS NULL)
    OR (completed_at IS NOT NULL AND outcome IS NOT NULL AND completed_at>=granted_at)),
 CHECK(response_observed_at IS NULL OR (completed_at IS NOT NULL AND response_observed_at>=granted_at)),
 CHECK(demand_id IS NULL OR (actor_user_id IS NOT NULL AND job_key IS NOT NULL)),
 CHECK(((job_key IS NULL AND job_attempt_count IS NULL AND lease_owner IS NULL AND lease_until IS NULL)
    OR (job_key IS NOT NULL AND job_attempt_count IS NOT NULL AND job_attempt_count>0
        AND lease_owner IS NOT NULL AND btrim(lease_owner)<>''
        AND lease_until IS NOT NULL AND isfinite(lease_until))) IS TRUE)
);
CREATE INDEX http_permit_window_v2 ON public.provider_http_permits(provider,lane,granted_at);
CREATE INDEX http_permit_actor_v2 ON public.provider_http_permits(actor_user_id,granted_at)
 WHERE actor_user_id IS NOT NULL;
CREATE INDEX http_permit_live_v2 ON public.provider_http_permits(provider,occupied_until)
 WHERE completed_at IS NULL;
-- Known response or confirmed LOCAL socket teardown releases logical ownership.
-- Unknown transport/coordinator loss retains its slot60s, then records terminal
-- unknown. It never asserts remote cancellation or refunds the charge.
-- Each retry/redirect hop needs a new requestId/permit; automatic redirects/retry
-- disabled; only allowlisted provider host/path. Retry lane is separate capacity.
-- Only the transaction inserting a new request_id may return granted. Every
-- repeated request_id returns indeterminate, never a send-capable permit/deadline.
-- Unknown grant commit sends nothing; a committed charge is never refunded.
-- Existing per-operation caps remain in addition to aggregate admission.
-- All HTTP calls <=5s local timeout; existing owner claims a30s job lease and
-- performs one HTTP/checkpoint per turn. 429 cooldown >=60s/Retry-After, 503 >=5s;
-- three429s/10min open circuit. Invalid/excessive Retry-After latches operator
-- review. No automatic retry, slot refund or provider-remote-stop assertion.


ALTER TABLE public.league_seasons ADD CONSTRAINT season_id_league_acquisition_unique UNIQUE(id,league_id);
ALTER TABLE public.league_source_mapping_revisions ADD CONSTRAINT mapping_id_connection_acquisition_unique UNIQUE(id,connection_id);
ALTER TABLE public.league_source_mapping_revisions ADD CONSTRAINT mapping_id_season_acquisition_unique UNIQUE(id,league_season_id);
CREATE TABLE public.app_league_renewals (
 id uuid PRIMARY KEY,
 association_id uuid NOT NULL REFERENCES public.app_provider_account_links(id),
 association_revision bigint NOT NULL CHECK(association_revision>0),
 league_id uuid NOT NULL REFERENCES public.leagues(id),
 predecessor_season_id uuid NOT NULL,
 successor_season_id uuid NOT NULL,
 predecessor_mapping_revision_id uuid NOT NULL,
 successor_mapping_revision_id uuid NOT NULL,
 membership_acceptance_id uuid NOT NULL REFERENCES public.league_roster_resource_acceptances(id),
 expected_selection_revision bigint NOT NULL CHECK(expected_selection_revision>0),
 expected_follow_revision bigint CHECK(expected_follow_revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(association_id,association_revision,league_id,expected_selection_revision,
        predecessor_mapping_revision_id,successor_mapping_revision_id),
 UNIQUE(id,association_id,league_id,successor_season_id),
 FOREIGN KEY(predecessor_season_id,league_id) REFERENCES public.league_seasons(id,league_id),
 FOREIGN KEY(successor_season_id,league_id) REFERENCES public.league_seasons(id,league_id),
 FOREIGN KEY(predecessor_mapping_revision_id,predecessor_season_id)
  REFERENCES public.league_source_mapping_revisions(id,league_season_id),
 FOREIGN KEY(successor_mapping_revision_id,successor_season_id)
  REFERENCES public.league_source_mapping_revisions(id,league_season_id),
 CHECK(predecessor_season_id<>successor_season_id)
);
CREATE TABLE public.app_current_league_selections (
 association_id uuid NOT NULL REFERENCES public.app_provider_account_links(id),
 league_id uuid NOT NULL REFERENCES public.leagues(id),
 league_season_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 renewal_id uuid,
 PRIMARY KEY(association_id,league_id),
 FOREIGN KEY(league_season_id,league_id) REFERENCES public.league_seasons(id,league_id),
 FOREIGN KEY(renewal_id,association_id,league_id,league_season_id)
  REFERENCES public.app_league_renewals(id,association_id,league_id,successor_season_id)
);
-- Guard additionally verifies later season, nonforked verified predecessor,
-- exact current mapping/member acceptance and fresh expected revisions.

ALTER TABLE public.app_provider_account_links
  ADD COLUMN subject_lookup_capture_id uuid,
  ADD CONSTRAINT association_lookup_subject_acquisition_fk FOREIGN KEY(subject_lookup_capture_id,source_manager_account_id)
    REFERENCES public.provider_identity_evidence(lookup_capture_id,manager_id);
CREATE UNIQUE INDEX association_manager_acquisition_unique ON public.app_provider_account_links(source_manager_account_id) WHERE revoked_at IS NULL;
-- The existing manager table admits Sleeper only. This copied provider is a
-- derived constant of that exact existing key, never fabricated lookup evidence.
ALTER TABLE public.app_provider_account_links ADD COLUMN provider text NOT NULL DEFAULT 'sleeper' CHECK(provider='sleeper');
CREATE UNIQUE INDEX association_actor_provider_acquisition_unique ON public.app_provider_account_links(app_user_id,provider) WHERE revoked_at IS NULL;

ALTER TABLE public.app_discovery_scans ADD COLUMN calendar_capture_id uuid REFERENCES public.provider_capture_receipts(id),
  ADD COLUMN league_season_at_start integer CHECK(league_season_at_start BETWEEN 1922 AND 2200),
  ADD COLUMN retained_selection_seasons integer[] NOT NULL DEFAULT '{}';
ALTER TABLE public.app_discovery_scan_seasons ADD COLUMN request_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE public.provider_request_attempts ADD COLUMN demand_id uuid REFERENCES public.app_acquisition_demands(id),
  ADD COLUMN dispatch_request_id uuid UNIQUE;
CREATE TABLE public.provider_acquisition_policy_installations (
  revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reviewed_sha text NOT NULL CHECK(reviewed_sha ~ '^[a-f0-9]{40}$'),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  manifest jsonb NOT NULL,
  installed_by name NOT NULL
);
CREATE TABLE public.app_association_commands (
 actor_user_id uuid NOT NULL REFERENCES public.app_users(id),
 command_id uuid NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 association_id uuid NOT NULL REFERENCES public.app_provider_account_links(id),
 association_revision bigint NOT NULL CHECK(association_revision>0),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_user_id,command_id)
);
CREATE FUNCTION public.acquisition_keys_v1(value jsonb,expected text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_typeof(value)='object' AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
   =(SELECT array_agg(key ORDER BY key) FROM unnest(expected) key)
   AND NOT EXISTS(SELECT 1 FROM jsonb_each(value) e WHERE e.value='null'::jsonb AND e.key NOT IN ('value','authorityExpiresAt','avatar','sourceObservedAt')),false);
$$;
REVOKE ALL ON FUNCTION public.acquisition_keys_v1(jsonb,text[]) FROM PUBLIC;

CREATE FUNCTION public.install_acquisition_policy_v1(p_manifest jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE owner_oid oid; context jsonb; policy jsonb; evidence_revision bigint;
BEGIN
 SELECT proowner INTO owner_oid FROM pg_proc WHERE oid='public.install_acquisition_policy_v1(jsonb)'::regprocedure;
 IF session_user::regrole::oid<>owner_oid OR current_user<>session_user OR current_setting('role') NOT IN ('none',session_user)
   OR NOT public.acquisition_keys_v1(p_manifest,ARRAY['reviewedSha','evidenceHash','infrastructure','context','policies','enabled'])
   OR p_manifest->>'reviewedSha' !~ '^[a-f0-9]{40}$' OR p_manifest->>'evidenceHash' !~ '^[a-f0-9]{64}$'
   OR p_manifest->'infrastructure' IS DISTINCT FROM website_auth.account_server_identity_v1()
   OR jsonb_typeof(p_manifest->'enabled')<>'boolean' OR jsonb_typeof(p_manifest->'policies')<>'array'
   OR jsonb_array_length(p_manifest->'policies')<>3 THEN RAISE EXCEPTION 'Acquisition installation denied'; END IF;
 context:=p_manifest->'context';
 IF NOT public.acquisition_keys_v1(context,ARRAY['id','revision','authorityExpiresAt'])
   OR context->>'revision' !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Invalid acquisition context'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sleeper:acquisition-policy',0));
 INSERT INTO public.provider_access_contexts(id,provider,audience_id,kind,state,revision,authority_expires_at)
 VALUES((context->>'id')::uuid,'sleeper','public','public','active',(context->>'revision')::bigint,(context->>'authorityExpiresAt')::timestamptz)
 ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state='active',authority_expires_at=excluded.authority_expires_at
 WHERE provider_access_contexts.provider='sleeper' AND provider_access_contexts.kind='public'
   AND provider_access_contexts.audience_id='public' AND provider_access_contexts.revision<excluded.revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition context revision changed'; END IF;
 FOR policy IN SELECT value FROM jsonb_array_elements(p_manifest->'policies') LOOP
   IF NOT public.acquisition_keys_v1(policy,ARRAY['id','family','normalizerVersion','validationVersion','coverageSpecId','revision','evidenceRef'])
     OR policy->>'family' NOT IN ('identity-lookup','league-list','nfl-state')
     OR policy->>'normalizerVersion'<>CASE policy->>'family' WHEN 'identity-lookup' THEN 'sleeper-account-identity-v1'
       WHEN 'league-list' THEN 'sleeper-account-leagues-v1' ELSE 'sleeper-discovery-calendar-v1' END
     OR policy->>'validationVersion'<>'sleeper-preenrollment-v1'
     OR policy->>'coverageSpecId'<>('sleeper:'|| (policy->>'family') ||':v1')
     OR policy->>'revision' !~ '^[1-9][0-9]{0,18}$' OR btrim(policy->>'evidenceRef')='' THEN RAISE EXCEPTION 'Unapproved acquisition interpretation'; END IF;
   INSERT INTO public.provider_request_policy_qualifications(id,provider,family,normalizer_version,validation_version,coverage_spec_id,state,revision,evidence_ref)
   VALUES((policy->>'id')::uuid,'sleeper',policy->>'family',policy->>'normalizerVersion',policy->>'validationVersion',policy->>'coverageSpecId',
     'qualified',(policy->>'revision')::bigint,policy->>'evidenceRef')
   ON CONFLICT(id) DO UPDATE SET state='qualified',revision=excluded.revision,evidence_ref=excluded.evidence_ref
   WHERE provider_request_policy_qualifications.revision<excluded.revision
     AND provider_request_policy_qualifications.family=excluded.family
     AND provider_request_policy_qualifications.normalizer_version=excluded.normalizer_version
     AND provider_request_policy_qualifications.validation_version=excluded.validation_version
     AND provider_request_policy_qualifications.coverage_spec_id=excluded.coverage_spec_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition policy revision changed'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'family') FROM jsonb_array_elements(p_manifest->'policies'))<>3 THEN RAISE EXCEPTION 'Incomplete policy manifest'; END IF;
 INSERT INTO public.provider_request_gates(provider,policy_version,enabled) VALUES('sleeper','sleeper-admission-v1',(p_manifest->>'enabled')::boolean)
 ON CONFLICT(provider) DO UPDATE SET enabled=excluded.enabled;
 INSERT INTO public.provider_request_lane_limits(provider,lane,limit_per_60s,max_in_flight)
 SELECT 'sleeper',lane,cap,slots FROM (VALUES('live-score',680,32),('role-roster',55,32),('transactions',100,32),
   ('metadata',20,32),('interactive',15,8),('import',15,32),('retry',15,32)) limits(lane,cap,slots)
 ON CONFLICT(provider,lane) DO NOTHING;
 INSERT INTO public.provider_acquisition_policy_installations(reviewed_sha,evidence_hash,manifest,installed_by)
 VALUES(p_manifest->>'reviewedSha',p_manifest->>'evidenceHash',p_manifest,session_user) RETURNING revision INTO evidence_revision;
 RETURN evidence_revision;
END; $$;
REVOKE ALL ON FUNCTION public.install_acquisition_policy_v1(jsonb) FROM PUBLIC;

CREATE FUNCTION public.acquisition_envelope_v1(p_result jsonb,p_receipt jsonb,p_deadline timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sampled timestamptz; deadline timestamptz;
BEGIN
 PERFORM public.lock_account_actor_authority_v2(p_receipt,false);
 sampled:=date_trunc('milliseconds',clock_timestamp()); deadline:=least((p_receipt->>'expiresAt')::timestamptz,p_deadline);
 IF deadline<=sampled THEN RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='Acquisition authority unavailable'; END IF;
 RETURN jsonb_build_object('result',p_result,'decisionTiming',jsonb_build_object('dbSampleAt',to_char(sampled AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'minimumAuthorityExpiresAt',to_char(deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'remainingLifetimeMs',floor(extract(epoch FROM deadline-sampled)*1000)::bigint::text));
END; $$;
REVOKE ALL ON FUNCTION public.acquisition_envelope_v1(jsonb,jsonb,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.activate_provider_account_v2(p_provider_account_id uuid,p_lookup_capture_id uuid,
 p_expected_actor_revision bigint,p_request_id uuid,p_session_receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid; capture public.provider_capture_receipts; attempt public.provider_request_attempts;
 context public.provider_access_contexts; policy public.provider_request_policy_qualifications;
 linked public.app_provider_account_links; admitted public.app_acquisition_demands; result jsonb;
 retained public.app_association_commands; input_hash_value text; association_changed boolean:=false;
BEGIN
 PERFORM public.lock_account_actor_authority_v2(p_session_receipt,true); actor:=public.current_app_actor();
 IF p_request_id IS DISTINCT FROM nullif(current_setting('app.request_id',true),'')::uuid THEN
   RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='Account state changed'; END IF;
 PERFORM 1 FROM public.league_source_manager_accounts WHERE id=p_provider_account_id AND provider='sleeper' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','lookup_unqualified'),'decisionTiming',null); END IF;
 SELECT * INTO capture FROM public.provider_capture_receipts WHERE id=p_lookup_capture_id AND provider_account_id=p_provider_account_id AND outcome='normalized';
 IF NOT FOUND THEN RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','lookup_unqualified'),'decisionTiming',null); END IF;
 SELECT * INTO attempt FROM public.provider_request_attempts WHERE id=capture.attempt_id;
 SELECT * INTO admitted FROM public.app_acquisition_demands WHERE id=attempt.request_id AND actor_user_id=actor AND kind='identify' AND state='completed';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.provider_identity_evidence WHERE lookup_capture_id=capture.id AND manager_id=p_provider_account_id) THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','lookup_unqualified'),'decisionTiming',null); END IF;
 SELECT * INTO linked FROM public.app_provider_account_links WHERE source_manager_account_id=p_provider_account_id AND revoked_at IS NULL FOR UPDATE;
 IF FOUND AND linked.app_user_id<>actor THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','conflict','reason','exclusive_conflict'),'decisionTiming',null); END IF;
 IF EXISTS(SELECT 1 FROM public.app_provider_account_links WHERE app_user_id=actor AND provider='sleeper'
   AND revoked_at IS NULL AND source_manager_account_id<>p_provider_account_id) THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','conflict','reason','exclusive_conflict'),'decisionTiming',null); END IF;
 input_hash_value:=encode(public.digest(convert_to(jsonb_build_array(p_provider_account_id,p_lookup_capture_id,p_expected_actor_revision)::text,'UTF8'),'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('association-command:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO retained FROM public.app_association_commands WHERE actor_user_id=actor AND command_id=p_request_id;
 IF FOUND THEN
   IF retained.input_hash<>input_hash_value THEN RETURN jsonb_build_object('result',jsonb_build_object('status','conflict','reason','command_conflict'),'decisionTiming',null); END IF;
   IF linked.id IS DISTINCT FROM retained.association_id OR linked.revision IS DISTINCT FROM retained.association_revision THEN
     RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','command_conflict'),'decisionTiming',null); END IF;
 ELSIF p_expected_actor_revision IS DISTINCT FROM (SELECT revision FROM public.app_users WHERE id=actor) THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','conflict','reason','command_conflict'),'decisionTiming',null);
 END IF;
 SELECT * INTO context FROM public.provider_access_contexts WHERE id=attempt.access_context_id FOR SHARE;
 SELECT * INTO policy FROM public.provider_request_policy_qualifications WHERE id=attempt.policy_qualification_id FOR SHARE;
 IF context.state<>'active' OR context.revision<>attempt.access_revision OR context.kind<>'public' OR context.audience_id<>'public'
   OR context.authority_expires_at<=clock_timestamp() OR policy.state<>'qualified' OR policy.revision<>attempt.policy_qualification_revision
   OR policy.family<>'identity-lookup' THEN RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='Lookup authority unavailable'; END IF;
 IF linked.id IS NOT NULL THEN
   IF linked.subject_lookup_capture_id IS DISTINCT FROM capture.id THEN
     -- Explicit own-subject activation refreshes qualified lookup evidence.
     -- Actor CAS was checked above under its lock; preserve a second exact
     -- association revision under the same lock. Its guard advances the link;
     -- the explicit actor update below advances the client-checked generation.
     UPDATE public.app_provider_account_links SET subject_lookup_capture_id=capture.id
       WHERE id=linked.id AND revision=linked.revision RETURNING * INTO linked;
     IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='Account state changed'; END IF;
     association_changed:=true;
   END IF;
   result:=jsonb_build_object('status','already_active','associationId',linked.id,'associationRevision',linked.revision::text,'assurance','user_asserted');
 ELSE
   INSERT INTO public.app_provider_account_links(app_user_id,source_manager_account_id,subject_lookup_capture_id)
   VALUES(actor,p_provider_account_id,capture.id) RETURNING * INTO linked;
   association_changed:=true;
   result:=jsonb_build_object('status','active','associationId',linked.id,'associationRevision',linked.revision::text,'assurance','user_asserted');
 END IF;
 IF association_changed THEN
   -- A link trigger does not advance its actor. Advance that generation in this
   -- same transaction so a different command carrying the old client revision
   -- cannot replace newer qualified evidence. Existing account revision/audit
   -- and rate guards apply; failure rolls back both mutations and their audits.
   -- Exact retained-command replay and same-capture no-ops never enter here.
   UPDATE public.app_users SET revision=revision WHERE id=actor AND revision=p_expected_actor_revision;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='Account state changed'; END IF;
 END IF;
 IF retained.command_id IS NULL THEN
   INSERT INTO public.app_association_commands(actor_user_id,command_id,input_hash,association_id,association_revision)
   VALUES(actor,p_request_id,input_hash_value,linked.id,linked.revision);
 END IF;
 RETURN public.acquisition_envelope_v1(result,p_session_receipt,context.authority_expires_at);
END; $$;
REVOKE ALL ON FUNCTION public.activate_provider_account_v2(uuid,uuid,bigint,uuid,jsonb) FROM PUBLIC;

-- Reuse the existing audit owner and unchanged mutation-rate lock/count.
ALTER TABLE public.app_identity_audit_events DROP CONSTRAINT app_identity_audit_events_subject_type_check;
ALTER TABLE public.app_identity_audit_events ADD CONSTRAINT app_identity_audit_events_subject_type_check CHECK(subject_type IN
 ('app_users','app_login_identities','app_provider_account_links','app_user_leagues','app_league_groups','app_league_group_memberships','app_acquisition_demands'));

CREATE FUNCTION public.admit_account_acquisition_v1(p_command jsonb,p_session_receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid; command_uuid uuid; command_hash text; scope_value jsonb; semantic_hash text; sampled timestamptz;
 context public.provider_access_contexts; association public.app_provider_account_links; demand public.app_acquisition_demands;
 gate public.provider_request_gates; demand_id uuid; job_key_value text;
BEGIN
 PERFORM public.lock_account_actor_authority_v2(p_session_receipt,true); actor:=public.current_app_actor();
 IF p_command->>'kind'='identify' THEN
   IF NOT public.acquisition_keys_v1(p_command,ARRAY['kind','commandId','username'])
     OR p_command->>'username' !~ '^[a-zA-Z0-9_]{1,100}$' THEN RAISE EXCEPTION 'Invalid acquisition command'; END IF;
   scope_value:=jsonb_build_object('kind','identify','username',p_command->>'username');
 ELSIF p_command->>'kind'='discover' THEN
   IF NOT public.acquisition_keys_v1(p_command,ARRAY['kind','commandId','associationId','associationRevision'])
     OR p_command->>'associationRevision' !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Invalid acquisition command'; END IF;
   SELECT * INTO association FROM public.app_provider_account_links WHERE id=(p_command->>'associationId')::uuid;
   PERFORM 1 FROM public.league_source_manager_accounts WHERE id=association.source_manager_account_id FOR SHARE;
   SELECT * INTO association FROM public.app_provider_account_links WHERE id=association.id AND app_user_id=actor
     AND revoked_at IS NULL AND revision=(p_command->>'associationRevision')::bigint AND subject_lookup_capture_id IS NOT NULL FOR SHARE;
   IF NOT FOUND THEN RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','authority_unavailable'),'decisionTiming',null); END IF;
   scope_value:=jsonb_build_object('kind','discover','associationId',association.id,'associationRevision',association.revision::text);
 ELSE
   -- Recovery needs selected league/membership lifecycle qualification; it cannot
   -- be approximated by discovery or grant routine collection authority.
   RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','scope_invalid'),'decisionTiming',null);
 END IF;
 command_uuid:=(p_command->>'commandId')::uuid;
 IF command_uuid IS DISTINCT FROM nullif(current_setting('app.request_id',true),'')::uuid THEN RAISE EXCEPTION 'Invalid command identity'; END IF;
 command_hash:=encode(public.digest(convert_to(p_command::text,'UTF8'),'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('acquisition-command:'||actor::text||':'||command_uuid::text,0));
 SELECT * INTO context FROM public.provider_access_contexts WHERE provider='sleeper' AND kind='public' AND audience_id='public' FOR SHARE;
 IF NOT FOUND OR context.state<>'active' OR context.authority_expires_at<=clock_timestamp() THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','admission_unavailable'),'decisionTiming',null); END IF;
 PERFORM 1 FROM public.provider_request_policy_qualifications WHERE provider='sleeper' AND state='qualified'
   AND family=CASE p_command->>'kind' WHEN 'identify' THEN 'identity-lookup' ELSE 'league-list' END FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','admission_unavailable'),'decisionTiming',null); END IF;
 SELECT * INTO gate FROM public.provider_request_gates WHERE provider='sleeper' FOR UPDATE;
 IF NOT FOUND OR NOT gate.enabled THEN RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','admission_unavailable'),'decisionTiming',null); END IF;
 sampled:=date_trunc('milliseconds',clock_timestamp());
 SELECT * INTO demand FROM public.app_acquisition_demands WHERE actor_user_id=actor AND command_id=command_uuid FOR UPDATE;
 IF FOUND THEN
   IF demand.command_input_hash<>command_hash THEN RETURN jsonb_build_object('result',jsonb_build_object('status','conflict','reason','command_conflict'),'decisionTiming',null); END IF;
   IF demand.scope IS NULL OR demand.terminal_outcome IN ('cancelled','expired') THEN RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','scope_invalid'),'decisionTiming',null); END IF;
   RETURN public.acquisition_envelope_v1(jsonb_build_object('status','joined','demandId',demand.id,'retryAfterSeconds',2),p_session_receipt,context.authority_expires_at);
 END IF;
 scope_value:=scope_value||jsonb_build_object('accessContextId',context.id,'accessRevision',context.revision::text);
 semantic_hash:=encode(public.digest(convert_to(scope_value::text,'UTF8'),'sha256'),'hex');
 IF EXISTS(SELECT 1 FROM public.app_acquisition_demands WHERE actor_user_id=actor AND scope_hash=semantic_hash AND state IN ('pending','running'))
   OR (SELECT count(*) FROM public.app_acquisition_demands WHERE actor_user_id=actor AND state IN ('pending','running') AND expires_at>sampled)>=2
   OR (SELECT count(*) FROM public.app_acquisition_demands WHERE state IN ('pending','running') AND expires_at>sampled)>=128 THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','limited','reason','budget_exhausted'),'decisionTiming',null); END IF;
 demand_id:=gen_random_uuid(); job_key_value:='account-acquisition:'||demand_id::text;
 INSERT INTO public.app_acquisition_demands(id,actor_user_id,command_id,command_input_hash,kind,association_id,association_revision,
   scope,scope_hash,policy_version,created_at,expires_at,not_before,state,job_key)
 VALUES(demand_id,actor,command_uuid,command_hash,p_command->>'kind',association.id,association.revision,
   scope_value,semantic_hash,'sleeper-admission-v1',sampled,sampled+interval '15 minutes',sampled,'pending',job_key_value);
 INSERT INTO public.projection_jobs(job_key,job_type,scheduled_for,payload)
 VALUES(job_key_value,'account-acquisition',sampled,jsonb_build_object('demandId',demand_id));
 RETURN public.acquisition_envelope_v1(jsonb_build_object('status','pending','demandId',demand_id,'retryAfterSeconds',2),p_session_receipt,least(sampled+interval '15 minutes',context.authority_expires_at));
END; $$;
REVOKE ALL ON FUNCTION public.admit_account_acquisition_v1(jsonb,jsonb) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.audit_app_identity_change() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE row_value jsonb; actor_id uuid; request_uuid uuid; subject_uuid uuid; user_uuid uuid; actor_type text;
  rate_window_start timestamptz;
BEGIN
  request_uuid := nullif(current_setting('app.request_id',true),'')::uuid;
  IF request_uuid IS NULL THEN RAISE EXCEPTION 'account change requires transaction-local request context'; END IF;
  row_value := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  actor_id := public.current_app_actor();
  subject_uuid := coalesce((row_value->>'id')::uuid,(row_value->>'league_id')::uuid);
  user_uuid := CASE WHEN TG_TABLE_NAME='app_users' THEN subject_uuid WHEN TG_TABLE_NAME='app_acquisition_demands' THEN (row_value->>'actor_user_id')::uuid ELSE (row_value->>'app_user_id')::uuid END;
  actor_type := CASE WHEN TG_OP='INSERT' AND TG_TABLE_NAME IN ('app_users','app_login_identities') THEN 'authentication'
    WHEN actor_id IS NOT NULL THEN 'user' ELSE 'operator' END;
  IF actor_type='user' THEN
    -- The shared per-actor lock covers direct SQL as well as the store's own
    -- serialized writes. A rejection rolls back the data/revision and audit
    -- together; authentication and deliberate operator maintenance are separate.
    IF current_setting('transaction_isolation')<>'read committed' THEN
      RAISE EXCEPTION USING ERRCODE='P4290', MESSAGE='account writes require read committed isolation';
    END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('app:mutation-rate:'||actor_id::text,0)) THEN
      RAISE EXCEPTION USING ERRCODE='P4290', MESSAGE='account write is already in progress';
    END IF;
    rate_window_start := clock_timestamp()-interval '60 seconds';
    IF (SELECT count(*) FROM (SELECT 1 FROM public.app_identity_audit_events
      WHERE actor_user_id=actor_id AND actor_kind='user' AND occurred_at>=rate_window_start LIMIT 60) recent)>=60 THEN
      RAISE EXCEPTION USING ERRCODE='P4290', MESSAGE='account write rate limit exceeded';
    END IF;
  END IF;
  INSERT INTO public.app_identity_audit_events(actor_kind,actor_user_id,operation,subject_type,subject_id,subject_user_id,request_id,metadata)
  VALUES(actor_type,actor_id,lower(TG_OP),TG_TABLE_NAME,subject_uuid,user_uuid,request_uuid,
    CASE WHEN row_value ? 'revision' THEN jsonb_build_object('revision',(row_value->>'revision')::bigint) ELSE '{}'::jsonb END);
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

CREATE TRIGGER acquisition_admission_audit AFTER INSERT ON public.app_acquisition_demands FOR EACH ROW EXECUTE FUNCTION public.audit_app_identity_change();

CREATE FUNCTION public.acquisition_authority_v1(p_demand uuid) RETURNS public.app_acquisition_demands
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE demand public.app_acquisition_demands; link public.app_provider_account_links; context public.provider_access_contexts;
BEGIN
 SELECT * INTO demand FROM public.app_acquisition_demands WHERE id=p_demand;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition unavailable'; END IF;
 PERFORM 1 FROM public.app_users WHERE id=demand.actor_user_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition unavailable'; END IF;
 IF demand.association_id IS NOT NULL THEN
   SELECT * INTO link FROM public.app_provider_account_links WHERE id=demand.association_id;
   PERFORM 1 FROM public.league_source_manager_accounts WHERE id=link.source_manager_account_id FOR SHARE;
   SELECT * INTO link FROM public.app_provider_account_links WHERE id=demand.association_id
     AND app_user_id=demand.actor_user_id AND revision=demand.association_revision AND revoked_at IS NULL
     AND subject_lookup_capture_id IS NOT NULL FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition unavailable'; END IF;
 END IF;
 -- Preliminary context inspection only; source owners take its stable lock
 -- after the typed request mutex and before the provider gate.
 SELECT * INTO context FROM public.provider_access_contexts WHERE id=(demand.scope->>'accessContextId')::uuid;
 IF NOT FOUND OR context.state<>'active' OR context.kind<>'public' OR context.audience_id<>'public'
   OR context.revision IS DISTINCT FROM (demand.scope->>'accessRevision')::bigint
   OR context.authority_expires_at<=clock_timestamp() OR (demand.state<>'completed' AND demand.expires_at<=clock_timestamp())
   OR demand.state NOT IN ('pending','running','completed') THEN RAISE EXCEPTION 'Acquisition unavailable'; END IF;
 RETURN demand;
END; $$;
REVOKE ALL ON FUNCTION public.acquisition_authority_v1(uuid) FROM PUBLIC;

CREATE FUNCTION public.acquisition_job_fence_v1(p_demand uuid,p_fence jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE demand public.app_acquisition_demands;
BEGIN
 IF NOT public.acquisition_keys_v1(p_fence,ARRAY['jobKey','workerId','attemptCount','leaseUntil'])
   OR jsonb_typeof(p_fence->'attemptCount')<>'number' OR p_fence->>'attemptCount' !~ '^[1-9][0-9]*$'
   OR length(p_fence->>'workerId') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid acquisition lease'; END IF;
 SELECT * INTO demand FROM public.app_acquisition_demands WHERE id=p_demand FOR UPDATE;
 IF NOT FOUND OR demand.state NOT IN ('pending','running') OR demand.expires_at<=clock_timestamp()
   OR demand.job_key IS DISTINCT FROM p_fence->>'jobKey' THEN RAISE EXCEPTION 'Acquisition lease lost'; END IF;
 PERFORM 1 FROM public.projection_jobs WHERE job_key=demand.job_key AND job_type='account-acquisition'
   AND payload=jsonb_build_object('demandId',demand.id) AND state='running'
   AND lease_owner=p_fence->>'workerId' AND attempt_count=(p_fence->>'attemptCount')::integer
   AND lease_until=(p_fence->>'leaseUntil')::timestamptz AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition lease lost'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.acquisition_job_fence_v1(uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.claim_account_acquisition_v1(p_worker_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE demand public.app_acquisition_demands; job public.projection_jobs; sampled timestamptz; work jsonb; selected_scan_id uuid;
BEGIN
 PERFORM public.acquisition_runtime_v1();
 IF p_worker_id IS NULL OR length(btrim(p_worker_id)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid worker'; END IF;
 PERFORM 1 FROM public.provider_request_gates WHERE provider='sleeper' AND enabled AND NOT circuit_open
   AND (cooldown_until IS NULL OR cooldown_until<=clock_timestamp()) FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','limited','retryAfterSeconds',5); END IF;
 sampled:=date_trunc('milliseconds',clock_timestamp());
 UPDATE public.app_acquisition_demands SET state='failed',terminal_outcome='expired',terminal_at=sampled
 WHERE state IN ('pending','running') AND expires_at<=sampled;
 SELECT d.* INTO demand FROM public.app_acquisition_demands d JOIN public.projection_jobs j ON j.job_key=d.job_key
 WHERE d.state IN ('pending','running') AND d.expires_at>sampled AND d.not_before<=sampled
   AND j.job_type='account-acquisition' AND j.scheduled_for<=sampled
   AND (j.state IN ('pending','failed') OR (j.state='running' AND j.lease_until<=sampled))
   AND NOT EXISTS(SELECT 1 FROM public.provider_http_permits p WHERE p.actor_user_id=d.actor_user_id
     AND p.occupied_until>sampled AND (p.completed_at IS NULL OR p.quarantined))
 ORDER BY (SELECT max(granted_at) FROM public.provider_http_permits p WHERE p.actor_user_id=d.actor_user_id) NULLS FIRST,
   d.created_at,d.id FOR UPDATE OF d,j SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','idle','retryAfterSeconds',2); END IF;
 UPDATE public.projection_jobs SET state='running',lease_owner=p_worker_id,lease_until=sampled+interval '30 seconds',
   attempt_count=attempt_count+1,updated_at=sampled WHERE job_key=demand.job_key RETURNING * INTO job;
 UPDATE public.app_acquisition_demands SET state='running' WHERE id=demand.id;
 IF demand.kind='identify' THEN work:=jsonb_build_object('kind','identify','username',demand.scope->>'username');
 ELSIF demand.result_ref IS NULL THEN work:=jsonb_build_object('kind','calendar-state');
 ELSE
   selected_scan_id:=(demand.result_ref->>'scanId')::uuid;
   work:=jsonb_build_object('kind','discover','nativeAccountId',(SELECT m.external_manager_id FROM public.app_provider_account_links l
     JOIN public.league_source_manager_accounts m ON m.id=l.source_manager_account_id WHERE l.id=demand.association_id),
     'scanId',selected_scan_id,'requiredSeasons',(SELECT coalesce(jsonb_agg(season ORDER BY season),'[]') FROM public.app_discovery_scan_seasons s WHERE s.scan_id=selected_scan_id));
 END IF;
 RETURN jsonb_build_object('status','claimed','demandId',demand.id,'fence',jsonb_build_object('jobKey',job.job_key,
   'workerId',job.lease_owner,'attemptCount',job.attempt_count,'leaseUntil',to_char(job.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'work',work);
END; $$;
REVOKE ALL ON FUNCTION public.claim_account_acquisition_v1(text) FROM PUBLIC;

CREATE FUNCTION public.account_discovery_work_v1(p_scan uuid,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scan public.app_discovery_scans; demand public.app_acquisition_demands; link public.app_provider_account_links; native text;
BEGIN
 PERFORM public.acquisition_runtime_v1();
 SELECT * INTO demand FROM public.app_acquisition_demands WHERE result_ref=jsonb_build_object('kind','discovery','scanId',p_scan) AND job_key=p_fence->>'jobKey';
 demand:=public.acquisition_authority_v1(demand.id);
 SELECT * INTO scan FROM public.app_discovery_scans WHERE id=p_scan;
 PERFORM public.require_acquisition_capture_current_v1(scan.calendar_capture_id);
 PERFORM 1 FROM public.provider_request_gates WHERE provider='sleeper' AND enabled FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM public.acquisition_job_fence_v1(demand.id,p_fence);
 SELECT * INTO link FROM public.app_provider_account_links WHERE id=demand.association_id;
 SELECT external_manager_id INTO native FROM public.league_source_manager_accounts WHERE id=link.source_manager_account_id;
 RETURN jsonb_build_object('scanId',scan.id,'associationId',link.id,'associationRevision',link.revision::text,
   'providerAccountId',link.source_manager_account_id,'nativeAccountId',native,'accessContextId',demand.scope->>'accessContextId',
   'accessRevision',demand.scope->>'accessRevision','audienceId','public','leagueSeasonAtStart',scan.league_season_at_start,
   'retainedSelectionSeasons',scan.retained_selection_seasons,'strategyVersion',scan.strategy_version,
   'requiredSeasons',(SELECT jsonb_agg(s.season ORDER BY s.season) FROM public.app_discovery_scan_seasons s WHERE s.scan_id=scan.id),
   'completed',(SELECT coalesce(jsonb_agg(jsonb_build_object('season',s.season,'captureId',s.list_capture_id) ORDER BY s.season),'[]')
     FROM public.app_discovery_scan_seasons s WHERE s.scan_id=scan.id AND s.status='complete'));
END; $$;
REVOKE ALL ON FUNCTION public.account_discovery_work_v1(uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.fail_account_acquisition_v1(p_demand uuid,p_fence jsonb,p_reason text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.acquisition_runtime_v1();
 IF p_reason NOT IN ('invalid_source','transport') THEN RETURN false; END IF;
 PERFORM 1 FROM public.provider_request_gates WHERE provider='sleeper' FOR UPDATE;
 PERFORM public.acquisition_job_fence_v1(p_demand,p_fence);
 UPDATE public.app_acquisition_demands SET state='failed',terminal_outcome='failed',terminal_at=clock_timestamp() WHERE id=p_demand;
 UPDATE public.projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,last_error=p_reason,updated_at=clock_timestamp()
 WHERE job_key=p_fence->>'jobKey';
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.fail_account_acquisition_v1(uuid,jsonb,text) FROM PUBLIC;

CREATE FUNCTION public.require_runtime_infrastructure_v1(p_expected jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
BEGIN
 IF session_user<>'league_one_runtime' OR current_setting('role') NOT IN ('none',session_user)
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT
     (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit))
   OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=session_user::regrole)
   OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=session_user::regrole)
   OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=session_user::regrole)
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=session_user::regrole)
   OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=session_user::regrole)
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_temp_' AND has_schema_privilege(session_user,oid,'CREATE'))
   OR has_database_privilege(session_user,current_database(),'CREATE')
   OR p_expected IS DISTINCT FROM website_auth.account_server_identity_v1() THEN RAISE EXCEPTION 'Runtime infrastructure unavailable'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.require_runtime_infrastructure_v1(jsonb) FROM PUBLIC;

CREATE FUNCTION public.acquisition_runtime_v1() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE expected jsonb;
BEGIN
 SELECT manifest->'infrastructure' INTO expected FROM public.provider_acquisition_policy_installations ORDER BY revision DESC LIMIT 1;
 PERFORM public.require_runtime_infrastructure_v1(expected);
END; $$;
REVOKE ALL ON FUNCTION public.acquisition_runtime_v1() FROM PUBLIC;

CREATE FUNCTION public.begin_provider_request_v2(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE demand public.app_acquisition_demands; context public.provider_access_contexts; policy public.provider_request_policy_qualifications;
 previous public.provider_request_attempts; logical_id uuid; attempt_id uuid; ordinal_value bigint; work jsonb; scope_value jsonb;
 v_family text; fence jsonb; immutable_payload jsonb; sampled timestamptz;
BEGIN
 PERFORM public.acquisition_runtime_v1(); v_family:=p_input->>'kind'; work:=p_input->'work'; scope_value:=p_input->'scope';
 IF v_family NOT IN ('identity-lookup','league-list','nfl-state')
   OR NOT public.acquisition_keys_v1(p_input,CASE WHEN v_family='league-list' THEN ARRAY['kind','requestId','attemptId','scope','accessRevision','policy','associationId','associationRevision','scanId','work']
     WHEN v_family='identity-lookup' THEN ARRAY['kind','requestId','attemptId','scope','accessRevision','policy','lookupValue','work']
     ELSE ARRAY['kind','requestId','attemptId','scope','accessRevision','policy','work'] END)
   OR NOT public.acquisition_keys_v1(work,ARRAY['kind','jobKey','leaseOwner','attemptCount','leaseUntil','deadlineAt']) OR work->>'kind'<>'job'
   OR NOT public.acquisition_keys_v1(p_input->'policy',ARRAY['canonicalNormalizerVersion','validationVersion']) THEN RAISE EXCEPTION 'Invalid provider reservation'; END IF;
 logical_id:=(p_input->>'requestId')::uuid; attempt_id:=(p_input->>'attemptId')::uuid;
 SELECT * INTO demand FROM public.app_acquisition_demands WHERE job_key=work->>'jobKey';
 demand:=public.acquisition_authority_v1(demand.id);
 IF v_family='identity-lookup' THEN
   IF demand.kind<>'identify' OR logical_id<>demand.id OR p_input->>'lookupValue' IS DISTINCT FROM demand.scope->>'username'
     OR NOT public.acquisition_keys_v1(scope_value,ARRAY['kind','provider','lookupRequestId','accessContextId','audienceId','coverageSpecId'])
     OR scope_value->>'lookupRequestId'<>demand.id::text OR scope_value->>'kind'<>'identity-lookup' THEN RAISE EXCEPTION 'Invalid identity scope'; END IF;
 ELSIF v_family='nfl-state' THEN
   IF demand.kind<>'discover' OR demand.result_ref IS NOT NULL OR logical_id<>demand.id
     OR NOT public.acquisition_keys_v1(scope_value,ARRAY['kind','provider','sport','accessContextId','audienceId','coverageSpecId'])
     OR scope_value->>'kind'<>'provider-calendar' OR scope_value->>'sport'<>'nfl' THEN RAISE EXCEPTION 'Invalid calendar scope'; END IF;
 ELSE
   IF demand.kind<>'discover' OR demand.association_id::text IS DISTINCT FROM p_input->>'associationId'
     OR demand.association_revision::text IS DISTINCT FROM p_input->>'associationRevision'
     OR demand.result_ref->>'scanId' IS DISTINCT FROM p_input->>'scanId'
     OR NOT public.acquisition_keys_v1(scope_value,ARRAY['kind','provider','providerAccountId','nativeAccountId','family','sport','season','accessContextId','audienceId','coverageSpecId'])
     OR scope_value->>'kind'<>'account-resource' OR scope_value->>'family'<>'league-discovery' OR scope_value->>'sport'<>'nfl'
     OR NOT EXISTS(SELECT 1 FROM public.app_discovery_scan_seasons s WHERE s.scan_id=(p_input->>'scanId')::uuid
       AND s.request_id=logical_id AND s.season=(scope_value->>'season')::integer AND s.status<>'complete')
     OR NOT EXISTS(SELECT 1 FROM public.app_provider_account_links l JOIN public.league_source_manager_accounts m ON m.id=l.source_manager_account_id
       WHERE l.id=demand.association_id AND m.id::text=scope_value->>'providerAccountId' AND m.external_manager_id=scope_value->>'nativeAccountId') THEN RAISE EXCEPTION 'Invalid discovery scope'; END IF;
 END IF;
 IF scope_value->>'provider'<>'sleeper' OR scope_value->>'audienceId'<>'public'
   OR scope_value->>'accessContextId' IS DISTINCT FROM demand.scope->>'accessContextId'
   OR p_input->>'accessRevision' IS DISTINCT FROM demand.scope->>'accessRevision' THEN RAISE EXCEPTION 'Provider context changed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('provider-request:'||logical_id::text,0));
 SELECT * INTO context FROM public.provider_access_contexts WHERE id=(scope_value->>'accessContextId')::uuid FOR SHARE;
 SELECT q.* INTO policy FROM public.provider_request_policy_qualifications q WHERE q.provider='sleeper' AND q.family=v_family
   AND normalizer_version=p_input->'policy'->>'canonicalNormalizerVersion' AND validation_version=p_input->'policy'->>'validationVersion'
   AND coverage_spec_id=scope_value->>'coverageSpecId' AND state='qualified' FOR SHARE;
 IF NOT FOUND OR context.state<>'active' OR context.revision IS DISTINCT FROM (demand.scope->>'accessRevision')::bigint
   OR context.authority_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Provider policy unavailable'; END IF;
 PERFORM 1 FROM public.provider_request_gates WHERE provider='sleeper' AND enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Provider gate unavailable'; END IF;
 fence:=jsonb_build_object('jobKey',work->>'jobKey','workerId',work->>'leaseOwner','attemptCount',work->'attemptCount','leaseUntil',work->>'leaseUntil');
 PERFORM public.acquisition_job_fence_v1(demand.id,fence); sampled:=date_trunc('milliseconds',clock_timestamp());
 IF (work->>'deadlineAt')::timestamptz<=sampled OR (work->>'deadlineAt')::timestamptz>least(demand.expires_at,(work->>'leaseUntil')::timestamptz)
   OR context.authority_expires_at<=sampled THEN RAISE EXCEPTION 'Provider deadline expired'; END IF;
 immutable_payload:=p_input-'attemptId'-'work';
 SELECT * INTO previous FROM public.provider_request_attempts WHERE id=attempt_id;
 IF FOUND THEN
   IF previous.request_payload<>immutable_payload OR previous.job_attempt_count<>(work->>'attemptCount')::integer
     OR previous.lease_owner<>work->>'leaseOwner' OR previous.lease_until<>(work->>'leaseUntil')::timestamptz THEN RAISE EXCEPTION 'Provider attempt conflict'; END IF;
   RETURN jsonb_build_object('status','already_reserved','attemptId',previous.id,'attemptOrdinal',previous.ordinal::text,'reservedAt',previous.reserved_at);
 END IF;
 IF EXISTS(SELECT 1 FROM public.provider_request_attempts WHERE request_id=logical_id AND request_payload<>immutable_payload) THEN RAISE EXCEPTION 'Provider request conflict'; END IF;
 SELECT coalesce(max(ordinal),0)+1 INTO ordinal_value FROM public.provider_request_attempts WHERE request_id=logical_id;
 -- Reservation loss/admission denial does not spend a network retry. Actual
 -- committed permit charges below enforce the three-send ceiling.
 INSERT INTO public.provider_request_attempts(id,request_id,access_context_id,access_revision,policy_qualification_id,policy_qualification_revision,
   scope,ordinal,reserved_at,job_key,lease_owner,lease_until,job_attempt_count,request_payload,normalizer_version,validation_version,demand_id)
 VALUES(attempt_id,logical_id,context.id,context.revision,policy.id,policy.revision,scope_value,ordinal_value,sampled,work->>'jobKey',work->>'leaseOwner',
   (work->>'leaseUntil')::timestamptz,(work->>'attemptCount')::integer,immutable_payload,policy.normalizer_version,policy.validation_version,demand.id);
 RETURN jsonb_build_object('status','reserved','attemptId',attempt_id,'attemptOrdinal',ordinal_value::text,'reservedAt',sampled);
END; $$;
REVOKE ALL ON FUNCTION public.begin_provider_request_v2(jsonb) FROM PUBLIC;

CREATE FUNCTION public.prepare_account_acquisition_attempt_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE demand public.app_acquisition_demands; policy public.provider_request_policy_qualifications; link public.app_provider_account_links;
 logical_id uuid; scope_value jsonb; v_family text; endpoint jsonb; canonical jsonb; result jsonb; attempt public.provider_request_attempts;
BEGIN
 PERFORM public.acquisition_runtime_v1();
 IF p_input->>'kind'='demand' AND public.acquisition_keys_v1(p_input,ARRAY['kind','demandId','attemptId','requestId','fence']) THEN
   SELECT * INTO demand FROM public.app_acquisition_demands WHERE id=(p_input->>'demandId')::uuid;
   v_family:=CASE demand.kind WHEN 'identify' THEN 'identity-lookup' ELSE 'nfl-state' END; logical_id:=demand.id;
 ELSIF p_input->>'kind'='league-list' AND public.acquisition_keys_v1(p_input,ARRAY['kind','scanId','season','attemptId','requestId','fence']) THEN
   SELECT * INTO demand FROM public.app_acquisition_demands WHERE result_ref=jsonb_build_object('kind','discovery','scanId',p_input->>'scanId') AND job_key=p_input->'fence'->>'jobKey';
   SELECT s.request_id INTO logical_id FROM public.app_discovery_scan_seasons s WHERE s.scan_id=(p_input->>'scanId')::uuid
     AND s.season=(p_input->>'season')::integer AND s.status<>'complete'; v_family:='league-list';
 ELSE RAISE EXCEPTION 'Invalid acquisition source'; END IF;
 demand:=public.acquisition_authority_v1(demand.id);
 PERFORM pg_advisory_xact_lock(hashtextextended('provider-request:'||logical_id::text,0));
 PERFORM 1 FROM public.provider_access_contexts WHERE id=(demand.scope->>'accessContextId')::uuid FOR SHARE;
 SELECT q.* INTO policy FROM public.provider_request_policy_qualifications q WHERE q.provider='sleeper' AND q.family=v_family AND q.state='qualified'
   AND q.normalizer_version=CASE v_family WHEN 'identity-lookup' THEN 'sleeper-account-identity-v1'
     WHEN 'league-list' THEN 'sleeper-account-leagues-v1' ELSE 'sleeper-discovery-calendar-v1' END FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 scope_value:=jsonb_build_object('provider','sleeper','accessContextId',demand.scope->>'accessContextId','audienceId','public','coverageSpecId',policy.coverage_spec_id);
 IF v_family='identity-lookup' THEN
   scope_value:=scope_value||jsonb_build_object('kind','identity-lookup','lookupRequestId',demand.id);
   endpoint:=jsonb_build_object('family','identity','username',demand.scope->>'username');
 ELSIF v_family='nfl-state' THEN
   scope_value:=scope_value||jsonb_build_object('kind','provider-calendar','sport','nfl'); endpoint:=jsonb_build_object('family','nfl-state');
 ELSE
   SELECT * INTO link FROM public.app_provider_account_links WHERE id=demand.association_id;
   scope_value:=scope_value||jsonb_build_object('kind','account-resource','family','league-discovery','sport','nfl','season',(p_input->>'season')::integer,
     'providerAccountId',link.source_manager_account_id,'nativeAccountId',(SELECT external_manager_id FROM public.league_source_manager_accounts WHERE id=link.source_manager_account_id));
   endpoint:=jsonb_build_object('family','account-leagues','nativeAccountId',scope_value->>'nativeAccountId','season',(p_input->>'season')::integer);
 END IF;
 canonical:=jsonb_build_object('kind',v_family,'requestId',logical_id,'attemptId',p_input->>'attemptId','scope',scope_value,
   'accessRevision',demand.scope->>'accessRevision','policy',jsonb_build_object('canonicalNormalizerVersion',policy.normalizer_version,'validationVersion',policy.validation_version),
   'work',jsonb_build_object('kind','job','jobKey',p_input->'fence'->>'jobKey','leaseOwner',p_input->'fence'->>'workerId',
     'attemptCount',p_input->'fence'->'attemptCount','leaseUntil',p_input->'fence'->>'leaseUntil',
     'deadlineAt',least(demand.expires_at,(p_input->'fence'->>'leaseUntil')::timestamptz)));
 IF v_family='identity-lookup' THEN canonical:=canonical||jsonb_build_object('lookupValue',demand.scope->>'username');
 ELSIF v_family='league-list' THEN canonical:=canonical||jsonb_build_object('associationId',demand.association_id,
   'associationRevision',demand.association_revision::text,'scanId',p_input->>'scanId'); END IF;
 result:=public.begin_provider_request_v2(canonical);
 SELECT * INTO attempt FROM public.provider_request_attempts WHERE id=(p_input->>'attemptId')::uuid;
 IF attempt.dispatch_request_id IS NOT NULL AND attempt.dispatch_request_id<>(p_input->>'requestId')::uuid THEN RAISE EXCEPTION 'Dispatch identity changed'; END IF;
 UPDATE public.provider_request_attempts SET dispatch_request_id=(p_input->>'requestId')::uuid WHERE id=attempt.id AND dispatch_request_id IS NULL;
 RETURN jsonb_build_object('kind','target','requestId',p_input->>'requestId','demandId',demand.id,
   'source',jsonb_build_object('kind','pre-enrollment','attemptId',attempt.id,'policyQualificationId',policy.id,'policyRevision',policy.revision::text),
   'fence',p_input->'fence','endpoint',endpoint);
END; $$;
REVOKE ALL ON FUNCTION public.prepare_account_acquisition_attempt_v1(jsonb) FROM PUBLIC;

CREATE FUNCTION public.reserve_account_provider_http_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE demand public.app_acquisition_demands; attempt public.provider_request_attempts; context public.provider_access_contexts;
 policy public.provider_request_policy_qualifications; gate public.provider_request_gates; sampled timestamptz; lane_value text;
 expected_endpoint jsonb; permit_id uuid; lane_limit integer; attempt_family text; charged integer; previous_grant timestamptz; jitter_ms integer;
BEGIN
 PERFORM public.acquisition_runtime_v1();
 IF NOT public.acquisition_keys_v1(p_request,ARRAY['kind','requestId','demandId','source','fence','endpoint']) OR p_request->>'kind'<>'target'
   OR NOT public.acquisition_keys_v1(p_request->'source',ARRAY['kind','attemptId','policyQualificationId','policyRevision'])
   OR p_request->'source'->>'kind'<>'pre-enrollment' THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','scope_invalid'),'endpoint',null); END IF;
 demand:=public.acquisition_authority_v1((p_request->>'demandId')::uuid);
 SELECT * INTO attempt FROM public.provider_request_attempts WHERE id=(p_request->'source'->>'attemptId')::uuid AND demand_id=demand.id;
 IF NOT FOUND OR attempt.dispatch_request_id IS DISTINCT FROM (p_request->>'requestId')::uuid THEN RAISE EXCEPTION 'Provider attempt changed'; END IF;
 SELECT * INTO context FROM public.provider_access_contexts WHERE id=attempt.access_context_id FOR SHARE;
 SELECT * INTO policy FROM public.provider_request_policy_qualifications WHERE id=attempt.policy_qualification_id FOR SHARE;
 attempt_family:=attempt.request_payload->>'kind';
 IF context.state<>'active' OR context.revision<>attempt.access_revision OR context.authority_expires_at<=clock_timestamp()
   OR policy.state<>'qualified' OR policy.revision<>attempt.policy_qualification_revision
   OR policy.id::text IS DISTINCT FROM p_request->'source'->>'policyQualificationId'
   OR policy.revision::text IS DISTINCT FROM p_request->'source'->>'policyRevision' THEN RAISE EXCEPTION 'Provider policy changed'; END IF;
 expected_endpoint:=CASE attempt_family WHEN 'identity-lookup' THEN jsonb_build_object('family','identity','username',attempt.request_payload->>'lookupValue')
   WHEN 'nfl-state' THEN jsonb_build_object('family','nfl-state') ELSE jsonb_build_object('family','account-leagues','nativeAccountId',attempt.scope->>'nativeAccountId','season',(attempt.scope->>'season')::integer) END;
 IF expected_endpoint IS DISTINCT FROM p_request->'endpoint' OR attempt.job_key IS DISTINCT FROM p_request->'fence'->>'jobKey'
   OR attempt.lease_owner IS DISTINCT FROM p_request->'fence'->>'workerId'
   OR attempt.job_attempt_count IS DISTINCT FROM (p_request->'fence'->>'attemptCount')::integer
   OR attempt.lease_until IS DISTINCT FROM (p_request->'fence'->>'leaseUntil')::timestamptz THEN RAISE EXCEPTION 'Provider scope changed'; END IF;
 SELECT * INTO gate FROM public.provider_request_gates WHERE provider='sleeper' FOR UPDATE;
 PERFORM public.acquisition_job_fence_v1(demand.id,p_request->'fence'); sampled:=date_trunc('milliseconds',clock_timestamp());
 IF NOT gate.enabled OR gate.circuit_open OR gate.cooldown_until>sampled THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','limited','reason','cooldown'),'endpoint',expected_endpoint); END IF;
 IF EXISTS(SELECT 1 FROM public.provider_http_permits WHERE request_id=(p_request->>'requestId')::uuid) THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','indeterminate','reason','scope_invalid'),'endpoint',expected_endpoint); END IF;
 SELECT count(*),max(p.granted_at) INTO charged,previous_grant FROM public.provider_http_permits p
   JOIN public.provider_request_attempts a ON a.dispatch_request_id=p.request_id WHERE a.request_id=attempt.request_id;
 IF charged>=3 THEN RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','scope_invalid'),'endpoint',expected_endpoint); END IF;
 jitter_ms:=get_byte(public.digest(convert_to(attempt.request_id::text,'UTF8'),'sha256'),0)*1000/256;
 IF charged>0 AND sampled<previous_grant+make_interval(secs=>CASE charged WHEN 1 THEN 2 ELSE 8 END)+(jitter_ms*interval '1 millisecond') THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','limited','reason','cooldown'),'endpoint',expected_endpoint); END IF;
 IF EXISTS(SELECT 1 FROM public.provider_http_permits p JOIN public.provider_request_attempts a ON a.dispatch_request_id=p.request_id
   WHERE a.request_id=attempt.request_id AND p.outcome IN ('http4xx','invalid')) THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','scope_invalid'),'endpoint',expected_endpoint); END IF;
 lane_value:=CASE WHEN charged>0 THEN 'retry' WHEN attempt_family='identity-lookup' THEN 'interactive' ELSE 'import' END;
 SELECT limit_per_60s INTO lane_limit FROM public.provider_request_lane_limits WHERE provider='sleeper' AND lane=lane_value;
 IF lane_limit IS NULL OR (SELECT count(*) FROM public.provider_request_lane_limits WHERE provider='sleeper')<>7
   OR (SELECT sum(limit_per_60s) FROM public.provider_request_lane_limits WHERE provider='sleeper')<>900 THEN RAISE EXCEPTION 'Provider budget unavailable'; END IF;
 IF (SELECT count(*) FROM public.provider_http_permits WHERE provider='sleeper' AND granted_at>sampled-interval '61 seconds')>=900
   OR (SELECT count(*) FROM public.provider_http_permits WHERE provider='sleeper' AND lane=lane_value AND granted_at>sampled-interval '61 seconds')>=lane_limit
   OR (SELECT count(*) FROM public.provider_http_permits WHERE actor_user_id=demand.actor_user_id AND granted_at>sampled-interval '61 seconds')>=5
   OR (SELECT count(*) FROM public.provider_http_permits WHERE actor_user_id=demand.actor_user_id AND granted_at>sampled-interval '3601 seconds')>=60
   OR (SELECT count(*) FROM public.provider_http_permits WHERE provider='sleeper' AND occupied_until>sampled AND (completed_at IS NULL OR quarantined))>=32
   OR (lane_value='interactive' AND (SELECT count(*) FROM public.provider_http_permits WHERE provider='sleeper' AND lane='interactive'
     AND occupied_until>sampled AND (completed_at IS NULL OR quarantined))>=8)
   OR EXISTS(SELECT 1 FROM public.provider_http_permits WHERE actor_user_id=demand.actor_user_id AND occupied_until>sampled AND (completed_at IS NULL OR quarantined)) THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','limited','reason','budget_exhausted'),'endpoint',expected_endpoint); END IF;
 IF least(demand.expires_at,attempt.lease_until,context.authority_expires_at)<=sampled+interval '1 second' THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','deadline'),'endpoint',expected_endpoint); END IF;
 permit_id:=gen_random_uuid();
 INSERT INTO public.provider_http_permits(id,request_id,provider,lane,policy_version,actor_user_id,demand_id,job_key,job_attempt_count,
   lease_owner,lease_until,scope_hash,request_context,granted_at,dispatch_before,occupied_until)
 VALUES(permit_id,(p_request->>'requestId')::uuid,'sleeper',lane_value,'sleeper-admission-v1',demand.actor_user_id,demand.id,attempt.job_key,
   attempt.job_attempt_count,attempt.lease_owner,attempt.lease_until,encode(public.digest(convert_to(attempt.scope::text,'UTF8'),'sha256'),'hex'),
   p_request,sampled,sampled+interval '1 second',sampled+interval '60 seconds');
 RETURN jsonb_build_object('result',jsonb_build_object('status','granted','permitId',permit_id,'dbSampleAt',to_char(sampled AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'dispatchBefore',to_char((sampled+interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'remainingDispatchMs',greatest(0,floor(extract(epoch FROM sampled+interval '1 second'-clock_timestamp())*1000)::integer),'httpDeadlineMs',5000),'endpoint',expected_endpoint);
END; $$;
REVOKE ALL ON FUNCTION public.reserve_account_provider_http_v1(jsonb) FROM PUBLIC;

CREATE FUNCTION public.finish_provider_http_v1(p_permit_id uuid,p_outcome text,p_retry_after_seconds integer) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE permit public.provider_http_permits; sampled timestamptz; observed boolean; delay_seconds integer;
BEGIN
 PERFORM public.acquisition_runtime_v1();
 IF p_outcome IS NULL OR p_outcome NOT IN ('success','invalid','http429','http503','http5xx','http4xx','network','cancelled','unknown')
   OR (p_retry_after_seconds IS NOT NULL AND p_retry_after_seconds NOT BETWEEN -1 AND 86400) THEN RETURN false; END IF;
 PERFORM 1 FROM public.provider_request_gates WHERE provider='sleeper' FOR UPDATE;
 SELECT * INTO permit FROM public.provider_http_permits WHERE id=p_permit_id AND provider='sleeper' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 observed:=p_outcome IN ('success','invalid','http429','http503','http5xx','http4xx'); sampled:=clock_timestamp();
 IF permit.completed_at IS NOT NULL THEN
   IF permit.outcome=p_outcome THEN RETURN permit.retry_after_seconds IS NOT DISTINCT FROM p_retry_after_seconds; END IF;
   IF permit.outcome<>'unknown' OR NOT observed OR permit.response_observed_at IS NOT NULL THEN RETURN false; END IF;
 END IF;
 UPDATE public.provider_http_permits SET outcome=p_outcome,completed_at=coalesce(completed_at,sampled),
   quarantined=quarantined OR p_outcome='unknown',retry_after_seconds=p_retry_after_seconds,
   response_observed_at=CASE WHEN observed THEN sampled ELSE NULL END WHERE id=p_permit_id;
 IF p_retry_after_seconds=-1 THEN
   UPDATE public.provider_request_gates SET circuit_open=true,circuit_reason='invalid-retry-after' WHERE provider='sleeper';
 ELSIF p_outcome IN ('http429','http503') THEN
   delay_seconds:=greatest(CASE p_outcome WHEN 'http429' THEN 60 ELSE 5 END,coalesce(p_retry_after_seconds,0));
   UPDATE public.provider_request_gates SET cooldown_until=greatest(cooldown_until,sampled+make_interval(secs=>delay_seconds)) WHERE provider='sleeper';
 END IF;
 IF (SELECT count(*) FROM public.provider_http_permits WHERE provider='sleeper' AND outcome='http429' AND response_observed_at>sampled-interval '10 minutes')>=3 THEN
   UPDATE public.provider_request_gates SET circuit_open=true,circuit_reason='rate-limit' WHERE provider='sleeper'; END IF;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.finish_provider_http_v1(uuid,text,integer) FROM PUBLIC;

CREATE FUNCTION public.record_provider_capture_v2(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.provider_request_attempts; demand public.app_acquisition_demands; policy public.provider_request_policy_qualifications;
 context public.provider_access_contexts; permit public.provider_http_permits; prior public.provider_capture_receipts;
 normalization jsonb; value jsonb; raw jsonb; field text; raw_key text; field_value jsonb; raw_field jsonb; candidate jsonb;
 manager_id uuid; capture_id uuid; fence jsonb; expected_endpoint jsonb; started timestamptz; finished timestamptz;
BEGIN
 PERFORM public.acquisition_runtime_v1();
 IF NOT public.acquisition_keys_v1(p_input,ARRAY['kind','attemptId','requestStartedAt','requestCompletedAt','sourceObservedAt','rawValue','normalization'])
   OR p_input->>'kind'<>'response' THEN RAISE EXCEPTION 'Invalid provider capture'; END IF;
 SELECT * INTO attempt FROM public.provider_request_attempts WHERE id=(p_input->>'attemptId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Provider reservation unavailable'; END IF;
 demand:=public.acquisition_authority_v1(attempt.demand_id);
 IF attempt.request_payload->>'kind'='identity-lookup' THEN
   IF jsonb_typeof(p_input->'rawValue'->'user_id') IS DISTINCT FROM 'string'
     OR (p_input->'normalization'->'value'->>'nativeAccountId' ~ '^[1-9][0-9]{0,31}$') IS NOT TRUE
     OR p_input->'normalization'->'value'->>'nativeAccountId' IS DISTINCT FROM p_input->'rawValue'->>'user_id' THEN
     RAISE EXCEPTION 'Invalid stable identity'; END IF;
   INSERT INTO public.league_source_manager_accounts(provider,external_manager_id)
     VALUES('sleeper',p_input->'rawValue'->>'user_id') ON CONFLICT(provider,external_manager_id) DO NOTHING;
   SELECT id INTO manager_id FROM public.league_source_manager_accounts
     WHERE provider='sleeper' AND external_manager_id=p_input->'rawValue'->>'user_id' FOR UPDATE;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('provider-request:'||attempt.request_id::text,0));
 SELECT * INTO context FROM public.provider_access_contexts WHERE id=attempt.access_context_id FOR SHARE;
 SELECT * INTO policy FROM public.provider_request_policy_qualifications WHERE id=attempt.policy_qualification_id FOR SHARE;
 IF context.state<>'active' OR context.revision<>attempt.access_revision OR context.authority_expires_at<=clock_timestamp()
   OR policy.state<>'qualified' OR policy.revision<>attempt.policy_qualification_revision THEN RAISE EXCEPTION 'Provider authority changed'; END IF;
 PERFORM 1 FROM public.provider_request_gates WHERE provider='sleeper' FOR UPDATE;
 SELECT * INTO permit FROM public.provider_http_permits WHERE request_id=attempt.dispatch_request_id AND demand_id=demand.id;
 IF NOT FOUND OR permit.outcome<>'success' OR permit.response_observed_at IS NULL THEN RAISE EXCEPTION 'Successful network capture unavailable'; END IF;
 fence:=jsonb_build_object('jobKey',attempt.job_key,'workerId',attempt.lease_owner,'attemptCount',attempt.job_attempt_count,'leaseUntil',attempt.lease_until);
 normalization:=p_input->'normalization'; raw:=p_input->'rawValue'; value:=normalization->'value';
 IF NOT public.acquisition_keys_v1(normalization,ARRAY['kind','canonicalNormalizerVersion','validationVersion','normalizedAt','coverage','value'])
   OR normalization->>'kind'<>'qualified' OR normalization->>'canonicalNormalizerVersion' IS DISTINCT FROM attempt.normalizer_version
   OR normalization->>'validationVersion' IS DISTINCT FROM attempt.validation_version
   OR p_input->'sourceObservedAt' IS DISTINCT FROM 'null'::jsonb
   OR normalization->'coverage'->>'coverageSpecId' IS DISTINCT FROM attempt.scope->>'coverageSpecId' THEN RAISE EXCEPTION 'Invalid normalization receipt'; END IF;
 started:=(p_input->>'requestStartedAt')::timestamptz; finished:=(p_input->>'requestCompletedAt')::timestamptz;
 IF started IS NULL OR finished IS NULL OR NOT isfinite(started) OR NOT isfinite(finished)
   OR finished<started OR started<attempt.reserved_at-interval '1 second' OR started>permit.dispatch_before
   OR finished>permit.response_observed_at+interval '1 second' OR finished-started>interval '5 seconds'
   OR (normalization->>'normalizedAt')::timestamptz IS NULL OR NOT isfinite((normalization->>'normalizedAt')::timestamptz)
   OR (normalization->>'normalizedAt')::timestamptz<finished
   OR (normalization->>'normalizedAt')::timestamptz>clock_timestamp()+interval '1 second' THEN RAISE EXCEPTION 'Invalid network chronology'; END IF;
 SELECT * INTO prior FROM public.provider_capture_receipts WHERE attempt_id=attempt.id;
 IF FOUND THEN
   IF prior.raw_value IS DISTINCT FROM raw OR prior.normalized_value IS DISTINCT FROM value OR prior.request_started_at<>started
     OR prior.request_completed_at<>finished OR prior.normalized_at<>(normalization->>'normalizedAt')::timestamptz THEN RAISE EXCEPTION 'Capture replay conflict'; END IF;
   RETURN jsonb_build_object('status','already_recorded','captureRef',prior.id,'qualification','qualified','providerAccountId',prior.provider_account_id);
 END IF;
 PERFORM public.acquisition_job_fence_v1(demand.id,fence);
 IF policy.family='identity-lookup' THEN
   IF NOT public.acquisition_keys_v1(value,ARRAY['kind','nativeAccountId','username','displayName','avatar']) OR value->>'kind'<>'identity'
     OR jsonb_typeof(raw)<>'object' OR value->>'nativeAccountId' !~ '^[1-9][0-9]{0,31}$'
     OR value->>'nativeAccountId' IS DISTINCT FROM raw->>'user_id'
     OR (attempt.request_payload->>'lookupValue' ~ '^[1-9][0-9]{0,31}$' AND value->>'nativeAccountId'<>attempt.request_payload->>'lookupValue') THEN RAISE EXCEPTION 'Invalid identity capture'; END IF;
   FOREACH field IN ARRAY ARRAY['username','displayName','avatar'] LOOP
     raw_key:=CASE field WHEN 'displayName' THEN 'display_name' ELSE field END; field_value:=value->field; raw_field:=raw->raw_key;
     IF NOT public.acquisition_keys_v1(field_value,ARRAY['state','value']) OR field_value->>'state' NOT IN ('known','empty','absent','null','invalid')
       OR (field_value->>'state'='known' AND (jsonb_typeof(raw_field)<>'string' OR field_value->'value' IS DISTINCT FROM raw_field
         OR (CASE WHEN field='avatar' THEN raw->>raw_key ~ '^[a-zA-Z0-9_-]{1,128}$' ELSE length(raw->>raw_key)<=100 AND btrim(raw->>raw_key)<>'' END) IS NOT TRUE))
       OR (field_value->>'state'='empty' AND (raw_field IS DISTINCT FROM '""'::jsonb OR field_value->'value'<>'""'::jsonb))
       OR (field_value->>'state'='absent' AND (raw ? raw_key OR field_value->'value'<>'null'::jsonb))
       OR (field_value->>'state'='null' AND (raw_field IS DISTINCT FROM 'null'::jsonb OR field_value->'value'<>'null'::jsonb))
       OR (field_value->>'state'='invalid' AND (NOT raw ? raw_key OR raw_field='null'::jsonb OR (jsonb_typeof(raw_field)='string' AND (CASE WHEN field='avatar' THEN raw->>raw_key ~ '^[a-zA-Z0-9_-]{1,128}$' ELSE length(raw->>raw_key)<=100 AND btrim(raw->>raw_key)<>'' END)) OR field_value->'value'<>'null'::jsonb)) THEN RAISE EXCEPTION 'Invalid identity field provenance'; END IF;
   END LOOP;

 ELSIF policy.family='nfl-state' THEN
   IF NOT public.acquisition_keys_v1(value,ARRAY['kind','leagueSeason']) OR value->>'kind'<>'calendar' OR jsonb_typeof(raw)<>'object'
     OR jsonb_typeof(value->'leagueSeason')<>'number' OR value->>'leagueSeason' !~ '^[0-9]{4}$'
     OR (value->>'leagueSeason')::integer NOT BETWEEN 1922 AND 2200 OR raw->>'league_season' IS DISTINCT FROM value->>'leagueSeason' THEN RAISE EXCEPTION 'Invalid NFL calendar capture'; END IF;
 ELSE
   IF NOT public.acquisition_keys_v1(value,ARRAY['kind','candidates','display']) OR value->>'kind'<>'league-list'
     OR jsonb_typeof(raw)<>'array' OR jsonb_typeof(value->'candidates')<>'array' OR jsonb_typeof(value->'display')<>'array'
     OR jsonb_array_length(raw)>1000 THEN RAISE EXCEPTION 'Invalid league-list capture'; END IF;
   FOR candidate IN SELECT item FROM jsonb_array_elements(value->'candidates') item LOOP
     IF NOT public.acquisition_keys_v1(candidate,ARRAY['nativeLeagueId','sourceSeasonNamespace','season','sport'])
       OR candidate->>'nativeLeagueId' !~ '^[1-9][0-9]{0,31}$' OR candidate->>'sport'<>'nfl'
       OR candidate->>'season' IS DISTINCT FROM attempt.scope->>'season'
       OR candidate->>'sourceSeasonNamespace' IS DISTINCT FROM ('nfl:'||(attempt.scope->>'season'))
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(raw) r WHERE r->>'league_id'=candidate->>'nativeLeagueId'
         AND r->>'season'=attempt.scope->>'season' AND r->>'sport'='nfl') THEN RAISE EXCEPTION 'League-list scope mismatch'; END IF;
   END LOOP;
   FOR candidate IN SELECT item FROM jsonb_array_elements(value->'display') item LOOP
     IF NOT public.acquisition_keys_v1(candidate,ARRAY['id','name','season','avatar'])
       OR jsonb_typeof(candidate->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(candidate->'name') IS DISTINCT FROM 'string'
       OR length(candidate->>'name') NOT BETWEEN 1 AND 200 OR candidate->>'name' ~ '[[:cntrl:]]'
       OR candidate->>'season' IS DISTINCT FROM attempt.scope->>'season'
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'candidates') c WHERE c->>'nativeLeagueId'=candidate->>'id')
       OR (candidate->'avatar'<>'null'::jsonb AND (candidate->>'avatar' ~ '^[a-zA-Z0-9_-]{1,128}$') IS NOT TRUE)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(raw) r WHERE r->>'league_id'=candidate->>'id'
         AND (jsonb_typeof(r->'name') IS DISTINCT FROM 'string' OR btrim(r->>'name') IS DISTINCT FROM candidate->>'name'))
       OR candidate->'avatar' IS DISTINCT FROM (SELECT CASE WHEN jsonb_typeof(r->'avatar')='string' THEN r->'avatar' ELSE 'null'::jsonb END
         FROM jsonb_array_elements(raw) WITH ORDINALITY rows(r,position) WHERE r->>'league_id'=candidate->>'id' ORDER BY position DESC LIMIT 1)
       THEN RAISE EXCEPTION 'Invalid discovery presentation provenance'; END IF;
   END LOOP;
   IF jsonb_array_length(value->'display')<>jsonb_array_length(value->'candidates')
     OR (SELECT count(DISTINCT c->>'id') FROM jsonb_array_elements(value->'display') c)<>jsonb_array_length(value->'display') THEN
     RAISE EXCEPTION 'Incomplete discovery presentation'; END IF;
   IF (SELECT count(DISTINCT r->>'league_id') FROM jsonb_array_elements(raw) r)<>jsonb_array_length(value->'candidates')
     OR (SELECT count(DISTINCT c->>'nativeLeagueId') FROM jsonb_array_elements(value->'candidates') c)<>jsonb_array_length(value->'candidates')
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(raw) r WHERE r->>'season' IS DISTINCT FROM attempt.scope->>'season' OR r->>'sport' IS DISTINCT FROM 'nfl') THEN RAISE EXCEPTION 'Incomplete list capture'; END IF;
 END IF;
 capture_id:=gen_random_uuid();
 INSERT INTO public.provider_capture_receipts(id,attempt_id,origin,outcome,raw_value,normalized_value,normalizer_version,validation_version,
   request_started_at,request_completed_at,source_observed_at,normalized_at,coverage,provider_account_id)
 VALUES(capture_id,attempt.id,'network','normalized',raw,value,attempt.normalizer_version,attempt.validation_version,started,finished,NULL,
   (normalization->>'normalizedAt')::timestamptz,normalization->'coverage',manager_id);
 IF manager_id IS NOT NULL THEN INSERT INTO public.provider_identity_evidence(id,manager_id,kind,lookup_capture_id)
   VALUES(gen_random_uuid(),manager_id,'lookup',capture_id); END IF;
 RETURN jsonb_build_object('status','recorded','captureRef',capture_id,'qualification','qualified','providerAccountId',manager_id);
END; $$;
REVOKE ALL ON FUNCTION public.record_provider_capture_v2(jsonb) FROM PUBLIC;

-- Atomic source retention and continuation: the shared worker never completes a
-- discovery job independently of this checkpoint transaction.
CREATE FUNCTION public.capture_account_acquisition_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.provider_request_attempts; demand public.app_acquisition_demands; permit public.provider_http_permits;
 value jsonb; coverage jsonb; recorded jsonb; capture_uuid uuid; scan_uuid uuid; season_value integer; retained integer[];
 required integer[]; completed boolean; item jsonb; sampled timestamptz; retained_scan public.app_discovery_scans; resume_current boolean; capture_ids uuid[];
BEGIN
 PERFORM public.acquisition_runtime_v1();
 IF NOT public.acquisition_keys_v1(p_input,ARRAY['kind','request','permitId','rawValue','normalizedValue','requestStartedAt','requestCompletedAt','normalizedAt']) THEN
   RAISE EXCEPTION 'Invalid acquisition capture'; END IF;
 SELECT * INTO permit FROM public.provider_http_permits WHERE id=(p_input->>'permitId')::uuid;
 IF NOT FOUND OR permit.request_context IS DISTINCT FROM p_input->'request' THEN RAISE EXCEPTION 'Capture permit changed'; END IF;
 SELECT * INTO attempt FROM public.provider_request_attempts WHERE id=(permit.request_context->'source'->>'attemptId')::uuid;
 IF NOT FOUND OR attempt.request_payload->>'kind' IS DISTINCT FROM p_input->>'kind' THEN RAISE EXCEPTION 'Capture purpose changed'; END IF;
 -- Reauthorize and classify retained continuation before the provider gate.
 -- The request mutex precedes all access/policy locks, including historical
 -- dependencies; those locks stay held through capture and checkpoint commit.
 IF p_input->>'kind'='nfl-state' THEN
   demand:=public.acquisition_authority_v1(attempt.demand_id);
   PERFORM pg_advisory_xact_lock(hashtextextended('provider-request:'||attempt.request_id::text,0));
   SELECT s.* INTO retained_scan FROM public.app_discovery_scans s
     WHERE s.association_id=demand.association_id AND s.association_revision=demand.association_revision
       AND s.strategy_version='sleeper-current-prior-two-retained-v1' AND s.finished_at IS NULL ORDER BY s.id LIMIT 1;
   IF FOUND THEN
     SELECT array_prepend(retained_scan.calendar_capture_id,coalesce(array_agg(s.list_capture_id ORDER BY s.season),'{}')) INTO capture_ids
       FROM public.app_discovery_scan_seasons s WHERE s.scan_id=retained_scan.id AND s.status='complete';
     resume_current:=public.lock_acquisition_resume_evidence_v1(capture_ids,attempt.id);
   END IF;
 END IF;
 value:=p_input->'normalizedValue';
 IF p_input->>'kind'='nfl-state' THEN value:=value||jsonb_build_object('kind','calendar');
 ELSIF p_input->>'kind'='league-list' THEN
   IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid discovery list'; END IF;
   value:=jsonb_build_object('kind','league-list','display',value,'candidates',
     (SELECT coalesce(jsonb_agg(jsonb_build_object('nativeLeagueId',v->>'id','sourceSeasonNamespace','nfl:'||(v->>'season'),
       'season',(v->>'season')::integer,'sport','nfl')),'[]') FROM jsonb_array_elements(value) v));
 END IF;
 coverage:=jsonb_build_object('coverageSpecId',attempt.scope->>'coverageSpecId','observed',jsonb_build_object(
   'periodIds','[]'::jsonb,'interval',null,'entitySet','full','fields',CASE p_input->>'kind'
     WHEN 'identity-lookup' THEN '["nativeAccountId"]'::jsonb WHEN 'nfl-state' THEN '["leagueSeason"]'::jsonb
     ELSE '["nativeLeagueId","season","sport","name","avatar"]'::jsonb END,
   'pagination','complete','nextCursor',null,'completeness','complete','reasons','[]'::jsonb),
   'populationEvidenceRef',null,'roleGroups','[]'::jsonb);
 recorded:=public.record_provider_capture_v2(jsonb_build_object('kind','response','attemptId',attempt.id,
   'requestStartedAt',p_input->>'requestStartedAt','requestCompletedAt',p_input->>'requestCompletedAt','sourceObservedAt',null,
   'rawValue',p_input->'rawValue','normalization',jsonb_build_object('kind','qualified','canonicalNormalizerVersion',attempt.normalizer_version,
     'validationVersion',attempt.validation_version,'normalizedAt',p_input->>'normalizedAt','coverage',coverage,'value',value)));
 capture_uuid:=(recorded->>'captureRef')::uuid;
 SELECT * INTO demand FROM public.app_acquisition_demands WHERE id=attempt.demand_id;
 -- Exact retained replay has already committed its checkpoint atomically.
 IF recorded->>'status'='already_recorded' THEN RETURN jsonb_build_object('captureId',capture_uuid); END IF;
 sampled:=clock_timestamp(); completed:=false;
 IF p_input->>'kind'='identity-lookup' THEN
   UPDATE public.app_acquisition_demands SET result_ref=jsonb_build_object('kind','identity','captureId',capture_uuid) WHERE id=demand.id;
   completed:=true;
 ELSIF p_input->>'kind'='nfl-state' THEN
   season_value:=(value->>'leagueSeason')::integer;
   SELECT coalesce(array_agg(DISTINCT s.season::integer ORDER BY s.season::integer),'{}') INTO retained
     FROM public.app_current_league_selections selection JOIN public.league_seasons s ON s.id=selection.league_season_id
     WHERE selection.association_id=demand.association_id;
   SELECT array_agg(DISTINCT y ORDER BY y) INTO required FROM unnest(retained||ARRAY[season_value-2,season_value-1,season_value]) y;
   -- Explicit fresh actor intent can resume retained progress after expiry or
   -- interruption. The original calendar/query set and receipts remain frozen.
   SELECT s.id INTO scan_uuid FROM public.app_discovery_scans s
     WHERE s.association_id=demand.association_id AND s.association_revision=demand.association_revision
       AND s.strategy_version='sleeper-current-prior-two-retained-v1' AND s.finished_at IS NULL
     ORDER BY s.id LIMIT 1 FOR UPDATE;
   IF scan_uuid IS NOT NULL AND (scan_uuid IS DISTINCT FROM retained_scan.id OR resume_current IS NOT TRUE) THEN
     -- Revoked or superseded qualification cannot be resumed. Retire only the
     -- execution, preserving its frozen calendar/query set and every receipt;
     -- the new accepted demand builds a fresh scan from its qualified calendar.
     UPDATE public.app_discovery_scans SET status='failed',finished_at=sampled,continuation=NULL,revision=revision+1 WHERE id=scan_uuid;
     scan_uuid:=NULL;
   END IF;
   IF scan_uuid IS NOT NULL THEN
     -- The frozen scan is retained discovery identity, not an inexhaustible
     -- retry budget. A NEW accepted demand starts a new bounded execution only
     -- for unfinished scopes. Same-command replay never reaches this branch:
     -- admission joins its demand and repeated calendar capture returns above.
     UPDATE public.app_discovery_scans SET job_key=demand.job_key WHERE id=scan_uuid AND job_key IS DISTINCT FROM demand.job_key;
     IF NOT FOUND THEN RAISE EXCEPTION 'Discovery execution already attached'; END IF;
     UPDATE public.app_discovery_scan_seasons SET request_id=gen_random_uuid()
       WHERE scan_id=scan_uuid AND status<>'complete';
   ELSE
   scan_uuid:=gen_random_uuid();
   INSERT INTO public.app_discovery_scans(id,association_id,association_revision,strategy_version,query_set_hash,status,revision,job_key,
     calendar_capture_id,league_season_at_start,retained_selection_seasons)
   VALUES(scan_uuid,demand.association_id,demand.association_revision,'sleeper-current-prior-two-retained-v1',
     encode(public.digest(convert_to(to_jsonb(required)::text,'UTF8'),'sha256'),'hex'),'pending',1,demand.job_key,capture_uuid,season_value,retained);
   INSERT INTO public.app_discovery_scan_seasons(scan_id,season,status) SELECT scan_uuid,y,'pending' FROM unnest(required) y;
   END IF;
   UPDATE public.app_acquisition_demands SET result_ref=jsonb_build_object('kind','discovery','scanId',scan_uuid) WHERE id=demand.id;
 ELSE
   scan_uuid:=(demand.result_ref->>'scanId')::uuid; season_value:=(attempt.scope->>'season')::integer;
   FOR item IN SELECT v FROM jsonb_array_elements(value->'candidates') v LOOP
     INSERT INTO public.app_discovery_candidates(scan_id,source_season_namespace,native_league_id,season,sport,list_capture_id)
     VALUES(scan_uuid,item->>'sourceSeasonNamespace',item->>'nativeLeagueId',season_value,'nfl',capture_uuid);
   END LOOP;
   UPDATE public.app_discovery_scan_seasons SET status='complete',list_capture_id=capture_uuid
     WHERE scan_id=scan_uuid AND season=season_value AND status<>'complete';
   IF NOT FOUND THEN RAISE EXCEPTION 'Discovery checkpoint changed'; END IF;
   completed:=NOT EXISTS(SELECT 1 FROM public.app_discovery_scan_seasons s WHERE s.scan_id=scan_uuid AND s.status<>'complete');
   UPDATE public.app_discovery_scans SET status=CASE WHEN completed THEN 'complete' ELSE 'partial' END,revision=revision+1,
     finished_at=CASE WHEN completed THEN sampled ELSE NULL END WHERE id=scan_uuid;
 END IF;
 UPDATE public.app_acquisition_demands SET state=CASE WHEN completed THEN 'completed' ELSE 'pending' END,
   terminal_outcome=CASE WHEN completed THEN 'completed' ELSE NULL END,terminal_at=CASE WHEN completed THEN sampled ELSE NULL END WHERE id=demand.id;
 UPDATE public.projection_jobs SET state=CASE WHEN completed THEN 'completed' ELSE 'pending' END,lease_owner=NULL,lease_until=NULL,
   completed_at=CASE WHEN completed THEN sampled ELSE NULL END,updated_at=sampled,scheduled_for=sampled,last_error=NULL WHERE job_key=demand.job_key;
 RETURN jsonb_build_object('captureId',capture_uuid);
END; $$;
REVOKE ALL ON FUNCTION public.capture_account_acquisition_v1(jsonb) FROM PUBLIC;

CREATE FUNCTION public.read_account_acquisition_v1(p_demand uuid,p_receipt jsonb,p_expected_kind text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE demand public.app_acquisition_demands; context public.provider_access_contexts; capture public.provider_capture_receipts;
 scan public.app_discovery_scans; result jsonb; actor uuid;
BEGIN
 PERFORM public.lock_account_actor_authority_v2(p_receipt,false); actor:=public.current_app_actor();
 SELECT * INTO demand FROM public.app_acquisition_demands WHERE id=p_demand AND actor_user_id=actor;
 IF NOT FOUND OR (p_expected_kind IS NOT NULL AND (p_expected_kind<>'identify' OR demand.kind<>p_expected_kind)) THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','denied','reason','scope_invalid'),'decisionTiming',null); END IF;
 IF demand.scope IS NULL OR demand.state IN ('failed','cancelled') OR (demand.state<>'completed' AND demand.expires_at<=clock_timestamp()) THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','unavailable','reason','unavailable'),'decisionTiming',null); END IF;
 demand:=public.acquisition_authority_v1(demand.id);
 SELECT * INTO context FROM public.provider_access_contexts WHERE id=(demand.scope->>'accessContextId')::uuid FOR SHARE;
 IF context.state<>'active' OR context.revision IS DISTINCT FROM (demand.scope->>'accessRevision')::bigint THEN RAISE EXCEPTION 'Acquisition unavailable'; END IF;
 IF demand.kind='identify' AND demand.state='completed' THEN
   SELECT * INTO capture FROM public.provider_capture_receipts WHERE id=(demand.result_ref->>'captureId')::uuid;
   PERFORM public.require_acquisition_capture_current_v1(capture.id);
   result:=jsonb_build_object('status','identified','demandId',demand.id,'lookupCaptureId',capture.id,'providerAccount',jsonb_build_object(
     'id',capture.provider_account_id,'provider','sleeper','namespace','sleeper:user','nativeAccountId',capture.normalized_value->>'nativeAccountId',
     'username',capture.normalized_value->'username','displayName',capture.normalized_value->'displayName','avatar',capture.normalized_value->'avatar',
     'identityEvidenceKind','lookup','identityEvidenceRef',capture.id));
 ELSIF demand.kind='discover' AND demand.result_ref IS NOT NULL THEN
   SELECT * INTO scan FROM public.app_discovery_scans WHERE id=(demand.result_ref->>'scanId')::uuid;
   PERFORM public.require_acquisition_capture_current_v1(scan.calendar_capture_id);
   PERFORM public.require_acquisition_capture_current_v1(l.subject_lookup_capture_id) FROM public.app_provider_account_links l WHERE l.id=demand.association_id;
   PERFORM public.require_acquisition_capture_current_v1(s.list_capture_id) FROM public.app_discovery_scan_seasons s WHERE s.scan_id=scan.id AND s.status='complete' ORDER BY s.season;
   result:=jsonb_build_object('status','discovery-progress','demandId',demand.id,'scanId',scan.id,'coverage',scan.status,
     'requiredSeasons',(SELECT jsonb_agg(s.season ORDER BY s.season) FROM public.app_discovery_scan_seasons s WHERE s.scan_id=scan.id),
     'completedSeasons',(SELECT coalesce(jsonb_agg(s.season ORDER BY s.season),'[]') FROM public.app_discovery_scan_seasons s WHERE s.scan_id=scan.id AND s.status='complete'));
 ELSE result:=jsonb_build_object('status','pending','demandId',demand.id,'retryAfterSeconds',2); END IF;
 RETURN public.acquisition_envelope_v1(result,p_receipt,least(context.authority_expires_at,CASE WHEN demand.state<>'completed' THEN demand.expires_at ELSE NULL END));
END; $$;
REVOKE ALL ON FUNCTION public.read_account_acquisition_v1(uuid,jsonb,text) FROM PUBLIC;

CREATE FUNCTION public.read_account_discovery_v1(p_demand uuid,p_receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE envelope jsonb; progress jsonb; demand public.app_acquisition_demands; scan public.app_discovery_scans;
 link public.app_provider_account_links; identity_value jsonb; native text; candidates jsonb;
BEGIN
 envelope:=public.read_account_acquisition_v1(p_demand,p_receipt,NULL); progress:=envelope->'result';
 IF progress->>'status'<>'discovery-progress' THEN
   RETURN jsonb_build_object('result',jsonb_build_object('status','unavailable','reason','unavailable'),'decisionTiming',null); END IF;
 SELECT * INTO demand FROM public.app_acquisition_demands WHERE id=p_demand;
 SELECT * INTO scan FROM public.app_discovery_scans WHERE id=(progress->>'scanId')::uuid;
 SELECT * INTO link FROM public.app_provider_account_links WHERE id=demand.association_id;
 SELECT external_manager_id INTO native FROM public.league_source_manager_accounts WHERE id=link.source_manager_account_id;
 SELECT normalized_value INTO identity_value FROM public.provider_capture_receipts WHERE id=link.subject_lookup_capture_id;
 SELECT coalesce(jsonb_agg(q.item ORDER BY q.item->>'season' DESC,q.item->>'id'),'[]') INTO candidates FROM (
   SELECT DISTINCT ON (display->>'id') display AS item FROM public.app_discovery_scan_seasons s
     JOIN public.provider_capture_receipts c ON c.id=s.list_capture_id CROSS JOIN LATERAL jsonb_array_elements(c.normalized_value->'display') display
   WHERE s.scan_id=scan.id AND s.status='complete' ORDER BY display->>'id',s.season DESC) q;
 RETURN jsonb_build_object('result',jsonb_build_object('status','available','demandId',demand.id,'scanId',scan.id,
   'providerAccountId',link.source_manager_account_id,'nativeAccountId',native,
   'displayName',coalesce(nullif(btrim(identity_value->'displayName'->>'value'),''),nullif(btrim(identity_value->'username'->>'value'),''),native),
   'currentSeason',scan.league_season_at_start,'coverage',progress->'coverage','requiredSeasons',progress->'requiredSeasons',
   'completedSeasons',progress->'completedSeasons','candidates',candidates),'decisionTiming',envelope->'decisionTiming');
END; $$;
REVOKE ALL ON FUNCTION public.read_account_discovery_v1(uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.reject_acquisition_history_change_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 RAISE EXCEPTION 'Acquisition history is immutable';
END; $$;
REVOKE ALL ON FUNCTION public.reject_acquisition_history_change_v1() FROM PUBLIC;
CREATE FUNCTION public.guard_acquisition_attempt_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Provider attempt history is immutable'; END IF;
 IF OLD.dispatch_request_id IS NOT NULL OR NEW.dispatch_request_id IS NULL
   OR (to_jsonb(OLD)-'dispatch_request_id') IS DISTINCT FROM (to_jsonb(NEW)-'dispatch_request_id') THEN
   RAISE EXCEPTION 'Provider attempt history is immutable'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_acquisition_attempt_v1() FROM PUBLIC;
CREATE TRIGGER acquisition_attempt_immutable BEFORE UPDATE OR DELETE ON public.provider_request_attempts
 FOR EACH ROW EXECUTE FUNCTION public.guard_acquisition_attempt_v1();
CREATE TRIGGER acquisition_attempt_no_truncate BEFORE TRUNCATE ON public.provider_request_attempts
 EXECUTE FUNCTION public.reject_acquisition_history_change_v1();
DO $$ DECLARE table_name text; role_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['provider_capture_receipts','provider_identity_evidence','provider_acquisition_policy_installations','app_association_commands','app_league_renewals'] LOOP
   EXECUTE format('CREATE TRIGGER acquisition_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.reject_acquisition_history_change_v1()',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['provider_access_contexts','provider_request_policy_qualifications','provider_request_attempts','provider_capture_receipts',
   'provider_identity_evidence','app_discovery_scans','app_discovery_scan_seasons','app_discovery_candidates','provider_request_gates',
   'provider_request_lane_limits','app_acquisition_demands','provider_http_permits','app_league_renewals','app_current_league_selections',
   'provider_acquisition_policy_installations','app_association_commands'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
   FOREACH role_name IN ARRAY ARRAY['league_one_account','league_one_runtime','league_one_auth'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name); END IF;
   END LOOP;
 END LOOP;
 REVOKE ALL ON SEQUENCE public.provider_acquisition_policy_installations_revision_seq FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['league_one_account','league_one_runtime','league_one_auth'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
     EXECUTE format('REVOKE ALL ON SEQUENCE public.provider_acquisition_policy_installations_revision_seq FROM %I',role_name);
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_account') THEN
   GRANT EXECUTE ON FUNCTION public.admit_account_acquisition_v1(jsonb,jsonb),public.read_account_acquisition_v1(uuid,jsonb,text),
     public.read_account_discovery_v1(uuid,jsonb),public.activate_provider_account_v2(uuid,uuid,bigint,uuid,jsonb) TO league_one_account;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
   -- Provisioning remains explicit; existing INHERIT roles are not silently repaired by a migration.
   GRANT EXECUTE ON FUNCTION public.require_runtime_infrastructure_v1(jsonb),public.claim_account_acquisition_v1(text),
     public.account_discovery_work_v1(uuid,jsonb),public.prepare_account_acquisition_attempt_v1(jsonb),public.reserve_account_provider_http_v1(jsonb),
     public.finish_provider_http_v1(uuid,text,integer),public.capture_account_acquisition_v1(jsonb),public.fail_account_acquisition_v1(uuid,jsonb,text)
     TO league_one_runtime;
 END IF;
END; $$;
-- Retained facts keep their historical bytes, but serving them requires their
-- exact interpretation qualification and access revision to remain valid.
CREATE FUNCTION public.require_acquisition_capture_current_v1(p_capture uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.provider_request_attempts; context public.provider_access_contexts; policy public.provider_request_policy_qualifications;
BEGIN
 SELECT a.* INTO attempt FROM public.provider_capture_receipts c JOIN public.provider_request_attempts a ON a.id=c.attempt_id
   WHERE c.id=p_capture AND c.outcome='normalized';
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition evidence unavailable'; END IF;
 SELECT * INTO context FROM public.provider_access_contexts WHERE id=attempt.access_context_id FOR SHARE;
 SELECT * INTO policy FROM public.provider_request_policy_qualifications WHERE id=attempt.policy_qualification_id FOR SHARE;
 IF context.state<>'active' OR context.revision<>attempt.access_revision OR context.authority_expires_at<=clock_timestamp()
   OR policy.state<>'qualified' OR policy.revision<>attempt.policy_qualification_revision THEN RAISE EXCEPTION 'Acquisition evidence unavailable'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.require_acquisition_capture_current_v1(uuid) FROM PUBLIC;

CREATE FUNCTION public.guard_acquisition_permit_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF TG_OP<>'UPDATE' OR (to_jsonb(OLD)-ARRAY['outcome','completed_at','response_observed_at','quarantined','retry_after_seconds'])
   IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['outcome','completed_at','response_observed_at','quarantined','retry_after_seconds']) THEN
   RAISE EXCEPTION 'Provider permit charge is immutable'; END IF;
 IF OLD.quarantined AND NOT NEW.quarantined OR OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at
   OR OLD.response_observed_at IS NOT NULL AND NEW.response_observed_at IS DISTINCT FROM OLD.response_observed_at THEN
   RAISE EXCEPTION 'Provider permit quarantine is immutable'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_acquisition_permit_v1() FROM PUBLIC;
CREATE TRIGGER acquisition_permit_immutable BEFORE UPDATE OR DELETE ON public.provider_http_permits
 FOR EACH ROW EXECUTE FUNCTION public.guard_acquisition_permit_v1();
CREATE TRIGGER acquisition_permit_no_truncate BEFORE TRUNCATE ON public.provider_http_permits
 EXECUTE FUNCTION public.reject_acquisition_history_change_v1();

CREATE FUNCTION public.reserve_provider_http_v1(p_request jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.reserve_account_provider_http_v1(p_request)->'result';
$$;
REVOKE ALL ON FUNCTION public.reserve_provider_http_v1(jsonb) FROM PUBLIC;


-- Classification is not an authorization fallback: false forbids resumption,
-- leaving history untouched and requiring a newly qualified scan. Include the
-- current attempt in the sorted lock set to avoid historical-policy inversion.
CREATE FUNCTION public.lock_acquisition_resume_evidence_v1(p_captures uuid[],p_new_attempt uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE expected_count integer;
BEGIN
 PERFORM 1 FROM public.provider_access_contexts context WHERE context.id IN (
   SELECT a.access_context_id FROM public.provider_request_attempts a WHERE a.id=p_new_attempt OR a.id IN
     (SELECT c.attempt_id FROM public.provider_capture_receipts c WHERE c.id=ANY(p_captures))) ORDER BY context.id FOR SHARE;
 PERFORM 1 FROM public.provider_request_policy_qualifications policy WHERE policy.id IN (
   SELECT a.policy_qualification_id FROM public.provider_request_attempts a WHERE a.id=p_new_attempt OR a.id IN
     (SELECT c.attempt_id FROM public.provider_capture_receipts c WHERE c.id=ANY(p_captures))) ORDER BY policy.id FOR SHARE;
 expected_count:=cardinality(p_captures);
 IF expected_count IS NULL OR expected_count=0 OR array_position(p_captures,NULL) IS NOT NULL THEN RETURN false; END IF;
 RETURN expected_count=(SELECT count(*) FROM public.provider_capture_receipts c
   JOIN public.provider_request_attempts a ON a.id=c.attempt_id
   JOIN public.provider_access_contexts context ON context.id=a.access_context_id
   JOIN public.provider_request_policy_qualifications policy ON policy.id=a.policy_qualification_id
   WHERE c.id=ANY(p_captures) AND c.outcome='normalized' AND context.state='active' AND context.revision=a.access_revision
     AND (context.authority_expires_at IS NULL OR context.authority_expires_at>clock_timestamp())
     AND policy.state='qualified' AND policy.revision=a.policy_qualification_revision);
END; $$;
REVOKE ALL ON FUNCTION public.lock_acquisition_resume_evidence_v1(uuid[],uuid) FROM PUBLIC;

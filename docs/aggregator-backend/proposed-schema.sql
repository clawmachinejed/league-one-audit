-- League One first-slice PostgreSQL schema DESIGN SPECIFICATION.
-- Source: application migrations 001, 016, 020, 021, 026-030 at verified source;
-- documentation baseline e2a37d99d637baf80f1f29db597d75a69d3a78bd.
-- NOT A MIGRATION. NOT AN INSTALL SCRIPT. NEVER execute this file against a DB.
-- It specifies final additive structure, not deployment order/backfill/release.
-- Destructive cleanup, production DML, seed values, credential values, role
-- creation, old-column removal and automatic rollout are deliberately excluded.
-- Functions below are exact contracts/algorithms in relational-design.md:
-- translating those algorithms into executable bodies is implementation work.
-- Unimplemented guard signatures make this specification intentionally incomplete
-- as an executable script; that does not omit their required design behavior.
-- Existing objects are not recreated; unchanged indexes/constraints still apply.
-- All UUIDs are explicit writer-generated values unless a default is shown.
-- All captured timestamps are finite UTC instants; SQL stores timestamptz.
-- Every unspecified FK uses NO ACTION (no new cascades); referenced evidence
-- stays immutable. Existing Better Auth cascades remain its owner's behavior.

-- S01: composite targets required by scope/subject equality.
ALTER TABLE public.league_source_manager_accounts
 ADD CONSTRAINT manager_id_provider_v2_unique UNIQUE(id,provider);
ALTER TABLE public.league_seasons
 ADD CONSTRAINT season_id_league_v2_unique UNIQUE(id,league_id);
ALTER TABLE public.league_source_connections
 ADD CONSTRAINT connection_id_season_v2_unique UNIQUE(id,league_season_id);
ALTER TABLE public.league_source_mapping_revisions
 ADD CONSTRAINT mapping_id_connection_v2_unique UNIQUE(id,connection_id),
 ADD CONSTRAINT mapping_id_season_v2_unique UNIQUE(id,league_season_id);
ALTER TABLE public.league_roster_resource_scopes
 ADD CONSTRAINT scope_id_connection_v2_unique UNIQUE(id,connection_id),
 ADD CONSTRAINT scope_id_season_v2_unique UNIQUE(id,league_season_id);
ALTER TABLE public.league_roster_resource_acceptances
 ADD CONSTRAINT acceptance_id_scope_v2_unique UNIQUE(id,scope_id);
-- league_configuration_versions(id,league_season_id) already exists in 016;
-- do not create it twice. Existing five-column role PK is retained unchanged.

-- S02 / RD06: acquisition authority does not grant serving authority.
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
 family text NOT NULL CHECK(family IN ('identity-lookup','league-list','league-candidate')),
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

-- S04 / RD05: final qualified association extension.
ALTER TABLE public.app_provider_account_links
 ADD COLUMN provider text,
 ADD COLUMN subject_lookup_capture_id uuid,
 ADD CONSTRAINT association_manager_provider_v2_fk
  FOREIGN KEY(source_manager_account_id,provider)
  REFERENCES public.league_source_manager_accounts(id,provider),
 ADD CONSTRAINT association_lookup_subject_v2_fk
  FOREIGN KEY(subject_lookup_capture_id,source_manager_account_id)
  REFERENCES public.provider_identity_evidence(lookup_capture_id,manager_id);
ALTER TABLE public.app_provider_account_links ALTER COLUMN provider SET NOT NULL;
-- Selected final invariant: provider NOT NULL, trusted manager-derived for old
-- rows. Transitional nullable addition/backfill/validation must be ordered in a
-- separately authorized migration. Target helpers reject NULL provider/lookup.
-- Old unqualified NULL lookup rows remain historical/unqualified, not new proof.
CREATE UNIQUE INDEX association_actor_provider_active_v2
 ON public.app_provider_account_links(app_user_id,provider) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX association_manager_active_v2
 ON public.app_provider_account_links(source_manager_account_id) WHERE revoked_at IS NULL;
-- Both global indexes require a conflict census and D03 activation policy first.
-- No automatic claimant selection, backdated lookup or old-row reactivation.

-- S05 / RD07: discovery is user private; list completion is scoped evidence.
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

-- S06 / RD09: connection authority events retain qualified adverse history.
ALTER TABLE public.league_source_connections
 ADD COLUMN authorization_generation bigint NOT NULL DEFAULT 1 CHECK(authorization_generation>0);
CREATE TABLE public.league_membership_authority_events (
 id uuid PRIMARY KEY,
 connection_id uuid NOT NULL REFERENCES public.league_source_connections(id),
 generation bigint NOT NULL CHECK(generation>0),
 event_kind text NOT NULL CHECK(event_kind IN
   ('baseline','manager-acceptance','mapping-change','qualification-change','serving-change')),
 mapping_revision_id uuid NOT NULL,
 acceptance_id uuid REFERENCES public.league_roster_resource_acceptances(id),
 policy_scope_id uuid,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(connection_id,generation),
 UNIQUE(generation,id),
 FOREIGN KEY(mapping_revision_id,connection_id)
  REFERENCES public.league_source_mapping_revisions(id,connection_id),
 FOREIGN KEY(policy_scope_id,connection_id)
  REFERENCES public.league_roster_resource_scopes(id,connection_id),
 CHECK((event_kind IN ('baseline','mapping-change') AND acceptance_id IS NULL AND policy_scope_id IS NULL)
    OR (event_kind='manager-acceptance' AND acceptance_id IS NOT NULL AND policy_scope_id IS NOT NULL)
    OR (event_kind IN ('qualification-change','serving-change') AND acceptance_id IS NULL AND policy_scope_id IS NOT NULL)),
 FOREIGN KEY(acceptance_id,policy_scope_id)
  REFERENCES public.league_roster_resource_acceptances(id,scope_id)
);
ALTER TABLE public.league_source_connections
 ADD CONSTRAINT connection_authority_current_v2_fk
 FOREIGN KEY(id,authorization_generation)
 REFERENCES public.league_membership_authority_events(connection_id,generation)
 DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.league_roster_resource_attempts
 ADD COLUMN reservation_authority_generation bigint,
 ADD COLUMN authority_event_id uuid,
 ADD CONSTRAINT roster_attempt_authority_pair_v2_ck
  CHECK((reservation_authority_generation IS NULL AND authority_event_id IS NULL)
     OR (reservation_authority_generation IS NOT NULL AND reservation_authority_generation>0 AND authority_event_id IS NOT NULL)),
 ADD CONSTRAINT roster_attempt_authority_event_v2_fk
  FOREIGN KEY(reservation_authority_generation,authority_event_id)
  REFERENCES public.league_membership_authority_events(generation,id);
-- Baselines are actual installation observations, never fabricated old removal.
-- Guard checks the event's connection/mapping against the attempt's exact scope.
-- NULL old attempt fence is readable historical evidence, never supersession proof.

-- S07 / RD10: renewal certificate before current selection avoids a fake predecessor.
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

-- S08 / RD12: absence is versioned; the existing follow row stays authoritative.
CREATE TABLE public.app_user_league_preference_tombstones (
 app_user_id uuid NOT NULL REFERENCES public.app_users(id),
 league_id uuid NOT NULL REFERENCES public.leagues(id),
 last_revision bigint NOT NULL CHECK(last_revision>0),
 ended_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(ended_at)),
 request_id uuid NOT NULL,
 PRIMARY KEY(app_user_id,league_id)
);
ALTER TABLE public.app_user_leagues
 ADD COLUMN carryover_renewal_id uuid REFERENCES public.app_league_renewals(id);
-- Current-row/tombstone exclusion is a guarded state transition under actor lock,
-- not two independent grants. Explicit follow consumes/removes the active
-- tombstone atomically after taking its revision; no caller gets tombstone DML.
-- Tombstone is mutable latest absence; audit preserves older changes.

-- S09 / RD13-14: existing versioned heads remain the sole acceptance heads.
CREATE TABLE public.league_resource_policy_qualifications (
 scope_id uuid PRIMARY KEY REFERENCES public.league_roster_resource_scopes(id),
 state text NOT NULL CHECK(state IN ('qualified','suspended')),
 revision bigint NOT NULL CHECK(revision>0),
 evidence_ref text NOT NULL CHECK(btrim(evidence_ref)<>'')
);
CREATE TABLE public.league_resource_serving_selections (
 logical_scope jsonb NOT NULL CHECK(jsonb_typeof(logical_scope)='object'),
 reader_contract text COLLATE "C" NOT NULL CHECK(btrim(reader_contract)<>''),
 connection_id uuid NOT NULL REFERENCES public.league_source_connections(id),
 selected_scope_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 PRIMARY KEY(logical_scope,reader_contract),
 FOREIGN KEY(selected_scope_id,connection_id)
  REFERENCES public.league_roster_resource_scopes(id,connection_id)
);
CREATE TABLE public.app_access_policy_binding (
 slot text PRIMARY KEY CHECK(slot='membership'),
 policy_version text NOT NULL CHECK(policy_version='sleeper-membership-access-v1'),
 revision bigint NOT NULL CHECK(revision>0)
);
CREATE TABLE public.attempt_failure_receipts (
 id uuid PRIMARY KEY,
 attempt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_resource_attempts(id),
 outcome text NOT NULL CHECK(outcome IN ('transport-failure','normalization-failed','rejected')),
 request_started_at timestamptz,
 request_completed_at timestamptz,
 normalized_at timestamptz,
 diagnostics jsonb NOT NULL CHECK(jsonb_typeof(diagnostics)='object'),
 CHECK(request_started_at IS NULL OR isfinite(request_started_at)),
 CHECK(request_completed_at IS NULL OR isfinite(request_completed_at)),
 CHECK(normalized_at IS NULL OR isfinite(normalized_at)),
 CHECK(request_completed_at IS NULL OR
       (request_started_at IS NOT NULL AND request_completed_at>=request_started_at)),
 CHECK(outcome<>'transport-failure' OR normalized_at IS NULL)
);
-- Attempt lock + outcome guard prohibits both successful and failure receipts
-- across the two physical tables. No dummy content/acceptance on failure.
-- Registry guard uses whole scope equality including explicit JSON nulls.
-- Current suspension/reversion never deletes an admitted adverse event.

-- S10 / RD08,15: reliable official facts do not need an analytics profile.
ALTER TABLE public.league_seasons ADD COLUMN official_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.league_seasons
 ALTER COLUMN scoring_profile_id DROP NOT NULL,
 ADD CONSTRAINT official_only_profile_v2_ck CHECK(scoring_profile_id IS NOT NULL OR official_only);
-- Final structure above requires the separately reviewed official-only consumer gate.
-- Existing nonnull scoring attachments and immutability trigger remain unchanged.
-- Unsupported official-only seasons are explicitly excluded from analytics
-- enumeration; never seed a dummy scoring profile or silently lose an official row.
CREATE TABLE public.league_configuration_analytics_applicability (
 id uuid PRIMARY KEY,
 league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
 configuration_version_id uuid NOT NULL,
 scoring_profile_id uuid NOT NULL REFERENCES public.scoring_profiles(id),
 assessment_version text NOT NULL CHECK(btrim(assessment_version)<>''),
 coverage jsonb NOT NULL CHECK(jsonb_typeof(coverage)='object'),
 accepted_ref uuid NOT NULL REFERENCES public.league_roster_resource_acceptances(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(league_season_id,configuration_version_id,scoring_profile_id,assessment_version),
 FOREIGN KEY(configuration_version_id,league_season_id)
  REFERENCES public.league_configuration_versions(id,league_season_id)
);
-- Existing configuration(id,season) composite FK proves same-season configuration.
-- Guard proves accepted_ref is exact settings evidence with compatible scope and
-- assessment, not merely any UUID from the acceptance table.

-- S11 / RD02 / ENG01: unchanged invitation policy, same-transaction auth fence.
CREATE TABLE website_auth.admission_epoch (
 slot smallint PRIMARY KEY CHECK(slot=1),
 revision bigint NOT NULL CHECK(revision>0),
 config_hash text NOT NULL CHECK(config_hash ~ '^[0-9a-f]{64}$'),
 issuer text COLLATE "C" NOT NULL CHECK(btrim(issuer)<>''),
 clock_domain text COLLATE "C" NOT NULL CHECK(btrim(clock_domain)<>''),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(activated_at))
);
-- Logical singleton key is empty; physical slot PK is retained for SQL.
-- Epoch update (not session contents) is operator-only under exclusive auth gate.
-- No table contains email digests, token digests, raw session tokens or receipts.
-- Existing pgcrypto extension is created by migration001:6; verify its qualified
-- digest function identity/extension schema in the catalog, never trust search_path.

-- Exact function declaration CONTRACT (implementation body is not supplied here):
-- public.lock_account_session_authority_v2(p_session_receipt jsonb)
-- RETURNS TABLE(session_expires_at timestamptz,
--               admission_epoch_revision bigint, db_sample_at timestamptz,
--               session_created_at timestamptz)
-- LANGUAGE plpgsql VOLATILE SECURITY DEFINER
-- SET search_path=pg_catalog,website_auth,public,pg_temp.
-- Owner: existing migration owner, never account/auth/runtime.
-- No arbitrary table/schema/function names, SQL text, URLs or submitted actor.
-- Receipt has exactly these nine keys, all strings:
-- sessionId,subject,expiresAt,issuer,admissionEpochRevision,configHash,clockDomain,
-- admittedEmailDigest,sessionTokenDigest.
-- Digests are lowercase64hex SHA256 of exact UTF8 persisted email/token values;
-- the server produces them only after successful existing Better Auth validation
-- and existing trim/lower invited-email check. No alternate SQL email policy.
-- The auth-only helper independently validates current emailVerified and digest
-- equality, full epoch identity, session subject/creation/expiry/token digest.
-- Each mandatory composition guard THEN binds active actor/exact login identity.
-- Own-association release requires final DB sample - actual session_created_at
-- between0 and300seconds inclusive at command admission (D03); the ordinary
-- command budget applies thereafter; a submitted timestamp is never proof.
-- It holds shared (19740517,1), epoch/user/session FOR SHARE in transaction B
-- before any domain locks. Those DB locks survive coordinator disconnection
-- while B continues and are released only with B commit/rollback.
-- All protected read/mutation helpers call it before touching account/domain rows.
-- Original two-transaction client-held overlap is superseded (see TX01/TX08).
-- Raw website_auth table privileges remain absent for account/runtime.

-- Auth BEFORE STATEMENT attachments (function algorithm guard G-AUTH below):
-- website_auth."user": INSERT OR UPDATE OR DELETE
-- website_auth.session: INSERT OR UPDATE OR DELETE
-- website_auth.admission_epoch: INSERT OR UPDATE OR DELETE
-- Each acquires exclusive advisory (19740517,1) BEFORE any row locks.
-- The session cascade from user deletion is already covered by the user guard.
-- Auth account/verification writes do not grant sessions; existing credential
-- rotation/admin routes affecting admission also take this gate before effects.
-- New security-relevant mutations must join this participation manifest.

-- S12 / RD06,RD16 / ENG02: accounting under existing acquisition/job owners.
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

-- S13: exact privilege/trigger specification (normative; no fake function bodies).
-- Security-definer functions are owned by the existing migration owner; roles
-- league_one_account, league_one_auth and league_one_runtime cannot own or assume
-- that owner, inherit its grants, create functions/schemas, or change search_path.
-- Every new function starts with PUBLIC execute revoked in its creation transaction.
-- Dynamic identifiers, caller-supplied SQL and broad schema/table grants prohibited.
-- pgcrypto digest is referenced by its catalog-verified extension-qualified name.

-- G-AUTH / function website_auth.guard_admission_authority_v2() RETURNS trigger:
-- BEFORE STATEMENT INSERT/UPDATE/DELETE on website_auth."user", session and
-- admission_epoch; acquire exclusive pg_advisory_xact_lock(19740517,1) first.
-- Registration/password/session owner entrypoints acquire that same gate before
-- any credential/session-affecting tuple lock. All direct supported DML covered.
-- Target live auth helper acquires SHARED same key before auth rows; all locks
-- belong to transaction B itself, not an outer coordinator transaction.

-- G-ACTOR / public.guard_account_session_statement_v2() RETURNS trigger:
-- Authenticated migration-owner sessions have a separate fixed-purpose operator
-- path: session_user OID must equal the catalog-pinned migration-owner role OID,
-- not a GUC, current actor ID or current_user changed by SECURITY DEFINER.
-- This trusted owner already has schema control; application roles cannot assume
-- it. Supported account disable/login revoke use the two helpers below. Guard
-- takes EXCLUSIVE auth gate then Actor/login for this role-authenticated branch;
-- it does not demand a browser session or permit a caller-set skip flag.
-- BEFORE STATEMENT INSERT/UPDATE/DELETE on app_provider_account_links and
-- app_user_leagues, and user-writable UPDATE on app_users.
-- Read the exact trusted transaction-local app.session_receipt_v2 JSON, reject
-- missing/malformed/extra keys, invoke auth-only lock_account_session_authority_v2
-- before row locks, then lock active actor and active exact issuer/subject login
-- in canonical order. Require actor matches the original server principal.
-- Never use a boolean "already authorized" GUC as a bypass. Existing RLS/audit
-- remains; target private writes use function-only entrypoints.
-- The existing resolve_app_login_identity(text,text,text,uuid) signature stays:
-- auth helper first; bind issuer/subject to receipt; special registration mutex
-- before any actor locks; then actor/login locks for an existing identity. A
-- newly allocated actor/login is owner-inserted and bound before return. Existing
-- actor-held paths may not call resolver (would reverse this order).
-- Read functions similarly invoke auth and actor binding even without DML.

-- G-ASSOCIATION / public.guard_provider_association_v2() RETURNS trigger:
-- BEFORE INSERT OR UPDATE app_provider_account_links. Lock stable manager in
-- TX02 order, derive provider from manager, reject reassignment or reactivation,
-- preserve actual revision/history. New target association requires same-subject
-- qualified lookup; NULL historical lookup never grants target access. Updated
-- legacy composition supplies the same evidence internally before D03 cutover.
-- Both partial unique indexes arbitrate concurrent active exclusivity.

-- G-PRE-ENROLLMENT / public.guard_provider_request_lineage_v2() RETURNS trigger:
-- BEFORE INSERT on provider_request_attempts, provider_capture_receipts,
-- provider_identity_evidence. Validate exact closed source contracts in
-- relational-design.md; requestId mutex + context/policy locks, immutable
-- request tuple and current qualified registry revision, scope/audience/provider
-- equality, actual job lease fence and purpose. Versions are pinned before HTTP.
-- Captures cannot fabricate normalization, verification or provider observation
-- time. Identity display values preserve exact Field<string> states. Success/
-- failure branches are exclusive; failed observed-none coverage is owner-derived.
-- Explicit type/range/member validation uses IS TRUE (SQL UNKNOWN never passes).
-- Qualifications are evidence-backed versions, not arbitrary future strings.

-- G-DISCOVERY / public.guard_discovery_state_v2() RETURNS trigger:
-- BEFORE INSERT/UPDATE on app_discovery_scans, app_discovery_scan_seasons,
-- app_discovery_candidates. Actor/association revision must match admitted work;
-- scan strategy/query set immutable; list/candidate capture provider, native
-- season/ID and query family must match; unknown/partial is never complete.
-- complete requires all nonempty required season rows and qualified complete
-- list captures; same scan cannot gain new required seasons after reservation.
-- finished_at is real DB completion/terminal failure time. Retryable failures
-- retain same unfinished continuation; new explicit refresh gets a new ID.

-- G-AUTHORITY / public.guard_membership_authority_v2() RETURNS trigger:
-- All scope qualification, manager acceptance, mapping and serving changes first
-- lock context/policy, stable league then connection FOR UPDATE in TX01 order.
-- Append exactly one correctly typed event per actual membership authority
-- change; bump connection generation atomically. Event mapping/scope/acceptance
-- must resolve to that same connection. Connection creation creates a real
-- baseline event in the same transaction under the stable-league lock.
-- Appended adverse evidence retains admission-time qualification; later current
-- registry suspension/head replacement cannot erase it. Attempts retain exact
-- current event/generation under the lock before HTTP. Existing mapping/head/
-- acceptance functions and trigger owners join this protocol, including direct
-- supported owner DML; no late row lock can replace the mandatory earlier gate.
-- Cross-version superset enumeration and causal supersession follow TX04.

-- G-SELECTION / public.guard_current_selection_v2() RETURNS trigger:
-- BEFORE INSERT/UPDATE on selections; BEFORE INSERT on immutable renewals.
-- Same actor/active association; capture and compare revisions; exact same
-- league, later successor, nonforked proved lineage and both mappings; fresh
-- compatible successor role and all adverse history. CAS initial absence or
-- expected current revision. A repeated proof ID with changed payload rejects;
-- committed old proof cannot restore a superseded selection.

-- G-FOLLOW / public.guard_follow_revision_v2() RETURNS trigger:
-- BEFORE INSERT/UPDATE/DELETE app_user_leagues, actor lock already held.
-- Explicit insert uses revision greater than existing tombstone; then consumes
-- active tombstone. DELETE writes new tombstone OLD.revision+1 atomically.
-- Carryover uses exact unchanged follow revision and renewal same actor/league;
-- never creates a follow from absence or over newer unfollow. Direct tombstone
-- DML and direct caller-supplied carryover/derived revisions are not granted.
-- D04 retained intent/qualification and D05 collection are specified in adopted
-- decisions, not deletion of source history or expansion of read authority.

-- G-AUDIT / extend public.audit_app_identity_change() RETURNS trigger:
-- Existing six subject mappings unchanged. Add app_current_league_selections:
-- subject_id=league_id, subject_user_id from exact association, metadata revision.
-- Add app_league_renewals: subject_id=id, user from association, metadata {}.
-- Add app_acquisition_demands: subject_id=id, subject_user_id=actor_user_id,
-- metadata {}; admitted NEW intent emits one INSERT event, an idempotent no-op
-- emits none. Worker progress is not a new user command event.
-- Actor must equal resolved owner. Request ID comes from trusted command context.
-- Existing ReadCommitted actor mutation lock and60 audited events/60seconds
-- remain. Renewal+selection counts2. Tombstone uses existing preference DELETE
-- event, no extra charge. Any audit/pending-work failure aborts the whole command.
-- Attach AFTER INSERT/UPDATE to selections; AFTER INSERT to renewals and demands.
-- Exact subject_type CHECK final enum adds only these3 subjects; replacement of
-- original CHECK is a separately reviewed migration operation, not executed here.

-- G-IMMUTABLE: existing prevent_league_administration_history_change() trigger
-- BEFORE UPDATE OR DELETE on provider_request_attempts, provider_capture_receipts,
-- provider_identity_evidence, league_membership_authority_events,
-- app_league_renewals, attempt_failure_receipts,
-- league_configuration_analytics_applicability.
-- Mutable policy qualifiers change only state/revision/proof under their owner;
-- identity tuples cannot be rewritten. Demands allow only monotonic state/time
-- transitions, not actor/command/scope/job reassignment. Permit charged identity,
-- policy/lane/hash/grant/dispatch/occupied times immutable; completion set once.

-- G-POLICY / public.guard_resource_policy_binding_v2() RETURNS trigger:
-- BEFORE INSERT/UPDATE on pre-enrollment and enrolled qualifiers, serving
-- bindings and access policy. Correct immutable version/identity; revision+1;
-- exact whole logical scope equals selected scope excluding policy only; selected
-- policy qualified with compatible evidence. Lock order and authority event above
-- apply. No implicit newest-version preference. D02 remains exactly3600seconds.
-- Qualification/evidence_ref registry entries are operator-approved metadata,
-- not privilege granted to account/runtime to self-qualify an interpretation.

-- Row-level security: ENABLE on app_discovery_scans, app_discovery_scan_seasons,
-- app_discovery_candidates, app_current_league_selections, app_league_renewals,
-- app_user_league_preference_tombstones, app_acquisition_demands.
-- Account SELECT policies (if granted) resolve actual association -> current actor;
-- child scan policies join scan -> association -> actor. Tombstone compares
-- app_user_id, demand compares actor_user_id. No caller-submitted actor shortcut.
-- New private tables have no runtime/auth/PUBLIC read or write grants. Function
-- owners must explicitly scope every access; do not assume definer obeys RLS.

REVOKE ALL ON website_auth.admission_epoch FROM PUBLIC,league_one_account,league_one_runtime,league_one_auth;
REVOKE ALL ON public.provider_access_contexts,public.provider_request_policy_qualifications,
 public.provider_request_attempts,public.provider_capture_receipts,
 public.provider_identity_evidence,public.app_discovery_scans,
 public.app_discovery_scan_seasons,public.app_discovery_candidates,
 public.league_membership_authority_events,public.app_league_renewals,
 public.app_current_league_selections,public.app_user_league_preference_tombstones,
 public.league_resource_policy_qualifications,public.league_resource_serving_selections,
 public.app_access_policy_binding,public.attempt_failure_receipts,
 public.league_configuration_analytics_applicability,public.provider_request_gates,
 public.provider_request_lane_limits,public.app_acquisition_demands,
 public.provider_http_permits
 FROM PUBLIC,league_one_account,league_one_auth,league_one_runtime;

-- Exact EXECUTE allowlist; created functions must exist before any eventual GRANT:
-- league_one_auth:
-- website_auth.read_admission_epoch_locked_v1(text,text)
-- league_one_account:
-- public.lock_account_session_authority_v2(jsonb)
-- public.read_account_current_roster_v2(uuid,text,jsonb)
-- public.activate_provider_account_v2(uuid,uuid,bigint,uuid,jsonb)
-- public.select_account_league_season_v2(jsonb,jsonb)
-- existing current_app_actor() and resolve_app_login_identity(text,text,text,uuid)
-- remain in exact manifest, with selected same-transaction guards.
-- league_one_runtime / existing administration dispatcher only:
-- public.begin_provider_request_v2(jsonb), public.record_provider_capture_v2(jsonb)
-- Preserve existing current-roster/mapping/settings worker helper allowlists.
-- Account additionally:
-- public.admit_account_acquisition_v1(jsonb,jsonb)
-- public.read_account_acquisition_v1(uuid,jsonb)
-- Runtime additionally:
-- public.claim_account_acquisition_v1(text)
-- public.reserve_provider_http_v1(jsonb)
-- public.finish_provider_http_v1(uuid,text,integer)
-- Exact closed input/output unions and ordered algorithms:
-- acquisition-admission-design.md. Demand reads use fresh same-transaction auth
-- plus actor binding; they never reuse an old serving allow. Worker claim holds
-- provider gate then demand/job only (no domain locks); reserve later acquires
-- actor/association/context/policy/domain first, then provider gate. Neither
-- claiming nor queued intent proves a current user session or authorizes serving.
-- Trigger functions are not callable by application roles directly.
-- No new table DML, broad function grant, raw website_auth USAGE or SELECT, worker
-- private-row read, account shared-row write, or caller-assumable owner role.
-- Provision-account-role.sql, provision-auth-role.sql, actual runtime owner
-- manifest and ACCOUNT_DATABASE_GUARD must explicitly adopt these exact deltas;
-- their current restrictive checks correctly reject unreviewed new objects.

-- Structural additions above still require independently executed G6 evidence:
-- exact catalog/table/column/FK/index/trigger/function/ACL checks; wrong-scope and
-- NULL tests; dump/restore and legacy fixture upgrade; lock-order deadlocks;
-- timeout/coordinator-death unknown-commit schedules; RLS/definer adversarial
-- callers; immutable-history tampering; cold discovery and real provider groups.
-- G7 rollout: D03 conflict census, auth epoch config binding, official-only
-- consumer gate, all actual HTTP-start owners instrumented, selected capacity
-- qualification and reversible feature enablement. No production action here.

-- S14: retained work identity, compaction and exact typed results.
-- Historical job_key/attempt_count/lease values are captured certificates, not
-- permanent FKs to projection_jobs; live use always checks actual row/lease.
-- This deliberate no-FK boundary preserves existing job cleanup. Keys are never
-- interpreted as proof of a currently live job merely because evidence retains them.
-- app_acquisition_demands.result_ref is exactly NULL or:
-- {"kind":"identity","captureId":UUID},
-- {"kind":"discovery","scanId":UUID}, {"kind":"recovery","status":"complete"}.
-- Writer validates matching typed referenced capture/scan and actor/scope; null
-- pending/progress does not fabricate an unavailable completed result.
-- After terminal_at+30days a guarded maintenance owner may null scope/result_ref
-- only; preserve actor,commandId,command_input_hash,scope_hash,state/outcome,
-- terminal_at and identity for actor lifetime. Old compact retry returns terminal
-- unavailable/demand_expired, never new work. Before compaction verify no live
-- work/capture acceptance still requires the detail; no automatic history purge.
-- Permit charge retention >=24h and never a live/quarantined charge. Closed
-- demand compaction and referenced source-evidence retention are distinct rules.
-- Existing job payload is EXACTLY {"demandId":UUID}; it contains no actor/session/
-- digest/source output. The guard owner resolves bounded purpose/fences internally.

-- S15: concrete row-security policy declarations (no additional SELECT grants).
ALTER TABLE public.app_discovery_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_discovery_scan_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_discovery_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_current_league_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_league_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_league_preference_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_acquisition_demands ENABLE ROW LEVEL SECURITY;
CREATE POLICY discovery_scan_actor_v2 ON public.app_discovery_scans FOR SELECT TO league_one_account
 USING(EXISTS(SELECT 1 FROM public.app_provider_account_links a
  WHERE a.id=association_id AND a.app_user_id=public.current_app_actor()));
CREATE POLICY discovery_season_actor_v2 ON public.app_discovery_scan_seasons FOR SELECT TO league_one_account
 USING(EXISTS(SELECT 1 FROM public.app_discovery_scans s JOIN public.app_provider_account_links a ON a.id=s.association_id
  WHERE s.id=scan_id AND a.app_user_id=public.current_app_actor()));
CREATE POLICY discovery_candidate_actor_v2 ON public.app_discovery_candidates FOR SELECT TO league_one_account
 USING(EXISTS(SELECT 1 FROM public.app_discovery_scans s JOIN public.app_provider_account_links a ON a.id=s.association_id
  WHERE s.id=scan_id AND a.app_user_id=public.current_app_actor()));
CREATE POLICY current_selection_actor_v2 ON public.app_current_league_selections FOR SELECT TO league_one_account
 USING(EXISTS(SELECT 1 FROM public.app_provider_account_links a
  WHERE a.id=association_id AND a.app_user_id=public.current_app_actor()));
CREATE POLICY renewal_actor_v2 ON public.app_league_renewals FOR SELECT TO league_one_account
 USING(EXISTS(SELECT 1 FROM public.app_provider_account_links a
  WHERE a.id=association_id AND a.app_user_id=public.current_app_actor()));
CREATE POLICY preference_absence_actor_v2 ON public.app_user_league_preference_tombstones FOR SELECT TO league_one_account
 USING(app_user_id=public.current_app_actor());
CREATE POLICY acquisition_demand_actor_v2 ON public.app_acquisition_demands FOR SELECT TO league_one_account
 USING(actor_user_id=public.current_app_actor());
-- New private reads remain function-only; these policies are defense in depth
-- and are not a substitute for actor-scoped definer predicates.

-- S16: exact helper grants (bodies must be implemented/qualified beforehand).
REVOKE ALL ON FUNCTION
 public.lock_account_session_authority_v2(jsonb),
 public.read_account_current_roster_v2(uuid,text,jsonb),
 public.activate_provider_account_v2(uuid,uuid,bigint,uuid,jsonb),
 public.select_account_league_season_v2(jsonb,jsonb),
 public.admit_account_acquisition_v1(jsonb,jsonb),
 public.read_account_acquisition_v1(uuid,jsonb),
 public.claim_account_acquisition_v1(text),
 public.reserve_provider_http_v1(jsonb),
 public.finish_provider_http_v1(uuid,text,integer),
 public.begin_provider_request_v2(jsonb),
 public.record_provider_capture_v2(jsonb),
 website_auth.read_admission_epoch_locked_v1(text,text)
 FROM PUBLIC,league_one_account,league_one_auth,league_one_runtime;
GRANT EXECUTE ON FUNCTION
 public.lock_account_session_authority_v2(jsonb),
 public.read_account_current_roster_v2(uuid,text,jsonb),
 public.activate_provider_account_v2(uuid,uuid,bigint,uuid,jsonb),
 public.select_account_league_season_v2(jsonb,jsonb),
 public.admit_account_acquisition_v1(jsonb,jsonb),
 public.read_account_acquisition_v1(uuid,jsonb) TO league_one_account;
GRANT EXECUTE ON FUNCTION
 public.claim_account_acquisition_v1(text),
 public.reserve_provider_http_v1(jsonb),
 public.finish_provider_http_v1(uuid,text,integer),
 public.begin_provider_request_v2(jsonb),
 public.record_provider_capture_v2(jsonb) TO league_one_runtime;
GRANT EXECUTE ON FUNCTION website_auth.read_admission_epoch_locked_v1(text,text) TO league_one_auth;
-- Existing narrow helpers remain only in their existing exact grants. Creating
-- and revoking/granting each future function occurs in one migration transaction;
-- production never sees the default PUBLIC EXECUTE interval.

-- S17: exact trigger attachments for new relations.
-- Function implementations must exist and be independently reviewed first.
CREATE TRIGGER provider_attempt_immutable_v2 BEFORE UPDATE OR DELETE ON public.provider_request_attempts
 FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER provider_capture_immutable_v2 BEFORE UPDATE OR DELETE ON public.provider_capture_receipts
 FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER provider_identity_immutable_v2 BEFORE UPDATE OR DELETE ON public.provider_identity_evidence
 FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER authority_event_immutable_v2 BEFORE UPDATE OR DELETE ON public.league_membership_authority_events
 FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER renewal_immutable_v2 BEFORE UPDATE OR DELETE ON public.app_league_renewals
 FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER failure_receipt_immutable_v2 BEFORE UPDATE OR DELETE ON public.attempt_failure_receipts
 FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER analytics_applicability_immutable_v2 BEFORE UPDATE OR DELETE ON public.league_configuration_analytics_applicability
 FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER auth_user_gate_v2 BEFORE INSERT OR UPDATE OR DELETE ON website_auth."user"
 FOR EACH STATEMENT EXECUTE FUNCTION website_auth.guard_admission_authority_v2();
CREATE TRIGGER auth_session_gate_v2 BEFORE INSERT OR UPDATE OR DELETE ON website_auth.session
 FOR EACH STATEMENT EXECUTE FUNCTION website_auth.guard_admission_authority_v2();
CREATE TRIGGER auth_epoch_gate_v2 BEFORE INSERT OR UPDATE OR DELETE ON website_auth.admission_epoch
 FOR EACH STATEMENT EXECUTE FUNCTION website_auth.guard_admission_authority_v2();
CREATE TRIGGER account_association_session_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.app_provider_account_links
 FOR EACH STATEMENT EXECUTE FUNCTION public.guard_account_session_statement_v2();
CREATE TRIGGER account_preference_session_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.app_user_leagues
 FOR EACH STATEMENT EXECUTE FUNCTION public.guard_account_session_statement_v2();
CREATE TRIGGER account_profile_session_v2 BEFORE UPDATE ON public.app_users
 FOR EACH STATEMENT EXECUTE FUNCTION public.guard_account_session_statement_v2();
CREATE TRIGGER current_selection_audit_v2 AFTER INSERT OR UPDATE ON public.app_current_league_selections
 FOR EACH ROW EXECUTE FUNCTION public.audit_app_identity_change();
CREATE TRIGGER renewal_audit_v2 AFTER INSERT ON public.app_league_renewals
 FOR EACH ROW EXECUTE FUNCTION public.audit_app_identity_change();
CREATE TRIGGER acquisition_demand_audit_v2 AFTER INSERT ON public.app_acquisition_demands
 FOR EACH ROW EXECUTE FUNCTION public.audit_app_identity_change();
-- The other named cross-row guards attach at the exact table/event timing
-- enumerated in S13; deferred cyclic authority FK is not replaced by a trigger.

-- Import DRR cursor0..2 persists on provider gate across grants: future preparation,
-- historical import and target discovery, quantum1. Empty groups skip; a grant
-- advances cursor atomically. Lane remains the same15 total; never3x15 capacity.
-- finish_provider_http_v1 Retry-After -1 means malformed/unrepresentable/>86400:
-- latch circuit, never silently shorten. A late429/503 may tighten shared
-- cooldown after job lease expiry but cannot accept source data or reclaim a
-- slot/freshness grant. Completion identity must match the originally granted
-- permit; all lease-sensitive data acceptance still rechecks the current lease.

-- S18: purpose-specific operator revocation (preserved trusted owner boundary).
-- public.disable_app_actor_v1(p_actor_id uuid,p_request_id uuid) RETURNS boolean
-- public.revoke_app_login_identity_v1(p_login_identity_id uuid,p_request_id uuid)
-- RETURNS boolean. Both VOLATILE SECURITY DEFINER, existing migration owner,
-- fixed pg_catalog,public,website_auth,pg_temp search_path; no dynamic target SQL.
-- Require session_user OID equals the catalog-pinned migration-owner role OID.
-- Never grant application/auth/runtime execute or owner-role membership.
-- Validate UUIDs; save then clear app.actor_user_id and set trusted request_id for existing
-- operator-kind audit. Acquire exclusive auth gate before any tuple lock.
-- Disable: target Actor FOR UPDATE then associated login rows ordered byUUID;
-- change active todisabled only. No reenable/delete/association displacement.
-- Revoke: resolve immutable login->actor without taking login lock; lock Actor
-- then login FOR UPDATE, reread exact ownership, set revoked_at actual DB time
-- only when previously NULL. Neither helper accepts arbitrary patch columns.
-- Return true for actual change or already-disabled/revoked exact repeat without
-- duplicate audit; missing/deleted invalid target returns false. Restore prior
-- scoped actor/request context on completion; any required audit failure rolls
-- back the operation and scoped context. Unknown commit is reconciled by repeat.
-- Current supported operator direct maintenance inherits the same explicit role
-- guard and order; schema-owner ability to disable guards is an inherent trusted
-- administration boundary, not protection against a compromised migration owner.

-- Login INSERT is authenticated resolver bootstrap: BEFORE STATEMENT auth-only
-- guard acquires the SAME shared gate/rows already held by resolver, never an
-- exclusive upgrade. BEFORE ROW binds NEW issuer/subject to exact receipt and
-- NEW app_user_id to the locked existing/new Actor; an existing login is not
-- required before its insertion. No generic bootstrap GUC skips these checks.
-- UPDATE/DELETE use the owner-only exclusive auth/Actor/login branch.
CREATE TRIGGER login_insert_session_v2 BEFORE INSERT ON public.app_login_identities
 FOR EACH STATEMENT EXECUTE FUNCTION public.guard_login_insert_authority_v2();
CREATE TRIGGER login_insert_binding_v2 BEFORE INSERT ON public.app_login_identities
 FOR EACH ROW EXECUTE FUNCTION public.guard_login_insert_binding_v2();
CREATE TRIGGER login_mutation_operator_v2 BEFORE UPDATE OR DELETE ON public.app_login_identities
 FOR EACH STATEMENT EXECUTE FUNCTION public.guard_account_session_statement_v2();
REVOKE ALL ON FUNCTION public.disable_app_actor_v1(uuid,uuid),
 public.revoke_app_login_identity_v1(uuid,uuid)
 FROM PUBLIC,league_one_account,league_one_auth,league_one_runtime;
-- Only implicit owner execution remains, additionally session_user-authenticated.

-- S19: exact immutable retry origin and bounded feedback refinement.
-- request_context is PermitRequestContext from acquisition-admission-design.md:
-- version=sleeper-permit-context-v1; origin is closed target|existing, omitting
-- transport requestId; resolved has accessContextId,accessRevision,audienceId,
-- connectionId,sourceMappingRevisionId (connection/mapping both null or both set).
-- Source is exactly pre-enrollment(attemptId,policyQualificationId,policyRevision)
-- or enrolled(attemptId,scopeId,policyRevision), matching the actual attempt table.
-- Null source is permitted only for a registered unpersisted existing read.
-- Target origin includes demandId,source,fence,endpoint; existing origin includes
-- endpoint,purpose,connectionId,source,fence. No session/token/email digest or
-- raw provider result is stored. Helper validators reject all extra properties.
-- A retry resolves endpoint/actor/context from this immutable certificate and
-- revalidates current authority, mapping and policy. Persisted-source retries
-- require a newly reserved source attempt under the same logical request/scope;
-- an already failed immutable attempt is never reused. The new permit captures
-- that fresh source/fence after equality checks. A hash alone is not replay data.
-- Completion fields are owner-guarded. An unknown local completion may refine
-- once to an observed HTTP outcome; preserve completed_at,grant/deadline/charge,
-- set response_observed_at=trusted DB time and tighten cooldown if applicable.
-- Conflicting second observed outcomes refuse. Count429 events by their actual
-- response_observed_at over10 minutes, including late responses, never granted_at
-- or original completed_at. Retain charges/feedback at least24h and while live.
-- Late response feedback never accepts source data, renews authority or grants
-- another dispatch. Unknown remote execution remains unknown.
-- Command idempotency: joined means only exact actor+commandId replay. A new
-- commandId with the same unfinished semantic scope returns limited and creates
-- no command/audit/job; it may later retry as a previously unaccepted command.
-- This avoids an unrecorded alias that could enqueue fresh work on old replay.

# First-slice behavior and security design

Selected G2/G4/G5 behavior and changed-surface security design for internal Sleeper identification, exclusive associations, current teams and stored reads, with transaction-bound command authority and shared acquisition admission. D03-D05 are selected in backend-decisions.md. No implementation, applied migration, live grant, provider call or deployment is claimed.

Status: `selected_design_not_implemented`. This register refines [README](README.md), [contracts](contracts.md) and [foundation](foundation.json). [Acquisition admission](acquisition-admission-design.md) selects the same-B authority and shared-provider control mechanisms; [backend decisions](backend-decisions.md) selects D03-D05. Every runtime oracle remains specified, not executed.

## Context and ownership

| ID | Existing owner | Authority | Limit |
| --- | --- | --- | --- |
| BS-AUTH | Existing auth owner | Validate cookie with Better Auth; session/user/admission; auth role only. | No league/source rows; no provider-account ownership assertion. |
| BS-ACCOUNT | Existing account service and restricted account writer | Trusted actor, exclusive association, own preferences/current selections and target response composition. | No raw source or auth-table grants; cannot write shared evidence. |
| BS-ADMIN | Existing administration adapter/normalizer/acceptance writer | Qualified source identities, captured evidence, per-resource acceptance and membership authority generation. | No impersonated L1 session; ingestion permission alone cannot authorize a user's read. |
| BS-WORK | Existing scheduler/jobs/leases | Existing jobs/leases/continuous worker ownership, shared provider request admission and recovery; exact budget and account-to-worker interfaces in acquisition-admission-design.md. | No alternate collector; no target browser Tank01 call. |
| BS-READER | Existing stored resource readers and account presenter | Read accepted immutable references and serialize exact allowed variant. | No network acquisition while reading; no reuse of a cached allow. |
| BS-OPS | Existing operator/release responsibility | Reviewed provisioning, active configuration epoch and diagnostic handling. | No user-triggered privileged takeover; production action requires release authority. |

| Boundary | From | To | Rule |
| --- | --- | --- | --- |
| BS-B01 | Untrusted caller | BS-AUTH / BS-ACCOUNT | Inputs select an operation; never actor, issuer, session, audience, generation, policy, owner or entitlement. Unknown extra authority fields rejected. |
| BS-B02 | BS-AUTH | BS-ACCOUNT | Ephemeral nine-field AuthReceiptV2 from maintained server cookie validation, with exact token/email digests and admission configuration; account B revalidates actual auth rows inside its own transaction through the narrow owner helper. No raw auth-table grant. |
| BS-B03 | BS-ACCOUNT | BS-ADMIN / BS-WORK | Bounded server-resolved work demand; no raw source mutation. A source fetch uses independent acquisition authority, including after membership expiry. |
| BS-B04 | Sleeper network / retained captures | BS-ADMIN | Source payload is untrusted data; validate exact scope, coverage, identity, timing and policy. Public source identity is not control of that account. |
| BS-B05 | Stored evidence / private cache | BS-READER | Exact audience and immutable references; complete final authorization on every delivery. Shared public evidence does not share private association/follow/session data. |
| BS-B06 | Application services | Diagnostics / operator | Safe enums and correlation only; no cookie/session token, raw payload, email, submitted username or competing actor identity. The companion operations design owns storage/retention/response. |
| BS-B07 | Restricted account/auth role | Owner-controlled fixed-signature guard helpers | Explicit target privilege surface: only allowlisted helper EXECUTE; fixed search_path, fully qualified objects, typed request scope, no dynamic SQL or arbitrary relation/row keys, no PUBLIC EXECUTE, no direct source UPDATE or cross-schema auth grants. Deployment role-manifest checker must recognize exactly these additions; current provisioning forbids unlisted SECURITY DEFINER calls. Exact acquisition and auth guard signatures are additionally fixed in acquisition-admission-design.md; no broad function-prefix allowlist. |

Source allocation:

| Source | Design input |
| --- | --- |
| apps/site/lib/accounts/auth.ts | Maintained getSession; cookie cache and refresh disabled; verified subject/admission; current principal omits session receipt. |
| apps/site/lib/accounts/auth-runtime.ts | Auth credential/session mutation transaction uses advisory lock (19740517,1); target extends guard coverage without replacing Better Auth. |
| apps/site/lib/accounts/neon/database.ts | Transaction-local actor/request context; ReadCommitted; 3000ms lock and 8000ms per-statement limits; one noninteractive Neon HTTP batch with 12000ms fetch timeout. Transport abort is not evidence of server rollback or of another connection retaining its locks. |
| docs/account-foundation-database.md | Account/auth/worker roles separate; actor credential is trusted; account mutation audit 60 events per rolling 60 seconds; source/raw writes forbidden. |
| docs/account-auth-foundation.md | Existing auth owner, invitation/verification, origin/body controls and preview-disabled behavior retained. |
| contracts.md | D02, exact denial shape, adverse-evidence dominance, independent account access and D03-D05 gates. |
| apps/site/scripts/provision-auth-role.sql | Lines 67-68 grant user/session UPDATE and other maintained auth access; exact five-table manifest must adapt for the new epoch/helper, preserving isolation. |
| apps/site/lib/accounts/http.ts | Lines 165-188 resolve principal and actor before store.mutate; no final live-session receipt or auth guard spans the mutation in current source. |
| apps/site/lib/sleeper.ts | fetchJson emits provider telemetry and applies local timeout/cache behavior; no demonstrated cross-invocation per-actor/global acquisition admission. |
| apps/site/lib/provider-request-telemetry.ts | HTTP-start telemetry observes calls and explicitly does not change provider/cache/worker behavior; it is not a request limiter. |
| apps/site/migrations/020_account_foundation.sql | Existing audit CHECK and triggers cover six old subject types only. New selection/renewal rows require an explicit adapter into the unchanged 60 events per 60 seconds audit/rate boundary. |

## State model and sequences

| Dimension | States | Rule |
| --- | --- | --- |
| association | absent; pending; active; ended | Ended association never reactivates; explicit later claim creates new identity after qualification. |
| discovery_scan | not_started; pending; partial; complete; failed | Scan completeness means the declared finite strategy query set completed with qualified account-list evidence. It does not assert role or current-selection completeness. |
| current_teams_result | pending; partial; complete; unavailable | Complete current teams additionally require qualified candidate identity, roster/role evidence and resolved current selections for the declared scope. A complete scan may still have a partial current-team result. |
| membership | unknown; positive; expired; removed | Expired is computed from trusted time, not persisted removal; removal requires exhaustive role evidence. |
| selection | unresolved; selected; renewal_pending | Independent per association/stable league; highest year is not a transition. |
| follow | absent; following; not_following | Explicit intention is independent of effective demand/access. Loss, expiry or disconnect suspends effectiveness without rewriting intention; fresh eligibility resumes only the latest intention. D04/D05 govern recovery and zero-demand collection. |
| delivery | available; pending; unavailable; denied; indeterminate | denied/indeterminate contain only status and safe reason. |

| Sequence | Scenario | Transitions | Outcome |
| --- | --- | --- | --- |
| BS-S01 | First claim to current roster | BS-T01; BS-T02; BS-T03; BS-T04; BS-T05; BS-T06 | Only qualified positive current roles produce protected delivery; lookup/discovery alone never creates follow or authorization. |
| BS-S02 | Outage and strict expiry recovery | BS-T06; BS-T07; BS-T10; BS-T04; BS-T11; BS-T06 | At T+3600 target data denies; independent bounded acquisition can restore a qualified positive age, while L1 sign-in continues. |
| BS-S03 | Removal or disconnect | BS-T08; BS-T06; BS-T09; BS-T06 | Removal fences all version heads; ended association denies without deleting shared data or changing L1 lifecycle. |
| BS-S04 | Renewal racing explicit unfollow | BS-T12; BS-T13; BS-T06 | Selection follows proved annual continuity per stable league; newer unfollow survives the race and discovery does not re-create it. |
| BS-S05 | Version promotion, remap and crash | BS-T15; BS-T16; BS-T18; BS-T06 | Guards/generations reject stale candidate references; accepted evidence and durable pending work are atomic; replay never refreshes T. |

## BS-P01 Guarded final stored delivery

1. Resolve the exact request through maintained Better Auth with cookie cache and refresh disabled. Compose protected candidate data privately; this preliminary validation is not reusable permission. The trusted bridge constructs nine-field AuthReceiptV2 as specified in acquisition-admission-design.md; no client/cache/job may supply it.

2. Account transaction B itself calls public.lock_account_session_authority_v2. The migration-owned SECURITY DEFINER function acquires shared transaction advisory lock(19740517,1), then admission epoch FOR SHARE, user FOR SHARE and session FOR SHARE. It validates the closed receipt; exact epoch/config/issuer/database-clock identity; session id/userId/expiry; current emailVerified; and equality to SHA256(convert_to(current email or token,UTF8)). PostgreSQL pgcrypto is already requested by migration001; qualification verifies actual extension schema and fully qualifies digest/convert_to/encode functions. No raw auth row or token is returned.

3. After B acquires its own auth gate/epoch/user/session locks, lock Actor, login identity, ProviderAccount identity, Association; typed command/request-ID mutex as needed; provider policy/access; stable League then SourceConnection; CurrentSelection, Follow and ServingSelection, in canonical order within each class. Validate exact actor/login/receipt binding. Existing fixed-signature read/lock composition acquires necessary source locks internally without broad source UPDATE or raw auth grants. Registration alone has a mutex class between auth and Actor, and cannot be entered while holding Actor.

4. Reread the complete dependency vector and immutable adverse removals qualified when admitted across relevant versions, independent of current head/qualification/suspension. Unknown adverse validity remains fail closed until proved resolution. Connection creators lock stable League first; membership/remap/qualification/serving writers use the same connection fence and advance authorization_generation, preventing insertion phantoms.

5. After all locks and slow work, final SQL samples clock_timestamp once and checks the exact live session/actor/association/context/policy, now<T+3600 and every earlier deadline plus the full adverse set. This is the logical decision/mutation point; B retains its actual auth/domain locks through its own commit or rollback. Auth revocation before B guard is observed; later revocation waits. Time passage is not frozen, so protected output also requires the final response-lifetime check.

6. After confirmed B commit, validate the exact server-only result/timing envelope. Anchor monotonic time immediately before final SQL; deduct ceil elapsed through commit from DB-computed floor remaining lifetime and require positive lifetime/request budget before synchronous serialization with no intervening await. Serialize only result. Unknown commit/transport/expiry suppresses protected output; an already committed mutation is not falsely reported as rolled back. No asynchronous provider work or reusable cached permission at this boundary.

**ordering.** B auth advisory gate -> admission epoch -> exact auth user/session -> registration mutex only for bootstrap -> Actor -> login identity -> ProviderAccount identity -> Association -> immutable command/request mutex -> policy/access -> stable League -> SourceConnection -> CurrentSelection -> Follow -> ServingSelection -> provider request gate -> demand/job/permit. Omit irrelevant classes; canonical key order within classes. Source-only writers start at their first required class and never acquire earlier classes afterward. Worker queue claim/completion may take only provider gate then demand/job; later dispatch is a separate transaction reentering the full applicable order. All direct auth mutators acquire exclusive auth gate BEFORE tuple locks; account DML guards acquire shared auth before Actor. Source-connection creators fence the parent League before insert.

**retry.** No automatic retry within a final-read request. Conflict, lock timeout, expired budget, unavailable authority or serialization failure discards composed protected data and returns indeterminate, except proved revocation/expiry returns denied. A later ordinary request evaluates from scratch. Explicit commands may retry the same idempotency identity; no freshness is inherited from failed attempts.

**bounds.** Existing account lock3000ms/statement8000ms/overall12000ms remain maxima; no stacked waits or automatic per-request retries. Provider transport has its separately selected5000ms deadline. HTTP cancellation is not database rollback proof. B server-owned auth locks survive a lost coordinator until B itself ends; SQL/connection limits and unknown-outcome reconciliation remain required. Acquisition permit accounting and quarantine are specified separately.

**configuration.** Target persisted admission epoch is changed only under exclusive auth gate. Handler config hash must match active epoch; old deployment/config denies instead of overriding it. No claim of global consistency among unrelated databases or unguarded operators. Mismatched environment/database identities fail before transaction entry. Distinct credentials must resolve the same intended Neon database/clock domain; current production configuration has not been proved by this design.

**proof.** AA-P01/P02 and BS-O05/O07/O13 specify the coordinator-loss and authority-change proofs. The selected same-B protocol resolves the previous architectural gap; actual helper/trigger/catalog and injected runtime schedules remain G6/G7 qualification, not executed evidence.

**trustedReceipt.** AuthReceiptV2 is exactly the prior seven fields sessionId,subject,expiresAt,issuer,admissionEpochRevision,configHash,clockDomain plus admittedEmailDigest and sessionTokenDigest. Both digests are lowercase64hex SHA256 of the exact UTF8 bytes of returned user.email and session.token respectively, with no trimming, case folding or normalization before hashing. The bridge first applies the existing invitedEmails/emailVerified policy unchanged. Treat token digest and the entire receipt as sensitive authority material: ephemeral server memory/transaction parameter only, never public output/log/cache/job/audit metadata. Matching admittedEmailDigest plus unchanged admission config binds the current user to the same invitation decision made by the trusted bridge. Matching sessionTokenDigest prevents a recreated session ID with a different token from reusing the receipt. Missing/replaced/expired session, changed email, failed verification or changed admission epoch refuses. Hash comparison supplements maintained cookie validation; a digest is not a new bearer authentication protocol. Compromised trusted server/account credentials remain outside this guarantee.

**returnBoundary.** The account read helper returns exactly {result:ReadCurrentRosterResult, decisionTiming:{dbSampleAt,minimumAuthorityExpiresAt,remainingLifetimeMs}|null}. decisionTiming is required and non-null for available/pending/unavailable, because all three contain protected selection fields and require a successful allow. It is null for denied/indeterminate. The trusted bridge checks the conservative lifetime receipt specified in TX01 after B commit, then serializes only result. Never add the timing receipt to a public DTO, cache it as permission or retain it for another request. Extra envelope/receipt/result keys reject. Invalid timing discards protected content and produces an exact safe result.

### Exact privileged adapters

| ID | Exact signature | Caller | Restriction |
| --- | --- | --- | --- |
| BS-H01 | website_auth.read_admission_epoch_locked_v1(p_expected_hash text,p_expected_issuer text) RETURNS TABLE(revision bigint,config_hash text,issuer text,clock_domain text) | league_one_auth only | After shared advisory gate, helper locks epoch FOR SHARE and compares expected configuration. Existing auth role has UPDATE privilege for direct user/session row locks; epoch manifest/helper additions are explicit target provisioning. |
| BS-H02 | public.read_account_current_roster_v2(p_league_id uuid,p_reader_contract text,p_session_receipt jsonb) RETURNS jsonb | Restricted account role only | Fixed read/lock composition; strict receipt shape from trusted bridge, current_app_actor and exact login/association scope. Lock required source authorities without granting direct UPDATE. Return the closed server-only {result,decisionTiming} envelope; only result is eligible for public serialization. No arbitrary relation or projection. |
| BS-H03 | public.activate_provider_account_v2(p_provider_account_id uuid,p_lookup_capture_id uuid,p_expected_actor_revision bigint,p_request_id uuid,p_session_receipt jsonb) RETURNS jsonb | Restricted account role only | Same-B auth guard and actor/login/request binding, exact nine-field receipt, own subject lookup and both exclusive constraints; audit/idempotency and closed ActivationHelperResult. Strip timing before public result; no implicit reassignment/control proof. |
| BS-H04 | public.select_account_league_season_v2(p_transition jsonb,p_session_receipt jsonb) RETURNS jsonb | Restricted account role only | Same-B auth plus actor/login, closed transition/receipt, mapping/selection/follow CAS and explicit audit/rate participation. Closed SelectionHelperResult; no arbitrary SQL or stale preference resurrection. |
| BS-H05 | public.begin_provider_request_v2(p_input jsonb) RETURNS jsonb | Existing runtime/job owner only | Strict exact shape and lease/purpose/scope/mapping checks; reserve through existing writer owner. Account/browser cannot call as source writer. |
| BS-H06 | public.record_provider_capture_v2(p_input jsonb) RETURNS jsonb | Existing runtime/job owner only | Strict exact shape, receipt/lease/purpose and authority-generation checks; capture/evidence acceptance uses existing owner and pending-work boundaries. Existing administration functions retain signatures and receive required guards. |
| BS-H07 | public.lock_account_session_authority_v2(p_session_receipt jsonb) RETURNS TABLE(session_expires_at timestamptz,admission_epoch_revision bigint,db_sample_at timestamptz,session_created_at timestamptz) | league_one_account only | Auth-only migration-owned helper inside B. Locks/validates actual auth/epoch and digests, returns safe timing; account layer subsequently binds actor/login. No raw auth grants. See acquisition-admission-design.md for exact receipt and bootstrap treatment. |
| BS-H08 | public.admit_account_acquisition_v1(p_command jsonb,p_session_receipt jsonb) RETURNS jsonb | league_one_account only | Closed durable command, same-B authority, own scope, atomic demand/audit/existing-job intent and idempotent result. Exact progress/worker/transport companion signatures are in acquisition-admission-design.md. |
| BS-H09 | public.disable_app_actor_v1(p_actor_id uuid,p_request_id uuid) RETURNS boolean | Existing migration owner only; no application-role EXECUTE | Role-authenticated security maintenance; exclusive auth gate then Actor and sorted login locks; active to disabled only, existing operator audit; no user receipt or provider-claim override. |
| BS-H10 | public.revoke_app_login_identity_v1(p_identity_id uuid,p_request_id uuid) RETURNS boolean | Existing migration owner only; no application-role EXECUTE | Role-authenticated exact login revocation; exclusive auth gate then Actor and login, immutable actor recheck, existing operator audit; never reassign/reactivate. |

### Target-command admission and acknowledgement

1. The auth-only guard returns only session_expires_at,admission_epoch_revision,db_sample_at,session_created_at. session_created_at is safe internal metadata for the separately trusted D03 admission policy; it adds no receipt field. Account command/read composition then locks Actor and login identity, proves exact issuer/subject/actor binding, and continues the existing domain order. B owns auth locks until B commits or rolls back; auth transaction A need not remain open. All supported auth mutations take exclusive(19740517,1) BEFORE STATEMENT or in their owner entrypoint, before row locks.

2. The trusted account bridge sets transaction-local app.session_receipt_v2 before private SQL. Existing direct account DML BEFORE STATEMENT guards invoke the auth-only guard before actor/domain locks and then validate actor/login. New user-scoped privileged helpers invoke it unconditionally using their typed receipt. Existing resolve_app_login_identity keeps its signature but consumes the same receipt, binds issuer/subject, and authenticates before its registration mutex. Its existing-actor path locks Actor then login; new-actor creation stays an owner-only authenticated bootstrap. A generic flag cannot skip checks. The registration mutex is a special class after auth and before Actor; callers already holding Actor cannot enter the resolver.

3. After all required locks, final SQL samples clock_timestamp once and evaluates expiry and operation predicates before mutation or delivery. Mutation linearizes there while its auth/domain state is protected through commit. Time passage is not frozen: an expired protected acknowledgement is suppressed. Confirmed rollback means no effects; unknown commit or confirmed commit followed by failed acknowledgement returns safe indeterminate without asserting rollback. Explicit same-command retry reauthorizes then reconciles retained command identity; no automatic request retry.

4. Activation and selection helpers receive AuthReceiptV2 and return closed ActivationHelperResult/SelectionHelperResult with DecisionTiming; all protected successful variants require nonnull timing, safe failures null. Discovery/recovery/identify use the exact durable admission and progress interfaces in acquisition-admission-design.md, returning an own pending handle instead of assuming a provider response completes synchronously. A failed acknowledgement does not cancel a committed durable command.

5. D03 own release checks actual locked session.createdAt against the guard db_sample_at at command admission: authentication age0..300seconds inclusive; future/nonfinite times refuse. Last activity never substitutes for creation time; an older session requires a new maintained login. The admitted command retains the ordinary12000ms maximum and live same-B authority through commit; the five-minute admission threshold is not a second final-commit age threshold. The auth-only helper returns session_created_at as safe internal timing; it never returns token/email/actor. Disputed takeover requires incumbent release or implemented reviewed independent provider-control proof; public Sleeper evidence/support discretion cannot substitute.

### Operator security revocation

Supported operator security revocation does not require the compromised user's receipt. public.disable_app_actor_v1(p_actor_id uuid,p_request_id uuid) RETURNS boolean and public.revoke_app_login_identity_v1(p_identity_id uuid,p_request_id uuid) RETURNS boolean are narrow migration-owner SECURITY DEFINER entrypoints with fixed safe search_path, fully qualified objects, and no EXECUTE grant to PUBLIC, account, auth or runtime. They require actual session_user to equal the catalog-pinned existing migration-owner role; SET ROLE or a caller GUC cannot establish this authority. From a fresh operator transaction, acquire exclusive auth gate(19740517,1), then Actor FOR UPDATE and sorted login rows. Resolve identity-to-actor without locking first, then lock/recheck the immutable actor link in canonical order. Only disable active actor or revoke the exact existing login; never reactivate, reassign, delete shared data or bypass D03 provider conflicts. Set transaction-local request UUID and clear user-actor context for the existing operator audit, restoring scoped context on return; transition and audit commit atomically. Exact already-disabled/revoked repeat returns true without another audit, absent or deleted invalid target returns false. Unknown commit is reconciled by explicit repeat, not called rollback.

G-ACTOR uses a role-authenticated migration-owner branch for supported operator maintenance and otherwise requires the same-B user guard; no boolean or receipt-free account bypass. app_login_identities UPDATE/DELETE acquire the exclusive auth gate before Actor and login locks. Login INSERT first acquires shared auth; the authenticated resolver holds its registration mutex, allocates/locks the Actor, and checks NEW issuer/subject against the exact receipt plus NEW app_user_id against that Actor. This insertion cannot require a preexisting login row. No direct account login INSERT/UPDATE/DELETE grant is introduced, and all other account mutation guards continue to require their ordinary actor/login binding. Existing schema-owner maintenance is an explicit trusted boundary, not an application credential capability.

### Explicit audit and rate participation

Extend the existing audit subject CHECK and bounded trigger adapter for app_current_league_selections and app_league_renewals. For selection mutations derive subject_user_id from the association, subject_id from leagueId and metadata from the selection revision; for renewal proof mutations derive subject_user_id from the association, subject_id from the proof ID and metadata {}. Both participate in the existing actor/request, ReadCommitted and 60 audit events per rolling 60 seconds limit; a renewal that produces multiple auditable changes consumes all corresponding events. No direct tombstone DML: canonical app_user_leagues DELETE and its existing audit produce the derived tombstone atomically; any audit/rate/tombstone failure rolls back the whole account transaction. This is a proposed narrow audit adaptation, not present trigger coverage. Demand admission adds app_acquisition_demands with subject_id=demandId, subject_user_id=current actor and metadata {}; the first accepted command, audit and existing job intent commit together. Only exact actor+commandId replay joins without duplicate audit/work; a distinct-command same-scope collision is limited and unaccepted, so no unpersisted idempotency alias is acknowledged.

## Transition contracts

### BS-T01: Identify submitted username

| Field | Decision |
| --- | --- |
| State | lookup absent -> identified or unavailable/invalid |
| input | Trusted actor; opaque submitted username; server request id |
| guard | Existing admission/origin/input limits, closed command and qualified identity adapter; exact atomic demand admission, actor/global budgets and source policy before dispatch |
| owner | BS-ACCOUNT + BS-ADMIN |
| atomic | Same-B demand/idempotency/audit/existing-job commit; provider network outside transaction through shared transport; append lookup capture through existing evidence owner |
| output | IdentifyProviderAccountResult including pending with lookupRequestId equal to own demandId; qualified completion returns exact public provider identity and own capture receipt only |
| failure | Malformed/unknown/network failure yields no fabricated account |
| recovery | Explicit repeat lookup retains new receipt; username rename never merges identity |
| oracles | BS-O01; BS-O10 |

### BS-T02: Activate association

| Field | Decision |
| --- | --- |
| State | identified/pending -> active |
| input | Subject lookup receipt; trusted actor; idempotency identity |
| guard | Same subject native key; both active uniqueness constraints; current actor/admission; mandatory same-B live auth and actor/login binding through the selected command boundary |
| owner | BS-ACCOUNT |
| atomic | Same-B auth-held account transaction enforces both exclusivity constraints, audit and command idempotency. Confirmed failure rolls back; uncertain commit is reconciled by explicit retained-identity retry. |
| output | One active association or private-safe conflict |
| failure | No implicit replacement or competing actor identity; D03 unsupported disputes stay locked until incumbent release or implemented qualified control proof. |
| recovery | Retry same command returns existing own result; fresh claim only after explicit disconnect |
| oracles | BS-O02; BS-O07; BS-O13 |

### BS-T03: Discover candidate leagues

| Field | Decision |
| --- | --- |
| State | active/not_started -> pending/partial/complete |
| input | Association revision; explicit finite season query set and strategy; acquisition context |
| guard | Current active association/revision, qualified finite active-retained-v1 season set, exact durable demand admission and shared budget; completion describes only declared scope |
| owner | BS-WORK + BS-ADMIN |
| atomic | Reserve/checkpoint under existing job fence; release transaction before network; commit per-scope receipts |
| output | DiscoveryScan with completed scopes and candidates; no follow |
| failure | Failed scope stays unfinished/partial, not empty |
| recovery | Resume unfinished scopes under same immutable strategy; restart after revision mismatch |
| oracles | BS-O03; BS-O09 |

### BS-T04: Qualify candidate and shared teams

| Field | Decision |
| --- | --- |
| State | candidate/unknown -> positive or unknown/removed |
| input | League identity/settings plus captured roster population/role groups |
| guard | Exact native identity; independent expected population; valid owner/co-manager groups; current mapping |
| owner | BS-ADMIN |
| atomic | Accepted manager and held resources independently commit under existing writer fences; connection authority changes with membership evidence |
| output | Shared season-team identities, role evidence; official roster independent of optional decoration |
| failure | Malformed players cannot suppress qualified removal; unknown roles cannot invent removal |
| recovery | Bounded ordinary revalidation; retain original-age last-good facts |
| oracles | BS-O04; BS-O08; BS-O10 |

### BS-T05: Choose initial current season

| Field | Decision |
| --- | --- |
| State | unresolved -> selected |
| input | Qualified stable league identity; association; current eligible team evidence |
| guard | No competing lineage/current choice; positive within D02; no selection by max year; mandatory same-B live auth and actor/login binding through the selected command boundary |
| owner | BS-ACCOUNT |
| atomic | CAS current-selection key and authority with the explicit new selection audit/rate adapter in the same transaction; same-league references enforced. |
| output | Per-league CurrentSelection and all proven team IDs |
| failure | Ambiguity returns unresolved; no silent newer-season override |
| recovery | Resume after qualified lineage/role evidence |
| oracles | BS-O03; BS-O08; BS-O07; BS-O13 |

### BS-T06: Compose and deliver stored roster

| Field | Decision |
| --- | --- |
| State | selected -> available/pending/unavailable/denied/indeterminate |
| input | Trusted actor; candidate stored refs; BS-P01 vector |
| guard | BS-P01 full coherent allow or safe denial; exact audience/coverage |
| owner | BS-READER + BS-AUTH + BS-ACCOUNT |
| atomic | BS-P01 final decision boundary; no provider calls |
| output | Exact result variant; pending is not empty |
| failure | Any uncertain guard abort discards protected result |
| recovery | Next ordinary request starts new decision; no automatic retry |
| oracles | BS-O05; BS-O06; BS-O07 |

### BS-T07: Membership clock reaches expiry

| Field | Decision |
| --- | --- |
| State | positive -> expired |
| input | Trusted evaluation time and original qualifyingVerifiedAt |
| guard | now >= min(T+3600,earlier authority expiry) |
| owner | BS-ACCOUNT |
| atomic | Computed at decision; no fake removal write |
| output | Denied affected league serving only |
| failure | No grace extension on failure/cache/replay |
| recovery | BS-T10 independently schedules recovery |
| oracles | BS-O06 |

### BS-T08: Accept complete role loss

| Field | Decision |
| --- | --- |
| State | positive/unknown -> removed |
| input | Exhaustive qualified all-team owner/co-manager exclusion |
| guard | Current scope/context/mapping; complete role and population proof |
| owner | BS-ADMIN |
| atomic | Connection guard + membership receipt/adverse evidence/authorization_generation + required pending work atomically |
| output | Early denial for that actor/league; shared data survives |
| failure | Any unknown relevant role keeps loss unproved; existing positive expires normally |
| recovery | BS-T11 later qualified correction may restore eligibility |
| oracles | BS-O04; BS-O11 |

### BS-T09: Disconnect association

| Field | Decision |
| --- | --- |
| State | active -> ended |
| input | Trusted actor; expected association revision |
| guard | Own active association; command current; audit limits; mandatory same-B live auth and actor/login binding through the selected command boundary; own release requires locked actual session creation age0..300seconds at command admission under D03 |
| owner | BS-ACCOUNT |
| atomic | End and revision/audit in account transaction; no shared facts deleted |
| output | Immediate target deny; L1 sign-in and other actors intact |
| failure | Stale command conflict, no automatic reassignment |
| recovery | New association requires explicit qualified claim; D03 forbids discretionary takeover or public-evidence ownership proof. |
| oracles | BS-O02; BS-O05; BS-O07; BS-O13 |

### BS-T10: Request recovery after expiry

| Field | Decision |
| --- | --- |
| State | expired -> revalidation pending |
| input | Authenticated actor; still active association; independently valid acquisition demand |
| guard | Current active association and independent context; exact same-B demand admission and shared budget. Retained ineligible follows allow at most hourly recovery for7days since first loss; failures do not reset it, then explicit authenticated demand is required. Disconnect is not recovery authority. |
| owner | BS-WORK |
| atomic | One pending scope/purpose/input identity through existing jobs; no request-held DB transaction |
| output | Pending work; serving stays denied until qualification |
| failure | Disconnect/permission revocation cannot be bypassed; budget exhaustion returns pending/limited |
| recovery | Ordinary scheduler resumes admitted work; no new cron |
| oracles | BS-O09 |

### BS-T11: Accept qualified positive correction

| Field | Decision |
| --- | --- |
| State | expired/removed/unknown -> positive |
| input | Fresh qualified role receipt; exact adverse evidence/supersession proof |
| guard | Current authority; proven ordering; no incomparable or replay-created freshness |
| owner | BS-ADMIN + BS-ACCOUNT |
| atomic | Existing acceptance and connection authority commit; next BS-P01 evaluates new evidence |
| output | Eligibility can recover; D02 from actual qualified network time |
| failure | Unknown set or unsuperseded removal continues denying |
| recovery | Fresh qualified membership restores only still-current explicit follow intention under active association; newer unfollow wins. Ordinary revalidation uses the shared provider budget. |
| oracles | BS-O06; BS-O11 |

### BS-T12: Verify annual renewal

| Field | Decision |
| --- | --- |
| State | selected old season -> selected successor |
| input | Both mapping revisions; fresh successor roles; expected selection and follow revisions |
| guard | Same stable league; nonconflicting predecessor link; no merely later-year candidate; mandatory same-B live auth and actor/login binding through the selected command boundary |
| owner | BS-ACCOUNT + BS-ADMIN |
| atomic | Ordered connection locks; current-selection CAS plus explicit selection/renewal audit/rate adapters; follow carryover guarded by exact current preference. All auditable changes count toward the unchanged event limit. |
| output | Only this league advances; existing follow preserved unless newer unfollow |
| failure | Mapping/selection conflict aborts; newer unfollow never overwritten |
| recovery | Reevaluate with current references; do not create new follow |
| oracles | BS-O08; BS-O12; BS-O07; BS-O13 |

### BS-T13: Explicit unfollow

| Field | Decision |
| --- | --- |
| State | following -> not_following |
| input | Trusted actor; stable league; preference revision |
| guard | Own preference, existing writer limits; mandatory same-B live auth and actor/login binding through the selected command boundary |
| owner | BS-ACCOUNT |
| atomic | Canonical preference DELETE, existing audit and derived tombstone/new revision commit atomically; no direct tombstone DML. Any audit/rate or tombstone failure rolls back both. |
| output | Preference changes only; eligibility unchanged |
| failure | Stale command safe conflict |
| recovery | Explicit subsequent follow remains an explicit command. D05 routine demand is only eligible follow, current authorized view or explicit registry obligation. Zero routine demand stops routine polling after30minutes. Bounded recovery/import never resets this cooldown or resurrects routine polling; shared accepted history is retained. |
| oracles | BS-O12; BS-O07; BS-O13 |

### BS-T14: Explicit follow

| Field | Decision |
| --- | --- |
| State | absent/not_following -> following |
| input | Trusted actor; stable league; explicit command |
| guard | Current eligibility and selected league; command is not discovery; mandatory same-B live auth and actor/login binding through the selected command boundary |
| owner | BS-ACCOUNT |
| atomic | Preference writer/revision/audit; absent-key race constrained |
| output | Own follow only; no access grant |
| failure | Ineligible/unknown cannot activate effective follow demand; retained intention grants neither access nor acquisition. D04/D05 select suspension, resumption and bounded recovery. |
| recovery | Retry idempotently after explicit user action and qualification |
| oracles | BS-O12; BS-O07; BS-O13 |

### BS-T15: Promote/revert serving interpretation

| Field | Decision |
| --- | --- |
| State | binding v1 -> binding v2 or unchanged |
| input | Qualified candidate policy tuple; expected binding; exact adverse set |
| guard | Compatible audience/coverage; no bypass of removal; no cross-head ordinal ordering; prior admitted removal survives normalizer suspension or reversion, with unknown validity denying |
| owner | BS-ADMIN |
| atomic | Connection guard; binding and authorization_generation with required pending materialization in one commit |
| output | Selected policy changes; D02 age unchanged by replay/promotion |
| failure | Incomplete comparison/adverse set refuses change |
| recovery | Same-owner fresh qualification; safe compatible rollback only |
| oracles | BS-O11 |

### BS-T16: Remap source / stale in-flight work

| Field | Decision |
| --- | --- |
| State | mapping A -> mapping B or later A |
| input | Reviewed mapping command; existing immutable revision/generation |
| guard | Exact current revision; source owner authority |
| owner | BS-ADMIN |
| atomic | Connection guard; mapping/authorization generation advance; histories retained |
| output | Prior captures/jobs fail fence even after A-B-A |
| failure | Old reservation cannot accept/publish under reused native key |
| recovery | Reserve new work under current mapping |
| oracles | BS-O11 |

### BS-T17: Auth logout/reset/revoke/admission change

| Field | Decision |
| --- | --- |
| State | session admitted -> session invalid or config epoch changed |
| input | Existing maintained auth command or authorized configuration rollout |
| guard | Exclusive existing auth gate; supported DB writes guarded; exact active config binding |
| owner | BS-AUTH |
| atomic | Auth transaction commits mutation/session invalidation/epoch; no app schema privileges |
| output | New target decisions/commands after committed revocation deny. An earlier B transaction retains its own auth gate through commit and orders before revocation; protected acknowledgement still obeys expiry. |
| failure | Failed auth mutation rolls back; no new session epoch or custom token |
| recovery | Existing auth recovery only; provider state irrelevant to L1 sign-in |
| oracles | BS-O07 |

### BS-T18: Crash/fail during acceptance or final read

| Field | Decision |
| --- | --- |
| State | work reserved/composition -> resumable or no delivery |
| input | Crash point before/after commit; job lease and immutable references |
| guard | Existing receipt and pending-work atomicity; idempotency |
| owner | BS-ADMIN / BS-READER |
| atomic | Acceptance plus durable next work atomic; final-read no durable allow |
| output | Restart does not duplicate facts or lose pending work |
| failure | Commit uncertainty suppresses protected output but never proves rollback; B retains its own auth fence until transaction end. No replay freshness. |
| recovery | Worker reclaims expired lease under current fences; reader starts fresh request. Explicit command retry retains its identity and reauthorizes before reconciling an unknown or already committed result. |
| oracles | BS-O13 |

## Action, object and field authorization

| ID | Actor | Action | Object | Precondition | Allowed | Prohibited | Owner | Controls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BS-AZ01 | Unauthenticated, disabled, unverified or uninvited caller | Any target private service action | Target first-slice results | No private admission | Safe failure only; existing public routes retain existing behavior | No target team/league/association metadata | BS-AUTH | BS-C01; BS-C05 |
| BS-AZ02 | Admitted L1 actor | Identify | Submitted Sleeper username | Current admission and validated source scope; same-B durable command plus exact shared acquisition budget | Public provider identity/display and opaque own lookup receipt | No other L1 link status/actor; no association activation | BS-ACCOUNT | BS-C02; BS-C03; BS-C10 |
| BS-AZ03 | Admitted actor with qualified subject lookup | Claim or end own association | Association / ProviderAccount | Atomic two-way uniqueness; trusted actor; expected revision; same-B live session/admission and actor/login binding; D03-D05 selected policy | Own association ID/state/revision or generic conflict | No other actor identity; no reassignment; no ownership-proof claim | BS-ACCOUNT | BS-C01; BS-C02 |
| BS-AZ04 | Actor with active association | Discover/current-team list | Own association and candidate scans | Qualified finite strategy/audience and exact active association revision; durable command admission and shared budget; BS-P01 before protected result delivery | Qualified own selections/team options and honest scope status; server-only unresolved refs remain server-side | No auto-follow, unrelated protected candidates or arbitrary account scan | BS-ACCOUNT | BS-C03; BS-C04; BS-C06 |
| BS-AZ05 | Currently qualified owner/co-manager | Stored current-roster read | Selected league season / shared teams | BS-P01 allow; exact evidence/audience/field coverage | Available exact roster variant; authorized native held IDs with optional features independently limited | No raw captures, auth/dependency vector, exact-week fiction or estimate for official data | BS-READER | BS-C04; BS-C05; BS-C06; BS-C10 |
| BS-AZ06 | Member/commissioner without qualifying role; expired/removed/ended association | Protected target read | League and team content | No qualifying allow | Exactly status/reason | No IDs, roster, revision, field/source metadata, features or other account identity | BS-READER | BS-C05; BS-C06; BS-C11 |
| BS-AZ07 | Admitted actor with active association but expired membership | Schedule bounded recovery | Own membership source demand | Independent context and active association remain valid; exact demand admission/shared budget plus D05 recovery bounds; no unexpired membership needed merely to request recovery | Safe work pending/limited result; no league payload before requalification | No revoked-context bypass, synchronous provider fetch in reader or duplicate storm | BS-WORK | BS-C03; BS-C11 |
| BS-AZ08 | Admitted eligible actor | Follow/unfollow | Own stable-league preference | Explicit command and expected revision; applicable follow gate; same-B live session/admission and actor/login binding; D03-D05 selected policy | Own preference revision/tombstone | No eligibility grant, stale unfollow resurrection or deletion of shared history; D04/D05 govern effective demand | BS-ACCOUNT | BS-C08 |
| BS-AZ09 | Existing acquisition worker | Capture/accept/materialize | Exact resource scope | Lease/context/mapping/reservation/fence; independently qualified groups | Existing writer-defined source/evidence fields and pending-work receipts | No user-session impersonation, account preference writes or permission from shared worker credential | BS-ADMIN | BS-C04; BS-C06; BS-C07; BS-C09 |
| BS-AZ10 | Ordinary account/auth/worker database role | Cross-boundary SQL | Other schema / raw data / privileged functions | Existing grants plus exactly the proposed guarded-helper EXECUTE allowlist; no broad role or table-grant expansion | Minimal sanctioned projected reads or own-domain actions | Account/worker cannot read auth; auth cannot read league/account; account cannot source-write; no owner membership | Existing DB role owners | BS-C01; BS-C04; BS-C12; BS-C13 |
| BS-AZ11 | Authorized operator | Policy/admission/promotion provisioning and diagnosis | Versioned configuration and diagnostic evidence | Separate operational authority, exact config epoch and guarded writers; review release gates | Necessary safe diagnostics and approved config only | No owner takeover via caller input; no secret/raw identity logging; no arbitrary public claim displacement | BS-OPS | BS-C02; BS-C07; BS-C12 |

## Threat, control and verification allocation

| ID | Threat | Control | Owner | Cases | Oracles | Residual |
| --- | --- | --- | --- | --- | --- | --- |
| BS-C01 | Forged actor/session/provider IDs; pooled context confusion | Maintained cookie validation plus ephemeral AuthReceiptV2; actual session/user/admission locked by narrow owner helper inside account B before actor/login/domain locks. Mandatory direct-DML and bootstrap guards; SET LOCAL context never substitutes for live authority. No raw auth grant or receipt persisted. | BS-AUTH / BS-ACCOUNT | FS08; FS13; FS18 | BS-O01; BS-O05; BS-O07 | Trusted server credential compromise is outside RLS protection; BS-R03. |
| BS-C02 | Squatting, conflicting claim, link-status enumeration | Both exclusive constraints atomically; same generic conflict shape and safe reason; avoid competing-actor lookup/return. Idempotency applies only to same trusted actor/subject. Public username data remains public; no promise to hide that a requested claim cannot succeed. | BS-ACCOUNT | FS02; FS03; FS18 | BS-O02 | D03 selects own fresh-login release and no discretionary takeover; unsupported disputes stay locked. Public evidence cannot prove external control. |
| BS-C03 | Lookup/discovery/recovery amplification and quota exhaustion | acquisition-admission-design.md selects atomic originator-scoped command/work admission, bounded queues, actor5/61s+60/3601s, global900 charged grants/61s with1s dispatch expiry, reserved lanes, no refunds, fair scheduling and circuit/backoff. Every owned Sleeper transport/cache refresh shares it; existing worker/jobs remain the owners. Numbers are application limits, not provider promises. | BS-ACCOUNT / BS-WORK | FS09; FS16; FS17; FS19 | BS-O03; BS-O09 | G6/G7 must prove complete transport convergence, strict charged-start accounting and full mixed-workload capacity before activation or watched-capacity expansion. Existing two named-league obligations and all future/import work count; no unbounded fallback. |
| BS-C04 | Cross-provider, team, season or audience reference injection | Exact tuple validation at command, acceptance and read boundaries; referenced account/native identity agrees; selected teams same stable league and season; no implicit private audience widening; native and internal IDs distinct. Use parameterized SQL; the adapter builds an allowlisted provider route with encoded native keys/username, never a caller-supplied URL or SQL fragment. | BS-ADMIN / BS-READER | FS01; FS13; FS15; FS16 | BS-O01; BS-O08 | Valid public captures may share; private grants must remain separate until equivalent visibility proved. |
| BS-C05 | Cached allow, denied-payload leakage, error disclosure | Private/no-store target responses; caches hold immutable facts, never reusable entitlement; BS-P01 reauthorizes each delivery. Exact denied/indeterminate keys only. Exceptions discard candidate data; safe reason enum not driver message. | BS-READER | FS05; FS08; FS13 | BS-O05; BS-O14 | Already delivered bytes cannot be recalled; upstream public Sleeper data is not made private. |
| BS-C06 | Incoherent final auth, hidden adverse evidence, missing-row phantoms | Same-B auth and domain fences protect coherent decision through B commit; guarded writers serialize source changes. Adverse set includes immutable removals qualified when admitted regardless current policy suspension/head selection; unknown validity denies. Phantom insertion is fenced by parent League/connection guards. | BS-ACCOUNT / BS-ADMIN | FS07; FS08; FS10; FS21 | BS-O05; BS-O11 | Selected paper proof is not deployed SQL evidence; actual direct-writer coverage, role/trigger behavior and coordinator-loss schedules remain required. |
| BS-C07 | Cross-version promotion bypass, replay renewal, stale worker writes | Serving selection is explicit CAS under connection guard; adverse removal supersession needs retained ordering proof. No cross-head ordinal order, semver selection or replay freshness. Commit binding/pending work and authority generation together. | BS-ADMIN | FS09; FS10; FS21; FS22 | BS-O11; BS-O13 | Unknown comparative lineage stays denied and requests ordinary fresh qualification. |
| BS-C08 | Renewal overwrites newer unfollow; discovery makes follow | Explicit follow intention remains independent of effective eligibility. D04 suspends demand on loss/expiry/disconnect and resumes only current intention after fresh eligibility. Renewal compares mapping/selection/preference revisions; newer explicit unfollow always wins. D05 routine demand unions only eligible follows, current authorized views and explicit registry obligations. Recovery/import authorizes only its bounded purpose and never resets the30minute zero-routine-demand cooldown or resumes routine polling. | BS-ACCOUNT | FS14; FS20 | BS-O08; BS-O12 | D03-D05 are selected in backend-decisions.md; timers, races, source proof and disposal qualification remain implementation obligations. |
| BS-C09 | Crash loses required rebuild or duplicates evidence | Existing receipt/job uniqueness and atomic pending-work commit; immutable captures and resumable checkpoints; fail stale lease/generation. No mutable permit persisted as authority. | BS-ADMIN / BS-WORK | FS09; FS10; FS22 | BS-O13 | Recovery implementation and DB fault schedules remain unexecuted. |
| BS-C10 | Optional malformed data suppresses valid identity or removal | Separate identity, manager, held-player and optional directory/catalog groups; other-manager identities resolve from qualified role keys, not mandatory username calls. Malformed players cannot mask complete removal; missing co-owners cannot prove exclusion. | BS-ADMIN | FS01; FS07; FS11; FS12; FS18 | BS-O04; BS-O10 | Source field coverage requires empirical qualification; null is not empty. |
| BS-C11 | Expiry extends during outage/retry or recovery locks itself out | Trusted single clock-domain evaluation; strict equality expiry; failed/cached/replayed/partial-unqualified evidence never advances T; recovery uses independent acquisition authority after expiry; L1 login unaffected. | BS-ACCOUNT / BS-WORK | FS06; FS17; FS22 | BS-O06; BS-O09 | Outage may deny league data; this is required bounded access, not account suspension. |
| BS-C12 | Sensitive or forged diagnostics; unguarded privileged mutations | Extend the existing audit subject CHECK and bounded trigger adapter for app_current_league_selections and app_league_renewals. For selection mutations derive subject_user_id from the association, subject_id from leagueId and metadata from the selection revision; for renewal proof mutations derive subject_user_id from the association, subject_id from the proof ID and metadata {}. Both participate in the existing actor/request, ReadCommitted and 60 audit events per rolling 60 seconds limit; a renewal that produces multiple auditable changes consumes all corresponding events. No direct tombstone DML: canonical app_user_leagues DELETE and its existing audit produce the derived tombstone atomically; any audit/rate/tombstone failure rolls back the whole account transaction. This is a proposed narrow audit adaptation, not present trigger coverage. Demand admission adds app_acquisition_demands with subject_id=demandId, subject_user_id=current actor and metadata {}; the first accepted command, audit and existing job intent commit together. Only exact actor+commandId replay joins without duplicate audit/work; a distinct-command same-scope collision is limited and unaccepted, so no unpersisted idempotency alias is acknowledged. Diagnostics remain safe structured enums/random request-local correlation. No durable read correlation-to-actor/resource audit join is promised; operations owns sink/access/retention. | BS-OPS | FS08; FS13 | BS-O07; BS-O14 | Full infrastructure/owner compromise and ASVS certification unassessed; G7 verifies deployed effectiveness. |
| BS-C13 | New guard helper becomes arbitrary privileged read/write, role escalation or row-lock denial of service | Exact migration-owned auth/read/command/acquisition guard helpers; closed inputs, fixed search_path, qualified objects, no PUBLIC/unrelated EXECUTE, no arbitrary SQL. Explicit manifest signatures only. Account receives no raw auth table/schema grant; worker receives bounded demand/fence and no receipt. Existing direct DML and bootstrap entrypoints receive mandatory same-B guards. | BS-ACCOUNT / BS-AUTH / BS-OPS | FS08; FS13; FS18 | BS-O15 | Target helper DDL, ownership and grant-manifest changes need hostile-role qualification before activation; no live privileges changed. |

## Independent fixture and oracle methods

| ID | Method | Fixture | Schedule | Expected | Proof | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BS-O01 | Typed fixture + guarded role SQL | Two actors/providers/seasons with colliding IDs and renamed username | Alter one typed key at each command/read boundary; forge actor/issuer/generation fields; inject URL delimiters and SQL-like username text | Reject wrong-key request; unchanged committed target rows; no protected response; valid native IDs remain exact | Independent expected literal keys and before/after DB rows, not same production mapper. | specified_not_executed |
| BS-O02 | Concurrent real writer transactions + serialized response inspection | A/B claim one native account; A claims two same-provider accounts | Barrier after each precheck; commit both; rerun winning command idempotently; fill the audit window then attempt selection and renewal; fail the audit insert and derived tombstone write separately; release with actual session.createdAt ages299,300,301seconds at admission, then cross300seconds during an otherwise valid admitted command; submit public screenshots/usernames as supposed takeover proof | Exactly one active relationship in each exclusive dimension; no displaced links; loser has generic conflict only; new subjects consume the unchanged audit limit and all command/tombstone effects roll back on a confirmed audit/rate failure; only own release admitted atage0..300 proceeds within the ordinary command budget; unsupported disputed takeover remains locked | Query active constraints/history/audit with guarded verifier; compare serialized key set and absence of competitor identifier. | specified_not_executed |
| BS-O03 | Fake provider fixture and job inspection | Declared seasons with older nonrenewed and new candidates, duplicate triggers | Fail one list scope; resume checkpoint; interleave association revision change; run multiple distinct usernames/scopes across separate invocations and start a fresh discovery after completed work | Partial coverage on gaps; one unfinished semantic demand; completed refresh has new capture age only after fresh source proof. Distinct scopes still obey shared global/actor budgets; declared active-retained-v1 scope never becomes universal-history completeness. | HTTP-start ledger and committed scan receipts compared to independently listed expected scope set. | specified_not_executed |
| BS-O04 | Normalizer resource fixtures + real acceptance | Known owner, unknown/null/empty co-owners, two teams; malformed players | Accept complete removal roles while players invalid; repeat with unknown role group | Valid removal denies independently; unknown co-owners never establish removal; unaffected teams remain | Independent source-role truth table; inspect manager/held acceptance receipts and qualification reasons separately. | specified_not_executed |
| BS-O05 | Controlled final-read concurrency + pool reuse | Permissive actor/association/role set with another actor connection | Barrier before/after each BS-P01 guard; concurrent revoke/remap/remove; reuse pooled connection | Writer before guard is observed; writer after final guard waits and orders after valid read; no mixed-state allow; actor context never leaks | Timeline with lock acquisition/commit/decision instants and exact response keys; inspect restricted-role context, not return status alone. | specified_not_executed |
| BS-O06 | Injected trusted clock + domain SQL | Positive T; context/session earlier deadlines; partial/cache/replay inputs | Evaluate 3599,3600,3601 seconds; expire while blocked acquiring guard; replay old evidence | Allow only before earliest expiry; equality denies; no T advance except fresh independently qualified positive group | Literal expected deadlines from fixture; compare stored verification timestamps and response suppression; no server-time sleep test. | specified_not_executed |
| BS-O07 | Maintained auth path + restricted roles | Same cookie/session; reset/logout/revoke/admission epoch switch; old deployment config | Interleave BS-P01 with supported auth writers and direct guarded auth-role mutation; force abort; repeat around activation, initial/renewal selection and preference commands; terminate the coordinator after account HTTP dispatch while logout waits; disable compromised actor and revoke exact login through owner-only helpers without a user receipt, race each against final B, and bootstrap a brand-new login | B holds its own shared auth gate/rows through commit regardless A/coordinator loss; revoke first denies, B first orders before revoke. Session-ID token replacement/email/config changes refuse. Account/runtime cannot SELECT raw auth; direct DML/bootstrap use the mandatory guard. Operator security actions remain available without the compromised session, serialize before/after B using the exclusive gate, and emit operator audit. New-login insertion proves NEW actor/issuer/subject without requiring a prior login. | Real session/user/epoch state plus locked timeline and role-denial SQL; cookie never copied to logs. | specified_not_executed |
| BS-O08 | Identity/renewal matrix + writer race | Two stable leagues selecting different years, old completed league, conflicting successor | Newer year candidate alone; cross-league successor injection; verified transition | Only proven same-league renewal advances; independent current years survive; route/UUIDs preserved | Independent expected relation tuples and committed selections; no max-year derived oracle. | specified_not_executed |
| BS-O09 | Bounded scheduling + acquisition ledger | Expired actor with active association; revoked context; many tabs/co-managers; N distinct admitted actors/usernames/scopes spread across independent invocations, each below every local cap | Submit duplicate recovery/view demands during failure and after context revocation | Exact accepted-command replay joins without another HTTP start; a distinct-command unfinished-scope collision is limited without accepting a command alias; distinct demands obey exact shared window/actor/queue/lane caps. D05 hourly recovery stops7days after first loss without failure resets; explicit later demand needs fresh admission/active association. L1 authentication remains independent. | Run AA-P03..AA-P08 with real restricted roles across processes, comparing transport starts to charged permit ledger and exact window limits. Observe all caches/fallbacks/retries/hosts. Virtual-clock recovery/deadline tests establish D05, not telemetry presence alone. | specified_not_executed |
| BS-O10 | Optional-data fault injection | Lookup subject plus other manager only in roster; missing users/catalog/projections | Fail optional services; malformed optional rows; keep valid held IDs/role truth | No per-other-manager username request; subject claim still requires own lookup; official content not blocked by missing decorations | Provider call ledger + normalized identity tuples + expected coverage labels; invalid optional output never becomes invented empty fact. | specified_not_executed |
| BS-O11 | Real connection guard and versioned-head schedules | v2 positive T1; v1 qualified removal T2; A-B-A mapping; empty adverse set | Promote/revert/replay T1; insert removal/new qualified head during final set evaluation; suspend the normalizer that admitted removal, requalify it, unselect its head and restore an older positive | No older positive allow, no replay age advance; guard includes phantom insertion; supersession requires exact ordering proof; stale writer fenced; accepted historical removal remains adverse after suspension/requalification/reversion; unknown interpretation remains fail closed | Inspect immutable refs/generations, ordering proof and writer/read timeline; do not compare different head ordinals. | specified_not_executed |
| BS-O12 | Follow CAS/renewal concurrent writers | Following revision r; two mapping revisions; concurrent newer unfollow | Pause renewal then commit unfollow; repeat absent follow; race two renewal selectors; cross120s view lease,30min zero-routine-demand, hourly recovery and7day first-loss boundaries; include failure/crash and later explicit recovery | Newer unfollow wins; renewal cannot use stale mapping; D04 loss suspends effective following without erasing intention, fresh eligible regain resumes only latest intention; D05 stops routine polling after30min zero routine demand while preserving shared history. Concurrent bounded recovery/import does not reset the cooldown or restore routine polling; recovery failures never restart the7day first-loss clock. | Inspect preference history/current tuple and selection rows; explicit event list, not UI label only. | specified_not_executed |
| BS-O13 | Crash injection at commit boundaries | Accepted input, pending materialization, claim/lease, restart; separate pinned auth A and noninteractive HTTP account B plus concurrent revoker R | Crash before acceptance, before commit, after commit before acknowledge, during final read commit; release/lose A after B dispatch but before B outcome, permit R to proceed, then allow B to finish; repeat unknown commit and committed-account/failed-auth acknowledgement | Atomic accepted-work/demand audit/job commits and explicit idempotent reconciliation. Unknown commit is never called rollback. B own auth locks prevent the former A/B/R gap; unknown permit stays charged/quarantined. Runtime must confirm AA-P01/06, not merely suppress responses. | Compare canonical identity/receipt counts, pending checkpoint and immutable hashes across restart. | specified_not_executed |
| BS-O14 | Serialization/log-capture fixtures + role deny tests | Strings with CR/LF, secret-like markers, competing identity markers, backend error | Inject each into malformed input/error path; simulate log failure and final authority error | Only safe schema/enum/correlation events; no driver/raw payload/session/competitor marker; fail closed result; random read correlation cannot be represented as an actor/resource audit join; selection/renewal audit metadata remains within the existing size/field boundary | Scan captured output/logs with independent marker denylist and required-field allowlist; log sink permissions tested separately at G7. | specified_not_executed |
| BS-O15 | Adversarial helper privilege and scope matrix | Actual proposed helpers deployed only in isolated guarded harness, every restricted role and two actors/audiences; temporary shadow names and malicious tuple inputs | Call each helper as PUBLIC/unrelated worker/account/auth roles; probe ill-shaped and cross-actor/audience receipt values, extra keys, mismatched actor/login bindings, search_path shadowing, expired budget, direct source UPDATE and direct auth SELECT. Submit a forged receipt through every HTTP/queue entry to prove it cannot enter the trusted bridge. Concurrent legitimate read establishes denial-of-service budget. | Only exact allowlisted role/signature invocation operates on trusted server-resolved scope; forbidden direct grants remain absent; malformed or mismatched fields reject. No arbitrary query/read/write, helper privilege escalation or transaction-surviving actor context. Failed or timed-out call returns no protected data. Compromise of the trusted account credential is excluded by BS-R03, not falsely tested as prevented. Every application role is denied the two operator helpers even with forged GUCs/SET ROLE attempts; authenticated migration-owner execution alone passes its role branch. No public-evidence dispute gets an operator takeover exception. | Catalog privilege/owner/search_path evidence plus role-specific result and mutation inspection; do not infer security from application return status alone. | specified_not_executed |

## Selected ASVS5.0.0 applicability

Requirements are selected by relevance/risk; this is not a claim every ASVS level applies or a complete certification. SQL mechanisms and numeric limits are League One design decisions.

| IDs | Disposition | Controls | Reason |
| --- | --- | --- | --- |
| v5.0.0-2.1.1; v5.0.0-2.1.2; v5.0.0-2.2.1; v5.0.0-2.2.2; v5.0.0-2.2.3 | selected-design | BS-C01; BS-C04; BS-C10 | Typed and cross-record validation at trusted boundaries. |
| v5.0.0-2.1.3; v5.0.0-2.3.2; v5.0.0-2.4.1 | selected-design | BS-C03 | Explicit peractor/global and lane budgets, durable admission, no-refund permit accounting and overload behavior are selected; actual effectiveness and full workload remain qualification. |
| v5.0.0-2.3.1; v5.0.0-2.3.3; v5.0.0-2.3.4 | selected-design | BS-C02; BS-C08; BS-C09 | Ordered association/renewal operations use atomic uniqueness and CAS. |
| v5.0.0-7.2.1; v5.0.0-7.4.1 | inherited-and-adapted | BS-C01; BS-C06 | Maintained session validation plus same-B live user/session/admission locks and exact token/email digests; termination ordering survives coordinator loss by database ownership. |
| v5.0.0-8.1.1; v5.0.0-8.1.2; v5.0.0-8.1.3; v5.0.0-8.1.4 | selected-design | BS-C04; BS-C05; BS-C11 | Action/object/field matrix includes time, scope, session and authority context; no location/IP scoring introduced. |
| v5.0.0-8.2.1; v5.0.0-8.2.2; v5.0.0-8.2.3; v5.0.0-8.3.1; v5.0.0-8.3.2; v5.0.0-8.3.3; v5.0.0-8.4.1 | selected-design | BS-C01; BS-C04; BS-C05; BS-C06; BS-C07; BS-C13 | Originator-scoped durable commands and same-B final authority; independent worker credential cannot grant user permission. Historical adverse evidence survives policy suspension. |
| v5.0.0-16.1.1; v5.0.0-16.2.1; v5.0.0-16.2.2; v5.0.0-16.2.3; v5.0.0-16.2.4; v5.0.0-16.2.5; v5.0.0-16.3.2; v5.0.0-16.3.3; v5.0.0-16.3.4; v5.0.0-16.4.1; v5.0.0-16.4.2 | allocated-operations-design | BS-C12 | Mutation audit coverage is explicitly adapted for new private subjects. Safe read signals provide aggregate and same-response correlation only, without an actor/resource audit join. Operations owns sink/access/retention; deployed effectiveness remains unexecuted. |
| v5.0.0-16.5.1; v5.0.0-16.5.2; v5.0.0-16.5.3 | selected-design | BS-C05; BS-C11 | Safe failure variants, independent recovery and no cached fallback allow. |

| Surface | Disposition |
| --- | --- |
| Authentication issuance, cryptography, passwords, cookies, OAuth/OIDC, frontend rendering, file upload, WebRTC | Unchanged or absent in this internal slice; reuse existing authentication hardening and verification. No blanket compliance or exemption from later full application assessment. |
| ASVS v5.0.0-8.4.2 administrative interface, 2.3.5 multi-user approval and 2.4.2 human-timing challenges | No new administrative UI, multiple-approval or CAPTCHA requirement is inferred. D03 explicitly selects fresh-login own release and locked unsupported disputes. Shared acquisition limits and exact owner interfaces are selected; no full ASVS level/certification claim. |
| ASVS V16 inventory, sink, retention and alerting details | Allocated to companion operations-evidence design through BS-B06; this document defines required security signals and disclosure rules. Actual deployment/retention effectiveness is a G7 qualification, not claimed. |

## Residual decisions and activation limits

| Risk | Risk | Disposition |
| --- | --- | --- |
| BS-R01 | A public username claim does not prove real-world control; an admitted malicious claimant can squat an unclaimed account. | D03 selects fresh-login own release; unsupported disputes remain locked without incumbent release or implemented independent control proof. Initial association stays explicitly user-asserted. |
| BS-R02 | Sleeper discovery and co-manager field completeness cannot be established by schema alone. | Concrete outcome is partial/unknown unless qualified; fixture/live qualification later determines coverage. Never convert missing roles to removal. |
| BS-R03 | Trusted account/schema-owner credential compromise bypasses application authority assumptions. | Keep separate restricted server credentials, no caller execution of SQL or arbitrary actor assignment, operational provisioning/review. No claim RLS defeats compromised trusted server. |
| BS-R04 | Same-B cross-schema guard introduces contention and migration-owned capability at a sensitive trust boundary. | Bound locks/timeouts; no automatic final retry; qualify exact owner/search_path/grants, all writers and capacity before activation. |
| BS-R05 | An unknown account commit can leave a durable mutation whose acknowledgement was lost. | Same-B auth locks close the earlier separate-connection authority gap. Keep explicit retained-command reconciliation and safe indeterminate output; actual crash schedules remain unexecuted. |
| BS-R06 | Provider quota/licensing, full mixed-workload throughput and continuous-worker hosting cannot be guaranteed by plan arithmetic. | Selected shared gate/interfaces/caps are in acquisition-admission-design.md. Qualify all transport sites, future/core coexistence and measured capacity/cost; reduce admitted capacity or revise licensed quota before expansion. |

The previous missing command lifetime and acquisition choices are now selected, with explicit source-derived boundaries and paper schedules. G6/G7 still require implementation, actual-role/clock/transport/failure tests and operating qualification. No runtime pass, live migration/grant, provider license or deployment is implied.

## Primary sources

- [ASVS 5.0.0 V2](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x11-V2-Validation-and-Business-Logic.md)
- [ASVS 5.0.0 V7](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x16-V7-Session-Management.md)
- [ASVS 5.0.0 V8](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x17-V8-Authorization.md)
- [ASVS 5.0.0 V16](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md)

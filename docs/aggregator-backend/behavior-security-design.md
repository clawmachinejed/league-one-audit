# First-slice behavior and security design

Selected design for G2 and G5. This document and [its structured register](behavior-security-design.json) refine the single normative entry in [README.md](README.md), [contracts.md](contracts.md) and [foundation.json](foundation.json). They do not introduce a second contract, a public API, a runtime implementation or a second ingestion/publication pipeline. The [relational design](relational-design.md) fixes the corresponding keys, SQL owners, guarded mutation paths and exact helper signatures.

`status: selected_design_not_implemented`. Application source baseline: `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`; documentation input: `473e32e`. Every verification method below is **specified, not executed**. Design selection closes the engineering choice of behavior and controls; activation still requires independent implementation qualification. D02 remains strict; D03, D04 and D05 remain product decision gates.

## Context and ownership

G2 composed behavior and G5 changed-surface controls for internal Sleeper identification, exclusive associations, current teams and stored reads. No new public endpoint, authentication system, migration execution or provider.

| ID | Existing owner | Authority | Limit |
| --- | --- | --- | --- |
| BS-AUTH | Existing auth owner | Validate cookie with Better Auth; session/user/admission; auth role only. | No league/source rows; no provider-account ownership assertion. |
| BS-ACCOUNT | Existing account service and restricted account writer | Trusted actor, exclusive association, own preferences/current selections and target response composition. | No raw source or auth-table grants; cannot write shared evidence. |
| BS-ADMIN | Existing administration adapter/normalizer/acceptance writer | Qualified source identities, captured evidence, per-resource acceptance and membership authority generation. | No impersonated L1 session; ingestion permission alone cannot authorize a user's read. |
| BS-WORK | Existing scheduler/jobs/leases | Deduplicated justified work, provider-wide budgets and recovery. | No alternate collector; no target browser Tank01 call. |
| BS-READER | Existing stored resource readers and account presenter | Read accepted immutable references and serialize exact allowed variant. | No network acquisition while reading; no reuse of a cached allow. |
| BS-OPS | Existing operator/release responsibility | Reviewed provisioning, active configuration epoch and diagnostic handling. | No user-triggered privileged takeover; production action requires release authority. |

| Boundary | From | To | Required treatment |
| --- | --- | --- | --- |
| BS-B01 | Untrusted caller | BS-AUTH / BS-ACCOUNT | Inputs select an operation; never actor, issuer, session, audience, generation, policy, owner or entitlement. Unknown extra authority fields rejected. |
| BS-B02 | BS-AUTH | BS-ACCOUNT | Server-only validated session receipt, exact issuer/subject and pinned admission configuration. Auth and account connections retain distinct restricted credentials. |
| BS-B03 | BS-ACCOUNT | BS-ADMIN / BS-WORK | Bounded server-resolved work demand; no raw source mutation. A source fetch uses independent acquisition authority, including after membership expiry. |
| BS-B04 | Sleeper network / retained captures | BS-ADMIN | Source payload is untrusted data; validate exact scope, coverage, identity, timing and policy. Public source identity is not control of that account. |
| BS-B05 | Stored evidence / private cache | BS-READER | Exact audience and immutable references; complete final authorization on every delivery. Shared public evidence does not share private association/follow/session data. |
| BS-B06 | Application services | Diagnostics / operator | Safe enums and correlation only; no cookie/session token, raw payload, email, submitted username or competing actor identity. The companion operations design owns storage/retention/response. |
| BS-B07 | Restricted account/auth role | Owner-controlled fixed-signature guard helpers | Explicit target privilege surface: only allowlisted helper EXECUTE; fixed search_path, fully qualified objects, typed request scope, no dynamic SQL or arbitrary relation/row keys, no PUBLIC EXECUTE, no direct source UPDATE or cross-schema auth grants. Deployment role-manifest checker must recognize exactly these additions; current provisioning forbids unlisted SECURITY DEFINER calls. |

Source allocation:

| Source | Design input |
| --- | --- |
| apps/site/lib/accounts/auth.ts | Maintained getSession; cookie cache and refresh disabled; verified subject/admission; current principal omits session receipt. |
| apps/site/lib/accounts/auth-runtime.ts | Auth credential/session mutation transaction uses advisory lock (19740517,1); target extends guard coverage without replacing Better Auth. |
| apps/site/lib/accounts/neon/database.ts | Transaction-local actor/request context; ReadCommitted; 3000ms lock, 8000ms statement and 12000ms transport deadlines. |
| docs/account-foundation-database.md | Account/auth/worker roles separate; actor credential is trusted; account mutation audit 60 events per rolling 60 seconds; source/raw writes forbidden. |
| docs/account-auth-foundation.md | Existing auth owner, invitation/verification, origin/body controls and preview-disabled behavior retained. |
| contracts.md | D02, exact denial shape, adverse-evidence dominance, independent account access and D03-D05 gates. |
| apps/site/scripts/provision-auth-role.sql | Existing user/session UPDATE grants permit direct auth row locks; epoch/helper additions require explicit manifest changes while retaining isolation. |

## State model and sequences

The state dimensions are independent: association is not proof of a role, membership is not a preference, and an available official resource is not proof that a particular caller may receive it. These are logical states, not a demand for redundant persisted enum columns.

| Dimension | States | Rule |
| --- | --- | --- |
| association | absent; pending; active; ended | Ended association never reactivates; explicit later claim creates new identity after qualification. |
| discovery_scan | not_started; pending; partial; complete; failed | Scan completeness means the declared finite strategy query set completed with qualified account-list evidence. It does not assert role or current-selection completeness. |
| current_teams_result | pending; partial; complete; unavailable | Complete current teams additionally require qualified candidate identity, roster/role evidence and resolved current selections for the declared scope. A complete scan may still have a partial current-team result. |
| membership | unknown; positive; expired; removed | Expired is computed from trusted time, not persisted removal; removal requires exhaustive role evidence. |
| selection | unresolved; selected; renewal_pending | Independent per association/stable league; highest year is not a transition. |
| follow | absent; following; not_following | Preference independent from access. Tombstone persists; D04/D05 transition side effects remain gated. |
| delivery | available; pending; unavailable; denied; indeterminate | denied/indeterminate contain only status and safe reason. |

| Sequence | Scenario | Transition order / racing operations | Required outcome |
| --- | --- | --- | --- |
| BS-S01 | First claim to current roster | BS-T01; BS-T02; BS-T03; BS-T04; BS-T05; BS-T06 | Only qualified positive current roles produce protected delivery; lookup/discovery alone never creates follow or authorization. |
| BS-S02 | Outage and strict expiry recovery | BS-T06; BS-T07; BS-T10; BS-T04; BS-T11; BS-T06 | At T+3600 target data denies; independent bounded acquisition can restore a qualified positive age, while L1 sign-in continues. |
| BS-S03 | Removal or disconnect | BS-T08; BS-T06; BS-T09; BS-T06 | Removal fences all version heads; ended association denies without deleting shared data or changing L1 lifecycle. |
| BS-S04 | Renewal racing explicit unfollow | BS-T12; BS-T13; BS-T06 | Selection follows proved annual continuity per stable league; newer unfollow survives the race and discovery does not re-create it. |
| BS-S05 | Version promotion, remap and crash | BS-T15; BS-T16; BS-T18; BS-T06 | Guards/generations reject stale candidate references; accepted evidence and durable pending work are atomic; replay never refreshes T. |

## BS-P01: guarded final stored delivery

1. Resolve the trusted request and exact cookie/session through the existing auth owner; perform preliminary scope and authority checks before candidate composition. Compose only server-private candidate data and exact immutable source references. This preliminary decision is not a reusable allow; BS-P01 must authorize again after composition.

2. On the pinned auth-role connection, acquire shared advisory transaction lock (19740517,1), then active admission-epoch row FOR SHARE, then exact website_auth.user/session rows FOR SHARE in canonical key order. Validate the current request using maintained Better Auth with cookie cache/refresh off; prove exact subject/session, verified/invited admission and handler config hash equal to active epoch. All auth/session/admission mutations use the exclusive gate and guarded supported DB entry points. This is selected target adaptation, not shipped enforcement.

3. While auth guards remain held, enter the distinct account-role ReadCommitted transaction with transaction-local actor/request context. Lock in this total order: Actor, app_login_identity, ProviderAccount identity, Association (PK order); typed immutable request-ID advisory mutex when reserving work; provider-access/policy-binding; stable Leagues then SourceConnections (UUID order); CurrentSelection, Follow, ServingSelection (canonical tuple order), all FOR SHARE. Only operation-relevant rows are required: an absent preference is irrelevant to a read, but absence of any required authority denies or is indeterminate. Writers follow the compatible total order in relational-design.md. Distinct roles retain their privileges. Existing shared-source SELECT grants do not imply FOR SHARE privilege. The target uses a single fixed-signature, fixed-search-path read/lock SECURITY DEFINER helper in the existing account composition, scoped to exact validated request keys; no free-form SQL, direct shared-source UPDATE or auth-schema privilege is granted to the account role. Auth admission-epoch row locking similarly uses its narrow owner helper. Exact signatures, owners and allowlisted grants are fixed in relational-design.md; these are proposed provisioning changes, not current permissions.

4. After guards are held, reread the complete current dependency vector and complete applicable adverse-evidence set, then compare all candidate immutable references. Membership acceptance, remap and version-promotion writers must lock/update the same connection authority and advance authorization_generation; guarded insertion ensures new adverse evidence cannot be a phantom invisible to the fence.

5. After locks are acquired, read the full accepted/adverse evidence set and final generations. In the final account SQL sample clock_timestamp once and evaluate all predicates using that instant: same exact session unexpired, now < T+3600, earlier context expiry, active actor/association/policy and qualified full adverse set. That guarded evaluation is the logical linearization point. Both role connections must address the same verified database/UTC clock domain; unproved clock/database identity returns indeterminate for target league serving without disabling L1 authentication. No guessed skew allowance.

6. Keep auth guards held until the account transaction completes and its result is validated; then finish the auth transaction. Discard protected candidate data on any commit/transport/abort uncertainty. The final database evaluation follows all slow work; immediately serialize only the exact selected result after both transactions end successfully, without asynchronous provider work, deliberate delay or alternate cached permission. An elapsed request/expiry deadline discards the candidate; never refresh T or extend authority to finish. Responses are private/no-store; already delivered bytes cannot be recalled.

**Lock ordering.** Auth gate and admission/user/session locks precede the account transaction. Account/domain order is Actor → login identity → ProviderAccount identity → Association → immutable request-ID mutex when reserving work → provider access/policy → stable League → SourceConnection → CurrentSelection → Follow → ServingSelection; PK/UUID/canonical tuple order within a class. Source-only writers begin at their first relevant class and never acquire an earlier class or auth gate while holding later locks. The relational design specifies write locks and guarded mutation paths. Privileged-owner bypass remains an operational boundary. Source-connection creators lock the stable League FOR UPDATE before inserting the season/connection; enumerating readers hold the League FOR SHARE. This parent fence covers an initially absent connection. Direct auth and user-account mutation guards acquire their auth gate/actor lock BEFORE STATEMENT or through the owner entry point, before tuple locks.

**Failure and retry.** No automatic retry within a final-read request. Conflict, lock timeout, expired budget, unavailable authority or serialization failure discards composed protected data and returns indeterminate, except proved revocation/expiry returns denied. A later ordinary request evaluates from scratch. Explicit commands may retry the same idempotency identity; no freshness is inherited from failed attempts.

**Bounds.** Reuse account guard maxima: lock 3000ms, statement 8000ms, total request 12000ms; total budget bounds combined auth/domain work, so waits do not stack. Abort releases both connections. These are safety ceilings, not latency SLOs or new polling cadence.

**Configuration and clock.** Target persisted admission epoch is changed only under exclusive auth gate. Handler config hash must match active epoch; old deployment/config denies instead of overriding it. No claim of global consistency among unrelated databases or unguarded operators. Mismatched environment/database identities fail before transaction entry. Distinct credentials must resolve the same intended Neon database/clock domain; current production configuration has not been proved by this design.

**Proof required.** Requires actual guarded SQL under runtime roles and injected schedules BS-O05/06/07/11/12; design reasoning is not passing runtime evidence.

The shared/exclusive auth fence and the per-connection authority fence order only participating guarded actors. The selected target requires every supported mutation path and configuration activation to participate, including database entry points. Schema-owner maintenance and compromised trusted credentials remain explicit operational boundaries. A function name or an in-process mutex is not evidence that the deployed protocol provides this order.

### Narrow privileged adapters and receipt boundary

The auth-to-account receipt is constructed only by the trusted in-process server bridge from the exact current request, maintained auth validation and pinned guarded auth rows. HTTP bodies, browser fields, jobs, caches and stored diagnostics cannot supply it. The read helper validates its exact shape and issuer/subject/actor/login binding, common clock/config context and deadline; it does not acquire auth privileges or independently authenticate a bearer token. This boundary does not withstand compromise of the trusted account credential or arbitrary server code, which already controls SET LOCAL actor context. BS-R03 is explicit; no forged-receipt immunity against that stronger attacker is claimed.

| Adapter | Exact selected signature | EXECUTE caller | Required restriction |
| --- | --- | --- | --- |
| BS-H01 | website_auth.read_admission_epoch_locked_v1(p_expected_hash text,p_expected_issuer text) RETURNS TABLE(revision bigint,config_hash text,issuer text,clock_domain text) | league_one_auth only | After shared advisory gate, helper locks epoch FOR SHARE and compares expected configuration. Existing auth role has UPDATE privilege for direct user/session row locks; epoch manifest/helper additions are explicit target provisioning. |
| BS-H02 | public.read_account_current_roster_v2(p_league_id uuid,p_reader_contract text,p_session_receipt jsonb) RETURNS jsonb | Restricted account role only | Fixed read/lock composition; strict receipt shape from trusted bridge, current_app_actor and exact login/association scope. Lock required source authorities without granting direct UPDATE. Return the closed server-only {result,decisionTiming} envelope; only result is eligible for public serialization. No arbitrary relation or projection. |
| BS-H03 | public.activate_provider_account_v2(p_provider_account_id uuid,p_lookup_capture_id uuid,p_expected_actor_revision bigint,p_request_id uuid) RETURNS jsonb | Restricted account role only | Trusted actor/request context, own subject lookup and both exclusive constraints; explicit mutation/audit guards. No reassignment or external ownership proof. |
| BS-H04 | public.select_account_league_season_v2(p_transition jsonb) RETURNS jsonb | Restricted account role only | Strict exact transition shape, own association, current selection and both mapping revisions; guarded renewal/follow CAS. No caller-defined SQL or generic privileged mutator. |
| BS-H05 | public.begin_provider_request_v2(p_input jsonb) RETURNS jsonb | Existing runtime/job owner only | Strict exact shape and lease/purpose/scope/mapping checks; reserve through existing writer owner. Account/browser cannot call as source writer. |
| BS-H06 | public.record_provider_capture_v2(p_input jsonb) RETURNS jsonb | Existing runtime/job owner only | Strict exact shape, receipt/lease/purpose and authority-generation checks; capture/evidence acceptance uses existing owner and pending-work boundaries. Existing administration functions retain signatures and receive required guards. |

The account read helper returns exactly {result:ReadCurrentRosterResult, decisionTiming:{dbSampleAt,minimumAuthorityExpiresAt,remainingLifetimeMs}|null}. decisionTiming is required and non-null for available/pending/unavailable, because all three contain protected selection fields and require a successful allow. It is null for denied/indeterminate. The trusted bridge checks the conservative lifetime receipt specified in TX01 after both commits, then serializes only result. Never add the timing receipt to a public DTO, cache it as permission or retain it for another request. Extra envelope/receipt/result keys reject. Invalid timing discards protected content and produces an exact safe result.

All six adapters are proposed fixed-signature owner functions with fixed safe search paths, qualified objects and no PUBLIC EXECUTE. Only the exact role-manifest additions are permitted. This is an explicit change in the future privileged-call surface; existing direct table grants remain restricted. [Relational design](relational-design.md) owns the exact interface/JSON, grant and writer-ordering contract; implementation must supply and qualify SQL bodies. It is not current installed permission evidence.

## Transition contracts

Every entry supplies the trusted input, guard, commit owner, boundary, output, failure behavior and recovery. Commands resolve actor and scope server-side before these transitions. No caller-provided receipt or boolean grants authority. A failed guarded command emits no protected candidate and does not silently retry a final reader.

### BS-T01: Identify submitted username

| Field | Decision |
| --- | --- |
| State | lookup absent → identified or unavailable/invalid |
| Input | Trusted actor; opaque submitted username; server request id |
| Guard | Existing admission/origin/input limits; adapter validates stable returned native account key |
| Commit owner | BS-ACCOUNT + BS-ADMIN |
| Atomic / trust boundary | Network outside transaction; append captured lookup evidence through existing evidence owner |
| Output | IdentifyProviderAccountResult; no association/follow/enrollment |
| Fail / retry | Malformed/unknown/network failure yields no fabricated account |
| Recovery | Explicit repeat lookup retains new receipt; username rename never merges identity |
| Independent oracle | BS-O01; BS-O10 |

### BS-T02: Activate association

| Field | Decision |
| --- | --- |
| State | identified/pending → active |
| Input | Subject lookup receipt; trusted actor; idempotency identity |
| Guard | Same subject native key; both active uniqueness constraints; current actor/admission |
| Commit owner | BS-ACCOUNT |
| Atomic / trust boundary | One account writer transaction enforces both constraints and audit/idempotency; conflict rolls back |
| Output | One active association or private-safe conflict |
| Fail / retry | No implicit replacement, no other actor identity; D03 blocks public launch |
| Recovery | Retry same command returns existing own result; fresh claim only after explicit disconnect |
| Independent oracle | BS-O02 |

### BS-T03: Discover candidate leagues

| Field | Decision |
| --- | --- |
| State | active/not_started → pending/partial/complete |
| Input | Association revision; explicit finite season query set and strategy; acquisition context |
| Guard | Current association/context; one unfinished work identity; bounded scheduler admission |
| Commit owner | BS-WORK + BS-ADMIN |
| Atomic / trust boundary | Reserve/checkpoint under existing job fence; release transaction before network; commit per-scope receipts |
| Output | DiscoveryScan with completed scopes and candidates; no follow |
| Fail / retry | Failed scope stays unfinished/partial, not empty |
| Recovery | Resume unfinished scopes under same immutable strategy; restart after revision mismatch |
| Independent oracle | BS-O03; BS-O09 |

### BS-T04: Qualify candidate and shared teams

| Field | Decision |
| --- | --- |
| State | candidate/unknown → positive or unknown/removed |
| Input | League identity/settings plus captured roster population/role groups |
| Guard | Exact native identity; independent expected population; valid owner/co-manager groups; current mapping |
| Commit owner | BS-ADMIN |
| Atomic / trust boundary | Accepted manager and held resources independently commit under existing writer fences; connection authority changes with membership evidence |
| Output | Shared season-team identities, role evidence; official roster independent of optional decoration |
| Fail / retry | Malformed players cannot suppress qualified removal; unknown roles cannot invent removal |
| Recovery | Bounded ordinary revalidation; retain original-age last-good facts |
| Independent oracle | BS-O04; BS-O08; BS-O10 |

### BS-T05: Choose initial current season

| Field | Decision |
| --- | --- |
| State | unresolved → selected |
| Input | Qualified stable league identity; association; current eligible team evidence |
| Guard | No competing lineage/current choice; positive within D02; no selection by max year |
| Commit owner | BS-ACCOUNT |
| Atomic / trust boundary | CAS current-selection key and authority; same-league references enforced |
| Output | Per-league CurrentSelection and all proven team IDs |
| Fail / retry | Ambiguity returns unresolved; no silent newer-season override |
| Recovery | Resume after qualified lineage/role evidence |
| Independent oracle | BS-O03; BS-O08 |

### BS-T06: Compose and deliver stored roster

| Field | Decision |
| --- | --- |
| State | selected → available/pending/unavailable/denied/indeterminate |
| Input | Trusted actor; candidate stored refs; BS-P01 vector |
| Guard | BS-P01 full coherent allow or safe denial; exact audience/coverage |
| Commit owner | BS-READER + BS-AUTH + BS-ACCOUNT |
| Atomic / trust boundary | BS-P01 final decision boundary; no provider calls |
| Output | Exact result variant; pending is not empty |
| Fail / retry | Any uncertain guard abort discards protected result |
| Recovery | Next ordinary request starts new decision; no automatic retry |
| Independent oracle | BS-O05; BS-O06; BS-O07 |

### BS-T07: Membership clock reaches expiry

| Field | Decision |
| --- | --- |
| State | positive → expired |
| Input | Trusted evaluation time and original qualifyingVerifiedAt |
| Guard | now >= min(T+3600,earlier authority expiry) |
| Commit owner | BS-ACCOUNT |
| Atomic / trust boundary | Computed at decision; no fake removal write |
| Output | Denied affected league serving only |
| Fail / retry | No grace extension on failure/cache/replay |
| Recovery | BS-T10 independently schedules recovery |
| Independent oracle | BS-O06 |

### BS-T08: Accept complete role loss

| Field | Decision |
| --- | --- |
| State | positive/unknown → removed |
| Input | Exhaustive qualified all-team owner/co-manager exclusion |
| Guard | Current scope/context/mapping; complete role and population proof |
| Commit owner | BS-ADMIN |
| Atomic / trust boundary | Connection guard + membership receipt/adverse evidence/authorization_generation + required pending work atomically |
| Output | Early denial for that actor/league; shared data survives |
| Fail / retry | Any unknown relevant role keeps loss unproved; existing positive expires normally |
| Recovery | BS-T11 later qualified correction may restore eligibility |
| Independent oracle | BS-O04; BS-O11 |

### BS-T09: Disconnect association

| Field | Decision |
| --- | --- |
| State | active → ended |
| Input | Trusted actor; expected association revision |
| Guard | Own active association; command current; audit limits |
| Commit owner | BS-ACCOUNT |
| Atomic / trust boundary | End and revision/audit in account transaction; no shared facts deleted |
| Output | Immediate target deny; L1 sign-in and other actors intact |
| Fail / retry | Stale command conflict, no automatic reassignment |
| Recovery | New association requires explicit qualified claim; D03 applies to recovery |
| Independent oracle | BS-O02; BS-O05 |

### BS-T10: Request recovery after expiry

| Field | Decision |
| --- | --- |
| State | expired → revalidation pending |
| Input | Authenticated actor; still active association; independently valid acquisition demand |
| Guard | Expiry not prerequisite allow; context not revoked; bounded deduped work |
| Commit owner | BS-WORK |
| Atomic / trust boundary | One pending scope/purpose/input identity through existing jobs; no request-held DB transaction |
| Output | Pending work; serving stays denied until qualification |
| Fail / retry | Disconnect/permission revocation cannot be bypassed; budget exhaustion returns pending/limited |
| Recovery | Ordinary scheduler resumes admitted work; no new cron |
| Independent oracle | BS-O09 |

### BS-T11: Accept qualified positive correction

| Field | Decision |
| --- | --- |
| State | expired/removed/unknown → positive |
| Input | Fresh qualified role receipt; exact adverse evidence/supersession proof |
| Guard | Current authority; proven ordering; no incomparable or replay-created freshness |
| Commit owner | BS-ADMIN + BS-ACCOUNT |
| Atomic / trust boundary | Existing acceptance and connection authority commit; next BS-P01 evaluates new evidence |
| Output | Eligibility can recover; D02 from actual qualified network time |
| Fail / retry | Unknown set or unsuperseded removal continues denying |
| Recovery | Ordinary fresh revalidation; D04 follow reaction remains unactivated |
| Independent oracle | BS-O06; BS-O11 |

### BS-T12: Verify annual renewal

| Field | Decision |
| --- | --- |
| State | selected old season → selected successor |
| Input | Both mapping revisions; fresh successor roles; expected selection and follow revisions |
| Guard | Same stable league; nonconflicting predecessor link; no merely later-year candidate |
| Commit owner | BS-ACCOUNT + BS-ADMIN |
| Atomic / trust boundary | Ordered connection locks; current-selection CAS; existing follow carryover guarded by exact current preference |
| Output | Only this league advances; existing follow preserved unless newer unfollow |
| Fail / retry | Mapping/selection conflict aborts; newer unfollow never overwritten |
| Recovery | Reevaluate with current references; do not create new follow |
| Independent oracle | BS-O08; BS-O12 |

### BS-T13: Explicit unfollow

| Field | Decision |
| --- | --- |
| State | following → not_following |
| Input | Trusted actor; stable league; preference revision |
| Guard | Own preference, existing writer limits |
| Commit owner | BS-ACCOUNT |
| Atomic / trust boundary | Persist tombstone/new revision and audit atomically |
| Output | Preference changes only; eligibility unchanged |
| Fail / retry | Stale command safe conflict |
| Recovery | Explicit subsequent follow command; D05 worker/retention effects remain gated |
| Independent oracle | BS-O12 |

### BS-T14: Explicit follow

| Field | Decision |
| --- | --- |
| State | absent/not_following → following |
| Input | Trusted actor; stable league; explicit command |
| Guard | Current eligibility and selected league; command is not discovery |
| Commit owner | BS-ACCOUNT |
| Atomic / trust boundary | Preference writer/revision/audit; absent-key race constrained |
| Output | Own follow only; no access grant |
| Fail / retry | Ineligible/unknown denies preference activation; no new collection policy inferred |
| Recovery | Retry idempotently after explicit user action and qualification |
| Independent oracle | BS-O12 |

### BS-T15: Promote/revert serving interpretation

| Field | Decision |
| --- | --- |
| State | binding v1 → binding v2 or unchanged |
| Input | Qualified candidate policy tuple; expected binding; exact adverse set |
| Guard | Compatible audience/coverage; no bypass of removal; no cross-head ordinal ordering |
| Commit owner | BS-ADMIN |
| Atomic / trust boundary | Connection guard; binding and authorization_generation with required pending materialization in one commit |
| Output | Selected policy changes; D02 age unchanged by replay/promotion |
| Fail / retry | Incomplete comparison/adverse set refuses change |
| Recovery | Same-owner fresh qualification; safe compatible rollback only |
| Independent oracle | BS-O11 |

### BS-T16: Remap source / stale in-flight work

| Field | Decision |
| --- | --- |
| State | mapping A → mapping B or later A |
| Input | Reviewed mapping command; existing immutable revision/generation |
| Guard | Exact current revision; source owner authority |
| Commit owner | BS-ADMIN |
| Atomic / trust boundary | Connection guard; mapping/authorization generation advance; histories retained |
| Output | Prior captures/jobs fail fence even after A-B-A |
| Fail / retry | Old reservation cannot accept/publish under reused native key |
| Recovery | Reserve new work under current mapping |
| Independent oracle | BS-O11 |

### BS-T17: Auth logout/reset/revoke/admission change

| Field | Decision |
| --- | --- |
| State | session admitted → session invalid or config epoch changed |
| Input | Existing maintained auth command or authorized configuration rollout |
| Guard | Exclusive existing auth gate; supported DB writes guarded; exact active config binding |
| Commit owner | BS-AUTH |
| Atomic / trust boundary | Auth transaction commits mutation/session invalidation/epoch; no app schema privileges |
| Output | New target reads deny; already linearized delivery may finish |
| Fail / retry | Failed auth mutation rolls back; no new session epoch or custom token |
| Recovery | Existing auth recovery only; provider state irrelevant to L1 sign-in |
| Independent oracle | BS-O07 |

### BS-T18: Crash/fail during acceptance or final read

| Field | Decision |
| --- | --- |
| State | work reserved/composition → resumable or no delivery |
| Input | Crash point before/after commit; job lease and immutable references |
| Guard | Existing receipt and pending-work atomicity; idempotency |
| Commit owner | BS-ADMIN / BS-READER |
| Atomic / trust boundary | Acceptance plus durable next work atomic; final-read no durable allow |
| Output | Restart does not duplicate facts or lose pending work |
| Fail / retry | Commit uncertainty forbids protected delivery; no replay refresh |
| Recovery | Worker reclaims expired lease under current fences; reader fresh request |
| Independent oracle | BS-O13 |

## Action, object and field authorization

This matrix models the target eligible-current-team path. It does not change existing general follow APIs or existing public routes. The final condition is conjunctive: admitted L1 request, active binding, scope-compatible qualified membership, strict freshness, applicable acquisition/audience authority and current selection/version must all hold. Denial is not a redacted success. Its serialized keys are exactly `status` and `reason`; internal decision dependencies stay server-only.

| ID | Actor | Action | Object | Precondition | Allowed fields / effect | Prohibited | Owner | Controls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BS-AZ01 | Unauthenticated, disabled, unverified or uninvited caller | Any target private service action | Target first-slice results | No private admission | Safe failure only; existing public routes retain existing behavior | No target team/league/association metadata | BS-AUTH | BS-C01; BS-C05 |
| BS-AZ02 | Admitted L1 actor | Identify | Submitted Sleeper username | Read-only bounded request and source validation | Public provider identity/display and opaque own lookup receipt | No other L1 link status/actor; no association activation | BS-ACCOUNT | BS-C02; BS-C03; BS-C10 |
| BS-AZ03 | Admitted actor with qualified subject lookup | Claim or end own association | Association / ProviderAccount | Atomic two-way uniqueness; trusted actor; expected revision | Own association ID/state/revision or generic conflict | No other actor identity; no reassignment; no ownership-proof claim | BS-ACCOUNT | BS-C01; BS-C02 |
| BS-AZ04 | Actor with active association | Discover/current-team list | Own association and candidate scans | Qualified strategy, audience, same association revision; BS-P01 before target private delivery | Qualified own selections/team options and honest scope status; server-only unresolved refs remain server-side | No auto-follow, unrelated protected candidates or arbitrary account scan | BS-ACCOUNT | BS-C03; BS-C04; BS-C06 |
| BS-AZ05 | Currently qualified owner/co-manager | Stored current-roster read | Selected league season / shared teams | BS-P01 allow; exact evidence/audience/field coverage | Available exact roster variant; authorized native held IDs with optional features independently limited | No raw captures, auth/dependency vector, exact-week fiction or estimate for official data | BS-READER | BS-C04; BS-C05; BS-C06; BS-C10 |
| BS-AZ06 | Member/commissioner without qualifying role; expired/removed/ended association | Protected target read | League and team content | No qualifying allow | Exactly status/reason | No IDs, roster, revision, field/source metadata, features or other account identity | BS-READER | BS-C05; BS-C06; BS-C11 |
| BS-AZ07 | Admitted actor with active association but expired membership | Schedule bounded recovery | Own membership source demand | Independent acquisition context remains valid; one work identity; existing budget | Safe work pending/limited result; no league payload before requalification | No revoked-context bypass, synchronous provider fetch in reader or duplicate storm | BS-WORK | BS-C03; BS-C11 |
| BS-AZ08 | Admitted eligible actor | Follow/unfollow | Own stable-league preference | Explicit command and expected revision; applicable follow gate | Own preference revision/tombstone | No eligibility grant; no automatic D04 regain or D05 deletion/collection change | BS-ACCOUNT | BS-C08 |
| BS-AZ09 | Existing acquisition worker | Capture/accept/materialize | Exact resource scope | Lease/context/mapping/reservation/fence; independently qualified groups | Existing writer-defined source/evidence fields and pending-work receipts | No user-session impersonation, account preference writes or permission from shared worker credential | BS-ADMIN | BS-C04; BS-C06; BS-C07; BS-C09 |
| BS-AZ10 | Ordinary account/auth/worker database role | Cross-boundary SQL | Other schema / raw data / privileged functions | Existing grants plus exactly the proposed guarded-helper EXECUTE allowlist; no broad role or table-grant expansion | Minimal sanctioned projected reads or own-domain actions | Account/worker cannot read auth; auth cannot read league/account; account cannot source-write; no owner membership | Existing DB role owners | BS-C01; BS-C04; BS-C12; BS-C13 |
| BS-AZ11 | Authorized operator | Policy/admission/promotion provisioning and diagnosis | Versioned configuration and diagnostic evidence | Separate operational authority, exact config epoch and guarded writers; review release gates | Necessary safe diagnostics and approved config only | No owner takeover via caller input; no secret/raw identity logging; no arbitrary public claim displacement | BS-OPS | BS-C02; BS-C07; BS-C12 |

## Threat, control and verification allocation

| Control | Threat / abuse | Selected control | Owner | Existing cases | Oracle | Residual / qualification |
| --- | --- | --- | --- | --- | --- | --- |
| BS-C01 | Forged actor/session/provider IDs; pooled context confusion | Resolve identity only through auth owner; exact typed keys; SET LOCAL actor and request on pinned transaction; compare returned scope, not requested ID alone; preserve role separation | BS-AUTH / BS-ACCOUNT | FS08; FS13; FS18 | BS-O01; BS-O05; BS-O07 | Trusted server credential compromise is outside RLS protection; BS-R03. |
| BS-C02 | Squatting, conflicting claim, link-status enumeration | Both exclusive constraints atomically; same generic conflict shape and safe reason; avoid competing-actor lookup/return. Idempotency applies only to same trusted actor/subject. Public username data remains public; no promise to hide that a requested claim cannot succeed. | BS-ACCOUNT | FS02; FS03; FS18 | BS-O02 | D03 must settle mistaken/malicious claim recovery before public launch; cannot prove external control. |
| BS-C03 | Lookup/discovery/recovery amplification and quota exhaustion | Retain existing admission and mutation rate guards; one unfinished logical job per association revision/scope/purpose; checkpoint declared finite query set; existing provider-wide budgets count actual HTTP starts. Joining pending work does not reset age or allocate another job. Unadmitted demand never reaches fetch. | BS-ACCOUNT / BS-WORK | FS09; FS16; FS17; FS19 | BS-O03; BS-O09 | No new rate/cadence invented; capacity limit may return partial/pending. Broad public launch needs measured budgets. |
| BS-C04 | Cross-provider, team, season or audience reference injection | Exact tuple validation at command, acceptance and read boundaries; referenced account/native identity agrees; selected teams same stable league and season; no implicit private audience widening; native and internal IDs distinct. Use parameterized SQL; the adapter builds an allowlisted provider route with encoded native keys/username, never a caller-supplied URL or SQL fragment. | BS-ADMIN / BS-READER | FS01; FS13; FS15; FS16 | BS-O01; BS-O08 | Valid public captures may share; private grants must remain separate until equivalent visibility proved. |
| BS-C05 | Cached allow, denied-payload leakage, error disclosure | Private/no-store target responses; caches hold immutable facts, never reusable entitlement; BS-P01 reauthorizes each delivery. Exact denied/indeterminate keys only. Exceptions discard candidate data; safe reason enum not driver message. | BS-READER | FS05; FS08; FS13 | BS-O05; BS-O14 | Already delivered bytes cannot be recalled; upstream public Sleeper data is not made private. |
| BS-C06 | Incoherent final auth, hidden adverse evidence, missing-row phantoms | BS-P01 locks actual authorities and per-connection authorization_generation; guarded writers serialize membership insertion/remap/promotion; complete adverse set includes all qualified policy heads. Unknown set forbids allow. | BS-ACCOUNT / BS-ADMIN | FS07; FS08; FS10; FS21 | BS-O05; BS-O11 | Exact DDL/SQL and guard trigger coverage require implementation qualification; no claim protocol deployed. |
| BS-C07 | Cross-version promotion bypass, replay renewal, stale worker writes | Serving selection is explicit CAS under connection guard; adverse removal supersession needs retained ordering proof. No cross-head ordinal order, semver selection or replay freshness. Commit binding/pending work and authority generation together. | BS-ADMIN | FS09; FS10; FS21; FS22 | BS-O11; BS-O13 | Unknown comparative lineage stays denied and requests ordinary fresh qualification. |
| BS-C08 | Renewal overwrites newer unfollow; discovery makes follow | No automatic discovery follow. Renewal compares predecessor/successor mapping and current-selection revisions; preference absent/tombstoned/newer unfollow cannot be created/replaced by carryover. | BS-ACCOUNT | FS14; FS20 | BS-O08; BS-O12 | D04/D05 side effects stay gated; this control does not choose them. |
| BS-C09 | Crash loses required rebuild or duplicates evidence | Existing receipt/job uniqueness and atomic pending-work commit; immutable captures and resumable checkpoints; fail stale lease/generation. No mutable permit persisted as authority. | BS-ADMIN / BS-WORK | FS09; FS10; FS22 | BS-O13 | Recovery implementation and DB fault schedules remain unexecuted. |
| BS-C10 | Optional malformed data suppresses valid identity or removal | Separate identity, manager, held-player and optional directory/catalog groups; other-manager identities resolve from qualified role keys, not mandatory username calls. Malformed players cannot mask complete removal; missing co-owners cannot prove exclusion. | BS-ADMIN | FS01; FS07; FS11; FS12; FS18 | BS-O04; BS-O10 | Source field coverage requires empirical qualification; null is not empty. |
| BS-C11 | Expiry extends during outage/retry or recovery locks itself out | Trusted single clock-domain evaluation; strict equality expiry; failed/cached/replayed/partial-unqualified evidence never advances T; recovery uses independent acquisition authority after expiry; L1 login unaffected. | BS-ACCOUNT / BS-WORK | FS06; FS17; FS22 | BS-O06; BS-O09 | Outage may deny league data; this is required bounded access, not account suspension. |
| BS-C12 | Sensitive or forged diagnostics; unguarded privileged mutations | Retain append-only account audit; diagnostic enum/correlation references only, structured encoding. The companion operations design binds sink/retention/access/stop conditions. All supported authority mutators use declared guards; schema-owner maintenance separately controlled. | BS-OPS | FS08; FS13 | BS-O07; BS-O14 | Full infrastructure/owner compromise and ASVS certification unassessed; G7 verifies deployed effectiveness. |
| BS-C13 | New guard helper becomes arbitrary privileged read/write, role escalation or row-lock denial of service | One fixed-signature account read/lock composition helper and narrow auth epoch helper, with exact scope validation, fixed search_path, fully qualified names, bounded returned projection and declared transaction timeout. Explicit manifest allowlist only; revoke PUBLIC and unrelated-role EXECUTE. No dynamic SQL, direct caller-selected actor authority or broad source UPDATE. Existing owners retain mutation guards. | BS-ACCOUNT / BS-AUTH / BS-OPS | FS08; FS13; FS18 | BS-O15 | Target helper DDL, ownership and grant-manifest changes need hostile-role qualification before activation; no live privileges changed. |

## Independent fixture and oracle methods

These methods are executable test specifications for future isolated qualification. They are independent of the documentation checker: the checker can establish register consistency and required coverage, but cannot establish authorization effectiveness, database isolation, lock timing, provider completeness or recovery. Expected results come from policy, immutable before/after evidence and explicit schedule boundaries; they must not be generated by copying implementation output. No production database or credentials are needed or authorized by this design.

| Oracle | Method | Fixture | Schedule | Expected result | Evidence | Execution status |
| --- | --- | --- | --- | --- | --- | --- |
| BS-O01 | Typed fixture + guarded role SQL | Two actors/providers/seasons with colliding IDs and renamed username | Alter one typed key at each command/read boundary; forge actor/issuer/generation fields; inject URL delimiters and SQL-like username text | Reject wrong-key request; unchanged committed target rows; no protected response; valid native IDs remain exact | Independent expected literal keys and before/after DB rows, not same production mapper. | specified_not_executed |
| BS-O02 | Concurrent real writer transactions + serialized response inspection | A/B claim one native account; A claims two same-provider accounts | Barrier after each precheck; commit both; rerun winning command idempotently | Exactly one active relationship in each exclusive dimension; no displaced links; loser has generic conflict only | Query active constraints/history/audit with guarded verifier; compare serialized key set and absence of competitor identifier. | specified_not_executed |
| BS-O03 | Fake provider fixture and job inspection | Declared seasons with older nonrenewed and new candidates, duplicate triggers | Fail one list scope; resume checkpoint; interleave association revision change | Partial not empty/complete on gap; one unfinished work identity; stale continuation cannot publish | HTTP-start ledger and committed scan receipts compared to independently listed expected scope set. | specified_not_executed |
| BS-O04 | Normalizer resource fixtures + real acceptance | Known owner, unknown/null/empty co-owners, two teams; malformed players | Accept complete removal roles while players invalid; repeat with unknown role group | Valid removal denies independently; unknown co-owners never establish removal; unaffected teams remain | Independent source-role truth table; inspect manager/held acceptance receipts and qualification reasons separately. | specified_not_executed |
| BS-O05 | Controlled final-read concurrency + pool reuse | Permissive actor/association/role set with another actor connection | Barrier before/after each BS-P01 guard; concurrent revoke/remap/remove; reuse pooled connection | Writer before guard is observed; writer after final guard waits and orders after valid read; no mixed-state allow; actor context never leaks | Timeline with lock acquisition/commit/decision instants and exact response keys; inspect restricted-role context, not return status alone. | specified_not_executed |
| BS-O06 | Injected trusted clock + domain SQL | Positive T; context/session earlier deadlines; partial/cache/replay inputs | Evaluate 3599,3600,3601 seconds; expire while blocked acquiring guard; replay old evidence | Allow only before earliest expiry; equality denies; no T advance except fresh independently qualified positive group | Literal expected deadlines from fixture; compare stored verification timestamps and response suppression; no server-time sleep test. | specified_not_executed |
| BS-O07 | Maintained auth path + restricted roles | Same cookie/session; reset/logout/revoke/admission epoch switch; old deployment config | Interleave BS-P01 with supported auth writers and direct guarded auth-role mutation; force abort | Committed mutation before admission prevents new allow; held read orders first; old config denied; account/worker cannot query auth; failed auth tx never partial commit | Real session/user/epoch state plus locked timeline and role-denial SQL; cookie never copied to logs. | specified_not_executed |
| BS-O08 | Identity/renewal matrix + writer race | Two stable leagues selecting different years, old completed league, conflicting successor | Newer year candidate alone; cross-league successor injection; verified transition | Only proven same-league renewal advances; independent current years survive; route/UUIDs preserved | Independent expected relation tuples and committed selections; no max-year derived oracle. | specified_not_executed |
| BS-O09 | Bounded scheduling + acquisition ledger | Expired actor with active association; revoked context; many tabs/co-managers | Submit duplicate recovery/view demands during failure and after context revocation | One compatible pending job; request budget conserved; revoked work stops; expiry can recover via fresh positive; L1 auth works | HTTP-start count, job key cardinality and explicit auth control request; no timing-only quota assertion. | specified_not_executed |
| BS-O10 | Optional-data fault injection | Lookup subject plus other manager only in roster; missing users/catalog/projections | Fail optional services; malformed optional rows; keep valid held IDs/role truth | No per-other-manager username request; subject claim still requires own lookup; official content not blocked by missing decorations | Provider call ledger + normalized identity tuples + expected coverage labels; invalid optional output never becomes invented empty fact. | specified_not_executed |
| BS-O11 | Real connection guard and versioned-head schedules | v2 positive T1; v1 qualified removal T2; A-B-A mapping; empty adverse set | Promote/revert/replay T1; insert removal/new qualified head during final set evaluation | No older positive allow, no replay age advance; guard includes phantom insertion; supersession requires exact ordering proof; stale writer fenced | Inspect immutable refs/generations, ordering proof and writer/read timeline; do not compare different head ordinals. | specified_not_executed |
| BS-O12 | Follow CAS/renewal concurrent writers | Following revision r; two mapping revisions; concurrent newer unfollow | Pause renewal then commit unfollow; repeat absent follow; race two renewal selectors | Unfollow tombstone wins, no discovered/absent follow created; selection cannot use stale mapping; D04/D05 side effect count zero | Inspect preference history/current tuple and selection rows; explicit event list, not UI label only. | specified_not_executed |
| BS-O13 | Crash injection at commit boundaries | Accepted input, pending materialization, claim/lease, restart | Crash before acceptance, before commit, after commit before acknowledge, during final read commit | Atomic receipt+pending work; idempotent restart, no missing rebuild; uncertain reader sends no protected data | Compare canonical identity/receipt counts, pending checkpoint and immutable hashes across restart. | specified_not_executed |
| BS-O14 | Serialization/log-capture fixtures + role deny tests | Strings with CR/LF, secret-like markers, competing identity markers, backend error | Inject each into malformed input/error path; simulate log failure and final authority error | Only safe schema/enum/correlation events; no driver/raw payload/session/competitor marker; fail closed result | Scan captured output/logs with independent marker denylist and required-field allowlist; log sink permissions tested separately at G7. | specified_not_executed |
| BS-O15 | Adversarial helper privilege and scope matrix | Actual proposed helpers deployed only in isolated guarded harness, every restricted role and two actors/audiences; temporary shadow names and malicious tuple inputs | Call each helper as PUBLIC/unrelated worker/account/auth roles; probe ill-shaped and cross-actor/audience receipt values, extra keys, mismatched actor/login bindings, search_path shadowing, expired budget, direct source UPDATE and direct auth SELECT. Submit a forged receipt through every HTTP/queue entry to prove it cannot enter the trusted bridge. Concurrent legitimate read establishes denial-of-service budget. | Only exact allowlisted role/signature invocation operates on trusted server-resolved scope; forbidden direct grants remain absent; malformed or mismatched fields reject. No arbitrary query/read/write, helper privilege escalation or transaction-surviving actor context. Failed or timed-out call returns no protected data. Compromise of the trusted account credential is excluded by BS-R03, not falsely tested as prevented. | Catalog privilege/owner/search_path evidence plus role-specific result and mutation inspection; do not infer security from application return status alone. | specified_not_executed |

## Selected ASVS 5.0.0 applicability

The IDs below refer to the tagged 5.0.0 requirements. `selected-design` means a control has been chosen and allocated, not that an ASVS requirement passed. `inherited-and-adapted` requires regression of the maintained authentication path. `allocated-operations-design` requires the companion operational artifact and later live evidence. This is a changed-surface applicability assessment, not full-application ASVS certification or a claim that every unlisted requirement is satisfied.

| Exact requirement IDs | Disposition | Controls | Applicability |
| --- | --- | --- | --- |
| v5.0.0-2.1.1; v5.0.0-2.1.2; v5.0.0-2.2.1; v5.0.0-2.2.2; v5.0.0-2.2.3 | selected-design | BS-C01; BS-C04; BS-C10 | Typed and cross-record validation at trusted boundaries. |
| v5.0.0-2.1.3; v5.0.0-2.3.2; v5.0.0-2.4.1 | selected-design | BS-C03 | Existing limits plus request coalescing bound caller-amplified work. |
| v5.0.0-2.3.1; v5.0.0-2.3.3; v5.0.0-2.3.4 | selected-design | BS-C02; BS-C08; BS-C09 | Ordered association/renewal operations use atomic uniqueness and CAS. |
| v5.0.0-7.2.1; v5.0.0-7.4.1 | inherited-and-adapted | BS-C01; BS-C06 | Maintained backend session verification; final guarded delivery rechecks actual termination. |
| v5.0.0-8.1.1; v5.0.0-8.1.2; v5.0.0-8.1.3; v5.0.0-8.1.4 | selected-design | BS-C04; BS-C05; BS-C11 | Action/object/field matrix includes time, scope, session and authority context; no location/IP scoring introduced. |
| v5.0.0-8.2.1; v5.0.0-8.2.2; v5.0.0-8.2.3; v5.0.0-8.3.1; v5.0.0-8.3.2; v5.0.0-8.3.3; v5.0.0-8.4.1 | selected-design | BS-C01; BS-C04; BS-C05; BS-C06; BS-C07; BS-C13 | Trusted consumer-specific decisions; immediate accepted-revocation handling; shared worker permission is insufficient. |
| v5.0.0-16.1.1; v5.0.0-16.2.1; v5.0.0-16.2.2; v5.0.0-16.2.3; v5.0.0-16.2.4; v5.0.0-16.2.5; v5.0.0-16.3.2; v5.0.0-16.3.3; v5.0.0-16.3.4; v5.0.0-16.4.1; v5.0.0-16.4.2 | allocated-operations-design | BS-C12 | Safe signals defined here; companion operations artifact owns inventory, correlation, access and retention; effectiveness unexecuted. |
| v5.0.0-16.5.1; v5.0.0-16.5.2; v5.0.0-16.5.3 | selected-design | BS-C05; BS-C11 | Safe failure variants, independent recovery and no cached fallback allow. |

| Unchanged / absent / separately allocated surface | Reason and limit |
| --- | --- |
| Authentication issuance, cryptography, passwords, cookies, OAuth/OIDC, frontend rendering, file upload, WebRTC | Unchanged or absent in this internal slice; reuse existing authentication hardening and verification. No blanket compliance or exemption from later full application assessment. |
| ASVS v5.0.0-8.4.2 administrative interface, 2.3.5 multi-user approval and 2.4.2 human-timing challenges | No new administrative UI or sensitive transfer operation. Do not add MFA, multiple approval or CAPTCHA policy from a guideline. Privileged operators remain separately authorized; first-slice anti-amplification uses admission, budgets and deduplication. |
| ASVS V16 inventory, sink, retention and alerting details | Allocated to companion operations-evidence design through BS-B06; this document defines required security signals and disclosure rules. Actual deployment/retention effectiveness is a G7 qualification, not claimed. |

Primary requirement sources:

- [ASVS 5.0.0 V2](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x11-V2-Validation-and-Business-Logic.md)
- [ASVS 5.0.0 V7](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x16-V7-Session-Management.md)
- [ASVS 5.0.0 V8](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x17-V8-Authorization.md)
- [ASVS 5.0.0 V16](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md)

The companion [scenario analysis](quality-operations.md#refined-scenarios-and-analysis) and [selected alternatives](quality-operations.md#selected-alternatives-and-decision-record) explain quality tradeoffs. Its [operating evidence contract](quality-operations.md#operating-evidence-contract) fixes the diagnostic envelope and retention; its [verification and transition plan](quality-operations.md#verification-and-transition-plan) owns rollout/rollback gates.

## Residual decisions and activation limits

| Risk | Concrete remaining risk | Disposition |
| --- | --- | --- |
| BS-R01 | A public username claim does not prove real-world control; an admitted malicious claimant can squat an unclaimed account. | Preserve approved user-asserted model. No automatic displacement or new ownership proof. D03 blocks public exclusive-claim launch; operator decisions cannot be invented by implementation. |
| BS-R02 | Sleeper discovery and co-manager field completeness cannot be established by schema alone. | Concrete outcome is partial/unknown unless qualified; fixture/live qualification later determines coverage. Never convert missing roles to removal. |
| BS-R03 | Trusted account/schema-owner credential compromise bypasses application authority assumptions. | Keep separate restricted server credentials, no caller execution of SQL or arbitrary actor assignment, operational provisioning/review. No claim RLS defeats compromised trusted server. |
| BS-R04 | Concurrent guard holders and layered auth/domain connections may exhaust the small pilot pool. | No automatic retry; one bounded final-read attempt and existing deadlines. Pool saturation/failure yields indeterminate; measured contention qualification before activation. No new fleet SLO asserted. |

The behavior and security design is selected for the internal first slice. It does not authorize public exclusive-claim launch while D03 is open, membership-loss/regain follow behavior while D04 is open, or last-follower collection/retention changes while D05 is open. Existing public behavior and L1 sign-in remain separate. G6/G7 must demonstrate the specified controls under the actual restricted roles, qualified source evidence, deliberate races and failures, supported provisioning manifest and reviewed deployment configuration before activation. Those are evidence gates, not placeholders for the behavior or control choices above.

# Phase 1: shared provider boundary design

Version 1.0 — October 21, 2026. Design only. This records the shared decisions and first standings increment under the [remediation plan](provider-independence-remediation.md). It authorizes no implementation, test, installation, provider request or release. CP28 remains frozen.

## Outcome and authority

The target remains one database and one acceptance system. An adapter translates its provider's evidence; that adapter's private verifier independently checks the translation; shared acceptance stores and serves the resulting League One facts. A provider may use different IDs, response shapes and endpoints without pretending to be Sleeper. SQL and stored readers make no provider requests.

This increment delivers three linked specifications:

| Document | Decision owned here |
| --- | --- |
| This shared design | Identity, trust, source lineage, common delivery and storage rules, compatibility, permissions and implementation boundaries |
| [Standings slice specification](provider-independence-standings-design.md) | First complete adapter → verified write → stored read path, exact fields, objects, functions, grants, guards and planned assertions |
| [Family dependencies and coverage](provider-independence-phase1-coverage.md) | All eight family owners, identity dependencies, guard destinations, implementation order and finite Q01–Q16 evidence mapping |

The parent plan's six R responsibilities, eight families, Q01–Q16, protected behavior and checkpoint outcomes are the fixed finish line. This is shared-design and first-slice readiness only. Full R1 remains open until every family's detailed specification is reviewed. R2–R6 implementation and execution are not complete because these documents exist.

The owner's instruction is “Start Phase 1 … Complete the shared design and the first standings slice specification … Keep CP28 frozen. No implementation or tests yet.” Only documentation is changed. The existing documentation worktree is reused; neither primary main nor the frozen candidate is an editing destination.

## Exact sources and migration decision

| Source | Identity and use |
| --- | --- |
| Main/documentation base | `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`, committed tree `a32e1b924432261bfca5f1a198c02a855ff6ff20`; local and GitHub main agree on October 21 |
| Published DATA reference | `168a856ae44e7431393b0a8a9404483dda294ccc`; PR318 open, draft and unmerged on October 21; migrations through 062 |
| Frozen coherent DATA source | `8f026c21ce2e633ba94368f63f3c01cac605f3d3`, tree `134b3b104c64a2c4855528870c122bc41b71e7ba`; complete source through 065, eight commits after published DATA |
| Documentation | Uncommitted Markdown on `codex/architecture-reference`; the main commit/tree identify its base, not these new files |
| Production evidence | Last observed October 20, as recorded in the source inventory; not live-revalidated by this design task. Fresh repository/service/production checks remain mandatory before implementation and deployment |

**D08 is resolved:** a separately authorized future implementation starts from the complete coherent `8f026c2` source in a separate worktree and appends forward migrations beginning at 066, subject to fresh lineage reconciliation. Carry the complete unchanged 063–065 overlay and its compatible reader/provisioning changes together. Keep the original CP28 checkout, plans, hashes, approvals and results unchanged. This chooses source integration, not CP28 execution or activation.

The original 062-based recommendation cannot safely mean “skip to 066.” `scripts/migration-text.mjs:22–30` requires contiguous prefixes and `scripts/migrate.mjs:31–33` calls it before connecting. The isolated harness at `integration/neon-integration-harness.ts:449–483` sorts/applies files without that same validation; a future isolated pass alone would miss a production-runner gap. Future installation proof must cover both the actual runner's sequence validation and actual restricted-role SQL behavior. Do not renumber 063–065, insert placeholders, edit their original contents or copy only selected accessor consumers.

The overlay is not wholly dormant. 063 replaces scoring identity upsert; 064 replaces v29/v42 administration writers and coverage/lineage logic; 065 replaces v48, intake checkpoint, reconciliation, settlement and accessors. Only the new shared roster-link capture routing and population/provenance interner bindings remain inactive. The first standings increment must neither bind those paths nor claim they are qualified. Their operative definitions are dependencies to review and preserve. Earlier CP28 results retain only their actual source and scope; frozen final-source execution remains unperformed.

All source paths below are relative to this exact DATA source: library paths begin `apps/site/lib/`, scripts/integration/migrations begin `apps/site/`. The [source inventory](provider-independence-source-inventory.md) supplies effective function-chain and family anchors.

## Shared decisions now selected

| Decision | Selected design and reason |
| --- | --- |
| D01 common contracts | Reuse `ProviderReference`, `SourceScope`, `ObservedCoverage`, `FieldGroup` and existing family values. Add a real versioned submission/read contract at the existing administration store. Types alone do not qualify behavior. |
| D02 independent verification | Private adapter-owned SQL verifier checks native → canonical parity. Shared acceptance independently checks source, scope, lineage, coverage, hashes, typed output and ownership. No signing service or caller-supplied trust flag. |
| D03 registration | Deployment-owned exact source/family/schema/codec/version allowlists. Production supports Sleeper only. A guarded isolated fixture adapter is installed solely by source-pinned qualification setup. |
| D04 compatibility | Existing record bytes, hashes, IDs and native codecs remain. New versioned evidence and typed facts coexist; no wholesale historical conversion. |
| D05 one owner | Reuse the existing jobs, reservations, scopes, heads and acceptances. One acquisition and transaction own a capture. A Sleeper compatibility receipt is evidence within that transaction, not a second feed or independently published result. |
| D06 two different proofs | Native parity proves meaning; lineage/hash/typed checks prove binding and persistence. Neither substitutes for the other. Existing weaker family guarantees must be identified honestly and not accidentally weakened. |
| D07 native versus common | Native evidence keeps legitimate native restrictions. Common identities and facts use qualified opaque references. A familiar field/table name is not itself a defect. |
| D08 coherent lineage | Complete unchanged `8f026c2` source plus reviewed forward changes, as above. No migration gaps and no CP28 activation. |

## Identity contract and migration boundaries

Canonical league, season, team, manager, scoring-entity and receipt UUIDs remain stable. Native IDs are case-sensitive opaque text. Do not parse them as integers, change case, strip prefixes, concatenate without framing, derive identity from a display name or replace them with invented surrogate strings. Reject malformed input rather than silently normalizing its key. Existing native Sleeper numeric validation stays in the Sleeper adapter.

`ProviderReference` remains `{provider, resourceKind, nativeNamespace, nativeId}`. Registration/lookup must bind all four fields and the relevant canonical parent. Provider admission comes from the policy registry; accepting a string or parsing a reference is not access or registration proof. The declared `ProviderCode` union and `assertSourceScope` family allowlist must agree with actual registry behavior: current source declares Yahoo without a shipped connector and omits weekly reports from one validator. Neither is authorization to enable Yahoo or omit a family.

The common mapping DTO is named `CanonicalSourceMappingV1`:

| Field | Meaning |
| --- | --- |
| `connectionId`, `leagueSeasonId`, `revisionId` | Existing canonical UUIDs, resolved from registered storage |
| `generation` | Positive current mapping generation, checked under the existing lock/CAS rules |
| `scope.provider`, `scope.nativeNamespace`, `scope.externalLeagueId` | Exact registered league source reference; resource kind is league |
| `scope.leagueKey`, `scope.season` | Existing canonical registry key and intended season; not inferred from the native ID |
| `sourceNamespace` | Existing mapping revision's season context, currently `nfl:<season>`; distinct from the provider's native keyspace |

No optional caller namespace may fall back to another provider's mapping. Existing Sleeper APIs can remain explicit legacy wrappers that supply the documented Sleeper namespace. New selectors require the qualified reference or canonical connection/revision; ambiguous or unavailable identity fails explicitly.

The [identity dependency table](provider-independence-phase1-coverage.md) specifies the source-bearing tables and unique keys. Add namespace metadata and replace incompatible provider-only uniqueness; alias sidecars alone would leave the old unique constraints blocking scoped reuse. Preserve existing IDs, ownership/CAS safeguards and source history. Do not repurpose an external-ID column with encoded fake values to evade a constraint.

Compatibility defaults are evidence of the old adapter convention, not newly discovered historical identity: Sleeper NFL league/scoring keys use `nfl`, managers use `account`, and existing team references use the exact framed JSON tuple `['nfl', season, externalLeagueId]`. Existing Tank01 NFL mappings keep their explicit NFL namespace. Mapping revision `source_namespace` keeps its original meaning. New providers declare their own approved keyspaces.

First-slice identity changes are limited to league/season/source registration, current mapping and team resolution. Manager, scoring/player, game and draft identity dependencies are recorded now but implemented with their relevant later slices. No player catalog, complete roster, manager directory or scoring profile is a prerequisite for official standings. Existing official-data registration already permits a null scoring profile; preserve that distinction from strict projection/publication enrollment.

The application method `registerCanonicalLeagueSeason(input, authorizedRegistration)` uses the guarded public SQL entry `register_canonical_official_source(input jsonb, work jsonb, fence jsonb) returns jsonb`. `authorizedRegistration` is actual stored work/lease context, never a caller approval flag. Sleeper retains its real public-intake guard before and after registration. The isolated adapter uses a source-pinned admission branch bound to an actual existing `projection_jobs` job, exact fixture source/payload, nonce and live fence; it does not impersonate Sleeper's numeric-ID/directory discovery contract. Restricted runtime performs registration, team resolution through verified materialization, reservation, write and read; owner setup creates no league/team identities or accepted facts for those demonstrations.

The three first-slice shared-table Sleeper-only CHECKs (`league_administration_enrollments`, `league_administration_enrollment_seasons`, `league_season_teams`) must become bounded provider-key syntax plus enforced registered-source policy. Native-only evidence CHECKs remain. The coverage companion specifies this change, source-policy triggers and grants. Existing runtime INSERT/UPDATE on `leagues`, `league_seasons` and `league_source_connections` remains only with legacy source-policy safeguards; do not describe the current runtime as globally read-only on identities. Nonlegacy registration goes through the guarded owner entry. New canonical evidence and existing enrollment/history/team tables remain unavailable for direct runtime mutation. Source-policy checks must distinguish the original statement's execution context; a SECURITY DEFINER trigger's own `current_user` is not proof that its caller was an authorized registration owner.

Old immutable source records, timestamps and hashes are not rewritten. Necessary new namespace columns on old identities are compatibility metadata. Where a derived team namespace needs initialization, use one owner installation transaction with an exclusive table lock and a narrowly constrained new-column-only guard; preserve every old value, restore the strict immutable guard before commit, and fail the migration on any mismatch. Never expose a runtime backfill/guard-disable path. Exact isolated installation proof is future work.

## Common ingress, acceptance and read contract

The new store operation is `recordCanonicalObservation(delivery, mapping, attempt, fence)`. It uses the existing Neon store and the sole public SQL writer `record_league_administration_observation(jsonb)`. Existing `recordObservation` and its legacy result semantics remain supported. No new service, queue, database client or acquisition loop is created.

The top-level discriminator is `contractVersion='league-one-canonical-delivery-v1'`; the first family uses `canonicalSchemaVersion='league-one-official-standings-v1'`. A missing discriminator follows only the existing legacy contract; an unknown/malformed discriminator or mixed-mode object rejects and must never fall back. The standings specification freezes the concrete first-family delivery. The shared field groups are:

| Field group | Binding/validation rule |
| --- | --- |
| Mapping and scope | Full `CanonicalSourceMappingV1`, enrolled `SourceScope`, family, canonical entity/period or explicit null, audience and coverage policy; all checked against registered current state |
| Versions | Schema, adapter, native codec, canonical normalizer and validation policy; exact allowlisted tuple, no function names or SQL supplied by caller |
| Attempt | Existing reserved UUID, scope, ordinal, expected generation and DB nonce; current worker fence; arbitrary IDs alone cannot become reservations |
| Capture | Actual acquisition/receipt identity, native revision if known, request/observed/checked/normalized times and origin; distinct cache, retained replay and isolated fixture semantics |
| Evidence | Retained native JSON, canonical facts, truthful population/field/period coverage and evidence references; no fabricated native keys or mandatory global catalog |
| Authority | Provider official versus derived/unknown field meaning; this increment stores official facts and does not recompute or replace official results |

`SourceScope.family='standings'` uses the existing family enumeration. `entityId` and `scoringPeriodId` are null for the season standings snapshot; `audienceId='public'` and `coverageSpecId='official-season-standings-v1'` are fixed for the first slice. This does not imply that private provider data may be labelled public. Unsupported audience/policy combinations reject.

Decimals are finite base-10 strings with each field's precise unit and scale policy. Missing, explicit null, invalid, known zero and empty collections remain distinct. Native decomposition (for example Sleeper whole/fraction point fields) stays in native evidence/codec, not a requirement for another adapter's official decimal value. Rank is not silently calculated from points. Lack of derived-feature support does not hide representable official data.

Acceptance is family-specific where current semantics differ. A qualified partial standings snapshot can be displayed with partial/unknown coverage. It does not merge-delete omitted teams or erase previous complete receipts. A newer failed/invalid standings reservation causes current standings to be unavailable, as today; it must not silently fall back to an older successful receipt. Explicit historical receipt reads remain available. Do not turn Q07 into a universal “only complete facts may be shown” rule.

Readers return stored qualified facts, typed field states, actual coverage/freshness, source reference, content/receipt/acceptance identity, mapping/version and generation. Explicit historical receipt selection may expose qualified preserved evidence with its outcome and no accepted generation; it must never label that evidence as the current accepted head. `readCanonicalOfficialStandings` is the first internal common reader; old `readOfficialStandings` remains the legacy compatibility API. Both are local stored reads. Existing public routes/DTOs keep their contract; no UI migration is included in this first increment. Unknown stored versions return an explicit unavailable reason rather than guessing a codec or calling a provider.

## Evidence, storage and hashes

Reuse `league_roster_resource_scopes`, `league_roster_resource_heads`, `league_roster_resource_attempts` and `league_roster_resource_acceptances`. Their historical names do not require a parallel state machine. Preserve mapping locks, ordinals, generation CAS, immutable attempts, immutable acceptances and non-regressing heads.

The isolated standalone path also needs an immutable reservation-time copy of its permitted source/digest tuple. Add nullable `canonical_reservation_context` JSONB on the existing attempt row, set only by the reservation helper from checked stored work/policy. For this slice, legacy and production Sleeper bridge attempts retain null and their existing witness binding; fixture attempts record the exact version, job type, policy, source, intended league key, season and registration/standings digests specified in the slice. Bind that context in receipt hashing and compare it with the live job after waits. Do not trust a caller-supplied context or let job-payload changes silently change the meaning of an already reserved attempt. No new state table or runtime mutation grant is added.

The first slice adds three relations: `league_canonical_resource_contents`, `league_canonical_resource_receipts` and `league_canonical_standings_teams`. This separates common evidence from the existing native `league_administration_contents` and roster-receipt foreign-key/shape contract; it does not add another job, scope/head owner or cache. The standings specification owns their exact column, FK, uniqueness and guard requirements.

Existing acceptances gain `canonical_receipt_id`; legacy `receipt_id` becomes nullable with an exactly-one-target constraint. Legacy receipt and canonical receipt each retain unique acceptance linkage. Existing acceptance UUIDs and all old FKs/heads survive. Version-dispatched lineage validates the selected branch; it never permits both receipts or neither. Typed children must exactly reconstruct the verified canonical payload before acceptance can advance a head. Failed materialization rolls back the complete affected transaction.

Canonical hash convention is explicitly versioned `league-one-jsonb-sha256-v1`: SHA-256 of PostgreSQL's UTF-8 JSONB text representation of the documented versioned object. This hashes retained JSON values, not original HTTP wire bytes. Native-content and canonical-content digests are separate. Receipt digest includes the exact attempt, mapping/revision, source/codec/normalizer/policy versions, origin/times, coverage, content identities and applicable original witness/legacy-receipt linkage. A supplied digest is checked against the database's recomputation. No existing hash convention, evidence-hash input or stored digest is changed.

Same-content new acquisition gets its own truthful attempt/receipt/timing even if content is shared. Exact idempotent replay returns the already-bound receipt; it does not acquire a new observation time or silently reuse an old witness as current. Equal digest with unequal retained value is an explicit collision failure. Corrections create new immutable content/receipts and preserve the old record; stale attempts cannot replace current accepted state.

## Verifier and permission boundary

The deployment owns two private SQL helpers: `canonical_resource_policy(mapping, delivery)` and `verify_registered_canonical_delivery(mapping, delivery)`, both returning JSONB. Their fixed branches identify exact approved versions and call explicit private adapter functions. They are not a dynamic function-name registry. The corresponding application registry admits the same tuples; future qualification checks disagreement rejects. Production branches support Sleeper only.

For isolated qualification, guarded owner setup may install `verify_fixture_standings_delivery(jsonb)` and source-pinned additions to the private policy/dispatch branches after candidate migrations. This is an explicit fixture-only source overlay, listed in the execution manifest. It enables no production route, environment flag or runtime registration API. The common writer/acceptor/materializer/reader remain the candidate code being qualified. Setup must not insert accepted facts or use owner credentials for the tested registration/write/read path.

| Actor / surface | Allowed | Denied / enforced |
| --- | --- | --- |
| Installer owner | Reviewed forward schema/functions/grants and exact isolated setup when separately authorized | No assumed current installation, destructive history conversion or implicit test authority |
| Restricted ingestion runtime | Existing public writer, new `begin_canonical_resource_attempt(mapping,id,scope,policy,fence)`, required registered identity operations and permitted stored reads | Policy/function alteration, arbitrary verifier selection, direct new evidence/head mutation, private acceptor/materializer/verifier calls |
| Public SQL role | None of the new execution privileges | PUBLIC execution revoked for new helpers, including trigger functions; explicit positive grants only |
| Account/auth roles | Existing account/auth responsibilities | New source registration, fixture policy, ingestion evidence and private helper access; no grant inherited through default privileges |
| Stored-reader application code | Existing least-privilege SELECT/accessors for its audience; common/legacy decode | Provider HTTP, raw secret/cursor exposure, implicit enrollment/access from parsed IDs |

Every SECURITY DEFINER uses a fixed trusted search path, schema-qualified references and a non-runtime owner; temporary/untrusted name shadowing cannot choose a verifier. Revoke EXECUTE on all legacy inner writer versions, the newly private legacy entry, adapter verifiers, materializers, policy helpers and trigger functions from PUBLIC/runtime/account/auth, then grant only documented entry points. Cover pre-existing roles and roles provisioned after migrations in `scripts/provision-runtime-role.sql`. A revoked new helper is insufficient if an old wrapper still bypasses it.

Native verification cannot certify an actual provider network exchange against a malicious writer. Existing witness/nonce/ownership evidence proves application acquisition ordering and job authority, not a cryptographic assertion from Sleeper. Preserve and state this limit; the design does not silently replace it with a `verified=true` assertion or claim stronger authentication.

## Acquisition, reservation and Sleeper compatibility

The existing application adapter owns HTTP, admission, per-job request limits, retries and deadlines. Common SQL/readers remain offline. The first slice reuses a single Sleeper roster acquisition; it does not request a fictional standings endpoint. Synthetic evidence is explicitly `fixture` origin under isolated policy and cannot be admitted as production network evidence.

The detailed standings specification uses a same-transaction Sleeper bridge: reserve the canonical standings companion before the existing native players reservation/acquisition; validate the basic source/attempt/input binding; preserve the exact legacy submission object and execute the private legacy writer once; pass the resulting internal receipt binding to the pure adapter verifier; then accept only its independently verified common facts. Bind the actual native payload, original witness and newly produced legacy receipt under the same mapping/fence. Verification failure rolls back the whole statement, including bridge writes. Exact replay can reuse only the already-bound pair, never attach an unrelated old receipt as a fresh observation. The canonical `captureId` identifies the new delivery for replay; it does not invent an existing native capture ID. Legacy player-membership rejection does not by itself reject independently valid official standings facts.

The current witness helper enumerates every reservation for a fence (`056_public_draft_intake.sql:523–606`). Therefore a canonical companion cannot simply be added invisibly. The forward design must exhaustively partition the exact native role group and its explicitly recognized standings companion, validate the companion's mapping/fence/nonce and ordering, and reject extra, unknown or duplicate roles. The native v1 witness payload/hash and exact native group semantics remain; the canonical receipt binds the separately validated companion. This is a narrowly specified witness-helper change, not permission to ignore unknown reservations or hand-build a witness. The slice's guard and adverse-case tables make this a required first-boundary proof.

All fenced intake/reservation/writer locking follows the existing order: actual `projection_jobs` ownership first, then configuration advisory/source-mapping locks, then resource heads/reservations and guarded materialization/acceptance as applicable (`035:142–155`, `037:45–64`). Do not acquire mapping before the job in the new dispatcher and invert legacy callers' lock order. Owner registration without a job remains a separate existing authority path, not a bypass for fenced intake. Recheck the live fence after waits and immediately before durable acceptance. The exact locks and rechecks in the slice are mandatory; any implementation discrepancy must update/review the specification before dependent code expands. No new scheduler, lease owner or separate standings worker is needed.

## First increment and later work boundaries

| Increment | Complete path and dependency boundary |
| --- | --- |
| First: official season standings | Common league/source/season registration and team identity only; namespace-aware mapping; real standalone fixture evidence; Sleeper bridge; registered verifiers; shared reservation/acceptance; canonical typed facts and common stored reader; exact legacy compatibility. No reports, players, score computation, UI change or new live connector. |
| Next: small roster/player-link path | Finish that slice's full specification first; add source-specific player namespace and catalog-independent resolution, explicit unresolved/conflict states; use the already-qualified common boundary. |
| Remaining families | Complete settings/team relationships, exact matchups/lineups/points and reports, transactions, drafts/picks, then dependent bracket/history compositions. Group only documented dependency-compatible work. Each materially different writer/trigger gets its own mapped proof. |

The coverage companion records all eight families even though the first slice covers only part of family 5 and minimum dependencies in families 1/2. Reports are not qualified by a standings pass. R4 is intentionally not exercised by a player-free standings sample. No broader identity/format refactor is bundled into the first increment simply because the shared design mentions it.

## Compatibility, installation and disable

1. Before code, revalidate repository/service identity and create a dedicated implementation worktree from the reconciled coherent source. Preserve the documentation and CP28 worktrees. This task creates no implementation branch.
2. Append ordered forward migrations and matching role provisioning; install compatibility/read support before selecting canonical writes. Qualify old and newly provisioned roles, actual function definitions, migration sequence and native/canonical lineage.
3. Select an explicit adapter/family/version through the deployment-owned policy; in-flight work remains bound to its reserved policy, mapping and fence. No mid-attempt interpretation change. Unknown policy rejects.
4. Preserve legacy reads and public behavior. The internal canonical standings API may read old native records only through their exact recorded Sleeper codec and honest original evidence; do not create new captures merely by reading them.
5. To disable, stop new selected DATA admission through existing controls and fence/drain affected work. Keep both readers and old/new records. Never roll back to code that cannot read already accepted canonical receipts. A reviewed forward fix may be required.
6. Final CP29/30 must cover actual restored legacy/canonical histories, replay and coherent deployment compatibility. No restoration, operational campaign, merge or activation is authorized here.

## Finite evidence plan and drift record

The [coverage companion](provider-independence-phase1-coverage.md) maps every Q requirement and family to planned evidence. The [standings assertions](provider-independence-standings-design.md) specify the first real SQL boundary, including mismatched translation, opaque/colliding references, bypass denial, field states, current/historical reads, correction/replay, lock-wait expiry, typed mutation and legacy coexistence. These are specifications, not tests executed or assertions counted as passes.

Use one bounded retained Sleeper fixture and one deliberately different synthetic adapter with the existing isolated harness. Group setup where state independence permits; retain distinct semantic, grant, contention and compatibility assertions. The source-pinned execution manifest must state setup overlay, exact cases, real runtime login, limit/accounting/cleanup and denied paths before any execution is proposed. The harness and live production migration runner have distinct sequence-validation behavior; do not let a successful SQL install conceal that difference.

After authorization, target checks to changed dependencies. Repeat a passing check only for a recorded relevant change, failure, unresolved concern or required workflow. Do not run `verify` immediately before unchanged-source `verify:full`, which includes it. Preserve the required complete pre-merge workflow, CI, actual preview and distinct CP26–29 evidence. This plan reduces duplication, not the assertion set, isolation safeguards or execution limits.

| Discovered dependency | Evidence and smallest correction | Trace / disposition |
| --- | --- | --- |
| 062 → 066 is not an installable lineage | Contiguous production runner; carry unchanged coherent 063–065 and compatible source in a separate future candidate | D08/F07, R1/R6, Q16; source recommendation explicitly amended, CP28 untouched |
| Provider parameter alone cannot permit scoped native-ID reuse | Existing source/manager/scoring uniqueness and team lookup; add namespace metadata and qualified uniqueness, preserve IDs | F01/F02/F05, R2/R4, Q03/Q12; first increment changes only source/team prerequisites |
| Standings requires native roster receipt and field decomposition | 048/065 writer, legacy DTO and native reconstruction; common evidence relations and adapter-owned bridge | F03/F04/F06, R1/R3/R5, Q02/Q05/Q07/Q12; no fabricated source/points fields |
| Companion reservation changes native witness group | Effective 056 derives all same-fence attempts; explicit exhaustive native/companion partition and binding | F06, R3/R6, Q04/Q06/Q10; no ignored unknown roles or weaker witness |
| Standalone fixture digest binding needs reservation-time evidence | Existing attempts lack that immutable payload snapshot; add one helper-written nullable context column on the existing immutable attempt and hash/check it with the receipt | F06, R3/R6, Q04/Q06/Q10; legacy/production witness unchanged, no new state owner or campaign |
| Standings does not require projections/players | Nullable official registration versus strict publication enrollment; retain separate readiness and create teams from verified official rows | F01/F03, R2/R3, families 1/2/5, Q04/Q07/Q14; no projection policy change |
| Generic completeness rule could hide official facts | Existing latest-attempt standings reader and partial population support; retain available qualified partial facts, preserve prior immutable snapshots, no fallback after new failure | F04/F06, R5, Q07/Q08/Q12; existing behavior preserved |

These are necessary resolutions within the approved boundary, not additional product requirements, new campaigns or authority expansions. Changes to the approved trust ownership, product scope, success criteria, cost or execution limits still require the plan's material-decision process. Routine source/object adjustments must be documented and reviewed, without asking the owner to approve every filename.

## Readiness and handoff record

Micro-level design success means an implementer can identify the first slice's complete input, identity resolution, verifier, transaction, materialized output, reader result, denied path and required evidence without deciding a new trust boundary during coding. Macro-level success remains all eight families using provider-neutral shared storage/readers, with historical integrity, unchanged product behavior and final operational/release evidence. Neither level claims support for an unimplemented live provider.

Primary risks are privilege bypass through old helpers, native/canonical translation disagreement, namespace migration mistakes, broken witness causality, subtly changed partial/current-reader behavior and incompatible rollback. The design assigns each a concrete guard and adverse assertion. Only future execution can establish those guards work. Broad family coverage and performance/storage/recovery remain unqualified.

**Phase 1 is complete as a design increment.** The shared design, all-family dependency/guard/evidence inventory and first standings specification are independently reviewed and design-ready. No material design blocker remains. This does not complete all of R1, implement a provider-neutral boundary, authorize Phase 2, or qualify runtime behavior.

| Independent review | Finding and resolution |
| --- | --- |
| Source lineage, SQL ownership, witnesses, permissions and transaction boundary | Resolved contiguous migration lineage; exact native/companion witness partition; job-first lock order; registration CHECK/permission closure; actual bridge receipt identity; pure-verifier/replay ordering; historical conflict classification; immutable fixture reservation context. Final fresh-read review found no material design blocker. |
| Identity, product behavior and all-family coverage | Resolved namespace-qualified keys and legacy defaults; nullable official readiness; canonical league-key binding; isolated fixture admission; exact provider-reference typing; partial/current/history semantics. All eight family and Q01–Q16 requirements remain present; no UI/new-provider activation added. |
| Standings author cross-review of shared and coverage decisions | Reconciled version/discriminator/hash names, registration API and grants, source mapping namespaces, witness/bridge semantics, fixture provenance, reader result and storage/trigger ownership. Later-family detail remains explicitly open. |

Reviews inspected the documents and the exact source; none executed application/SQL tests. Local relative document links and whitespace were checked. Primary main and the frozen CP28 worktree were clean at closeout. The frozen execution-plan hash remains `4a41f69c5b3772f8d3946e6611abe8ffd4037328598d0d2b58fcd320a035491b`; the readiness-receipt hash remains `6477ba8d12c071ab83410c0324d5575e74e08ab07cadfbe598fa672dbf433a15`. Their execution status and authority are unchanged.

### Mandatory four-point handoff

1. **Agreed requirement.** Complete Phase 1's shared design and first standings specification under the v1.2 plan's mandatory drift controls, preserving R1–R6, all eight families, Q01–Q16 and checkpoint outcomes. Authority is documentation/read-only inspection only; CP28 stays frozen.
2. **Actual change.** Added this v1.0 shared design, the v1.0 standings specification and v1.0 family coverage companion. Updated the parent plan, source inventory and acceptance document to v1.3 and added README navigation. D08 now explicitly uses coherent `8f026c21ce2e633ba94368f63f3c01cac605f3d3` for a separate future candidate rather than an invalid 062 → 066 gap. All seven changed files are Markdown; previous architecture-reference work is preserved. Changes remain local and uncommitted on `codex/architecture-reference`, based on `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` / tree `a32e1b924432261bfca5f1a198c02a855ff6ff20`. The base identities do not include these uncommitted documents.
3. **Evidence.** Read-only exact-source/GitHub inspection, independent design reviews, document consistency/link/whitespace checks and frozen-artifact hash checks support design readiness. Review findings above were corrected; no unresolved design failure remains. Application tests, SQL installation/qualification, provider acquisition, preview, performance/storage/restore and deployment checks are all unexecuted. There are no new test pass totals or transferred historical qualifications. No database/provider/production action occurred.
4. **Unresolved items or deviations.** No unresolved material deviation within this design increment. Full later-family R1 specifications and all implementation/operational evidence remain open. Source integration, namespace changes and reservation context are explicitly recorded dependencies, not silent scope expansion. Only documentation authority was consumed; implementation, testing, CP28 execution, installation, publication, merge and release authority remain unused and are not inferred. Next bounded action, if authorized, is the specified first standings implementation with its minimum identity prerequisites and early restricted-role SQL proof under a separately bounded execution manifest. Revalidate source/service identity before that work. Do not start later-family code or resume CP28 from this handoff.

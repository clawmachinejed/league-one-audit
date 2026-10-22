# Provider independence source inventory

Version 1.3 — October 21, 2026. Companion to the [remediation plan](provider-independence-remediation.md). Phase 1 adds source-lineage and first-slice design references. This is source evidence and change ownership, not implementation or qualification results.

## Exact baselines

| Baseline | Identity and evidence limit |
| --- | --- |
| Main | `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`; local and GitHub main rechecked October 21; source migrations through 033 |
| Published DATA | `168a856ae44e7431393b0a8a9404483dda294ccc`; [PR318](https://github.com/clawmachinejed/league-one-audit/pull/318) freshly observed open/draft/unmerged, branch `codex/data-cp28-measurement-proposal`, base `codex/data-reader-performance`; source through 062 |
| CP27 branch head | GitHub `codex/data-reader-performance` observed at `b41fca034e9982014f3396f960c91c3a718b0169`; this branch-head identity is not a successful performance qualification |
| Frozen local DATA/CP28 candidate | `8f026c21ce2e633ba94368f63f3c01cac605f3d3`, tree `134b3b104c64a2c4855528870c122bc41b71e7ba`; source through 065; clean worktree observed |
| Documentation branch | `codex/architecture-reference`, based on main above; existing README/architecture document work preserved |
| Production identity evidence | Last checked October 20: Vercel `league_one_fantasy`, root `apps/site`, branch `main`, Ready deployment `8C3YSnXRCbmPETftQgRtirfyck5e` at main above. Not reverified through a live app/DB audit in this documentation task; revalidation required before implementation/release |

Candidate-relative paths and one-based lines below refer to **8f026c2**, unless marked main or published. The candidate root is [the preserved CP28 checkout](</C:/Users/Robert Finchum/.codex/worktrees/data-cp28-measurement-proposal/LeagueOneEngineering>). Published equivalents can be inspected in the [immutable DATA tree](https://github.com/clawmachinejed/league-one-audit/tree/168a856ae44e7431393b0a8a9404483dda294ccc). Do not treat a relative path in this appendix as proof that the same implementation exists in main.

The candidate diff from published DATA includes 063–065, compatible changes to six reader modules, and associated tests. It contains operative function/accessor replacements even though the new sharing capture/interner paths remain unbound. “Unbound optimization” does not mean the entire migration is inert.

Phase 1's [resolved D08](provider-independence-phase1-design.md#exact-sources-and-migration-decision) chooses the complete unchanged `8f026c2` source for a separate future implementation candidate, then forward migrations beginning at 066 after fresh reconciliation. `168a856` remains the published comparison reference. Its merge base with `8f026c2` is exactly `168a856`; the latter is eight commits ahead. The production migration runner requires contiguous prefixes (`scripts/migration-text.mjs:22–30`, invoked by `scripts/migrate.mjs:31–33`), while the isolated harness's sorting/apply loop (`integration/neon-integration-harness.ts:449–483`) alone does not enforce the same rule. Never qualify a 062 → 066 gap from a harness pass. The frozen original checkout, plan, receipts and execution status remain unchanged.

The [shared design](provider-independence-phase1-design.md), [standings specification](provider-independence-standings-design.md) and [family coverage](provider-independence-phase1-coverage.md) now define the selected ownership/identity/guard destinations. Future implementation must use these detailed specifications as well as this source inventory. Later-family specifications remain open; a table of owners is not a completed field/SQL design for every family.

## Finding to source map

Library paths start at `apps/site/lib/`; throughout this inventory, `neon/` abbreviates `apps/site/lib/league-administration/neon/`. Within a row, unprefixed filenames inherit the directory of the preceding fully qualified library path. Migration paths start at `apps/site/migrations/`.

| Finding | Exact source anchor | What the source establishes | Necessary change boundary |
| --- | --- | --- | --- |
| F01 registration | `projections/adapters/neon/contracts.ts:39`; `identities.ts:26,58,68,99,111` in the same directory | Registration input names `sleeperLeagueId`; inserts literal Sleeper | Common source identity input and SQL parameters; preserve registered provider policy and canonical IDs |
| F01 lookup | `league-administration/store-contracts.ts:129`; `neon/administration.ts:164–174` | Mapping lookup lacks provider argument and supplies Sleeper in SQL | Provider/resource/namespace-qualified selector; an adapter-specific convenience wrapper may remain |
| F01 scope/enrollment | `league-administration/contracts.ts:14–18`; `league-administration/store-contracts.ts:32,60,72`; `league-administration/source-mapping.ts:15`; `neon/enrollment.ts:23–47` | Several common-facing types/selectors assume one provider | Separate common contract from explicitly Sleeper-native scope; no unrestricted string admission |
| F02 external IDs | `apps/site/migrations/045_exact_matchup_values.sql:21,23` | External roster/matchup IDs are numeric-constrained in a typed path | Decide native evidence versus shared fact ownership; preserve exact opaque source IDs in common references |
| F03 actual ingress | `league-administration/runtime.ts:116`; `league-administration/store-contracts.ts:80`; `neon/administration.ts:183–231` | Application normalizes, then submits a native envelope and typed projections through one SQL writer | Versioned canonical delivery plus source verifier; reuse this store/acceptance owner |
| F03 standings example | `apps/site/migrations/048_official_standings.sql:842–854`; candidate `065_roster_provenance_contents.sql:555–578` | Standings require roster-family receipt and native reconstruction | Truthful family-specific capture/coverage input, preserving native parity in registered verifier |
| F04 common native read | `league-administration/neon/administration.ts:88–104`; `current-roster.ts:93–103,121–123` | Reader reconstructs Sleeper envelope, normalizes and emits Sleeper references | Canonical accepted reader plus exact legacy codec dispatch |
| F04 shared composition | `aggregator/transaction-activity.ts:7,45–97`; `exact-matchups.ts:13–16,193–202`; `official-results.ts:31–38,102–105`; `within-season-history.ts` | Native event parsing or literal provider/period context inside common-facing assembly | Provider-specific fact factory/codec; shared joins/order/coverage take common facts and explicit policy |
| F05 directory/links | `apps/site/migrations/042_roster_player_links.sql:270–272,334–347`; candidate `063_roster_player_link_contents.sql:209`; library `neon/player-directory.ts:82,150`; `neon/roster-player-links.ts:165,242,272,313` | Selects Sleeper directory and source-specific aliases | Provider-qualified link selection, preserving explicit unresolved/conflicting states |
| F05 draft links | `league-administration/neon/draft-selections.ts:215`; `aggregator/roster-player-links.ts:16,37,93` | Source identity assumptions extend beyond roster display | Use same qualified identity contract in accepted draft links |
| F06 guard preservation | Effective SQL chain and per-family inventory below | Native parity and shared integrity are interleaved and differ by resource | Inventory each guard before changing ownership; no blanket removal |
| F07 CP28 overlap | Migrations 063–065 and six compatible reader changes below | Receipt/evidence/link changes also affect acceptance, checkpoint recovery and budgets | Separate source-integration decision and final-source evidence |

`aggregator/contracts.ts:12,19,56,86,89` provides reusable provider references, source scopes, observation evidence and accepted-resource concepts. These declarations do not establish that the actual ingress/SQL/reader uses them. `projections/shared/provider-identity.ts:13–24` also provides useful scoped source identities.

## Effective SQL ownership

The writer is a versioned chain of wrappers, not simply the highest-numbered migration filename. At the frozen candidate, the exported writer delegates through these definitions:

| Function layer | Effective defining migration and line |
| --- | --- |
| `record_league_administration_observation` | 056:1032 |
| `record_league_administration_observation_v54` | 056:911 |
| `record_league_administration_observation_v53` | 056:793 |
| `record_league_administration_observation_v52` | 049:376 |
| `record_league_administration_observation_v48` | 065:555 |
| `record_league_administration_observation_v47` | 047:665 |
| `record_league_administration_observation_v45` | 043:93 |
| `record_league_administration_observation_v42` | 064:454 |
| `record_league_administration_observation_v34` | 051:526 |
| `record_league_administration_observation_v32` | 032:97 |
| `record_league_administration_observation_v31` | 031:133 |
| `record_league_administration_observation_v30` | 039:633 |
| `record_league_administration_observation_v29` | 064:197 |
| `record_league_administration_observation_v1` | 037:9 |

For published DATA, v48 and v29/v42 have earlier definitions in 048; 064/065 replace them in the local candidate. Main ends at 033 and has its earlier chain. This map must be regenerated from the selected ordered candidate before migration design; a filename match or old function definition does not prove installed behavior.

## Family acceptance and verification inventory

Migration references below are under `apps/site/migrations`. Library `neon/` paths mean `apps/site/lib/league-administration/neon/`. These are current owners to preserve/refactor, not instructions to edit historical migration files.

| Family | Acceptance/materialization owner | Native interpretation or parity currently enforced | Common integrity and semantics to preserve |
| --- | --- | --- | --- |
| 1 Settings/league | 037:9; candidate064:197; identity registration above | Sleeper envelope/dialect checks037:30–43; normalized league identity106–110; native scoring112; raw league/season/sport064:282–287; population330–331 | Stable identity, configuration applicability, source mapping, versions, finite scoring input, time ordering, content collision checks. Do not claim independent re-normalization of every settings field |
| 2 Teams/managers | 028:30;035:6,43;043:93; candidate064:367–384,590–593 | Roster ownership/v2 projection verification; raw users directory and commissioner facts043:113–117 | Correct scoped teams/managers, roles, vacancies versus unknown, population, immutable capture and receipt linkage; no commissioner/website ownership inference |
| 3 Rosters/catalog/links | candidate064:404–419;041:183;042:251; candidate063:209 | Raw held-player arrays versus normalized membership064:412–414; catalog duplicate-key/native projection041:251–261; native categories/directory/crosswalk in links | Membership/order/category meaning, complete/partial/empty, namespace and mapping versions, unresolved/conflict states, immutable link evidence, atomic crosswalk collision behavior |
| 4 Matchups/lineups/points | 039:633;045:59,117,142,215 | Raw IDs, players/starters, points/overrides and per-player values; field-state parity045:81–99; numeric source restrictions21,23 | Exact requested period, team/source scope, lineup order, decimal/zero/missing semantics, cardinality, immutable corrections and receipt closure |
| 5 Standings/reports | 048:621,795; candidate065:555;049:65,144,248,376 | Roster-derived standings parity065:565–578; report identity/week/standings049:87–90; expected projection447; typed parity274 | Record/rank/seed/point authority, own truthful capture/coverage, correct source/period, complete typed values. Results composition does not create a separate storage owner |
| 6 Transactions | Base037 normalized entries;051:526 | Source/envelope/native shape checks;051:596–598 mainly compares raw/normalized array types and cardinality, not every semantic field | Native transaction identity, period, complete-empty, accepted-head ordering, original timing, replay/fences, partial failure and corrections. Do not invent a stronger existing SQL parity guarantee |
| 7 Drafts/picks | Projectors053:48,054:34,055:131; materializers053:179,054:160,055:70; writers056:793,911,1032; links054:503 | Expected native projection056:875,996,1114; typed lineage053:239,054:221,055:236 | Draft/team/player identity, pick/slot order and counts, ownership conflict/unknown, capture corrections and links. Typed sibling acceptance may coexist with legacy rejection; retain each status's meaning |
| 8 Brackets/history | 046:98,239,301;047:665;031 period/calendar;044 inventory;032 calculation lineage | Bracket native graph/count parity046:261–264; native period mapping and explicit evidence | Graph/result/advancement references, coverage, native period identities, immutable versions. A bracket match ID is not automatically an NFL week; schedules/history compose accepted records |

## Reader and composition inventory

Every family below needs an explicit canonical/legacy selection policy. A listed source-specific decoder may remain within the adapter; listing a file is not a requirement to remove every native field from it.

| Family or shared responsibility | Current read/composition anchors | Required boundary |
| --- | --- | --- |
| General source read | `neon/administration.ts:88–114` | Versioned canonical decode; legacy envelope decode retained as explicit source codec |
| Settings | `neon/league-settings.ts:72–84`; `aggregator/league-settings.ts:25–48` | Accepted settings and truthful source extensions; preserve counted/ordered slots and scoring formats |
| Team/manager facts | `neon/team-managers.ts:99,202–212,234–249`; `aggregator/team-managers.ts:25–42,71–83` | Common relationships and provider-qualified IDs; native users parsing in codec |
| Current roster | `neon/current-roster.ts:93–103,121–128` | Canonical roster plus receipt/mapping/coverage; source-qualified identity |
| Catalog/links | `neon/player-directory.ts:82,150`; `neon/roster-player-links.ts:165,242,272,313`; `league-administration/player-directory-contracts.ts:3–44` | Keep native catalog capture schema; common link selection must not default to it for all providers |
| Exact matchups | `neon/exact-matchups.ts:123,142–166`; `neon/exact-matchup-values.ts:133–137`; `aggregator/exact-matchups.ts:193–202` | Common groups, slots, official values and external references; preserve current supported shapes |
| Period/applicability | `neon/exact-period-context.ts:101,150–162`; `neon/exact-lineup-applicability.ts`; `neon/public-period-inventory-reader.ts:51–68` | Explicit provider/period policy and evidence; exact-week preservation, not automatic calendar expansion |
| Standings/reports | `neon/official-standings.ts:166–172`; `neon/weekly-reports.ts:128–147` | Accepted fact version and own source receipt; no compulsory roster-body reconstruction for another provider |
| Transactions | `neon/transactions.ts:193`; `aggregator/transaction-activity.ts:7,45–97` | Adapter produces event facts; common ordering/merging/coverage retains native extensions and compatibility payload |
| Draft metadata | `neon/draft-metadata.ts:205–210`; `aggregator/draft-metadata.ts` | Canonical metadata with provider-qualified draft/team references and old codec support |
| Draft selections | `neon/draft-selections.ts:215,264–269`; `aggregator/draft-selections.ts` | Canonical selections, qualified player linking, native evidence retained |
| Traded picks | `neon/traded-picks.ts:171–176`; `aggregator/traded-picks.ts` | Actual supplied ownership/conflict state and future-year reference; no prior/future-season traversal |
| Brackets | `neon/brackets.ts:100–114`; `aggregator/playoff-brackets.ts` | Common graph and supplied result facts; source parser stays native |
| Results/history | `aggregator/official-results.ts:31–38,102–105`; `aggregator/within-season-history.ts`; `league-administration/public-season-history-reader.ts`; `league-administration/public-official-results-reader.ts` | Common joins with explicit source/season/period context; preserve unknown finality and settings applicability |
| Intake/composition | `league-administration/public-intake-runtime.ts:14,47`; `projections/runtime/projection-services.ts:35–41` | Registered adapter selection at existing composition seam; only Sleeper enabled; same pipeline |

Main public compatibility anchors remain `lib/page-source.ts:133–175`, `lib/leagues.ts:2,10`, `components/league-pages.tsx:107,116,126`, and `app/(enrolled)/leagues/[league]/[[...section]]/page.tsx:11`. Current imported routes and numeric team URLs are legitimate existing presentation contracts. They do not require a common database to use numeric external IDs. Future public provider routes are outside this repair.

## Guard disposition checklist

| Guard class | Required future owner | Forbidden shortcut |
| --- | --- | --- |
| Native syntax/field semantics | Registered versioned adapter normalizer and independent verifier where currently present | Rename raw fields or assert `validated:true` |
| Canonical types/units/field states | Shared contract validator and relational constraints | Treat missing as zero or drop unrepresented supplied facts |
| Native-to-canonical parity | Adapter-owned verification boundary with actual non-bypassable entry | Replace semantic verification with hashes alone |
| Mapping and authorization | Existing shared SQL mapping, enrollment, audience and restricted-role checks | Assume parsed scope or provider name proves permission |
| Capture/attempt binding | Shared SQL checks original resource, source, scope, witness and chronology | Borrow another request's receipt or refresh its observation time |
| Ownership and deadline | Existing job/attempt/generation/fence owner, including post-wait checks | Clear leases broadly or accept an expired worker |
| Immutable identity and replay | Versioned content, receipts and acceptance rules | Rehash old records under new semantics, overwrite history, or duplicate observation on replay |
| Coverage/removal | Common resource policy using real adapter evidence | Interpret omission as deletion without complete authoritative coverage |
| Typed materialization | Shared comparison between canonical payload and complete relational children | Check only that a query returned some rows |
| Legacy validation | Recorded provider/version-specific codec | Relabel old captures as new canonical observations |

Specific shared guard examples:027:110 mapping validation; candidate064:233–254 attempt/mapping/fence;064:436–445 final owner/deadline/head transition;051:555–598 transaction acceptance/coverage;053–055 complete materialization;065:359 receipt/acceptance/head lineage. Exact error/transaction behavior must be part of the implementation specification.

## Frozen CP28 overlap and evidence

| Candidate object | Direct dependency |
| --- | --- |
| 063:4,23,43,56,87,99,167,209,372,528 | Link content/entries, receipt extension/accessor, guards, storage/capture functions, crosswalk upsert; new shared capture unbound |
| 064:3,15,28,119,197,454,644,720 | Population content/receipt/accessor, unbound interner, v29/v42 replacements, lineage and standings coverage |
| 065:3,14,28,157,206,282,359,436,486,555,631,886,950 | Provenance content/accessors, unbound interners, population/lineage/standings, v48 writer, checkpoints, resource reconciliation and settled-capture budget |
| Changed library consumers | `neon/current-roster.ts`, `neon/team-managers.ts`, `neon/roster-player-links.ts`, `neon/official-standings.ts`, `neon/exact-period-context.ts`, `league-administration/public-official-results-reader.ts` |

Frozen artifacts are under the preserved candidate's `test-results/cp28-consolidated-candidate/`:

| Artifact | SHA-256 |
| --- | --- |
| `execution-plan.json` | `4a41f69c5b3772f8d3946e6611abe8ffd4037328598d0d2b58fcd320a035491b` |
| `approval-readiness-receipt.json` | `6477ba8d12c071ab83410c0324d5575e74e08ab07cadfbe598fa672dbf433a15` |

Execution plan records `executionAuthorized:false` and `nativeExecuted:false`.

Both artifact hashes were rechecked during the October 21 Phase 1 design closeout and still match this table. The original frozen worktree and primary main were clean. These are preservation checks, not CP28 execution or qualification.

The selected plan covers four core cases, 46 attempted/44 successful captures with two intended rejections, two warm and 32 measured cores, two leagues with 20 teams each. It cannot independently close all eight families or establish capacity for 41 leagues ×12 teams. Changed canonical/receipt/reader behavior requires a new candidate binding; it cannot inherit the old plan's authority.

## Checkpoint status evidence

Sources are in the preserved candidate's `docs/aggregator-backend/`.

| Status | Evidence anchor |
| --- | --- |
| CP3/4 deferred | `data-backend-readiness-contract.md:92–93`; evidence ledger284 |
| CP26 stopped/incomplete | `data-backend-cp27-plan.md:7`; evidence ledger31; narrowed requirement readiness3,115 |
| CP27 deferred/unqualified | Evidence ledger12,23; `data-backend-cp27-plan.md:3` |
| CP28 incomplete/capacity unqualified | Evidence ledger12 and frozen candidate execution plan; later local optimization work does not close this status |
| CP29–34 later gates | Readiness contract118–123 |
| CP20 later accepted | Evidence ledger3017: accepted dependency and5/5 hosted result |
| CP24 later accepted | `data-backend-cp25-plan.md:14`; evidence ledger3142 |
| CP25 later accepted | Evidence ledger3172: accepted source15fb9b7 and matched closeout |

Old leading plan paragraphs and the October13 “current” summary predate later acceptances. Preserve those historical records, but do not count their earlier failed/pending statements as new unfinished checkpoints. Accepted historical source-specific results are also not a blanket current-candidate qualification.

## Inventory limits and update rule

This inventory identifies the demonstrated restrictions and directly affected owners across current families. It does not certify live database objects, prove future provider API semantics, or preapprove every file in these directories for editing.

The [three-phase delivery](provider-independence-remediation.md#three-phase-delivery) changes execution grouping, not the six R1–R6 completion requirements, F01–F07 findings, eight-family coverage, or Q01–Q16 acceptance obligations. Phase 1 establishes the all-family owner/dependency/guard map, known representation conflicts, shared identity/evidence/verifier and legacy-compatibility decisions, and exact source/migration lineage. Shared decisions must account for every affected family before their implementation begins.

In Phase 2, complete and independently review each affected family's field contract and each affected object's storage, compatibility, guard and grant specification before authoring its code. Include the old guard, replacement owner, role grants, index/read effect and Q mapping. Unchanged semantics may be incorporated by exact existing versioned type/contract and source references; record what is reused and verify that its meaning fits. Explicitly define changed or new meanings. A reference is not permission to leave an affected field, trust boundary, ownership rule or grant ambiguous.

R1 remains partial until all eight family specifications are complete. A later shared-contract or dependency change reopens the affected reviews and evidence through its actual dependency closure; it does not automatically invalidate unrelated accepted work or require every historical campaign to run again. Phase 3 reconciles the completed specifications and proof against the integrated candidate. Follow the [streamlined testing policy](provider-independence-acceptance.md#streamlined-testing-policy) without reducing any family or guard requirement.

For any newly discovered dependency, the [mandatory drift controls](provider-independence-remediation.md#mandatory-drift-controls) require its exact source, relation to F01–F07 and R/Q/family requirements, minimal necessary change, affected files/objects/guards and earlier evidence, and any scope/architecture/cost/limit/success-criterion effect to be recorded before affected work expands. Classify and resolve it in the existing plan/coverage record. Routine corrections within existing scope and authority may proceed after their applicable design/review checks; material amendments require an explicit owner decision before dependent work. Independent review must not quietly add features, seasons, campaigns or different completion criteria.

At closeout, reconcile actual changes against that record and use the [mandatory four-point handoff](provider-independence-acceptance.md#mandatory-four-point-handoff). Missing scope/evidence reconciliation or an unresolved material deviation prevents an increment-complete claim. This documentation provides no implementation or test-execution authority; CP28 and its source-bound artifacts remain frozen.

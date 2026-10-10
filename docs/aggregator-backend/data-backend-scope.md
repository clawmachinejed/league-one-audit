# Fantasy football aggregator: current data-backend scope

Revision: data-backend-v1, October 6, 2026. This is the current implementation boundary, read with [AGENTS.md](../../AGENTS.md). The user's latest explicit direction supersedes older broader plans wherever they conflict. The current outcome is a fully functioning fantasy football aggregator **data backend**. Website product work is a later outcome.

The [checkpoint 1 readiness contract](data-backend-readiness-contract.md) freezes the current completion boundary to season **2026**, including within-season history and corrections across all eight official families. Annual linking and prior-season discovery remain deferred; native predecessor and future-pick-year references are retained without traversal. Its operating targets are acceptance criteria, not measured readiness or execution/release authority. Checkpoint 2 source/checklist work and later qualification remain separate.

The [checkpoint 2 source baseline and acceptance checklist](data-backend-acceptance-baseline.md) pins the source/evidence overlay and existing owners for the remaining resource and operating work. It preserves checkpoint 1 targets and historical proof boundaries; completing the checklist document does not qualify the backend.

## The outcome

**Sleeper username → stable provider user identity → associated leagues → existing provider adapter → canonical relational identities and typed official resources with provenance → durable PostgreSQL storage → refresh/retry/recovery → backend readers.**

Sleeper is the only implemented fantasy-league provider. Username is a lookup label; retain stable provider user IDs and do not treat public lookup as ownership proof. Future providers extend adapters, identity mappings, schemas where necessary and provider tests; they are not shipped. League One, League Two and Dynasty are regression customers, not eligibility standards for unrelated leagues. Official-data support is independent of projection or analytics coverage.

## Included and deferred

| Included now | Deferred; not prerequisites for this outcome |
| --- | --- |
| Provider identity resolution and associated-league discovery; canonical league/season/team/manager/player identity; official data acquisition, normalization and durable storage | Website accounts, registration/login, exclusive identity claims, onboarding UX, follows and user-membership entitlements |
| Backend readers, source permission, actual infrastructure authorization, restricted database roles, validation, protected delivery where necessary and safe compatibility | Pages, dashboards, navigation, visual design, browser flows and UI end-to-end completion |
| Bounded refresh, durable jobs, retry, idempotency, recovery, provenance, freshness, corrections and operational evidence for those data paths | New projections, forecasts, win probabilities, analytics, general account lifecycle work and unrelated architecture expansion |
| Incremental reuse of existing adapters, workers, readers, normalization and storage owners | Another worker, scheduler, queue, provider feed, cache or publication pipeline for convenience |

Existing useful security and shared infrastructure remain intact. Deferral of website account features does not remove real source permissions, database role boundaries, privacy or protection of existing private data. Existing routes, payloads, fallbacks, named-league isolation, exact-week behavior, clock-v1, frozen baselines and production behavior remain protected. Any necessary compatibility work must be concrete and bounded.

## Official fantasy data coverage

For each family, identify the existing source/adapter, exact native fields, typed storage, reader and demonstrable coverage. Declare the discovery season window, historical coverage and refresh objective; do not claim “all leagues” without that boundary. Retain native settings and status. Distinguish supplied, unavailable, not requested, unsupported and invalid; never invent an official value.

| Family | Required representation and coverage |
| --- | --- |
| Leagues, settings and seasons | Stable canonical league identity; exact 2026 provider/season IDs; scoring, roster, competition and waiver settings with time-applicable versions. Annual predecessor/successor mapping is deferred under the 2026 readiness contract; retain native references without traversal |
| Teams, managers and co-owners | League/season-scoped team or roster identity; provider user identities and observed manager/co-owner relationships, including vacancies and changes; commissioner status is distinct |
| Rosters and player identities | Held players, reserve/taxi/other native categories where provided; provider player namespace and evidenced crosswalks; transfers/removals and complete versus partial rosters |
| Lineups and matchups | Exact native period and competition phase; starting/bench assignments, slots and matchup grouping; byes, ties, multiweek or other native formats where supplied |
| Official scores, results and standings | Provider scores, custom overrides, result/finality and provider standings/rank where supplied; zero remains zero; locally computed ordering is identified as derived |
| Transactions, waivers and FAAB | Stable transaction IDs, type, status, participants, adds/drops/trades, bids/budgets and source timestamps where supplied; no inferred failed/accepted outcome |
| Drafts and picks | Draft identity/settings/order/status, pick ownership and traded picks where supplied; native round/pick/season scope and player references |
| Schedules, playoffs and history | Exact 2026 periods, opponents/brackets/results and recoverable within-season source history; coverage gaps and correction semantics stated explicitly. Evidenced annual season chains are deferred under the 2026 readiness contract; retain native references without traversal |

Unusual scoring or incomplete derived-feature coverage must not reject a league whose official data can be represented reliably. Unsupported official structures get explicit resource-level limitations and retained evidence; no claim of complete coverage may hide an unimplemented obtainable family.

## Data integrity and operation

- **Identity and relational design:** keep native IDs as strings within provider/resource namespaces; never equate roster numbers across leagues or annual league IDs with permanent league identity. Model keys, foreign keys, cardinality, uniqueness and functional dependencies. Use canonical relational identities and typed queryable resources; a raw JSON archive alone is not the backend. Keep raw/native evidence where needed for lossless provenance.
- **Meaning:** record season, period, units, source statuses and field presence. Missing, null, empty, invalid and zero are distinct where applicable. Preserve official rules and supplied official outcomes; estimates cannot replace them.
- **Provenance and time:** bind observations and accepted resource versions to provider/native key, source request or retained fixture, capture/acceptance/source times when available, schema/normalizer version, coverage and freshness. A retry or cache hit cannot pretend to be a new source observation.
- **Corrections:** preserve immutable evidence and version corrections, deletions and accepted-head ordering. Partial, stale or failed responses cannot silently erase complete accepted data. Replays and out-of-order delivery cannot regress the accepted version. Existing immutable projection baselines stay immutable.
- **Durability and concurrency:** reuse existing durable jobs, admission and fenced ownership; atomic acceptance, idempotency and unique constraints must survive duplicate dispatch, contention, rollback and process death. Do not hold database transactions across provider calls. Retry/backoff and failure states remain bounded and observable.
- **Security:** enforce actual database role privileges and source/audience permissions on relevant writers/readers. Preserve shared security mechanisms; website-login or membership products are not newly required to collect and read otherwise authorized official data. No secrets in evidence, logs or committed artifacts.
- **Performance and recovery:** declare measurable resource/workload bounds, reader queries/indexes, provider budgets, freshness objectives and failure behavior. Prove retry/restart/replay and stale-data recovery; inspect real query plans/load where material. Report measured latency/capacity and restore gaps, without importing unproved 500-league or timing guarantees.

## Definition of done

A resource increment is complete only when the existing provider path produces durable, correctly keyed typed records and its backend reader returns the intended official result, with objective evidence. Record only four short fields:

1. **Data resource:** native family, identity and supported coverage.
2. **Existing path:** source/adapter → relational storage → backend reader, naming the changed files.
3. **Persisted result:** expected records, official meaning, provenance/freshness and reader output.
4. **Real evidence and gaps:** exact source revision, executed checks and independent review; explicit unsupported cases and unexecuted qualification.

For the **backend outcome** to be complete, run the full source-adapter-database-reader chain against actual authorized isolated PostgreSQL, using retained representative provider evidence and actual restricted roles. Verify installed constraints and permissions, reader/source parity, duplicates/replay, late corrections, partial failures, concurrency, rollback, crash/restart and bounded recovery. Cover unrelated leagues and relevant formats as well as League One/Two/Dynasty regressions. Also prove at least one bounded, authorized live Sleeper username → stable user ID → associated leagues within the declared season window → actual isolated PostgreSQL → stored backend-reader result. Retained fixtures complement this live connection proof; fixture-only SQL or authored adapters cannot replace it. Identify the PostgreSQL version actually tested.

Authored migrations, types, mocks, source checkpoints, documentation validators and passing path checks are useful progress; they are not this completion proof. If actual SQL or source/infrastructure access is not authorized, continue safe local work and report qualification pending. Do not fabricate SQL results, weaken required guards or seek permission for routine engineering choices. No UI implementation or UI end-to-end journey is a prerequisite for data-backend completion. Existing regression checks still protect existing consumers; release/preview checks apply when a release is separately authorized.

The older 108-obligation account/access ledger and BC-M account milestones remain preserved historical/deferred work, including their pending and unverified statuses. Do not inflate that ledger, close its obligations by redefining them or make it the denominator for this data-only outcome.

## Scope discipline and local check

Before an increment, review its four fields against this contract. Repeat the checker and actual-diff review before publication and before declaring completion. Reject or stop out-of-scope work before authoring it. A necessary shared-core dependency may be included only when it directly enables this data result or safe compatibility: record the specific file, resource, purpose, objective proof and independent reviewer confirmation. A vague “backend” or “security” label is not an exception. Ordinary choices within the contract need no user approval; a material scope change does.

Run from the repository with Node and Git; no packages, database or network are required:

~~~sh
node scripts/check-data-backend-scope.mjs --governance-change data-backend-scope-v1
node scripts/check-data-backend-scope.mjs --self-test
~~~

The default data-backend profile compares all committed and working changes with the clean source baseline 87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f. For the preserved account worktree only:

~~~sh
node scripts/check-data-backend-scope.mjs --profile preserved-account-checkpoint --governance-change data-backend-scope-v1
~~~

The [manifest](data-backend-scope.json) records narrow data path rules and exact hashes for the 51 pre-existing application changes at checkpoint 682f6bbf8158e1c3494d85f31cd0e83856536ebe. Their preservation is a fact, not approval or qualification. Those hashes apply only when that preservation base is selected; they grant no exception in the clean data workstream.

The checker compares committed, indexed and working changes against the configured base plus non-ignored untracked paths. In the preservation profile it always inspects every recorded file, even if restored to the base: raw working bytes must match the checkpoint, and HEAD/index blobs and modes must match either the original base or exact checkpoint (absence is valid only for initially untracked files). Paths under lib/accounts mix provider and deferred account concerns and therefore need exact-file reviewed extensions. Shared data code under existing projection adapters or administration may be eligible; path location alone never establishes semantic scope.

Changing the contract, manifest, checker, AGENTS or listed introductory notices requires an explicit declared --governance-change ID. The documented command includes this declaration because newly installed policy files differ from the configured baseline. The flag records only those eight fixed governance paths; it is not reviewer approval and never admits application code. An exact-file extension records reviewer, review reference, resource, purpose and proof. Updating an exception or baseline is a visible governance change requiring independent review; --base accepts only the selected profile's configured full SHA, never an arbitrary HEAD. Do not advance the baseline to hide out-of-scope work.

The existing `verify` command now runs this **path/checkpoint check** first and stops on failure; `verify:full` starts with that command, and the existing GitHub verify job invokes it with the fixed baseline available in checkout history. This is source wiring, not evidence of a hosted CI run or a required GitHub branch-protection check. The checker does not establish semantic scope, reviewer authentication, database correctness, production readiness or release authority. Ignored files are not inspected. Review the actual diff, baseline and exact-file exceptions independently. Self-tests write only disposable local Git fixtures; ordinary checks are read-only.

## Engineering references and authority

Apply the existing database-design method proportionately: [Database Design Chapter 13](https://opentextbc.ca/dbdesign01/chapter/chapter-13-database-development-process/) for requirements, ER model, implementation/testing and maintenance; [Chapter 12](https://opentextbc.ca/dbdesign01/chapter/chapter-12-normalization/) for normalization and dependency analysis. Use PostgreSQL [constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) and [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) documentation matched to the installed version. Tailor [NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final), [OWASP ASVS](https://owasp.org/projects/asvs) and [SRE](https://sre.google/sre-book/table-of-contents/) to the actual changed data/security/operating risks. These are engineering references, not a blanket certification or a mandate to build deferred account products.

Follow [Sleeper's documented identity and league interfaces](https://docs.sleeper.com/) and confirm applicable provider-use authority before external/commercial operation. Public read access is not evidence of commercial permission.

All delegated or automatic implementation for this outcome uses gpt-6-astra with ultra reasoning, as requested. This contract grants no production write, paid SQL run, provisioning, credential access, migration application, merge or release authority. Repository identity, existing isolated integration guards and separately authorized release rules remain mandatory.

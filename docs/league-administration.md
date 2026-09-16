# Portable league administration

This document describes the Sleeper-only database foundation in migrations `016_portable_league_administration.sql` and `017_enrolled_all_player_publication.sql`. It is an implementation guide, not evidence that those migrations or this application revision have been deployed. Release status and verification belong in the release evidence.

Sleeper remains the official league administration, roster, lineup, fantasy schedule and scoring source. Neon retains observed evidence and accepted current documents. Tank01 retains its existing projection-statistics and game-state role. The existing scorer, projection normalizer, frozen baselines, `clock-v1`, snapshots and publication path remain in use. Saving an unfamiliar source setting does not implement its behavior.

## Identity and enrollment

The existing `leagues.id` is a permanent UUID. `league_seasons.id` identifies one year of that league, and `league_source_connections` maps that year to its opaque Sleeper league ID. A new annual Sleeper ID must not overwrite the prior year or create a new permanent league.

| Record | Purpose and boundary |
| --- | --- |
| `league_administration_enrollments` | Owner-managed current collection fleet: permanent league UUID, provider, active flag, enrollment evidence and time. This is site administration, not a setting obtained from Sleeper. |
| `league_administration_enrollment_seasons` | Immutable intended league membership for an exact season. It is independent of whether the season/profile/connection has been registered successfully, so an incomplete registration cannot silently reduce the required publication group. Retiring a current enrollment does not erase historical membership. |
| `league_source_connection_history` | Append-only connection registration and evidenced remapping history, retaining the old and new external IDs where applicable. |

Migration 016 bootstraps the current three public league keys only from their existing registered Sleeper connections and exact seasons. Ongoing runtime lookup has no three-league allowlist. Current collection selects every active enrollment's latest intended season and requires its registered season, source connection and legacy profile. A higher unapproved registration cannot select itself. Historical operator collection selects the intended exact-season membership, including previously enrolled leagues that are no longer active. Empty or incomplete configured enrollment is an error; it does not fall back to a smaller fleet.

The existing public routes, branding and route-to-league keys remain site code. Adding an arbitrary enrolled league does not create a public route, logo or supported UI automatically. When persistence is disabled, including Vercel Preview, the explicit existing configuration registry remains the bootstrap source.

## Settings and source evidence

| Record | Stored information |
| --- | --- |
| `league_configuration_versions` | Distinct normalized settings for one internal season, dialect and normalizer version, semantic hash, shared scoring profile reference, total roster count, and five validated JSON components. |
| `league_administration_contents` | Deduplicated complete raw provider JSON plus normalized JSON, family, exact week where applicable, source connection, raw-content hash, semantic hash, completeness, validation diagnostics and optional configuration version. |
| `league_administration_observations` | Immutable evidence of observed changes, rejected/partial documents and stale attempts: content reference, origin, actual request/source/check times, replay identity, outcome and that observation's validation diagnostics. Different validations can reuse raw content while preserving distinct diagnostics. |
| `league_administration_heads` | A small pointer per season/family/week: latest observed evidence, accepted complete evidence, generation, source ordering, successful check time, nullable real network verification time, last attempt time and blocking conflict when present. |
| `league_configuration_activations` | Append-only component applicability decisions. A source capture records `observed_current`; an owner-confirmed historical correction records a separate evidenced season-type/week interval. |
| `league_configuration_heads` | The current observed activation for each component. These pointers do not establish historical applicability. |

The five components are:

- `scoring`: the exact source scoring dictionary and its shared immutable scoring profile.
- `roster`: ordered `roster_positions`, including repeated and unfamiliar slot codes.
- `competition`: source `settings` and total roster count. League type, divisions, playoffs, waiver, trade and keeper settings remain in this component with their original provider codes.
- `display`: source name, avatar and metadata.
- `extensions`: retained fields not represented elsewhere, including unfamiliar source fields.

Provider codes and extra fields are preserved; undocumented values are not translated into invented site behavior. The competition component deliberately remains cohesive in this foundation. Supporting independently effective playoff versus waiver corrections would require a reviewed component split or a narrower applicability model; changing one competition component currently binds all its retained values together.

Only the known operational counters `leg`, `last_scored_leg`, `daily_waivers_last_ran`, and `last_report`, plus the top-level source lifecycle `status`, are excluded from the material configuration identity. Their actual values remain in raw evidence. A counter-only change can create a source-content/observation record while reusing the same configuration version.

There are no full weekly copies of unchanged settings. Consecutive identical accepted network documents advance successful verification without another observation or configuration version. A → B → A reuses version A's content and creates a new observation and changed component activation for the return to A. The system cannot detect a source change that occurred and reverted between checks.

Collection endpoints represent sets of scoped entities. Reordering the same entities retains the distinct raw content and a new immutable observation with its actual retrieval times, classified as `unchanged`. The accepted pointer advances to that raw evidence while the semantic generation stays fixed. Actual collection changes, league operational-state changes and recovery from a blocking conflict still advance generation. Equal-time raw conflicts and unknown-age cache protections remain unchanged.

## Observation time and applicability

An envelope identifies its source family and exact scope and carries `origin`, request start/end, nullable `sourceObservedAt`, and `checkedAt`. Database `recorded_at` is a separate fact. Importing an old matchup today records when it was actually retrieved; it does not manufacture its original observation time.

Known source observation time controls advancement. A cache retrieval's current clock must not outrank an older proven source time. A cached document with unknown source age may reuse an identical accepted document without advancing freshness or ordering. A different unknown-age cache document is retained as stale evidence with `unproven_cache_change`; the existing official loader can verify that one family with a fresh request. Older proven observations cannot replace newer heads. Equal source times with different contents are a conflict.

Rejected or partial observations do not overwrite an accepted complete document or refresh its successful `checked_at`. The last attempted time is separate. Exact successful replay returns current context only when that observation is still the accepted pointer; replaying an old or rejected observation cannot masquerade as a new acceptance.

`verified_at` separately records the latest accepted real network verification of the current content. An unchanged network response advances it without replacing the original immutable observation. An initial cache-only head has no network verification; an unchanged cache replay cannot make it fresh. Rejected and stale attempts leave successful verification untouched. Page source freshness uses this verification, rather than treating a new cache-check clock as a new source response.

A normal capture establishes what was observed now. It does not establish Week 1 rules or backdate today's roster and playoff configuration. Historical applicability requires an evidenced component interval. Later overlapping corrections have a greater component generation and leave earlier decisions intact. The pure resolver refuses missing or inconsistent explicit bindings. The live scoring pipelines still use their existing immutable season profile; historical activation records are not a switch to a new historical rescoring engine.

## Scoring compatibility and calculation lineage

`scoring_profiles` remains the existing shared store of exact raw rule dictionaries and compatible hashes. Identical dictionaries can share a profile between leagues and years. Zero, negative and unfamiliar keys remain intact; absence and explicit zero are distinct source evidence.

The existing `league_seasons.scoring_profile_id` remains immutable. A newly observed dictionary that differs from that binding is retained in a new configuration version/profile, but the source reader reports `scoring_profile_change_requires_explicit_compatibility_and_period_review`. It does not silently return the new raw scoring settings as accepted current league data. Compatible non-scoring component history can still advance. Missing usable scoring rules also fail this compatibility gate.

Owner-recorded applicability does not rebind the legacy season profile, clear a scoring conflict, or rescore frozen/history records. Enabling a changed scoring profile for an existing season needs a separately reviewed compatibility and calculation-selection change. Keeping the original record and creating a corrected derived result are separate operations.

New projection official observations may pin `source_data.administration` containing the accepted league observation ID, configuration version ID and head generation. The insertion guard checks source identity and current accepted context under locks. Publication checks the same context again, using the pointer's `verification_source_observation_id` when provided. This permits an unchanged displayed snapshot to be reused with a newly verified source observation while rejecting a configuration change that happened between calculation and publication. Existing observations without this optional context remain compatible; old snapshots and frozen baselines are not rewritten.

Migration 017 replaces only the two existing all-player group-validation/publication function bodies. The intended exact-season enrollment determines all required leagues and distinct profiles. Missing registrations or source connections fail the entire expected group. Existing scorer support, official parity, profile coordination, worker fences, immutable score sets and atomic publication checks remain. Its existing regular-season and supported-year restrictions remain in force.

## Teams, managers and operational coverage

| Source family | Persisted fields and interpretation |
| --- | --- |
| `league` | Full raw league document, five configuration components, total roster count and raw scoring-profile identity. |
| `rosters` | Source roster ID, nullable primary owner, co-owners, player IDs, ordered starters, reserve and taxi IDs; exact raw roster document. Missing lists remain unknown rather than becoming empty. |
| `users` | Public source account ID, display name, username and avatar, with raw source fields preserved. |
| `matchups` | Exact season and week, source roster and matchup IDs, player/start lists, official points and custom commissioner points, plus raw evidence. |
| `transactions` | Exact source week, including week 0; transaction ID/type/status/timestamps, roster/consenter IDs, typed player adds/drops, budget transfers and draft-pick movements, plus raw evidence. |
| `drafts` | Season-scoped source catalog, draft details, picks and draft traded-pick bodies; validated draft/league/year identity and typed draft ID, pick-number, selected-player and traded-pick references. The complete raw bundles remain retained. |
| `traded_picks` | The league's season-scoped source inventory of traded pick movements, retaining target year/round, original roster, previous owner and current source owner. |
| `winners_bracket`, `losers_bracket` | Season-scoped source bracket bodies and typed match ID, round, roster sides and nullable winner/loser references. Unfamiliar source fields and advancement data remain raw rather than gaining invented semantics. |

`league_season_teams` gives a UUID to a source team entry scoped by internal season, provider, external league ID and roster ID. Repeated roster number 1 in another league/year is a different team entry. An evidenced source remap does not silently infer franchise continuity. `league_source_manager_accounts` represents Sleeper accounts, globally keyed by provider account ID, and is separate from site login identities.

`league_administration_team_entries`, `league_administration_manager_entries`, `league_administration_memberships` and `league_administration_transaction_entries` retain typed content-linked records. Draft, traded-pick and bracket families reuse the existing raw/normalized content and observation tables; there are no empty placeholder entity tables for them. Membership changes create new evidence and retain the previous owner/co-owner associations. A vacant team is valid. A public source owner/co-owner is not authorization to log in, administer the website, or approve local operations.

Player and defense IDs in these operational records remain source IDs. The existing shared canonical scoring identities and verified provider mappings remain the scorer's authority; this foundation does not guess mappings for unknown players. It also does not infer a transaction from two roster snapshots or use today's roster as a historical lineup.

The collection boundary is one document family per observation. Separately fetched league, users and rosters do not pretend to share one provider observation time. A draft-family bundle spans catalog/detail/pick/trade requests; its envelope describes that sequence rather than an atomic provider snapshot. Each family's accepted head is atomic; the families are not advertised as one provider-wide transaction snapshot. A failed draft subdocument remains null in partial evidence, and partial collection cannot erase an accepted complete bundle. A confirmed empty source array is valid complete evidence.

For `winners_bracket` and `losers_bracket` only, a successful response containing JSON `null` is also valid complete source evidence. The original null remains in the envelope and stored raw payload; its normalized match list is empty because no match records were returned. This does not establish why the bracket is absent, whether playoffs are disabled, or how future brackets will behave. Raw `null` and `[]` retain distinct content and semantic identities, so changing between them is recorded rather than collapsed into the same source state. Stored reads revalidate the retained null through the same bracket-specific normalizer. Such complete evidence can pass the operator's shadow and write validation without inventing a populated bracket.

An HTTP/transport failure or a refused request budget is different: its null placeholder remains partial evidence with unknown source observation time, fails acceptance and cannot replace a complete head. Malformed bracket objects or scalar values remain rejected. Null draft catalogs, draft subdocuments and league traded-pick inventories do not gain this bracket-only allowance; their existing failure and completeness checks remain in force.

## Collection and readers

Existing current/future projection and lineup paths can retain the administration documents they already obtain from the official Sleeper boundary. Lightweight/page reads do not write shared administration state. The existing current cron lane also has a bounded administration maintenance opportunity at UTC minute 30: one global hourly job selects one enrolled league. Ordinary turns collect core documents and one exact period, using at most five Sleeper GETs (four for week 0). Every fourth turn for that league substitutes its four metadata families, with a 28-request metadata allowance plus three core requests, at most 31 total. It has a finite deadline, rotating coverage and the existing job lease system. No new cron route or Tank01 collection path is introduced.

These are collection opportunities, not a freshness SLA. With three enrolled leagues, this maintenance rotation revisits a league's core documents about every three hours and its metadata about every twelve hours. Current and previous exact weeks receive priority turns, while metadata turns interrupt the historical rotation. The bounded fairness regression covers a 684-hour window (`4 × 3 × 3 × 19`) to establish coverage of every week 0–18 for three leagues at a steady Week 18; it is not a promise of a complete weekly refresh within a few hours. Primary worker captures and page fallbacks have their own existing schedules/cache windows. Timeouts, job contention, insufficient remaining deadline or missed cron invocations can delay maintenance coverage further; a small database does not imply all provider history has been collected.

The maintenance and explicit operator paths share the `league-administration-maintenance` job key. An explicit fence includes job key, worker ID, attempt generation and deadline. The atomic SQL writer locks and verifies the existing job row, then rechecks expiry before advancing a head. Existing worker jobs retain completion/failure outcomes. Row locking, replay checks and source timestamps also protect ordinary captures that have no separate maintenance fence.

Stored page reads return accepted raw source JSON with its scope, evidence IDs, generation, successful check time and nullable network verification time. The page reader also enforces its caller's source freshness window (60 seconds by default) against successful checks and network verification; stale or unverified stored documents need the established official fallback. Reads distinguish:

- `available`: a validated accepted complete head.
- `missing` or `disabled`: the existing official Sleeper fallback is permitted.
- `unavailable`: the database could not be read; the existing source fallback remains distinguishable from stored success.
- `conflict`: source mapping, stored-document integrity or scoring compatibility is inconsistent; readers fail closed instead of silently using another source.

The existing snapshot reader, exact-week selection and page fallback presentation remain separate from source document ingestion. Static site horizon, lineup eligibility support, projection formulas, participation/PPG policy, rounding, cache/worker policies, source normalization and supported-stat mappings are still application behavior.

## Owner procedures

These procedures describe authorized operations after the additive schema is installed and service identity is verified. They are not authorization to apply production migrations or change production data.

**Enroll a league.** First verify the permanent internal league, exact registered season, immutable scoring profile and source connection using independent Sleeper evidence. As the schema owner, insert the current fleet row into `league_administration_enrollments`, with `provider='sleeper'` and concrete evidence, and insert each intended exact-season membership into `league_administration_enrollment_seasons`. Do not infer old membership merely from a matching name. These enrollment tables are not writable by the application role. The initial three leagues use migration 016's verified-existing-connection seed.

**Connect the next annual source.** Verify the new source's `league_id`, `season`, `previous_league_id` and complete scoring dictionary. Compute the dictionary hash with the existing compatible algorithm. Call the owner-only function:

```sql
public.connect_league_administration_season(
  p_league_id uuid,
  p_season smallint,
  p_previous_external_id text,
  p_external_id text,
  p_rules_hash text,
  p_rules jsonb,
  p_evidence text
)
```

The function locks the permanent league, requires the latest registered external ID to equal the expected predecessor and the new year to be the next year, creates the immutable profile/season/source association and records the intended season membership. It does not fetch Sleeper or prove the supplied evidence itself. A predecessor/source disagreement requires investigation. Arbitrary missing historical years require an independently reviewed owner import; they are not inferred by this next-year helper. Runtime refresh cannot add an annual connection to an enrolled league.

**Correct a same-season source mapping.** Call `remap_league_source_connection(p_season_id uuid,p_provider text,p_expected_external_id text,p_external_id text,p_evidence text)` as owner. It compares the expected old mapping under lock, preserves the remap evidence and invalidates source heads until fresh accepted evidence is collected. Runtime updates cannot change the external ID, season or provider. A remap is not a way to rewrite historical team/franchise identities.

**Record evidenced applicability.** Call `activate_league_configuration_component(p_version_id uuid,p_component text,p_season_type text,p_from_week smallint,p_through_week smallint,p_evidence text,p_expected_generation bigint)` as owner. Pass the latest generation for that season/component, including prior observed-current activations. The inclusive interval applies only to that component, and a stale expected generation fails. This records a decision; it does not change the legacy scorer or amend earlier snapshots.

**Bootstrap or inspect source coverage.** From `apps/site`, the bounded CLI is:

```text
node --conditions=react-server --import tsx scripts/run-league-administration.ts --mode shadow --season 2026 --league league1 --weeks 0-2
```

`--mode write` uses the same official loaders, normalizer, job fence and SQL writer. `--league all` targets every intended member of the exact season; week ranges are explicit and bounded to 0–18. Add `--metadata include` to collect drafts, traded picks and both bracket families; the default is `--metadata skip`. Metadata collection validates catalog ownership before constructing draft endpoint requests, limits the catalog to eight drafts, bounds detail requests and retains partial evidence when a source or budget prevents a complete inventory. The command refuses more than 120 planned provider requests, enforces the remaining budget as the draft inventory becomes known, and uses a three-minute deadline. Shadow mode performs source reads/validation but no administration writes or job claim; it is not a provider-free operation. This operator path supplements the bounded recurring metadata opportunities; neither path guarantees unavailable historical source data can be recovered.

The CLI requires `DATABASE_URL` plus exact target environment, expected host/database/runtime role, matching `VERCEL_ENV`, and an exact-scope write-authorization marker in write mode. See `parseAdministrationOperatorInput` for the variable names and accepted values; keep credentials outside committed files. It rechecks the live session's database and role. A new bootstrap execution observes current source state; it cannot recreate unexposed historical edits or secretly approve historical applicability.

## Permissions, release and recovery

The runtime role has `SELECT` on all fifteen new tables and `EXECUTE` on the atomic `record_league_administration_observation(jsonb)` writer. It cannot directly insert/update/delete/truncate the new tables or call owner remap, annual connection or applicability functions. History rows reject updates/deletes, and typed child rows cannot be appended after their content has been observed. Scoped foreign keys prevent cross-season configuration, observation and team references. Definer functions use a fixed trusted search path and are not executable by `PUBLIC`.

Use the dedicated 016/017 release wrapper and its captured, independently reviewed catalog. The wrapper checks the pre-016 ledger, exact migration checksums, schema/database/role identity and expected additive object/ACL changes, and applies the bundle transactionally with postconditions. A commented `--review` rendering is not executable release approval. Installed migrations 001–015 remain unchanged.

Before commit, a failed migration/postcondition rolls back as one transaction. After commit, rollback is an explicit application/schema compatibility decision: preserve the new evidence, enrollment records and immutable legacy bindings. Do not drop tables, delete migration-ledger entries, remove guards or apply an old compensation package as an automatic rollback. An older application may remain compatible with unchanged existing sources, but cannot be assumed compatible with newly enforced enrollment, annual mapping or generic publication-group rules. Verify the intended previous revision or use a reviewed forward fix. The older Dynasty compensation artifact was reviewed only for the pre-016 database and must not be applied blindly afterward.

This foundation does not provide a native league management engine, authenticated commissioner UI, native draft execution, a comprehensive internal pick-asset ownership ledger, bracket execution or a new playoff UI, private waiver bids, native trade/waiver/lineup commands, cross-provider person or franchise matching, or a reversible authority-cutover mechanism. Draft/pick/bracket ingestion retains the source evidence and typed references; it does not implement those native administration capabilities. The foundation does not create a separate site-policy database. These remain separate product and implementation work, and retained unfamiliar source fields are not evidence that those capabilities exist.

# Week 1 statistics recovery

This repair retains valid partial player statistics when historical game context is unresolved, fixes dual-position roster metrics at the existing catalog boundary, and distinguishes a verified empty current pregame week from malformed provider data. It does not change scoring weights, participation policy, provider cadence, or complete-publication requirements.

## Findings and behavior

| Finding | Correction and evidence |
| --- | --- |
| A player has retained Week 1 statistics but no team in the current catalog. The adapter and preflight accepted the partial row; PostgreSQL rejected the whole batch. | Migration 018 permits an eligible player without a game only in partial content with unknown game phase. The captured Jimmy Horn regression reproduces the original rejection and verifies repaired retention, replay, physical counts and unchanged pointers. |
| A player's current team differs from retained context for the requested week. | Read only that exact period's accepted history. Treat disagreement as unresolved context, not proof of either team. Preserve the dated catalog and conflict provenance; do not assign old statistics to the current team's game. Reviewed period evidence can resolve context for an observation while that evidence remains supplied; a later run without it conservatively quarantines the retained conflict again. |
| Travis Hunter's primary catalog position is DB, although his fantasy positions include WR. Roster presentation dropped stored WR metrics. | Use the existing shared official catalog classifier for roster presentation. Do not create an alias, alternate scorer or ranking pipeline. Tests exercise all three league routes. |
| Empty, not-yet-started current weeks were indistinguishable from malformed weekly responses. | Classify a parsed empty object separately. Record `no-statistics-yet` only after current-period, schedule, kickoff, official-points and ownership proof. Null, arrays, malformed JSON, error envelopes, started weeks and historical requests remain failures. |
| Durable failures did not identify response shape or persistence category. | Store bounded HTTP status, shape, member count, SHA-256, observation times, stage and allowlisted SQLSTATE category. Never retain connection strings, arbitrary SQL errors, headers or response contents in diagnostics. |

## Participation and score authority

Sleeper remains the official source for league rules, player points and lineups. Tank01 remains the projection and game-state source; this repair never requests Tank01 to diagnose statistics. Neon retains immutable observations and the current reader contract.

Use the existing versioned participation policy. Positive individual snaps or valid appearance evidence can count as participation even when fantasy points are zero. Missing rows or absent/zero participation evidence retain the accepted product assumption and its provenance. A missing row is not authoritative proof of a healthy scratch. Unknown eligibility remains null. Never derive a participation denominator from the point total alone.

Partial observations may inform the existing provisional roster metrics. They do not create complete score sets, move complete-score pointers, or certify the all-player inventory complete. Valid raw records with unresolved game context retain their source flags and counts. Complete publication still requires complete inventory, canonical game context, scoring support, all-profile parity and live fenced ownership.

Historical context uses the earliest retained observation for each distinct player/team pair, so repeated observations alone do not change its fingerprint. After the first conflict is saved, its durable conflict marker can create one additional content version on the next retrieval. This transition is bounded for unchanged inputs; later identical context reuses content. Preserve the marker because a current catalog reverting to an earlier team cannot erase an unresolved conflict. Measure physical growth during release verification; do not infer database storage from serialized JSON or claim whole-season capacity from this narrow repair.

Reviewed period evidence is not a permanent conflict-clear operation. It must continue to be supplied on subsequent runs that rely on it. If it is absent, retained conflicting context becomes unresolved again; this repair does not introduce a separate durable resolved-identity or resolved-team state.

## Verified current pregame empty response

An empty object is acceptable only in the recurring current period, after a shared budgeted request. Every enrolled league must have a fresh matching active-period authority. All 32 NFL teams must have consistent canonical schedule coverage, including explicit byes. Scheduled games must be reciprocal, agree with stored exact-period games and have future kickoffs at the post-response check. Neither source may indicate a live/final game, and official team/player/custom points must not contradict an unstarted period.

The SQL completion function rechecks the live lease, generation, deadline, consumed request generation, enrolled active authorities and stored games. A kickoff, rollover, expiry or takeover between application preflight and completion rejects the healthy outcome. No player zeros, denominators, aliases, official observations, raw batches, scores or pointers are written for this outcome. The request still consumes the shared hour slot, and correction-period selection remains unchanged. Successful no-data is not a successful score publication.

## Week 1 evidence and screenshot coverage

The ten supplied Sleeper screenshots contain 157 fully readable distinct League One entries: 147 players and 10 defenses, including 106 starters and 51 nonstarters. Every readable point value matches the separately captured official Week 1 matchup evidence. Overlapping screenshot rows are counted once; clipped values are not guessed.

The official League One Week 1 records contain 170 entries. The 13 missing from the readable screenshots are:

| Screenshot location | Missing entries |
| --- | --- |
| Photo 10, Matthew Stafford's side | Brock Bowers, Woody Marks, Kaelon Black, Trevor Lawrence, Zach Charbonnet, Green Bay Packers defense |
| Photo 10, Dak Prescott's side | Tre Tucker, Wan'Dale Robinson, Isaiah Likely, Brian Robinson, Parker Washington, Seattle Seahawks defense |
| Photos 4–5, Bo Nix's side | Kansas City Chiefs defense, a nonstarter |

Photo 10 cuts off both defenses and omits both nonstarter sections. Photo 5 includes Carnell Tate's extra nonstarter row but does not include the Kansas City defense. The official matchup record distinguishes starters from other players; it does not prove whether an omitted nonstarter occupied a bench, reserve or taxi slot.

The screenshots cover one league. Across all three official Week 1 roster populations, there are 254 unique identities and 571 roster occurrences; 97 identities are absent from the screenshots, including Dynasty's Travis Hunter. Keep each league's scoring profile separate.

The independent local audit combined 762 nonempty and 3,626 explicitly stored empty-stat rows. It reproduced all 571 official roster point values, verified the enrolled scoring-rule hashes and current metric-reader mapping guards, and matched 570 of 571 captured site PPG/rank pairs. Hunter is the confirmed display gap: stored WR data supports 1.60 PPG and WR rank 92, while the pre-repair site presents DB and drops those metrics. These are timestamped pre-release observations, not evidence that a subsequent ingestion succeeded.

The stored appearance denominators are Mac Jones 0, requested DeVito identity 0, A.J. Brown 1 and TreVeyon Henderson 0. Henderson's eligibility remains unknown under the accepted missing-row assumption. Among the 73 official zero-point roster occurrences, 28 have an appearance of one and 45 have an appearance of zero. Zero fantasy points alone must not decide participation.

## Verification record before release

| Check | Observed result |
| --- | --- |
| ESLint, generated route types, TypeScript, production build | Passed |
| Unit suite | 2,771 passed, 1 skipped; 154 files |
| Guarded isolated database suite | 313 passed; 21 files; zero database-test skips |
| Actual migration 018 release wrapper | 11 SQL checks passed on PostgreSQL 180006 |
| Independent catalog/wrapper review | No blocking findings; exact two-function body change, 50 protected physical tables, preserved ownership/ACLs and full constraint inventory |
| Initial full browser run | 75 passed, 1 skipped, 6 failed |
| Targeted rerun of the six browser failures | 5 passed; combined multi-viewport Rosters case still timed out |
| Final targeted browser run after splitting Rosters by viewport | Four Rosters cases passed at 320, 390, 504 and 1280 pixels; separate My Team selection case remained skipped |

The final Rosters cases retain the original assertions but give each viewport its own test deadline. The remaining browser skip is “My Team choices remain independent between League One and League Two”: the source did not supply manager cards needed by that journey. This behavior remains unverified in those local runs. Do not combine reruns into a claim that the original full browser command passed or report zero skips.

The SQL wrapper evidence is in [wrapper-verification.integration.json](../apps/site/release/all-player-partial-context/wrapper-verification.integration.json), with independent review in [catalog-review.integration.json](../apps/site/release/all-player-partial-context/catalog-review.integration.json). The wrapper capture's original pending-review label records capture time; the later independent review and reviewed manifest establish the review result.

The full isolated suite regenerated four historical capacity-report paths. Their current-run outputs were copied and hash-verified in the local repair evidence directory before restoring the tracked historical reports. These measurements prove the stated isolated scenarios only; they do not establish production season-fit or fresh production headroom.

Local logs and operational exports remain in the durable repair evidence directory. Branch publication, actual preview inspection, production migration installation, merge/deployment and naturally scheduled collection are separate gates to record when observed; the local results above do not claim those gates are complete.

## Release and recovery procedure

1. Revalidate canonical GitHub/main, Vercel source/root/production branch and exact current production SHA. Check the intended Neon project/branch/database/owner, migration ledger, PostgreSQL 180006 catalog, runtime grants and live leases. Proceed only with no competing owner observed. Retain a pre-release restore point and local audit evidence; do not publish operational exports in the PR.
2. Run the complete repository verification workflow and the existing guarded isolated integration harness. Capture the exact 018 before/after function definitions and PostgreSQL constraint/ACL catalog. Require independent review and the actual release-wrapper success, deliberate corrupt-manifest rollback and false-success rejection evidence. Inspect the real preview. Preview remains database-disabled.
3. Apply only the reviewed additive 018 wrapper to the verified production database, with no live worker owner. It must preserve installed migrations 001–017 and all data, pointers, table/column/trigger protections and privileges. Record the commit sentinel, checksum, unchanged physical history counts and matching catalog. Never edit an installed migration.
4. Keep the existing deployed application compatible while verifying the migration. The old function signatures and old outcome values remain accepted. The new partial allowance cannot publish complete scores. No cron change is required.
5. Merge the reviewed coordinated PR within release authority, verify the exact merged production SHA, and check Matchups and Rosters for League One, League Two and Dynasty. Verify Hunter's stored WR metrics and the requested denominator cases against the captured official Week 1 baseline.
6. Observe the existing natural scheduled lane. Record a Week 1 raw save with actual physical counts, source time, league-specific parity, no unintended pointer movement and durable outcome; observe a current Week 2 result with its actual response shape and subsequent not-due behavior. Do not reconstruct the body of an earlier failure from a later response. Do not force unbudgeted provider retries to make a release report look complete.

If a safety condition fails, stop further release/data work and preserve the last accepted history and pointers. A protected application revert can restore the preceding release while leaving 018 installed: old calls remain compatible. Do not use a destructive down migration, erase history, or move score pointers manually. If function restoration is necessary, stop the affected lane using its existing configuration and wait for leases to expire, then independently review a compensating additive migration restoring the captured prior function bodies; preserved unresolved raw records must remain readable. Verify source/configuration agreement and all league readers before resuming.

The operational report must distinguish local tests, branch/PR, preview, migration, merged production revision, actual scheduled observations and remaining unobserved gates. Arithmetic checks on stored rows are not fresh ingestion or complete all-player publication.

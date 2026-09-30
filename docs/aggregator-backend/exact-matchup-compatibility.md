# Exact-period stored-reference compatibility

This internal Bundle 1 join starts from preserved PR274 `b1c81b9ebba60ef0fdafebb52d21bb8211f43e38`. It attaches existing stored forecasts, original game-state observations and probabilities to accepted exact-period matchup facts. The [Step 2 checklist](step-2-checklist.md) remains the sole completion ledger. This increment does not complete B1 or switch any public reader.

## Input and evidence boundary

The caller supplies an exact snapshot UUID, league-season UUID, numeric season and week, projection model, expected enrolled source mapping, period context and evaluation time. There is no default-season lookup or latest-week substitution. The reader uses the existing database factory and Preview isolation. It performs no provider request, calculation, baseline lookup, publication or write.

The accepted matchup query and source-history query are reused with their existing validation. The administration store supplies its private accepted query and parsers through the projection store's composition factory; projection SQL and decoding stay inside its Neon adapter. The accepted receipt now exposes its already-selected immutable configuration content ID. Snapshot decoding uses `snapshotFromRow` and the existing `isMatchupsData` validation. The evidence query also reads immutable configuration versions, the league-season scoring profile, captured matchup payloads and original game observations. A single database statement keeps accepted and snapshot verification pointers coherent during the read. Each read receives a fresh three-second deadline.

Compatibility requires complete participant and matchup-group identity, effective official team scores, ordered starter IDs and vacancy positions, and official starter scores. Custom zero remains zero; missing remains distinct from zero or an explicitly vacant slot. A content hash or equal week number alone is insufficient. Historical slot labels are not required to compare the retained raw ordered players.

The accepted configuration, original calculation configuration and later verification configuration are checked separately against the immutable scoring profile and rules. Retained native-to-NFL mapping and the original source mapping revision must match the requested scope. A later verification cannot repair an unlinked original or an A → B → A source remap. Original consumed-input times and IDs remain separate from legacy observation times and later verification times.

Original game references must cover the exact expected game set, provider, season, season type and week. Original matchup and game observation/completion times and calculation time must fit the existing 90-second source-skew limit. Their actual observation times remain visible. The schema has no separate verification-time game observation set, so this join supplies none. A local stored matchup status or final probability does not establish provider fantasy-matchup finality.

## Result and limitations

The result retains the accepted official read unchanged. Forecast, game state and probability have independent available/unavailable results. Their available values are copied from the existing stored snapshot and keyed to participant identity, preserving probability when displayed sides reverse. No projection, probability or official score is recalculated.

The exact UUID must still be the selected snapshot for that league-season/week; a superseded snapshot returns `snapshot_not_current` while retaining its source history. This avoids assigning it another snapshot's verification or inventing a verification time from its calculation time. The selected snapshot may represent a historical week. The join reuses snapshot freshness policy: an active stale snapshot is unavailable, historical data remains durable, and future data can remain available with refresh due. The supplied period context is checked for consistency with the requested period; this internal join does not establish fresh current calendar authority for a future public reader.

Player-row projected points preserve existing presentation semantics, including the frozen pregame value after a game is final. Team projected points preserve the stored phase-dependent team forecast. They are not recomputed by summing visible player rows. Missing stored results remain unavailable or explicitly partial in their original fields.

Snapshots do not retain every original per-player candidate or frozen-baseline ID. This join does not reconstruct those historical inputs from today's baseline rows or claim complete calculation provenance. Historical configuration applicability, lineup attention, box scores, retained-history restart/comparison, B2–B4 and final composed B1 acceptance remain separate gates.

## Qualification and authorization

Before implementation, clean primary local/GitHub main and Ready Vercel production agreed at `2a46133a866af259066f454307e14cbf32152f76`, deployment `A57m3zjCdGRAwxSE9cpTrT87fZqg`. The authenticated Vercel project remained `league_one_fantasy`, connected to `clawmachinejed/league-one-audit`, production branch `main`, root `apps/site`. No competing owner observed in inspected worktrees, branches, PRs, workflows and deployments. Production database and worker leases were not inspected for this development-only task.

PR274's completed source-history qualification is reconciled in the checklist and remains attributed to `b1c81b9`. It does not qualify this new SQL reader. Local checks, independent review, hosted CI, actual Preview and protected exact-SHA disposable SQL are separate gates. The user approved candidate `6254e22e413bb3f33eb38f47180f3fc7c7aef306` and raised the cumulative test cap from $5 to $10; this is not a budget reset. Its full SQL run failed one fixture while all cleanup gates passed. The checklist records the evidence and fixture correction. A changed candidate requires new concrete exact-SHA approval before another full guarded disposable run.

No new schema or migration is introduced. No production migration, merge/release, backfill/replay, provider enrollment, cron change or Step 3 public-reader switch is authorized by this increment. A future release still needs the predecessor migrations and their separate production authorization. Application rollback can remove the internal join while preserving all immutable evidence and existing public behavior.

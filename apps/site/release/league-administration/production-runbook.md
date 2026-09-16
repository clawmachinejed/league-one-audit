# Production release and initial collection

Prepared for PR #220, the existing three 2026 Sleeper leagues, and migrations 016/017 only. This document does not grant production authorization. Execute it only under explicit authority covering production migration, bounded data collection, merge and deployment; the isolated test database authorization alone is insufficient. Record the actual authorization and release status in the operator's release evidence.

## Preconditions

Require successful final isolated integration, independently reviewed real PostgreSQL 180006 catalog, wrapper rollback/commit/replay checks, physical capacity measurement, application verification, exact-head CI and actual Preview inspection. Read `production-preflight.readonly.json` as dated evidence, not live configuration. The existing production all-player job reported `provider-failed` at 19:01 UTC; investigate or document its current status before claiming all production services healthy. Do not force another provider collection to hide this baseline.

Recheck canonical local/GitHub main, PR head, protected merge requirements, Vercel repository/root/production branch and exact production SHA. Verify Neon project `solitary-base-99261075`, branch `br-rapid-boat-avgeevye` (`main`), database `neondb`, owner `neondb_owner`, PostgreSQL 180006, the exact 001–015 ledger and runtime permissions. Stop on unexplained disagreement. Check worktrees, PRs, deployments and live worker leases; the migration wrapper independently refuses active ownership. Ordinary cron work remains subject to those guards.

Use the independently reviewed capacity scenarios for this three-league rollout. The measured final synthetic footprint is 1.1875 MiB; unchanged checks appended no history in that finite workload. The proposed 5 GB incremental relation-storage review reserve is a planning threshold, not allocated capacity or a spending authorization. Re-measure after bootstrap and the first full live game week, retaining ordinary application, shared-table, restore-history and branch overhead separately. Do not claim a complete season or thousands of leagues fit from this fixture.

Record the existing production deployment and read-only counts, immutable references and current score/snapshot pointers. Confirm a current usable recovery point before applying the bundle. The older pre-Dynasty backup is not a backup of the state immediately before this release. Do not restore a database or create paid capacity as an implicit test step.

## Compatible migration and bounded bootstrap order

1. On the reviewed PR revision, render `016-017.production.sql` using `node scripts/render-league-administration-release-wrapper.mjs` from `apps/site`. Verify its recorded checksum and reviewed catalog against the exact migration files. The `--review` artifact is comments only and cannot install anything.
2. Under explicit production release authority, open a fresh dedicated idle SQL session as the verified owner and apply that exact wrapper. Never reuse a session with pending work: the wrapper first clears and commits a session-only success marker, then installs both additive migrations in one transaction while the existing production application continues running. Require this execution's commit sentinel and verify the installed 001–017 ledger, resulting catalog, least-privilege grants and unchanged protected history. On failure, follow the wrapper evidence and recovery rules; do not paste individual migrations or rerun blindly.
3. Run the new CLI from the reviewed revision in an approved controlled operator environment, before deploying the new scheduled collector. Use the existing runtime credential securely; do not commit, print or copy production credentials into a normal local development environment. This separates initial validation from automatic administration capture, which begins when the new application is deployed.
4. Run the following bounded shadow, with the write marker absent:

   ```text
   node --conditions=react-server --import tsx scripts/run-league-administration.ts --mode shadow --season 2026 --league all --weeks 0-2 --metadata include
   ```

   The command makes official Sleeper GETs but performs no administration writes or job claim. It uses no Tank01 request. Require completed status, all three intended 2026 connections, compatible scoring profiles and accepted evidence for all requested families. Partial/rejected/unknown source evidence is a stop condition for calling bootstrap complete; it is not permission to invent data.
5. Only after that shadow succeeds, set the exact-scope write marker `LEAGUE_ADMINISTRATION_WRITE_AUTHORIZATION=2026:all:0-2:metadata` and run the identical command with `--mode write`. The planned scope is 36 family/period documents: per league, three core families, four metadata families, matchups for Weeks 1/2 and transactions for Weeks 0/1/2. Metadata detail GETs vary with the actual draft inventory; preserve the reported count and the 120-request/180-second limits. Families commit independently, so a later failure may leave valid accepted evidence. Diagnose it before a bounded replay; never describe the complete operation as atomic.
6. Clear the write marker after the operation. Verify stored source connections, configuration versions and five component heads per league, accepted content/observation lineage, typed team/account/membership/transaction rows, and real network verification times. Expect 12 accepted family/period heads per league only if every requested source document is valid and complete. Do not require one immutable version when a legitimate source change occurred during collection.
7. Merge the reviewed PR within the approved release scope. Confirm Vercel production runs the exact merged SHA, then verify all three leagues' Matchups, My Team, Standings, Rosters and manager navigation. Existing points, projections, ranks, PPG, noon-Eastern week rollover and team selection retain their existing contracts. A ready Preview does not prove database-backed production behavior.
8. Observe a real existing current-lane invocation that records administration evidence and the UTC-minute-30 maintenance opportunity, then a not-due/busy or unchanged follow-up. Record league, exact period/family, actual provider requests, durable job outcome, head movement and physical storage change. Verify failed/partial observations do not replace accepted complete documents. Recurring maintenance begins with deployed code; there is no separate new cron or activation switch.

The operator requires `DATABASE_URL` with TLS and runtime role, `VERCEL_ENV=production`, `LEAGUE_ADMINISTRATION_TARGET_ENVIRONMENT=production`, `LEAGUE_ADMINISTRATION_EXPECTED_DATABASE=neondb`, `LEAGUE_ADMINISTRATION_EXPECTED_ROLE=league_one_runtime`, and `LEAGUE_ADMINISTRATION_EXPECTED_HOST` matching the freshly verified endpoint hostname. Do not guess the hostname. The shadow rejects any write-authorization marker. The write command and recurring maintenance share the existing `league-administration-maintenance` job lease.

## Read-only evidence after bootstrap

Use queries scoped to the three approved 2026 leagues, for example:

```sql
SELECT l.league_key, s.season, c.external_league_id,
       h.family, h.week, h.generation, h.accepted_observation_id,
       h.checked_at, h.verified_at, h.read_conflict
FROM public.league_administration_heads h
JOIN public.league_seasons s ON s.id=h.league_season_id
JOIN public.leagues l ON l.id=s.league_id
JOIN public.league_source_connections c ON c.league_season_id=s.id
  AND c.provider='sleeper'
WHERE s.season=2026 AND l.league_key IN ('league1','league2','dynasty')
ORDER BY l.league_key,h.family,h.week;

SELECT relname, pg_table_size(relid) AS table_and_toast_bytes,
       pg_indexes_size(relid) AS index_bytes,
       pg_total_relation_size(relid) AS total_bytes
FROM pg_catalog.pg_statio_user_tables
WHERE relname LIKE 'league_administration_%'
   OR relname IN ('league_configuration_versions','league_configuration_heads',
                 'league_configuration_activations','league_source_connection_history',
                 'league_season_teams','league_source_manager_accounts')
ORDER BY relname;
```

Preserve source observation times and unknown historical applicability. A Week 1 import today does not recover earlier hidden edits or authorize historical rescoring. Saving settings does not implement undocumented Sleeper behavior, a new provider, or a league management engine.

## Failure and compensating recovery

Before migration commit, an assertion failure must roll back the bundle and ledger. A missing final sentinel is ambiguous: independently read identity, ledger and catalog before deciding whether anything committed. An already-installed bundle is not a new successful installation.

After migration commit, preserve additive tables, immutable history, source mappings, existing scoring profiles and verified pointers. Do not drop tables, delete migration entries, disable integrity triggers or apply the pre-016 Dynasty compensation package. This release does not remap any source or change any scoring rule, so no identity/scoring reversal is part of its ordinary rollback.

If the new application requires rollback, use the recorded prior compatible application revision after checking that only the originally approved enrollment and mappings exist. Rolling back stops its new scheduled administration path, but in-flight workers can remain until their current bounded leases/deadlines expire. Verify they have drained before further corrective operations; retain all valid evidence they wrote. If an immediate hard stop is needed, use the existing reviewed job-ownership mechanism under explicit authority rather than inventing a new kill switch. Confirm old readers and the existing three-league publication interfaces against the additive schema. If compatibility cannot be proven, prepare a narrow forward correction.

An initial bootstrap failure does not require erasing earlier valid documents. Correct the evidenced source/normalization/compatibility issue, shadow the bounded scope again and replay through the same writer. Unexplained changes, newly missing source identity, unexpected cost or materially broader corrective work require a new decision.

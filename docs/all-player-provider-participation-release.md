# Provider participation migration 012 release runbook

This is a prepared procedure, not evidence that migration 012 has been installed. The migration preserves installed 010 and 011 and changes no retained observations, score sets, pointers, identity mappings, provider budget, leases, or cron settings.

## Reviewed change

The additive migration adds nullable `all_player_stat_observations.provider_context` and a bounded insert guard for advisory Sleeper catalog metadata. The context carries its real observation time and source revision; `effectivePeriod` must be null and `role` must be `context-only`. Each listed official player and requested game must match an entry in the observation's immutable content. Current team, status and injury labels can disagree with historical labels and never change eligibility. Context is outside raw semantic hashing; later context observations can reuse the same statistics and score sets.

The migration also replaces the existing eligibility predicate and entry validation function. V3 individual `off_snp`, `def_snp`, and `st_snp` counts can prove an appearance when at least one is a positive safe integer and no malformed or contradictory participation field exists. Team snap totals, all-zero snaps, rank fields and current catalog status do not prove appearance. Positive snaps opposed by `gp=0` or `gms_active=0`, and malformed fields, retain null counts. Nested evidence cannot conceal those contradictions. V3 retained participation fields require matching weekly evidence. New snap evidence belongs only to player identities and requires canonical exact-period game context for an eligible appearance.

## Compatibility and installation order

1. Revalidate canonical repository `clawmachinejed/league-one-audit`, local/GitHub main, reviewed PR, Vercel repository/root binding `apps/site`, production branch `main`, exact production SHA, and Neon project/branch/database/owner/runtime identity. Resolve unexplained disagreement. Observe worktrees, PRs, deployments and live jobs; use “no competing owner observed” when supported.
2. Keep `ALL_PLAYER_RECURRING_ENABLED` absent or disabled. Preserve the existing global all-player request timestamps, cooldown and generation. Ensure no live all-player owner exists before applying the wrapper; do not clear leases or delete the durable budget row to make release proceed.
3. Require complete local verification, independent SQL/domain/writer review, actual Vercel preview evidence, the guarded PostgreSQL 18 integration matrix, measured context-only reuse, actual wrapper rollback/commit proof, and independent approval of `012-catalog.integration.json` bound to the exact normalized migration checksum.
4. Render the actual 012 wrapper using the existing renderer's `--participation` option. It requires the reviewed installed 011 checksum `0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6` and reviewed 011/012 catalog manifests. Bind fresh database and owner identity; review the complete rendered SQL and its checksum before execution.
5. Install schema 012 before deploying application code that inserts `provider_context`. The wrapper takes the existing schema advisory lock plus a job-table lock, rejects live all-player ownership, requires exactly migrations 001–011 with their checksums and PostgreSQL 18, checks old catalog/ACLs, installs the narrow change, records 012, and checks new catalog/ACLs, unrelated objects and all seven historical table counts before commit.
6. Require the exact `ALL_PLAYER_PARTICIPATION_APPLIED:012_all_player_provider_participation.sql:<normalized-checksum>` sentinel. If execution is ambiguous, inspect the ledger and catalog before considering another attempt; do not retry blindly.
7. Deploy the reviewed merged application SHA, verify it reaches Vercel production, and recheck both existing league readers. The old v2 application remains compatible with the nullable column and v2 absent-snap evidence; new application writes need the column. No migration or deployment enables recurrence.
8. Run only the authorized operator action after current source period, game context, identity, parity and capacity checks. Respect the stored global request budget and ownership; partial evidence remains partial and produces no complete score group or pointer advance. Catalog context does not satisfy missing historical inventory/eligibility or finality gates. No manual Tank01 diagnosis or additional provider-stat fanout is part of this release.

## Isolated verification commands

Use Node 24 and the repository's existing guarded `.env.integration.local` harness. Every authorization, database/branch sentinel, server identity, TLS, role and production denylist check remains mandatory. Root coordinates the one destructive isolated run; no production database may be used.

The regular integration runner discovers `all-player-provider-participation.integration-case.ts`. The separate actual-wrapper command from `apps/site` is:

```text
node --env-file=.env.integration.local --import tsx scripts/run-all-player-migration-wrapper-integration.mjs --participation
```

The wrapper test captures PostgreSQL 18 catalog evidence with `reviewed:false`, recreates only the authorized isolated database through 011, proves that a corrupted constraint manifest rolls back the complete catalog and ledger, and requires the real wrapper commit sentinel. It cleans the isolated schema through the existing harness. A fresh capture needs independent review before production rendering.

The context measurement is an explicitly synthetic partial batch with 4,356 player entries. It records physical heap/index/TOAST allocation before and after initial and context-only writes, writer durations and returned entry counts. It proves reuse and overhead at that tested shape; it does not prove actual completed-period source coverage or sustainable whole-season capacity.

## Read-only postflight

Inspect the exact installed 012 ledger checksum, all-player table/function/trigger definitions and runtime effective permissions against the reviewed manifest. Confirm all pre-release immutable counts and current pointer identities are unchanged by the migration. Check that old observations retain SQL NULL context and that new observations carry the exact captured source revision/time with the context-only role. Recount raw entries, known/unknown eligible and appearance counts, complete score groups and current pointers after any authorized write. Confirm the existing global job outcome, request timestamp, next allowed request, generation and ownership state. Recheck both league readers and current capacity.

These are read-only query templates to execute only against freshly verified identity:

```sql
SELECT current_database(), current_user, current_setting('server_version');
SELECT name, checksum FROM app_schema_migrations ORDER BY name;
SELECT ordinal_position, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='all_player_stat_observations'
ORDER BY ordinal_position;
SELECT provider, season, season_type, week, normalizer_version, quality,
       count(*) AS observations,
       count(*) FILTER (WHERE provider_context IS NOT NULL) AS contexts
FROM all_player_stat_observations
GROUP BY provider, season, season_type, week, normalizer_version, quality;
SELECT job_key, state, attempt_count, lease_until,
       payload->'lastOutcome' AS last_outcome,
       payload->'requestStarts' AS request_timestamps
FROM projection_jobs WHERE job_type='all-player-ingestion';
```

Use the exact reviewed catalog query and wrapper assertions for integrity/ACL verification; the concise templates alone are insufficient.

## Recovery and rollback

Disable recurrence first and stop authorized operators. Prevent stale publication through the existing live owner/generation/expiry mechanism; wait for a live owner to terminate or follow the reviewed lease recovery procedure, preserving its durable outcome and provider request budget. Preserve all verified immutable observations, score sets and pointers.

Before commit, any wrapper assertion failure rolls back the whole migration and its ledger insert. After successful commit, leave the compatible nullable column, context trigger and v2-compatible eligibility guard installed while reverting application/configuration to the reviewed previous SHA. Old v2 writes omit context and preserve their prior semantics. Do not drop the column, rewrite v3 observations, delete history, alter installed checksums, or force old SQL onto newly retained evidence. Any future compensating database change requires a separate reviewed additive migration. Existing alias retirement and its prior compensation procedure are unchanged by 012.

## Evidence to fill after execution

- Exact final PR/head/merge SHA, production deployment and both readers: pending.
- Full verification totals and classified skips: pending.
- First guarded integration run: the 9 new 012 tests passed, including 84 eligibility matrix inputs, direct runtime-role shape/identity/time guards, actual writer context visibility, v2 replay, context-only reuse and exact/conflicting observation replay. The full database run had 207 passes and 2 failures: the explicit migration list still ended at 011 (corrected for the next run), and an unrelated lineup-lineage WebSocket transport error. This is development evidence; the final full workflow and actual wrapper sentinel remain pending.
- Normalized 012 checksum: `bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed`. The actual PostgreSQL 18 wrapper passed corrupted-manifest rollback, installation and exact sentinel checks. The capture from `2026-09-13T03:01:58.711Z` was independently reviewed: one nullable column, one check constraint, two replaced functions, one new function and one new trigger; existing indexes and other permissions/functions are unchanged. Reviewed manifest SHA-256: `ed4023c34d8b869e65ba046a3979fc079fda26e067f56678a3b96010b9b5beac`. Rendered production wrapper SHA-256: `4f78dd667330561da616a6b6a2d2cfc5053e55eb534bb125f8b865e8301f5563`.
- Context storage measurement at `2026-09-13T02:59:16.556Z`: the first synthetic batch wrote 4,356 raw entries; the later context-only observation wrote zero entries and retained the same content ID/hash. The first write added 1,777,664 physical entry bytes and 57,344 observation bytes. The later context-only write added 24,576 observation bytes, with no raw content or entry allocation growth. Writer durations were 2.082 and 2.165 seconds, each below 55 seconds. Two retained compressed context values occupied 40,150 bytes. Initial/later compact context inputs were 652,552 and 757,096 bytes; these measure client-to-database input, not Neon outbound transfer. No provider request occurred.
- Production schema installation, authorized capture result and exact pointers: pending; do not infer completion from local tests.

At this measured allocation, one initial context plus 251 later contexts would add 6,225,920 observation bytes across 252 total requests (18 weeks at the maximum two requests per day). That is a bounded synthetic scenario using two measured observations, not a season-fit claim: it excludes new/corrected raw contents and score groups, different status distributions and compression, parity evidence, mapping growth, ordinary application demand, billing scope and compute. Physical allocation includes page rounding and may reuse existing free pages. Recheck actual retained growth and account headroom before activation.

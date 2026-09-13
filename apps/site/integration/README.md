# Isolated Neon projection-store integration tests

These tests are destructive. They reset the `public` schema before and after the suite. Run them only against a dedicated Neon branch and dedicated database that contain no production data.

Create `apps/site/.env.integration.local` with all of these values:

```dotenv
PROJECTION_INTEGRATION_AUTHORIZATION=I_ACKNOWLEDGE_THIS_RESETS_AN_ISOLATED_DATABASE
PROJECTION_INTEGRATION_OWNER_DATABASE_URL=postgresql://...
PROJECTION_INTEGRATION_RUNTIME_DATABASE_URL=postgresql://league_one_runtime:...
PROJECTION_INTEGRATION_EXPECTED_DATABASE=projection_refactor_test
PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID=br-...
PROJECTION_INTEGRATION_EXPECTED_BRANCH_NAME=projection-integration-test
PROJECTION_INTEGRATION_DATABASE_SENTINEL=replace-with-a-long-random-value
PROJECTION_INTEGRATION_PRODUCTION_DENYLIST=production-branch-id,production-branch-name,production-database,production-endpoint-host
```

The file is covered by the repository's `.env.*` ignore rule. Never commit it.

Before the first run, store the matching identity on the dedicated database. Run this with the owner connection after replacing every placeholder:

```sql
COMMENT ON DATABASE projection_refactor_test IS
'{"purpose":"league-one-projection-store-integration","sentinel":"replace-with-the-same-long-random-value","branchId":"br-replace","branchName":"projection-integration-test"}';
```

The owner URL must use the schema-owner role. The runtime URL must use the existing `league_one_runtime` role and point to the same database. Direct and pooled forms of the same Neon endpoint are accepted.

From the repository root, run:

```text
pnpm test:integration
```

The runner and global setup independently refuse to continue unless authorization, URL identity, server-reported database identity, the durable JSON database comment, safe test naming, distinct roles, TLS, and the production denylist all pass. Configured production database URLs are compared by normalized endpoint and database identity rather than raw connection-string text.

## PR2 coverage

The 13 store-facade cases exercise a migration from a verified empty schema; canonical scoring JSON and hashes; immutable scoring rules, baselines, and snapshot history; concurrent provider-identity resolution and orphan cleanup; corrected game aliases and conflicts; projection-run replay and eligibility; the absence of a synthetic row when a baseline is missing; forward and rejected game-state transitions; official-observation replay and unmapped reports; competing job claims and lease ownership; exact snapshot source sets, source skew, material deduplication, verification advancement, history, and older-pointer rejection; requested and latest snapshot selection in one query; malformed payload rejection after an owner-level insert; runtime-role restrictions; and safe pruning with current pointers and frozen sources retained.

## Deliberately outside this PR2 database suite

- Player projection math and policies for pregame, live, halftime, final, bye, empty-slot, explicit zero substitution, retained prior values, D/ST, duplicate starters, and exact team sums remain pure-domain and worker tests. A missing baseline is represented in Neon by no row; the worker's zero substitution does not belong in the store.
- Sleeper and Tank01 normalization, cold- and warm-cache calls, shared provider groups, cross-league failure isolation, worker logging, cadence, and accepted-result counts remain worker/provider gates for PR3 and PR4.
- Matchup and cron HTTP status, body, cache, page fallback, polling, browser, and preview behavior remain their existing HTTP/page/browser and release gates; they do not require database-owner credentials.
- Compatibility with the recorded production snapshot IDs is a read-only release check. This destructive suite intentionally contains no production data and never connects to the production database.
- The harness emits no connection strings, sentinels, or provider credentials. End-to-end checks for secrets in browser bundles, HTTP bodies, provider cache keys, and structured worker logs remain PR3/PR4 and release checks because those paths are outside the store facade.

## Hourly all-player schedule tests

Migration `014` keeps the production schedule clock internal and owner-only. After all destructive-test guards pass, Vitest global setup substitutes an in-window clock in the isolated database so legacy store tests can run at any time of day. Only the all-player schedule clock changes; lease and deadline expiry always use the real database clock. The hourly cases control that owner-only clock to verify Eastern noon–midnight hours, daylight saving, hour-slot deduplication, the strict 13-request rolling-24-hour cap, operator/recurring contention, window and budget changes after claim, and expiry/takeover. They restore the prior fixture clock and job row afterward.

The actual `014` release-wrapper capture uses `prepareIntegrationDatabase` directly and never installs the test clock. It verifies the real production clock, owner-only helper permissions, unchanged table/constraint protections, old read signature, exact sentinel and complete transaction rollback after a deliberately corrupted constraint manifest. Run `scripts/run-all-player-migration-wrapper-integration.mjs --hourly` only through the same explicitly authorized isolated environment. Its catalog remains `reviewed: false` until independent review; the production renderer refuses it until then.

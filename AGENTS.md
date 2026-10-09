# League One engineering rules

## Current implementation scope: fantasy football data backend

- Follow [the current data-backend contract](docs/aggregator-backend/data-backend-scope.md). The user's latest data-only direction takes precedence over older broader aggregator/account plans.
- Implement only Sleeper identity and associated-league discovery through existing adapters, canonical relational identities and typed official resources, durable storage, refresh/retry/recovery and backend readers. Sleeper is the only implemented provider; League One/Two/Dynasty are regression customers, not eligibility standards.
- Website UX, accounts/login, exclusive claims, onboarding, follows, user-membership entitlements, projections and analytics are deferred, not prerequisites. Preserve existing shared security, source permissions, database roles, compatibility and production behavior.
- Before each increment, name its data resource, existing adapter/store/reader path, persisted result and real proof/gaps. Stop out-of-scope work before authoring it. A necessary shared-core dependency requires a specific file/purpose and independent reviewer confirmation; routine in-scope choices do not require user approval.
- Run `node scripts/check-data-backend-scope.mjs --governance-change data-backend-scope-v1` and review the actual diff before publication and completion. This declaration covers only eight policy/notice paths, not reviewer approval or application changes. Preserved checkpoint hashes are not acceptance; source-only checks are not actual PostgreSQL qualification. Keep the old 108-obligation account ledger historical/deferred with its pending statuses.
- Use gpt-6-astra with ultra reasoning for all delegated/automatic implementation of this outcome. No paid SQL run, credentials, provisioning, migration application or production release is authorized by this scope block.

## Authority and scope

- The canonical application repository is `clawmachinejed/league-one-audit`. Repository contents plus freshly checked GitHub, Vercel, and live-site evidence are authoritative.
- Use a fresh Codex task for each distinct outcome.
- Before implementation and again before deployment, revalidate local and GitHub `main`, the Vercel source binding and production branch, and the exact production Git SHA. Stop and report any unexplained disagreement.
- Preserve unrelated user changes and keep the primary `main` checkout clean. Perform code changes and working mockups in a dedicated Git worktree outside OneDrive or any other synchronized folder.
- Permit only one production-writing or release-owning task at a time. Base ownership statements on observable worktrees, branches, pull requests, deployments, cron activity, and database or worker leases. Say “no competing owner observed”; never claim that no other task or chat exists.

## Product mission

- Build a single home for a manager's fantasy football teams across supported providers: a cross-league overview with a clear path into each league's matchups, teams, standings, transactions, schedules, and history. Enrich official data with League One projections, forecasts, win probabilities, and projected standings where supported.
- Treat Sleeper as the only implemented fantasy-league provider today. Yahoo, ESPN, and others are future integrations; do not describe them as shipped or assume access to their data.
- Keep the host provider authoritative for official league data and scoring. League One owns provider-neutral normalization and presentation, identity links, projections, forecasts, and analytics. Do not require complete support for every scoring or competition edge case before showing a league whose official data can be represented reliably. Label derived-feature coverage independently and never substitute an estimate for an official result.
- Evolve the existing shared feature and worker architecture incrementally. Provider additions should primarily add adapters, identity mappings, and provider tests, rather than parallel feature pages or a rewrite. The current-source and behavior rules below continue to apply until a requested change explicitly updates them.

## Canonical behavior

- Read [README.md](README.md) for product scope, the single league registry, provider roles, commands, and the code map.
- Read [docs/lineup-freshness.md](docs/lineup-freshness.md) for the current worker and reader architecture, `clock-v1`, immutable baselines and snapshots, bye and missing-projection policy, and operational recovery.
- Read [docs/future-week-projections.md](docs/future-week-projections.md) for exact-week and future-period behavior, [docs/release-validation.md](docs/release-validation.md) for release evidence, and [apps/site/integration/README.md](apps/site/integration/README.md) for isolated database test safety.
- Sleeper remains the official league, lineup, schedule, and scoring source. Tank01 remains the projection-statistics and game-state source. Neon remains the stored snapshot source. League One and League Two remain isolated.
- Preserve exact-week behavior, `clock-v1`, immutable frozen baselines, existing bye and missing-projection behavior, and the single scorer, projection pipeline, Tank01 normalizer, snapshot builder, and publication path.
- Browser pages and lightweight observers never call Tank01. Never duplicate an existing worker, reader, cache, provider feed, scoring, normalization, snapshot, or publication pipeline merely to simplify an implementation.
- Preserve existing routes, payloads, fallbacks, caching, presentation, league selection, and manager selection unless the requested feature explicitly changes them.
- Under `apps/site`, also follow [apps/site/AGENTS.md](apps/site/AGENTS.md), including its generated Next.js documentation rule.

## Safety and autonomy

- Never expose or commit secrets. Do not pull production secrets into a local environment by default.
- Never run destructive integration tests against production. Use the existing isolated Neon harness only when every authorization, identity, sentinel, TLS, role, and denylist guard passes.
- Do not change migrations, production data, cron schedules, provider configuration, scoring, projections, runtime behavior, or public APIs unless they are explicitly in scope.
- Independently reproduce high-risk findings before fixing them. Revalidate audit findings against the latest `main` and repair confirmed root causes rather than symptoms.
- Ask the user only for login, MFA, CAPTCHA, unavoidable account selection or consent; a material product decision; unexpected cost; destructive or irreversible work; missing production authority; unprovable repository or service identity; or materially expanded scope.
- When the user says “push to production,” treat it as production-release authorization for the requested scope. Still stop for unplanned destructive data changes, unexpected cost, missing authority, or materially expanded scope.

## Verification and release

- Use targeted checks during development and the complete verification workflow before merge.
- Work on an isolated branch and pull request. Respect repository protections, obtain independent review when risk warrants it, and inspect the actual Vercel preview in the built-in browser.
- Merge only within the user’s release authorization. Verify that Vercel production runs the exact merged Git SHA, then verify both League One and League Two after every production release.
- Report local completion, branch publication, preview readiness, merge state, production deployment, test totals, skips, deviations, and unverified evidence separately.

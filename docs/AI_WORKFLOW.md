# AI engineering workflow

This guide turns ordinary-language requests into repeatable League One engineering work. It contains stable process rules, not current SHAs, authentication state, or production status. Follow `AGENTS.md` and its canonical architecture and release references.

## Shared preflight

1. Classify the requested outcome as Explore, Build or Fix, Health, or Audit and Remediation.
2. Inspect the applicable `AGENTS.md` files, package files, relevant current code and documentation, Git status, and unrelated user work.
3. Check local and GitHub `main`, the Vercel project and source binding, the production branch and exact deployed SHA, open pull requests and deployments, worktrees, cron activity, and observable writer leases appropriate to the task.
4. Check only the service authentication needed for the task. Mark inaccessible or expired evidence `Unverified`; never call it healthy.
5. Before code changes or a working mockup, create a clean, task-specific worktree from verified `origin/main` outside synchronized folders.
6. Do not continue through an unexplained repository, branch, source-binding, or production-SHA disagreement.

For work lasting more than about fifteen minutes, report the current stage; worktree, branch, or pull request; important tests; whether production was touched; any blocker; and the next gate.

## Explore, with an optional working mockup

Use this workflow for requests such as: “Explore adding trade analysis and show me a working mockup. Do not implement or deploy it.”

- Inspect the relevant current code and behavior. Explain realistic options and tradeoffs and recommend one.
- Make no production change. When a working mockup is requested, create it in a disposable worktree and reuse the actual design system and components where practical.
- Use fixtures, simulated data, or safely isolated data. Never call production providers or mutate Neon. Clearly label simulated behavior.
- Start the local development server and open the mockup in Codex’s built-in browser so the user can interact with it and leave visual comments.
- Exercise relevant mobile, desktop, dark-mode, accessibility, loading, empty, and error states, then iterate on feedback.
- Do not commit, merge, publish, or deploy the mockup automatically. Use Sites only when the user explicitly asks for a separately hosted prototype.
- Treat the mockup as design evidence. Once approved, carry the decisions into a clean production implementation rather than promoting disposable code.

## Build or Fix

Use this workflow for requests such as: “Implement the approved version and push it to production.”

1. Run the appropriate preflight, reconfirm repository and production baselines, and classify implementation risk.
2. Generate the risk-sized brief or contract. The user does not write it.
3. Use a clean isolated worktree and branch. For a defect, reproduce it and prove the root cause before editing.
4. Implement the smallest coherent solution and avoid unrelated cleanup or duplicate pipelines.
5. Run targeted tests while developing, then run Full Verify before merge.
6. Open a pull request. Obtain independent review when risk warrants it, wait for required GitHub checks, and inspect the Vercel preview in Codex at relevant desktop and mobile widths.
7. Verify League One and League Two in the preview. When release is authorized, merge and verify the exact merged SHA in production, then verify both leagues again.
8. Report the implementation, test totals, deployment evidence, deviations, and deferred or unverified validation.

## Health

Use this workflow for requests such as: “Check the entire League One project’s health. Diagnose only.”

- Remain read-only and inspect repository identity and status, authentication, dependency state, tests, database visibility, deployment, cron activity, provider boundaries, and both public leagues at the requested depth.
- Classify each area as `Healthy`, `Unhealthy`, `Unverified`, or `Not applicable`.
- Do not treat missing evidence as healthy. Diagnose confirmed problems and do not repair them unless the user explicitly asks.

## Audit and Remediation

Use this workflow for requests such as: “Run a top-down production audit, independently validate the findings, and prepare an implementation-ready remediation program. Do not implement.”

1. Establish fresh GitHub and production baselines.
2. Audit architecture, domain behavior, providers, database, workers, concurrency, browser behavior, testing, security, release ownership, and operations.
3. Classify each candidate as `Confirmed defect`, `Missing proof`, `Operational risk`, `Technical debt`, or `False positive`.
4. Group symptoms under root causes and independently reproduce high-risk candidates.
5. Create a dependency-safe remediation design. Never use raw audit notes directly as implementation instructions.
6. Preserve one durable, scope-named audit and remediation artifact, such as `docs/audits/YYYY-MM-DD-<scope>.md`, on a branch and pull request accessible to later project tasks. Do not create a status registry or duplicate templates.
7. For audit-only requests, stop after the reviewed remediation program. For an explicit audit-and-repair request, revalidate every finding against the latest `main`, generate the appropriate implementation contract, and continue through normal implementation and release gates.

Repair only confirmed root causes, proven duplication, dead paths, or contract inconsistencies. Cleanup never authorizes a broad rewrite.

## Risk-sized implementation contracts

### Routine

For isolated copy, styling, accessibility, or another narrow reversible change, use a short in-task change brief. Do not create a formal contract.

### Material

For a new page, endpoint, component flow, cache, polling behavior, or cross-module behavior, create a concise contract covering objective; scope and non-goals; relevant invariants; design; tests; release verification; and rollback.

### Production-critical

For database migrations, scoring, projections, identity, period authority, cron ownership, leases, concurrency, provider traffic, permissions, public APIs, or difficult-to-reverse state, create a formal versioned contract covering:

- verified repository and production baseline and an observable definition of done;
- scope, non-goals, protected invariants, architecture, and data flow;
- database, provider, API, concurrency, compatibility, and cost effects;
- failure and fallback behavior and a dependency-safe pull-request sequence;
- exact tests and evidence, deployment and mixed-version gates;
- canary, rollback floor, abort conditions, production verification, and unresolved evidence or decisions.

Obtain independent review before implementation. Present the user with intended behavior, material tradeoffs, risk, cost, and decisions unless technical detail is requested. Follow the existing `docs/<feature>-...` convention when a durable contract is necessary; do not create reusable contract-template files.

## Quick actions

The Codex local environment installs with `pnpm install --frozen-lockfile` and exposes:

- **Start Preview — `pnpm dev`:** start the local site at `http://localhost:3000`.
- **Fast Check — `pnpm verify`:** run the existing deterministic lint, TypeScript, Vitest (including architecture tests), and production-build gate.
- **Doctor — `pnpm run doctor`:** run read-only local, GitHub, Vercel, cron-declaration, public-route, and optional lease checks. Unavailable remote evidence is reported as `Unverified`.
- **Full Verify — `pnpm verify:full`:** run Fast Check and the Chromium browser suite. It runs the destructive Neon integration suite only when `apps/site/.env.integration.local` exists; the existing harness must pass every isolation guard before resetting anything.

Doctor never fetches secrets, applies migrations, invokes workers or cron endpoints, changes cron state, calls Tank01 projections, or performs destructive integration tests. Full Verify never substitutes production credentials and never runs `db:migrate`.

## Reporting

Final reports state the verified repository and local path; declared and actual tool versions; GitHub, Vercel, Neon, Sleeper, and Tank01 capability status; created or changed files; exact quick-action commands; test totals, failures, skips, and unverified capabilities; pull request, merge, deployment, and production SHA evidence when applicable; both league results; remaining user action; and whether migrations, cron, providers, scoring, or application behavior changed.

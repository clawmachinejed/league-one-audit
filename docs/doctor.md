# Doctor remote evidence

Run `pnpm run doctor` from the repository root (`pnpm doctor` invokes pnpm's own diagnostic). Doctor is a read-only diagnostic, not release authorization. It does not invoke cron routes, workers, or providers, fetch secrets, change settings, or retry unavailable evidence. Existing optional database checks use only aggregate SELECT queries when `DATABASE_URL` is already present; do not pull production credentials merely to run Doctor.

## Workflow evidence

Doctor checks the canonical repository's `verify.yml` workflow on `main`. The intended commit is the freshly observed GitHub `main` SHA, not this feature branch's HEAD. It examines the ten most recent workflow runs and selects the newest run ID for that exact commit. An older success cannot hide a newer failed, cancelled, or still-running run for the same commit. Missing evidence in this bounded window is not proof that a run never existed.

| Evidence | Report |
| --- | --- |
| Latest exact-commit `verify` run completed successfully | Healthy / success |
| Latest exact-commit run failed, cancelled, timed out, or otherwise completed without success | Unhealthy / failure |
| Observed `verify` runs belong only to other commits | Unhealthy / wrong-commit |
| Latest exact-commit run is active or waiting | Unverified / running |
| No intended workflow observed | Unverified / absent |
| CLI/API/authentication unavailable, invalid SHA, malformed or unknown run metadata | Unverified / unavailable |

Workflow visibility alone does not prove success. Workflow evidence also does not establish Vercel source identity: Doctor retains the explicit requirement to independently inspect the source repository, branch, and full production SHA in authenticated Vercel evidence.

## Public route evidence

Doctor makes one credential-free GET to each canonical production matchup route with manual redirect handling. Any redirect response or reported redirect fails the check; its destination is never requested. A successful response must have the exact expected final URL, origin, and path, without an unexpected query, fragment, or embedded credentials. Network/body-read failure, HTTP 429, and HTTP 5xx remain Unverified; other unsuccessful HTTP responses are Unhealthy.

An HTML response must contain the existing shell's matching league home anchor, current-league selector button, and active matchup anchor. Generic league text, titles, scripts, comments, inert markup, and marker-shaped strings inside attributes cannot establish route identity. This checks server-rendered shell evidence; the existing browser feature suite remains necessary for rendered application behavior.

Remote command errors, response bodies, redirect locations, and exception messages are not printed. Diagnostic redaction also suppresses credential-bearing URLs, authorization values, and token patterns.

## H2 reproduction and scope

DOCTOR-001 was reproduced on clean `main` at `430718053b905cde87d88a7c51af3e74cfa53b5c`. Verbatim original workflow and route evaluation blocks were executed with controlled command/fetch fixtures, without network or provider calls:

| Controlled input | Original result |
| --- | --- |
| Failed workflow for the intended commit | Healthy |
| Successful workflow for a different commit | Healthy |
| Cancelled workflow for the intended commit | Healthy |
| HTTP 200 redirected to another origin's parking path, containing League One text | Healthy |
| Wrong final league path with League One only in its title | Healthy |

The workflow code equated parsable run visibility with health and ignored SHA/conclusion. The route code followed redirects and used a substring marker without final-destination checks. Pure evaluators and controlled collector tests cover those root causes, including unavailable evidence and output redaction. Run `pnpm --filter @l1/site exec vitest run scripts/doctor-evidence.test.mjs` for the targeted tests; the repository gates remain `pnpm verify`, `pnpm test:browser`, and `git diff --check`.

H2 changes Doctor tooling and its tests/documentation only. H1 and browser feature coverage, application routes/runtime, database, scoring, providers, cron, billing, and GitHub/Vercel settings remain outside scope. G4 and destructive database integration tests do not apply. Applicable G5 scans must stay silent; the accepted [PR #171 dependency false-positive finding](https://github.com/clawmachinejed/league-one-audit/pull/171#issuecomment-5552473990) can support identical inherited literals only, not new matches.

DOCTOR-001 remains open while the H2 PR is unmerged. This work authorizes neither merge nor production deployment. If later needed, rollback is a protected revert of this tooling-only change.

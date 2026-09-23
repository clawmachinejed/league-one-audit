# Website accounts and the existing league library

This increment implements the first two items in the approved foundation sequence and preserves the third. It does not open unrelated-league onboarding or redesign My Team.

1. Website accounts, private preferences and My Leagues for the three existing leagues.
2. Optional League One / League Two affiliation; Dynasty independent.
3. Preserve public URLs, guest browsing, My Team choices and existing collection.
4. Before an unrelated-league pilot: prove capability checks and collection failure isolation.
5. Before broader onboarding: measure capacity, failure isolation, onboarding limits and operational ownership.

## Identities and relationships

| Concept | Stored identity and purpose |
| --- | --- |
| Website user | Independent UUID in `app_users`; display name is not an identity or authorization key. |
| Login | Exact configured authentication issuer and verified subject in `app_login_identities`. A verified email allows pilot admission; it is not the persistent key and is not used to merge users. |
| Sleeper association | Private, nonexclusive link to an existing stable source-manager account. Always `user_asserted`; never proof of control or commissioner authority. |
| Permanent league | Reuses `leagues.id`, separate from its yearly Sleeper connection. |
| Annual team participation | Derived from the approved current enrollment and accepted exact-season roster head, including owner/co-owner roles. Retained historical memberships are never unioned into current participation. |
| Saved league | Private account-to-permanent-league preference: favorite, order and optional preferred annual team. Following a league does not mean playing in it. |
| League group | Optional, many-to-many affiliation with dated membership records. The initial operator seed links only League One and League Two. It affects discovery, not scoring or permissions. |

Current public league data stays public. A League One participant can browse League Two already; the affiliation explains and organizes that relationship in My Leagues. Dynasty remains a separate personal league. A future workplace group can use the same relationship without promotion or relegation semantics. Suggestions only expand one step from observed participation, so following a suggested league does not recursively pull in its other groups.

The initial UI associates one of the public Sleeper profiles already observed in the supported leagues. It does not request Sleeper credentials, search arbitrary users, claim exclusive ownership or automatically treat `eneerg` display corrections as identity proof. Multiple website accounts may associate the same public profile. They still have separate private preferences.

## UI and private requests

- `/sign-in`: maintained Better Auth running in the app, with authentication records stored in Neon. Website admission requires verified email and the server-side invitation list. Both the app's HTTP boundary and the maintained user-creation hook enforce invited signup; alternate enrollment routes remain closed.
- `/account`: website display name and explicit Sleeper associations.
- `/my-leagues`: participating or last-known leagues, saved follows, direct linked suggestions and other supported leagues. Favorites/order are account-scoped.
- `/api/me`: private profile, associations and library. `/api/me/teams` returns **every** matching team with league, season, owner/co-owner roles and evidence status, deduplicating multiple associations to the same team. Selecting a preferred team cannot shrink this collection.

The current `/my-team`, `/league2/my-team` and `/dynasty/my-team` screens keep their existing guest selection and matchup behavior. This increment does not import browser storage into an account or synchronize that selection silently. Their later redesign must explicitly handle guest import, server preference conflicts and account switches.

Private responses use `private, no-store` and `Vary: Cookie`. Account state lives in component memory, never shared browser storage. Account switching, logout, focus/visibility and BFCache restoration clear/revalidate it. Mutations have exact Origin checks, 4 KiB JSON limits, strict fields, row revisions and an `X-Expected-Account-ID` precondition. The expected ID only detects an old form after a session switch; the verified server session always selects the actual actor. No client value can select a different authorized actor.

The database enforces row isolation and restricted columns through a separate `league_one_account` role. A transaction verifies physical role/RLS prerequisites, binds actor/request context locally, then runs queries. Mutations serialize per account. The existing append-only audit index supports a 60-change/60-second limit; rejection rolls back both the change and audit and returns 429 with a 60-second retry delay. This is separate from Better Auth's persisted authentication rate limits and future public onboarding protection.

## Source freshness and failure behavior

Supported website league cards read existing accepted Neon administration evidence. The separate Sleeper discovery list makes narrow, read-only Sleeper requests for the associated profiles; neither path calls Tank01, creates a collector, enrolls a league, or controls worker demand. The accepted roster source, annual connection, completeness, normalizer, observation lineage and conflicts are checked together. Provider display names come from accepted users evidence separately; the documents are not claimed atomic.

The 60-second current-evidence threshold matches the existing core reader. Older valid data is labeled last known. An identical network verification may update a head while retaining a cached original observation, so the head's verified time supplies evidence when that original source time was null. Missing, contradictory or wrong-period evidence is unavailable. A missing co-owner in normalized data is not proof that no co-owner exists. Saved follows remain even when a source is unavailable or deactivated; new follows and associations require approved active source scope.

No timer repeatedly polls the private account API. Reads happen on navigation, relevant focus/session changes and after explicit writes. Each request verifies the authoritative persisted Better Auth session, resolves the internal identity idempotently and reads/mutates the private store. Current three-league reads are bounded to existing supported public routes. Paginated libraries, larger source inventories and fleet-scale measurements are separate onboarding gates.

The root layout is neutral. The existing league shell lives in `(leagues)`, which adds no URL segment. All existing public page contents and URLs are preserved. A failure in authentication or account storage cannot make the public layout require a login. Existing cross-league registry/collector behavior is not represented as solved; isolating those failures remains item four before unrelated leagues.

## Sleeper league discovery

My Leagues includes a separate list of the current NFL leagues returned by Sleeper for the signed-in account's active profile associations. It resolves the active league season from Sleeper's NFL state and labels that season explicitly; it does not claim to include historical seasons. League IDs and stable user IDs remain strings. Results are deduplicated across associations, and each league opens a fixed-origin Sleeper link.

The private `GET /api/me/sleeper-leagues` endpoint derives the actor from the verified session and requires an `X-Expected-Account-ID` precondition. The restricted account store supplies active associated manager IDs, including links whose accepted display-name evidence is temporarily missing. Client request parameters cannot select an arbitrary website or Sleeper user. Discovery uses the existing Sleeper retrieval boundary; public provider caching never includes the private account mapping. Slow responses are checked against current associations, and the browser aborts and discards old requests after an account or association change.

Discovery loading and failures stay within its section. An unavailable profile is reported explicitly, never silently treated as having zero leagues. External discoveries do not become permanent leagues, saved preferences, team ownership claims, or collection work. Each discovery now includes an [automatic capability report](league-capabilities.md), with separate support assessments for scoring, projections, roster slots, standings, schedules/history and substitutions. Missing or conflicting settings degrade the report without hiding a valid league link. Full website support for additional leagues still requires **collection failure isolation** and resolution of the report's relevant unsupported or unverified features. Measured capacity before broader onboarding and combining My Team pages remain deferred.

## Configuration and deployment sequence

Accounts are dormant by default. Environment names and maintained-auth qualification are in [account-auth-foundation.md](account-auth-foundation.md). Private persistence requires `ACCOUNT_DATABASE_URL` using the separately restricted `league_one_account` credential with TLS; authentication requires `ACCOUNTS_AUTH_DATABASE_URL` using `league_one_auth`. Never reuse the owner, migration or worker credential. Vercel Preview disables auth and private persistence regardless of copied configuration. Full account browser interaction tests use intercepted synthetic local responses, not production users. `pnpm test:browser:accounts` builds an explicitly isolated local browser fixture run; `verify:full` and the CI browser job run it after the ordinary public-page suite. It rejects deployed targets and supplies no database or provider credentials. The ordinary suite's skipped enabled-account cases are exercised by this separate required run.

Before a production release:

1. Recheck canonical GitHub/local main, Vercel project/root/production branch and exact production SHA. Record no competing owner observed only from actual release/worker evidence. Retain the tested pre-account checkpoint and preserve any subsequent user data before rollback.
2. Confirm the existing repository's production authorization covers the concrete reviewed account release and its database/configuration changes. Keep `ACCOUNTS_ENABLED` absent/false. Require full verification, actual preview inspection, independent SQL/auth review and passing guarded isolated tests. Record the exact commit and each applicable normalized migration checksum.
3. Under database authority, inspect the installed migration ledger and verify every installed checksum. The required account schema includes `020_account_foundation.sql` and `021_website_auth.sql`; apply only the reviewed migrations actually pending through the existing checksummed migration runner. Migration 020 adds private account tables/functions/guards; 021 adds the separate `website_auth` schema. Existing public readers and collectors do not depend on either. Stop for an unexpected pending migration or catalog discrepancy; never replay or rewrite an installed migration.
4. Inspect both runtime roles and their current consumers before provisioning. The owner-only `scripts/provision-account-role.sql` and `scripts/provision-auth-role.sql` create a missing role or check an existing one and establish their separate privilege boundaries. Execute only the required reviewed provisioning, securely assign any authorized credentials, and rerun privilege postconditions. A role may already serve another database, so coordinate credential changes with its active consumers. Inspect the League One/Two group before running the separately reviewed idempotent `scripts/seed-account-league-group.sql`; verify exactly those two members and no Dynasty affiliation. These actions create no login or source-team ownership.
5. Qualify the exact maintained authentication configuration in a disposable isolated database, including verified admission, recovery, session revocation, concurrency, rollback and branch/cookie isolation. Separately verify actual email delivery and any existing-user identity transition in the retained pilot; never run destructive integration tests against retained users. No production snapshot or recovery branch is a development environment. A production mail service and any additional cost require a concrete decision before activation.
6. Prepare the verified production HTTPS origin, its exact `/api/auth` issuer, distinct auth secret, approved invitation list, both restricted database credentials, and an authorized domain-scoped sending credential with a verified sender. Review any existing production users and issuer/subject mappings before admission; the isolated pilot is not permission to copy users or credentials into production. Deploy the approved code with accounts disabled, then verify the exact merged SHA, all three public league routes and unchanged scheduled collection.
7. Enable accounts only after all required gates pass. Verify production sign-in, intended profile links, two-account private separation, stale-tab rejection, logout, actual production email delivery and unaffected public browsing. This is separate from broader onboarding.

This document is a procedure, not proof any production step happened. Record local, branch, preview, migration, merge, deployment and activation evidence separately.

## Recovery

Disable `ACCOUNTS_ENABLED` to stop the app's private feature path; preserve private records and audit history. If needed, revoke relevant sessions or restricted credentials through reviewed operator actions coordinated with their active consumers. Revert compatible code through a protected PR or use the existing emergency deployment rollback procedure, reconciling Git afterward. Public cron/provider settings are unchanged by this increment and must not be replaced as part of account rollback.

Do not drop migrations 020/021, erase identity or audit history, or restore an older full database merely to remove the UI. After accounts or league data have advanced, preserve that newer state before any full restoration. The pre-account checkpoint records the original code, deployment/configuration and tested Neon snapshot recovery. It is not permission to discard newer user data. Authentication recovery must preserve `website_auth` records and the applicable service configuration/secrets; an application public-schema snapshot is not a complete auth backup. Returning to the former managed service after passwords or identities have changed requires a separately reviewed preservation plan.

Accounts can later add more identity issuers and providers without replacing permanent league/user UUIDs. Actual ESPN/Yahoo connectors, private-league grants, verified ownership, account merging, commissioner tools and a self-service deletion workflow remain deliberately unimplemented. The pilot is not evidence of readiness for 6,000 leagues.

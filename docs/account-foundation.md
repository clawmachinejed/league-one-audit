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
| Login | Exact managed authentication issuer and subject in `app_login_identities`. A verified email allows pilot admission; it is not the persistent key and is not used to merge users. |
| Sleeper association | Private, nonexclusive link to an existing stable source-manager account. Always `user_asserted`; never proof of control or commissioner authority. |
| Permanent league | Reuses `leagues.id`, separate from its yearly Sleeper connection. |
| Annual team participation | Derived from the approved current enrollment and accepted exact-season roster head, including owner/co-owner roles. Retained historical memberships are never unioned into current participation. |
| Saved league | Private account-to-permanent-league preference: favorite, order and optional preferred annual team. Following a league does not mean playing in it. |
| League group | Optional, many-to-many affiliation with dated membership records. The initial operator seed links only League One and League Two. It affects discovery, not scoring or permissions. |

Current public league data stays public. A League One participant can browse League Two already; the affiliation explains and organizes that relationship in My Leagues. Dynasty remains a separate personal league. A future workplace group can use the same relationship without promotion or relegation semantics. Suggestions only expand one step from observed participation, so following a suggested league does not recursively pull in its other groups.

The initial UI associates one of the public Sleeper profiles already observed in the supported leagues. It does not request Sleeper credentials, search arbitrary users, claim exclusive ownership or automatically treat `eneerg` display corrections as identity proof. Multiple website accounts may associate the same public profile. They still have separate private preferences.

## UI and private requests

- `/sign-in`: maintained Neon email authentication. Website admission requires verified email and the server-side invitation list. Managed registration controls require independent qualification; application admission alone does not close the hosted auth endpoint.
- `/account`: website display name and explicit Sleeper associations.
- `/my-leagues`: participating or last-known leagues, saved follows, direct linked suggestions and other supported leagues. Favorites/order are account-scoped.
- `/api/me`: private profile, associations and library. `/api/me/teams` returns **every** matching team with league, season, owner/co-owner roles and evidence status, deduplicating multiple associations to the same team. Selecting a preferred team cannot shrink this collection.

The current `/my-team`, `/league2/my-team` and `/dynasty/my-team` screens keep their existing guest selection and matchup behavior. This increment does not import browser storage into an account or synchronize that selection silently. Their later redesign must explicitly handle guest import, server preference conflicts and account switches.

Private responses use `private, no-store` and `Vary: Cookie`. Account state lives in component memory, never shared browser storage. Account switching, logout, focus/visibility and BFCache restoration clear/revalidate it. Mutations have exact Origin checks, 4 KiB JSON limits, strict fields, row revisions and an `X-Expected-Account-ID` precondition. The expected ID only detects an old form after a session switch; the verified server session always selects the actual actor. No client value can select a different authorized actor.

The database enforces row isolation and restricted columns through a separate `league_one_account` role. A transaction verifies physical role/RLS prerequisites, binds actor/request context locally, then runs queries. Mutations serialize per account. The existing append-only audit index supports a 60-change/60-second limit; rejection rolls back both the change and audit and returns 429 with a 60-second retry delay. This does not replace qualification of managed authentication rate limits or future public onboarding protection.

## Source freshness and failure behavior

Account pages read existing accepted Neon administration evidence; they do not call Sleeper or Tank01, create a collector, enroll a league, or control worker demand. The accepted roster source, annual connection, completeness, normalizer, observation lineage and conflicts are checked together. Provider display names come from accepted users evidence separately; the documents are not claimed atomic.

The 60-second current-evidence threshold matches the existing core reader. Older valid data is labeled last known. An identical network verification may update a head while retaining a cached original observation, so the head's verified time supplies evidence when that original source time was null. Missing, contradictory or wrong-period evidence is unavailable. A missing co-owner in normalized data is not proof that no co-owner exists. Saved follows remain even when a source is unavailable or deactivated; new follows and associations require approved active source scope.

No timer repeatedly polls the private account API. Reads happen on navigation, relevant focus/session changes and after explicit writes. Each request verifies the upstream session, resolves the internal identity idempotently and reads/mutates the private store. Current three-league reads are bounded to existing supported public routes. Paginated libraries, larger source inventories and fleet-scale measurements are separate onboarding gates.

The root layout is neutral. The existing league shell lives in `(leagues)`, which adds no URL segment. All existing public page contents and URLs are preserved. A failure in authentication or account storage cannot make the public layout require a login. Existing cross-league registry/collector behavior is not represented as solved; isolating those failures remains item four before unrelated leagues.

## Configuration and deployment sequence

The branch is dormant by default. Environment names and managed-auth qualification are in [account-auth-foundation.md](account-auth-foundation.md). Private persistence additionally requires `ACCOUNT_DATABASE_URL` using the SQL-provisioned `league_one_account` credential with TLS. Never reuse the owner, migration or worker credential. Vercel Preview disables auth and private persistence regardless of copied configuration. Full account browser interaction tests use intercepted synthetic local responses, not production users. `pnpm test:browser:accounts` builds an explicitly isolated local browser fixture run; `verify:full` and the CI browser job run it after the ordinary public-page suite. It rejects deployed targets and supplies no database or provider credentials. The ordinary suite's skipped enabled-account cases are exercised by this separate required run.

Before a production release:

1. Recheck canonical GitHub/local main, Vercel project/root/production branch and exact production SHA. Record no competing owner observed only from actual release/worker evidence. Retain the tested pre-account checkpoint and preserve any subsequent user data before rollback.
2. Obtain the existing repository's production authorization for the concrete reviewed account release. Keep `ACCOUNTS_ENABLED` absent/false. Require full verification, actual preview inspection, independent SQL/auth review and passing guarded isolated tests. Record exact commit and normalized migration checksum.
3. Under database authority, verify installed migrations 001–019 against their original checksums and that 020 is the only pending migration. Run the existing checksummed migration runner. Migration 020 only adds private tables/functions/guards; old application readers and collectors do not depend on them. Do not rewrite an installed migration or checksum.
4. As owner, execute `scripts/provision-account-role.sql`, securely provision its credential and rerun its privilege postconditions. Execute the separately reviewed idempotent `scripts/seed-account-league-group.sql`. Verify exactly League One/Two in that group and no Dynasty affiliation. These actions create no login or source-team ownership.
5. Deploy the approved code and verify the exact merged SHA, all three public league routes and unchanged scheduled collection. The new platform pages can remain dormant while auth qualification is incomplete.
6. Qualify managed authentication in an empty isolated environment, including email delivery, verified admission, recovery, revocation, branch/cookie isolation, production origin and provider limits. No production snapshot or recovery branch is a development environment. A production mail service and its costs require a concrete decision before activation.
7. Configure the verified production auth issuer, distinct cookie secret, invitation list, canonical app origin and restricted account database URL. Enable accounts only after all required gates pass. Verify two independent accounts, private preference isolation, stale-tab rejection, logout and unaffected public browsing. This is separate from broader onboarding.

This document is a procedure, not proof any production step happened. Record local, branch, preview, migration, merge, deployment and activation evidence separately.

## Recovery

Disable `ACCOUNTS_ENABLED` to stop the app's private feature path; preserve private records and audit history. If needed, revoke relevant sessions and the new account credential through reviewed operator actions. Revert compatible code through a protected PR or use the existing emergency deployment rollback procedure, reconciling Git afterward. Public cron/provider settings are unchanged by this increment and must not be replaced as part of account rollback.

Do not drop migration 020, erase audit rows or restore an older full database merely to remove the UI. After accounts or league data have advanced, preserve that newer state before any full restoration. The pre-account checkpoint records the original code, deployment/configuration and tested Neon snapshot recovery. It is not permission to discard newer user data. Auth service users/sessions/secrets require their own retained service configuration and lifecycle recovery; an application public-schema snapshot is not a complete auth backup.

Accounts can later add more identity issuers and providers without replacing permanent league/user UUIDs. Actual ESPN/Yahoo connectors, private-league grants, verified ownership, account merging, commissioner tools and a self-service deletion workflow remain deliberately unimplemented. The pilot is not evidence of readiness for 6,000 leagues.

# Account authentication foundation

Accounts remain disabled by default, including every Vercel Preview. Public league browsing and the Sleeper/Tank01 projection pipeline do not depend on authentication. A Sleeper username remains an asserted profile association, not proof of website identity.

## Maintained runtime

The application runs `better-auth@1.6.23` with `kysely@0.29.6` and the existing Neon serverless PostgreSQL driver. Better Auth owns password hashing, recovery tokens, verification codes, cookie issuance and persisted session validation. Neon stores those records in the dedicated `website_auth` schema. The old managed Neon Auth SDK, its UI dependencies and peer-resolution workaround are removed. `pnpm verify:dependencies` checks ordinary peers and the exact runtime/adapter resolutions; upgrades require reviewing the migration and lifecycle proofs again.

The server explicitly enables `emailAndPassword.revokeSessionsOnPasswordReset`. This option is available because Better Auth now runs in the application; the previous managed service did not expose a supported setting for it. [Better Auth email/password documentation](https://better-auth.com/docs/authentication/email-password), [PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql), [Next.js integration](https://better-auth.com/docs/integrations/next).

## Server configuration

| Variable | Purpose |
| --- | --- |
| `ACCOUNTS_ENABLED` | Exactly `true` enables the account feature; Preview remains disabled. |
| `ACCOUNTS_APP_ORIGIN` | Exact trusted application origin. HTTPS except local development. |
| `ACCOUNTS_AUTH_ISSUER` | Stable configured identity namespace, exactly the app origin plus `/api/auth`. Never inferred from incoming headers. |
| `ACCOUNTS_AUTH_SECRET` | Independent secret of at least 32 characters, stored outside source control. |
| `ACCOUNTS_AUTH_DATABASE_URL` | TLS Neon PostgreSQL connection for restricted `league_one_auth`, distinct from account-domain and worker credentials. |
| `ACCOUNTS_INVITED_EMAILS` | Required server-only comma/newline-separated pilot admission list. |
| `ACCOUNTS_EMAIL_API_KEY` | Application-scoped Resend sending credential. The managed service's SMTP secret is not automatically available to the app. |
| `ACCOUNTS_EMAIL_FROM` | Verified sender email address. |
| `ACCOUNT_DATABASE_URL` | Existing separately restricted account-domain database credential. |

No secrets use `NEXT_PUBLIC_`. Do not pull production credentials into local development or a preview. An unavailable database or configuration denies private admission. Use distinct auth secrets, credentials, issuers and cookies across isolated environments.

## Request and session boundaries

The app retains its endpoint allowlist, exact Origin checks, 16 KiB UTF-8 JSON body limit, exact `/sign-in` callback checks and private/no-store responses. Signup requires an invited email both at the HTTP boundary and the maintained library's user-creation hook. Email verification is required for private admission. OAuth, passwordless login and alternate enrollment routes are not exposed. Account linking is not an authentication or Sleeper ownership proof.

Every protected request reads the authoritative persisted session. Cookie caching is disabled, and native Better Auth receives boolean `disableCookieCache: true`. This intentionally replaces the old proxy SDK's string-only cache-bypass behavior. The new cookie prefix prevents accidental reuse of the old managed-service cookie. Private routes resolve only configured issuer plus verified subject; emails are not persistent application identity keys.

The maintained reset endpoint alone updates the password and deletes sessions sequentially. The application therefore runs auth requests through one PostgreSQL transaction. Credential/session mutations take a fixed database transaction advisory lock before Better Auth executes. This serializes overlapping sign-in/reset operations. A returned server failure or thrown error rolls back token consumption, credential changes and session deletion. Ordinary validation and rate-limit failures commit so rejected requests still consume maintained rate limits and verification attempts. No custom password hashing, reset-token interpretation or session epoch is added.

This serialization is appropriate for the small pilot. It limits concurrent credential mutations; lock and query deadlines bound waits. Broader onboarding requires measured capacity testing and a reviewed change if finer-grained coordination becomes necessary. A request already authorized before reset may finish; the guarantee is that an old session cannot newly authorize after a successful reset has committed.

Database-backed rate limits remain enabled in local qualification and production. OTPs use the maintained hashed storage, expiry and attempt limits. Verification messages include the code's field name. Recovery email links point to `/sign-in` with the maintained opaque token; the page removes it from URL/history after capturing it in memory and sends no-referrer/private cache headers. Email delivery is awaited, bounded and fails safely without logging recipients, tokens or provider responses.

## Database installation and privileges

Migration `021_website_auth.sql` creates the reviewed Better Auth core tables and persistent rate-limit table. Existing migrations remain immutable. The app never migrates itself.

After owner-run migrations, run `apps/site/scripts/provision-auth-role.sql` as the database owner. This creates/checks an unprivileged standalone `league_one_auth` role and grants only required auth-table access. The auth role cannot read or change the public account/league tables, own objects, create schema objects or invoke public privileged writers. The account-domain and projection-worker roles cannot access auth tables. Re-run all role checks after credential provisioning. Never give the app an owner connection or Neon management key.

The isolated harness now resets both fixed schemas, `public` and `website_auth`, only after its complete authorization, database/branch identity, TLS, sentinel, role and production-denylist checks. Use a fresh disposable database. The retained populated pilot is not a destructive test target.

## Existing pilot identity transition

Replacing the auth service changes the identity namespace. Keep the current pilot intact until the replacement passes synthetic and PostgreSQL qualification.

1. Record each existing exact managed issuer/subject and its application-user ID from authoritative storage. Snapshot the existing private profile, provider-link and preference records.
2. Enroll the two intended users through a supported Better Auth verification/password setup flow with the replacement's ACCOUNT_DATABASE_URL unset, so authentication can run but no private application identity can be provisioned. Keep that database credential unavailable until the exact identity mappings below are installed. Do not reuse managed sessions, reset tokens or verification tokens. Do not assume password-hash portability.
3. Review a one-to-one mapping of old issuer/subject to the same application-user ID and the new issuer/subject. Insert those new identity mappings in an owner-controlled transaction before enabling private admission. Never sign in first and merge two app accounts by email afterward.
4. Verify both users retain their application-user IDs, Sleeper associations and preferences, and each sees only their own private information. Preserve old identity history; revoke the old mapping only as part of the approved cutover.
5. Keep production activation separate from preview/code review. Verify the exact merged Git SHA and both public leagues after any authorized production release.

The application team now owns auth version updates, email delivery, database migrations, abuse controls and operational recovery. Additional cost or a paid service change requires a separate decision.

## Qualification before activation

Require evidence from the exact application configuration, not merely a similar example:

- Verified signup and sign-in; unknown, uninvited and unverified users denied; wrong/expired/reused verification codes rejected; duplicate signup and alternate routes handled safely.
- Two existing cookies admitted before reset and both rejected unchanged afterward. Old password rejected, new password accepted, reset token single-use, unrelated user's session unaffected.
- Overlapping sign-in/reset and reset/reset requests preserve the same guarantees through the actual PostgreSQL orchestration. Fault injection during session deletion must not report success or commit a partial password change.
- Authoritative protected-route checks fail closed on database outages; logout, expiry, origin/callback/body limits and private caching remain enforced.
- Real restricted-role boundaries, fresh migrations, repeatable guarded cleanup and credential cleanup verified against a disposable Neon database.
- Actual transactional email and the two-user identity transition verified in the isolated pilot before production activation.

Memory-adapter and synthetic-browser tests are useful regression coverage but do not qualify PostgreSQL locking, provider email delivery, the identity transition or production deployment. Report each layer separately.

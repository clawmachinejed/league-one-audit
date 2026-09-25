# Account league onboarding

This change keeps website registration invitation-only and requires verified email. Sign-in opens My Fantasy. An account without an association gets a Connect Sleeper action; `/account` accepts a username, shows the resolved Sleeper profile, and asks the user to confirm its current-season teams before importing selected leagues.

Sleeper's [public API](https://docs.sleeper.com/) resolves the username to a stable user ID. The association remains nonexclusive and `user_asserted`: it grants no Sleeper control or commissioner privileges. Owner/co-owner membership must agree with official roster evidence. Existing observed-profile association and unlink controls remain available.

## Import and collection

`POST /api/me/sleeper-onboarding` requires the invited session, exact Origin, bounded JSON, strict input and expected account ID. Preview is read-only and limited to 20 current-season leagues, with four concurrent roster lookups. Unsupported or unavailable leagues are visible but cannot be imported. The existing capability assessor admits supported and limited formats. A confirm request handles one league within a 50-second deadline; the browser confirms selected leagues sequentially and retains partial progress on failure.

An already active source reuses its permanent registry entry. A new source receives `sleeper-<initial-league-id>` as its permanent route key. The canonical registration, administration normalizer and fenced writer capture official league, roster and manager documents. There is no new scoring, projection, snapshot or provider pipeline. Existing collection lanes discover the new active registry entry; projections may remain unavailable until collection completes. Import endpoints never call Tank01.

Migration **025** adds two narrowly granted runtime functions. Preparation reserves an inactive enrollment; activation requires complete, conflict-free, recently verified canonical evidence for all three core documents. Prepared imports stay out of current and exact-season worker inventories. Reservations count toward a conservative **16-enrollment pilot admission cap**, including existing/operator enrollments. The advisory transaction lock serializes admission and per-source job claims serialize imports. This cap is a policy limit, not a measured refresh guarantee; see [collection capacity](collection-capacity-validation.md). An abandoned reservation requires owner investigation, not an automatic destructive cleanup. A retry resumes the same registration. Existing operator enrollments, scoring profiles, baselines and snapshots are preserved.

Annual renewal still requires the existing owner continuity workflow. Do not treat a new Sleeper season ID as permission to overwrite a permanent source connection. Associations alone do not create affiliations; League One/Two's existing direct group is retained, with Dynasty independent.

## Presentation and privacy

Signed-in My Fantasy reads `/api/me/fantasy` with the expected account ID. Its cards derive from the account's current-season accepted owner/co-owner evidence. Browser choices cannot add a league or an unrelated team. Direct affiliates stay in the ribbon without receiving a personal card. The ribbon labels participating, linked and followed leagues separately and supports imported routes under `/leagues/<key>`. Public routes still use the existing readers, exact-week policy and snapshot refresh.

Private account data remains in component memory, with `private, no-store` responses and session revalidation across navigation, focus, logout and account changes. The fantasy response rechecks the session and association set after loading public league data. Signed-out browsing retains the existing explicit browser-team selection behavior. My Team's independent guest/team-selection contract is unchanged.

League names and icons come from accepted Sleeper league metadata, falling back to official reads and then a generic icon when artwork is absent. The supplied site PNG is the global brand and browser/touch icon, separate from league artwork. Original PNG SHA-256: `73ce2a461e219722a7af132225426a89246d4bacf8bfb1f0d44f2cdbeb2945a5`.

## Release gates

No production migration or enrollment is performed by this code change. Before release:

1. Revalidate main, Vercel source/branch and production SHA; obtain release authorization and independent review of the new admission permissions.
2. Run the guarded isolated Neon suite, including `account-enrollment.integration-case.ts`. It tests inactive preparation, evidence-required activation, retry, capacity and role boundaries. No configured isolated environment means this evidence remains unverified.
3. Apply migration 025 through the owner migration process before enabling this application version. Provisioning grants the same narrow functions when the runtime role is created after migrations. The private account role receives no shared enrollment permissions.
4. Verify an invited signup/email/sign-in, real username confirmation and a new league import in the authorized environment; confirm account isolation, both existing League One/Two routes, linked navigation and subsequent worker collection.

Vercel Preview deliberately disables private accounts and database persistence. Public preview checks and local synthetic account browser tests provide distinct evidence; they do not prove a real Neon import or production email delivery. Roll back application code without deleting imported leagues or account data; owner review is required to deactivate enrollment if collection must stop.

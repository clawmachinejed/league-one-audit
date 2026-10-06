# Current team-to-provider-manager relationships

Implementation scope agreed with the coordinator before substantive editing:
one public, internal shadow resource through the existing administration collector,
normalizer and writer. No page/account reader cutover, provider connection, new
service, scoring/projection change, production migration or release is authorized.

## Identity and coverage

Reuse existing season-team and provider-manager UUIDs. A team keeps its UUID on
owner transfer; annual teams and source-remapped teams retain separate identities.
Provider manager IDs are opaque and source qualified, never matched by name.
Observed ownership does not create a website account claim, private grant,
preference or affiliation. Display names/photos from `users` are optional and do
not qualify this resource. Capture time does not establish historical tenure.

The immutable teams-family scope requests **complete primary `owner_id` coverage**
for the independently evidenced league team population. It does not claim a
complete inventory of all managers. A present valid owner ID means owned; explicit
null means unowned under this versioned Sleeper policy; an absent owner field is
unknown and cannot replace the primary-owner head. Optional co-manager groups in
the exact same receipt independently report known arrays (including explicit
empty arrays) or unknown with a reason. Missing/null/malformed co-manager fields
do not block proven primary ownership. Unknown never means empty or removal.

BC-M1 R035 also preserves an independently valid co-manager group when the primary
owner is malformed: that primary is unknown, with its original invalid-identifier
diagnostic, rather than vacant. This enriched **unqualified** projection uses
`sleeper-current-team-managers-partial-v2`. It is not a registered acceptance
policy. Every representable v1 projection and accepted value retains its existing
version, shape and hash; historical receipts are not reinterpreted or rewritten.
The sole writer's closed v1 policy and the accepted reader still require complete
primary-owner coverage. Consequently these new partial facts cannot create a
provider-manager identity, membership, fresh acceptance or exhaustive exclusion.
Qualification of partial positive role groups for account access remains pending.

A failed, malformed or partial-unqualified later attempt preserves prior accepted facts and
their original source time. It does not itself establish a qualified adverse
removal, renew an old membership, or erase a still-valid D02 allowance. The future
account membership composition must evaluate the selected qualified positive
group, the full qualified adverse set and the original 3,600-second deadline;
neither this normalization result nor the public accepted reader is an account
authorization decision. Missing co-manager coverage cannot prove exhaustive loss.

The [Sleeper API reference](https://docs.sleeper.com/) documents roster owner IDs,
the all-rosters endpoint and stable user IDs; `users.is_owner` means commissioner.
Its sample omits `co_owners` and does not establish null semantics. The official
[co-owner guide](https://support.sleeper.com/en/articles/3995216-how-can-i-add-co-owners)
and [transfer guide](https://support.sleeper.com/en/articles/4100936-how-can-i-transfer-a-team-to-another-owner)
establish distinct primary/co-owner roles and unassignment, not a JSON-null
co-owner convention. A bounded public League Two shape check on 2026-09-29 found
11 null co-owner groups and one nonempty group across 12 rosters. No manager IDs
or raw personal payload were exported. Consequently null co-owners stay unknown;
ordinary live primary relationships can still qualify. The explicit-null primary
policy is an adapter interpretation, not a claimed provider timestamp/tenure fact.

Prior co-manager lists remain in immutable captures/receipts. There is no active
complete co-owner replacement pointer, last-known blending, or inferred deletion.
Any future last-known lookup must retain its original receipt/time and distinguish
it from unknown current coverage. Per-team reservations and additional fetches
are unnecessary for this policy.

## Persistence and compatibility plan

Migration 028 extends the closed policy registry in 027 and its single writer;
installed migration 027 remains byte-for-byte unchanged. The same existing raw
roster HTTP request gets separate players and manager attempt UUIDs, reserved
in one database statement before acquisition. Existing scope/attempt/receipt/head
tables retain mapping, latest reservation, expected generation and worker lease
fences. The writer calls the preserved v1 implementation once, then independently
qualifies each shadow policy in that transaction. Failed/unknown evidence leaves
the prior resource acceptance intact. Exact retries retain their original receipt;
changed evidence under an attempt is rejected.

An additive immutable projection and its typed membership relation bind the independently normalized manager fields to
the existing content and season-team UUIDs. It is needed when malformed unrelated
player fields reject the v1 document and therefore produce no v1 team entries.
Existing provider-manager identities are reused. Original v1 content-linked
memberships remain sealed: their existing guard disallows insertion after an
observation and rejects invalid v1 content. The new immutable linkage validates
each manager/role against exact projection evidence without weakening that guard.
No historical normalization, hash, ID or acceptance is relabeled. A new
internal read selects exact accepted receipt evidence, validates raw/projection
parity and exposes source-qualified relationships plus separate co-group coverage.

Independence is deliberately asymmetric for compatibility: managers can qualify
despite malformed unrelated player fields. Missing/null manager fields that v1
allows do not block players. Malformed manager fields still reject the existing
v1/players policy as they did in 027. Broadening players would need a new policy
version and is outside this slice. Old callers remain valid and cannot create
manager acceptances without a manager reservation and completion input. Cache
checks remain neutral; changed-cache network verification reserves both policies
before its already-required fetch. No new provider request or cron is introduced.

## Qualification and release boundary

Target unit/transport and disposable SQL evidence: owner transfer/removal, co-owner
changes, null/absence/empty/malformed fields, duplicate/foreign IDs, multiple teams
per manager, source/season isolation, rollover, remaps including A-B-A, stale/failed
latest attempts, exact/changed retries, mapping/lease/deadline fences, unchanged
v1 observations with new exact receipts, history/UUID preservation, narrow role
permissions and old callers. Run full deterministic/public/account browser checks,
independent review and actual Vercel Preview inspection. Production is unchanged.

The exact committed/reviewed SHA must receive responsible maintainer approval in
the protected `integration-test` environment before the disposable Neon run. The
existing $5 total test budget is not a fresh allowance. SQL is unverified until
tests and every cleanup receipt pass; source tests and a queued run are not SQL
evidence. No production secrets or destructive production tests are involved.

Starting clean isolated HEAD, primary main and GitHub main match
`d25609b9be8086ccb9903e81e6a9d6ba19b8abe7`. The coordinator independently checked
Ready Production `6PTSY6BuMvKnxKsSVRkTQ4bKRECo` at that exact SHA, canonical
`clawmachinejed/league-one-audit`, branch `main`, root `apps/site`, Vercel project
`robert-finchums-projects/league_one_fantasy`. No competing owner observed in
inspected worktrees, PRs and workflows; this task owns implementation and PR only.
Production database leases were not inspected by this implementation task.

Application rollback retains 028 and immutable evidence. New manager acceptance
stops with old callers; original v1/players behavior continues. New callers require
028 first. Do not reverse schema, clear heads/history or widen permissions.
Record local checks, PR, preview, SQL qualification and later production separately.

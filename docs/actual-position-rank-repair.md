# Actual position rank repair

The first hourly capture on September 13, 2026 stored valid Week 1 statistics,
but production revision `29abc3bc1e8ff6c73e43be045528d310168f4d9f` returned
no QB, RB, WR, or TE ranks in either league. Individual PPG values and defense
ranks continued to work. The defect was in the provisional metrics reader.

## Reproduced evidence

A read-only census at `2026-09-13T19:19:13.466393Z` checked Neon project
`solitary-base-99261075`, branch `br-rapid-boat-avgeevye` / `main`, database
`neondb`, role `neondb_owner`, PostgreSQL 18.6. No active all-player lease was
observed. Local and GitHub main matched the Vercel production SHA above; Vercel
was bound to `clawmachinejed/league-one-audit`, `main`, root `apps/site`.
No competing release owner was observed in the checked worktrees, open PRs,
deployment, or all-player lease.

The source was the existing observation
`c477ce57-92b5-5f12-aa84-cdb2e77ca45f`, observed at
`2026-09-13T19:00:28.921Z`, content
`612210bc-ff64-5c7b-a2bb-638ac65d8f89`. Both leagues shared scoring profile
`ffe5ecf4-ddfe-4ebf-b176-180520020540`.

| Position | Nonzero scoring rows | Unmapped zero-point appearances | Unmapped nonzero scoring rows |
| --- | ---: | ---: | ---: |
| QB | 22 | 2 | 0 |
| RB | 46 | 3 | 2 |
| WR | 62 | 6 | 1 |
| TE | 34 | 7 | 0 |
| K | 19 | 0 | 0 |
| DEF | 19 | 0 | 0 |

All 21 missing mappings were absent, rather than expired or retired. The three
nonzero source-only players were Sleeper `11280`, `12048`, and `12732`.
There were no nonzero rows with the mixed/zero participation counts that the
old reader rejected. The raw coverage separately contained a projection-only
RB exclusion from the already retired false Tank01 relationship.

Before repair, League One had 89 non-null PPG values but only seven ranks,
all defenses. League Two had 91 non-null PPG values but only seven ranks,
all defenses. Counts describe roster occurrences, not a complete NFL ranking
population. The sanitized fixture retains the actual stored rows, evidence,
profile, mapping presence, and source timestamps; its README defines the
selection and limits.

## Finding-to-fix evidence

| Finding | Repair | Regression evidence |
| --- | --- | --- |
| Optional projection warning hides actual RB ranks | Actual-stat reader no longer consumes projection rank exclusions | Legacy RB coverage plus real source-only RB statistics |
| Partial raw history precedes canonical registration | Accepted Sleeper player IDs can compete provisionally with a null internal canonical ID | Real absent mappings, unrostered competitors, and all six position populations |
| Filtered mapping join hides invalid mappings as absent | Explicit absence check across entity kinds and mapping states | Expired, future-valid, retired, unverified, wrong-kind, and canonical collision cases |
| Later registration can invalidate older source-only history | Enrich partial source identities using mappings valid at the read transaction time | Registration after observation and conflicts with immutable published identity |
| Tests manufacture mappings instead of reproducing stored state | Retain actual mapping absence and eligibility evidence in one shared fixture | Unit reader/scorer and isolated PostgreSQL reader tests |
| Floating arithmetic splits tied actual scores | Compare exact rank units at the existing four-decimal published weekly score precision | Four real RB tie pairs, positive/negative decimal halves, and accumulated weekly contributions |

The captured RB pairs `8228`/`11576`, `10219`/`12474`, `7567`/`12969`, and
`5967`/`9757` have tied actual totals of 3.1, 2.3, 1.9, and 1.8 respectively.
Binary floating-point artifacts previously assigned different ranks within
each pair. The rank key follows the existing stored score precision; actual
totals and PPG still come from the unchanged canonical scorer.

The canonical scorer, complete-score writer, partial ingestion, immutable history,
publication guards, roster payload, and hourly ingestion schedule retain their
existing roles. A provisional rank is a rank among valid observed actual totals;
it does not assert completed Week 1 inventory, finality, or full official parity.
Players with no nonzero total continue to display a dash under the existing
product contract.

## Release and rollback

1. Run targeted regressions and the complete repository verification workflow.
   The isolated harness must pass every identity, authorization, sentinel, role,
   TLS, and production denylist guard before any destructive setup.
2. Obtain independent review of the reader, mapping validity semantics, fixture,
   and PostgreSQL cases. Publish one PR. Inspect its actual Vercel preview in the
   built-in browser; preview remains database-disabled under existing policy.
3. Revalidate local/GitHub main, canonical remote, Vercel binding/production SHA,
   and observable release ownership. Merge within the existing production-release
   authorization after required checks pass.
4. Verify that production runs the exact merged SHA. Read both live roster
   endpoints and inspect expanded rosters. Confirm actual ranks across QB, RB,
   WR, TE, and DEF, source timestamps, PPG, league selection, and zero-value dashes.
   Neither league currently rosters kickers; K population coverage is a fixture
   and database test, not a live roster claim.
5. Compare the live results with the same retained observation where possible.
   A natural hourly capture can advance statistics during release; record that
   boundary explicitly rather than attributing changed scores to this repair.

No migration, alias correction, manual backfill, provider request, or configuration
change is needed for this reader release. Recurring collection continues through
the existing guarded lane. No production secrets are copied to the local or
preview environment.

If the reader regresses, revert this application change through a protected PR
and verify both leagues. The prior deployment is compatible with the unchanged
schema and raw history, although it restores the known blank-rank defect.
Do not delete observations, move score pointers, alter aliases, or run a database
down-migration. Any temporary Vercel rollback must be reconciled with GitHub.

The final release artifact records exact revisions, independent review, test
totals/skips, preview, merge, deployment, and live values separately. This repair
does not claim that complete Week 1 score publication or full foundation readiness
has been established.

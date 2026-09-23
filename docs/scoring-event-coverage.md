# Shared scoring-event coverage

League-specific weights continue to come from Sleeper and remain in Neon's
immutable scoring profiles. The existing shared sparse actual-stat calculator
multiplies each active rule by the same-named native weekly statistic. There is
no league-specific calculation code or manually entered scoring profile here.

## Qualified actual events

The additive `022_sleeper_actual_scoring_events.sql` migration and Sleeper
adapter allowlist qualify these eleven native actual-stat counters:

| Sleeper key | Event |
| --- | --- |
| `pass_int_td` | Passing interception returned for a touchdown |
| `st_fum_rec` | Individual special-teams fumble recovery |
| `ff` | Team-defense forced fumble |
| `def_st_ff` | Team special-teams forced fumble |
| `st_ff` | Individual special-teams forced fumble |
| `fgm_0_19`, `fgm_20_29`, `fgm_30_39`, `fgm_40_49`, `fgm_50_59`, `fgm_60p` | Made field goals in each of six distance ranges |

The native categories remain separate. No aliasing, special-teams aggregation,
field-goal distance estimates, or league-specific override is introduced. A
league can configure both a base field-goal award and distance awards; each
active configured rule contributes exactly once.

## Evidence and limits

`apps/site/test-support/fixtures/sleeper-scoring-event-coverage.json` retains
public provider evidence captured September 23, 2026. Each original response
has its URL, observation time, HTTP status and SHA-256; selected stat rows are
unchanged, while league and matchup documents retain only scoring settings and
official player points. This is public evidence, not a production database copy.

- Nonzero native examples for ten keys come from Sleeper's 2025 Week 1 stats.
- The rare `fgm_0_19` example comes from 2024 Week 2: player `4227`, one short
  field goal among two made field goals.
- All 181 The GridIron II and 183 Myers 2026 Week 2 official player-point
  comparisons match. Maximum absolute floating-point delta in either capture
  is `7.105427357601002e-15`, below the unchanged `0.0001` parity tolerance.
- The regression suite independently replays the retained native rows through
  the current shared scorer. Missing provider rows in this arithmetic fixture
  do not grant eligibility or bypass ingestion's identity, participation,
  completeness, parity or publication checks.

Sleeper's [scoring option descriptions](https://support.sleeper.com/en/articles/3998131-what-scoring-options-are-available)
provide category names. Actual support is established by the native counters
and official-point parity, rather than inferred from a label alone.

This expands **actual calculated scoring only**. Tank01's existing normalized
projection data does not provide these eleven independent events. The
projection adapter therefore still reports all eleven as unsupported when
active. Official Sleeper scores remain authoritative. This does not enroll
additional leagues or establish complete projection, standings or playoff
support.

## Version and database compatibility

The calculator, zero handling, rounding, raw rules, rules hashes and
`sleeper-actual-v1` identifier are unchanged. These are newly qualified inputs
to its existing exact multiplication contract. A profile with any newly
qualified nonzero key could not previously pass the database contract; every
previously accepted profile therefore retains identical score and breakdown
semantics. Existing live and frozen results are never rewritten.

Migration 022 replaces only `all_player_scoring_contract_supported` with the
expanded key list. The provider/version checks, weight validation, active-rule
requirement, immutable function attributes and execution restrictions remain.
There are no table changes, grants, enrollment changes, cron changes or data
updates. The historical migration 010 stays byte-for-byte unchanged.

Apply the reviewed additive migration before enabling new actual-scoring
profiles in production. Existing qualified profiles remain compatible with
both application versions; an application rollback does not require removing
the additive database contract. The feature's release record, not this source
document, establishes whether migration 022 has been applied or the code has
been deployed.

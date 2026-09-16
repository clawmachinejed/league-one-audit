# Implementation review and verification

September 16, 2026. Prepared on `codex/portable-league-database` from canonical main `9325a979e4883fb0ed10a83f2edf4d8eda618d48`. This records local implementation review; it does not approve the uncaptured database catalog or a production release.

## Local verification

- `pnpm verify`: lint, generated Next route types, TypeScript, 2,673 passing unit/runtime checks, one environment-dependent network-interface skip, and production build passed.
- Complete Chromium suite: 82 passed at four workers. Initial ten-worker run passed 81 with one `route.fetch` ECONNRESET during local fixture injection; the unchanged complete rerun passed. No application exception was found in the inspected failed-request trace.
- Real Node administration CLI startup outside Next is covered; missing authority is rejected before database/provider operations. Shadow composition verifies normalization, exact enrollment and immutable scoring-profile compatibility without a job claim or source-history writes.
- Retained sanitized real settings for all three leagues and the earlier League One/Two roster and matchup shapes are exercised. These prove source shape, not current production parity or historical rule applicability.
- Earlier isolated suite: 281 passed, four failed. Subsequent fixes have not received the final isolated rerun. See `validation-status.json` for the automatic approval-review block; no workaround or retry followed that rejection.

## Independent review findings and corrections

| Finding | Correction and regression evidence |
| --- | --- |
| Fresh cache verification could label an older calculation with newer settings | Compare original and verified raw content hashes; retain new evidence but withhold calculation context if they differ. `runtime.test.ts` tests the source mismatch. |
| Cached checks could falsely refresh source freshness | Store nullable `verified_at` separately; network-only accepted checks advance it. Page reader tests cover stale, unknown, future and zero-TTL evidence plus conflict-first behavior. Final SQL regression remains pending. |
| Latest season lookup could select a registered but unapproved year | Select the latest intended enrollment season before joining its registration. Missing intended registration fails closed; the prepared DB regression covers an unapproved higher year. |
| Historical operator could use the current year's source registry | Exact operator season is passed to the existing enrollment read. Existing calendar/parity restrictions remain in force; this does not authorize historical rescoring. |
| Configuration could change between official observation and publication | Add a publication-time lineage trigger using the verification observation or original snapshot observation; lock and check current context. Reused immutable snapshot content can receive fresh matching verification. Final SQL race regression remains pending. |
| Metadata turns could permanently skip some historical weeks | Exclude metadata turns from the weekly ordinal. Tests inspect actual non-metadata selections for current weeks 1, 2, 3, 7, 15 and 18. Independent arithmetic review covered every current week 1–18 across three leagues with no missing historical period. |
| Failed metadata bodies have no source observation time | Preserve null evidence time, retain partial/rejected observations, and never advance accepted freshness from them. Pure/runtime checks pass; final SQL regression remains pending. |
| Draft/bracket source variants and ownership could be misread | Verify draft catalog/detail league, season and resource identity before requests/acceptance. Preserve unknown fields. Normalize documented bracket advancement forms and typed selections; reject conflicting asset ownership and duplicate identities. |
| Prior all-player membership depended on fixed league names | Migration 017 uses immutable exact-season intended membership and all required distinct profiles; existing leases, parity and publication path remain. Final arbitrary-key/shared-profile DB regression remains pending. |

Independent agents reviewed schema/source identity, runtime composition, source normalization, page freshness, publication membership, migration tooling and collection rotation. The final real catalog, physical measurements and exact release revision still require review after authorized database testing.

## Release gate

Do not merge or apply migrations until the guarded final integration suite, PostgreSQL 180006 catalog capture, actual wrapper rollback/commit/replay checks, physical storage workload and independent manifest review pass. A successful Preview is database-disabled and cannot satisfy these database gates. Production migration, deployment, bootstrap and scheduled-operation evidence are separate events and are not claimed here.

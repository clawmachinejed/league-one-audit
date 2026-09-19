# Manager display corrections

The owner confirmed on September 19, 2026 that the League Two team assigned to Sleeper account **eneerg** is actually managed by **tylerawildman**. Sleeper will retain the incorrect account assignment. The site records this explicit exception in `apps/site/lib/manager-display.ts`.

| Scope | Verified value |
| --- | --- |
| Sleeper league connection | `1378850360529014784` (League Two, 2026) |
| Roster | `1` |
| Source account | `95628446075863040` / eneerg |
| Displayed manager | `862177751849877504` / tylerawildman |

The account IDs and current roster assignment were checked against Sleeper's public user and league endpoints. The **ownership correction itself is owner-supplied authority**, not an inference from those endpoints. It applies to this connection and roster only. An annual renewal, different roster or ownership change requires reviewing the exception; it must not silently attach Tyler to an unrelated team.

## Presentation behavior

The page core matches the league connection, roster ID and source owner ID before changing the manager name. The same correction reaches Managers, standings/waivers, League Rosters, manager profiles, transaction views, schedules and the official matchup fallback. A source display-name change does not break this owner-ID match. Team name, artwork, roster selection, standings order, players and scoring values remain the official team's values.

Championship lookup uses the effective manager identity for this one roster. Tyler has no championships in the supplied history, so this League Two team receives no trophy. Eneerg retains his three championships in League One and Dynasty. Neither source account nor global championship history is edited.

Stored matchup snapshots lack owner IDs. Matchups and My Team therefore apply a narrow compatibility correction **at render time**, after the existing snapshot hook: League Two, season 2026, roster 1, source manager name `eneerg`. The same rule handles initial rendering and later polling responses. Other names, seasons, roster IDs and leagues remain unchanged. Unknown snapshot names are not guessed to be this manager. This rule does not load another provider or introduce additional network requests.

Raw administration documents, source ownership, projection-worker input, persisted snapshots, public matchup payloads, revisions and freshness checks retain their original evidence. No database migration, ownership rewrite, history repair, worker rebuild or scoring change is required. A protected application revert removes the presentation correction if necessary.

## Verification

Loader regressions cover the shared page paths, partial rosters, source-name changes, no extra roster/user requests, trophy attribution, other-league isolation, different/unassigned owners, wrong roster and unchanged official worker/administration evidence. Shared Matchups/My Team component tests cover initial and updated snapshots, actual points, unchanged source objects and unrelated league/season/roster/name cases. The normal complete verification and actual Vercel preview checks remain the release gates.

# Manager championship trophies

Every visible manager name uses the shared ManagerName component: the Managers directory, manager profile headers, Matchups and My Team, Standings and Waivers, League Rosters, and both sides of My Team/manager schedules. One blue-flame trophy appears for each League One Trophy Bowl win, and one red-flame trophy for each League Two Promotion Bowl win. On matchup and schedule cards, trophies face inward: after the left manager name and before the right manager name, including when My Team moves a team to the left. Other surfaces place trophies after the name. Both sets follow the manager across all three leagues and retain their original championship league, regardless of promotion or relegation. Team-only transaction labels remain team names.

The user supplied the historical results and identity mappings on September 19, 2026. This is curated league history, not newly inferred Sleeper scoring or playoff results. The server-only registry in `apps/site/lib/manager-championships.ts` stores championship years once per stable Sleeper user ID. Counts are derived from those years. Future winners or historical corrections require an explicit, reviewed registry update; this change does not introduce an automatic award collector.

The existing cached calendar, roster and user reads supply ownership evidence. The directory retains its verified loader fields; other page views receive a separate honors map scoped to the resolved annual connection, season and roster. The server joins roster ID to owner ID, applies the confirmed [manager display correction](manager-display-corrections.md), then looks up championship years. No additional provider requests are introduced. Unknown, unassigned, ambiguous or missing-user identities receive no badge. Honor-read failure preserves otherwise usable page data.

The client verifies the active resolved connection and season, then matches the expected displayed manager name for that roster. The name is a stale-data guard, never the authority for awarding titles. Matchup and roster payload updates are independently season-scoped. Existing snapshots remain unchanged; a renamed snapshot may temporarily omit trophies until its name catches up with current ownership evidence. Changing pages/reloading refreshes the map through the existing cached reads. The generic Team model, roster/matchup APIs, immutable snapshots, revisions and worker inputs do not acquire award fields. League Two Tyler remains trophy-free; eneerg retains his three titles elsewhere.

| Supplied name | Verified Sleeper account | Championship years |
| --- | --- | --- |
| Baute.J | jwbaute | 2008, 2009, 2014, 2025 |
| Greene.R | eneerg | 2010, 2012, 2017 |
| Harris / Danny Pack | DannyPak | 2013, 2016 |
| Woodruff.S | SWoodruff | 2011, 2024 |
| Finchum | clawmachinejedi | 2020 |
| Greene.D / Old School | dgreene4223 | 2022 |
| Hrebec | whrebec | 2015 |
| Baute.T | tbaute69 | 2023 |
| Franklin | trellfrank | 2019 |
| Metcalf | bmetcalf21 | 2018 |
| Williams | swilliams24 | 2021 |

The user confirmed Finchum's 2020 championship belongs to clawmachinejedi.

## League Two Promotion Bowl history

The second owner-supplied championship table covers 2015–2025. Both kinds of awards use the same stable-owner boundary and existing presentation metadata; `promotionChampionshipYears` stays separate from League One `championshipYears`. A manager can hold both. Display labels and hover text identify the league and years separately.

| Supplied name | Verified Sleeper account | Championship years |
| --- | --- | --- |
| Baute.J | jwbaute | 2020, 2022 |
| Greene.D | dgreene4223 | 2017, 2018 |
| Baute.T | tbaute69 | 2019 |
| Hsueh | Pending confirmation of rhsueh2 spelling | 2023 |
| Jessup | Pending owner-supplied account mapping | 2015 |
| Leath | evleath | 2024 |
| Minnick | jmin28 | 2021 |
| Swinney | tswinney2 | 2016 |
| Thomen | tthomen | 2025 |

Public Sleeper identities were checked on September 19, 2026 at 17:26 UTC. Seven confirmed owner IDs account for nine titles. The supplied `rshueh2` spelling resolves to no account; the existing League One account is `rhsueh2`. Hsueh and Jessup remain unassigned until the owner resolves those identities; their supplied championship history is retained here rather than awarded to a guessed account.

Identity verification used the official public users and rosters for the current three league connections: League One 1378850182409490432, League Two 1378850360529014784 and Dynasty 1312138224994385920. These are provenance observations, not new routing constants. The 11 confirmed manager mappings cover all 18 championships from 2008 through 2025.

## Artwork

The user supplied the blue-flame silver trophy JPEG. Its checkerboard was painted into the source image. Built-in image editing produced a transparent PNG, `apps/site/public/league-one-champion-v1.png`, preserving the trophy's design. The source attachment was `1-Photo-1.jpg` in attachment group0150E4C4-C00B-4A1A-A075-6CA5A017DE4E.

The edit prompt requested: “Remove only the gray checkerboard background, including inside the handles, and preserve the original trophy's exact shape, blue flames, silver ornamentation, engraved central numeral1, colors and proportions. Keep the complete trophy and all flame tips and handles. Center in a tight portrait bounding box with just a small transparent margin. The output background must have genuine alpha transparency, not a drawn checkerboard or solid background. Do not redesign the trophy; no text or new elements.”

The asset is RGBA1145×1373, with real transparent pixels. Next Image serves a size-optimized local image. CSS height is 1cap, the manager font uppercase-letter height, with the original1145:1373 aspect ratio. The Managers directory preserves its original 17×20px trophy boxes and 1px group gap. Repeated icons share the same image URL. The icon group has one accessible label containing the number of League One championships and each year; individual decorative images have empty alt text. Outside the directory, trophies inherit the name font size and sit on its baseline. Names and icons may wrap naturally; no count replacement, font shrinking or new truncation is introduced. Existing enclosing button/link labels also include title counts and years for assistive technology.

The red-flame League Two trophy came from `2-Photo-2.jpg` in attachment group57388BD3-0C7B-41F5-BC16-B2C43B70A545. Built-in imagegen background extraction produced `apps/site/public/league-two-champion-v1.png`, RGBA1123×1401. Alpha inspection confirms transparent corners and handle openings. The edit prompt requested removal only of the painted gray checkerboard, preserving the exact trophy shape, complete red/orange flames, silver ornamentation, engraved numeral2, colors and proportions, all handles and the base, with a tight transparent margin and no redesign, recoloring, simplification, added text, objects or shadows.

Red trophies are always 1ex high, the manager font's lowercase x-height, with the asset's1123:1401 aspect ratio. This includes the Managers directory: its larger blue-trophy styling never enlarges the red trophies. Each league has its own accessible group label and tooltip; enclosing control labels announce both when applicable. Natural wrapping remains allowed while longer combined names/awards are evaluated visually.

No database migration, historical result writes, scoring changes, provider configuration or scheduled work is part of this feature. Rollback is a normal protected application revert; the historical source document remains available to restore the registry.

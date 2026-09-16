# PostgreSQL catalog and release-wrapper review

Current catalog approval is the **20:18 UTC collection-semantics follow-up** at the end of this report. Its migration, capture and expected rendering hashes supersede the historical values below. The initial review is retained unchanged as release history.

Reviewed on 2026-09-16 at 19:18 UTC by the scoring/schema review agent. The source baseline was commit `18fa6cc23fded410f11f4f194e27e18054ecf48c`; the release-tool corrections listed below were also reviewed in the shared worktree. This review used files only. The separate database owner produced the isolated PostgreSQL 18.6 evidence; this reviewer made no database connection.

**Outcome: the captured catalog is approved for rendering the reviewed release bundle. No unresolved release-wrapper or catalog mismatch was found. This is not production authorization or evidence of production installation.** Full application, integration and capacity results remain separate release requirements.

This agent authored migration 016 earlier in the task. This review independently verifies the other agent's catalog capture and release tooling, and rechecks migration compatibility; it is not a claim of independent authorship review of 016. The implementation review by the other agents is recorded separately in `implementation-review.md`.

## Exact evidence

The real catalog and readable definitions were captured at `2026-09-16T19:14:39.672Z`, on PostgreSQL `180006`, with expected owner `neondb_owner`.

| Item | SHA-256 |
| --- | --- |
| Migration 016, normalized LF | `0106ab529c3c978cfd2a72b8d3628e24660f325ff278d9428758d52367e123aa` |
| Migration 017, normalized LF | `1247dbfbdfbc79f41a448cf3b2e95fb4f9387e951a26f340e9533754e5c9c361` |
| Captured manifest before its review flag was changed | `f556373de208ca6d1ff96e82165d7b509f7c299fa3a36e95767f54f7b85fcb68` |
| `catalog-definitions.integration.json`, file bytes | `5ea7a71f36c71715b815c766e4cf8b570e9a7cb4ceeaadec38d0fcf523ee11ab` |
| `wrapper-verification.integration.json`, captured before review metadata update | `033263dd8af7c5d4509a783c91a2863af7fecf02fc633b3769c65b130ca06734` |
| `wrapper-verification.integration.json`, current file bytes | `357c26bc8e286d034ec536ed6a89f83478f222d5122bd6b4513ab77354121f8c` |
| `JSON.stringify({before: manifest.before, after: manifest.after})` | `9cf03a2d21ea0d97a0f00cc83b75f3d3ce0b47e6af05cd4c726c518f25819ec5` |
| `league-administration-release-wrapper.mjs`, normalized LF | `06e3773242285bf0535acddf26c8eef9011de0cf33ce4306b27fd6a1be661475` |
| `league-administration-catalog.mjs`, normalized LF at database verification | `109b0e8cb949d0738fd5df857e6c9c233d4ea44f37fc2692209afddb5929b6ce` |
| `league-administration-catalog.mjs`, normalized LF after formatting review | `511f10bf87cddea0673a7289bd936e4a22fb981df49cd582c7cada1df03451be` |
| `verify-league-administration-release-wrapper.ts`, normalized LF | `dc437909bf95f3b78e5d27507492852ff09bd97d3a0462c94d5eba5428ff55f0` |
| `render-league-administration-release-wrapper.mjs`, normalized LF | `83ca9f1e0b97510bce03f5c6c11b49552f22c4b446985178aee5ea7afb6e9f2d` |
| Final `016-017.production.sql`, file bytes | `5917776ae1e306df85c80a2a1a05049ee737496811449d55e63ceb3d185b666e` |
| Final `016-017.production.review.sql`, file bytes | `9339f7472af9a6e10d30086f9c8b5022beae8f1e7411cc9ed588ebbe05fbf487` |

The manifest's `reviewed` flag is changed only after this report is written. The before/after catalog payload stays unchanged. A new migration checksum requires a new capture and review.

### Final formatting follow-up

At 19:32 UTC, this reviewer independently checked the final rendering cleanup against the prior staged artifacts. The executable SQL differs on exactly three whitespace-only lines, and the comments-only review copy differs on 39 whitespace-only lines. Each full artifact is identical to its prior rendering after trimming line-ending whitespace. Both embedded migration bodies still contain the exact LF-normalized source text and match the original checksums above. The catalog renderer change removes empty-line indentation; the unaffected catalog query is unchanged. The review-copy renderer trims trailing comment whitespace only.

The captured catalog and readable database definitions are unchanged. The wrapper-verification artifact's only review-related metadata update records the completed review; its nine successful checks are unchanged. The renderer owner reported 11 passing wrapper unit tests, targeted lint and a clean working diff check for this follow-up. No database execution was repeated for this formatting-only change, and no production action was taken. The catalog approval remains valid for the final hashes above.

## Catalog comparison

File-only assertions independently recomputed the accepted checksums for every installed migration 001–015, and both new migration checksums. All matched. Every captured column, constraint and index fingerprint was independently recomputed from the readable definitions and matched the compact manifest.

The actual inventory is 15 new tables, 110 columns, 28 indexes and 186 constraints: 43 CHECK, 26 foreign key, 90 PostgreSQL 18 NOT NULL, 15 primary key and 12 UNIQUE constraints. All captured constraints are validated. The table inventory, ordered columns, types, nullability, defaults and per-table constraint counts were compared to 016. Scoped foreign keys, deduplication keys, nine source families, transaction Week 0, explicit evidenced-period non-null boundaries, and head verification timestamps match the migration.

All 15 tables belong to `neondb_owner`. The runtime role has only SELECT; PUBLIC has no table privileges. The complete table ACL is `{neondb_owner=arwdDxtm/neondb_owner,league_one_runtime=r/neondb_owner}`. No unexpected row-security policies or column grants appeared in the captured fingerprints.

All 11 affected function bodies match their migration source exactly after LF normalization. The nine new functions match 016; the two publication functions match 017. Each readable `pg_get_functiondef` hash matches the manifest. Replacing the two captured publication bodies with their exact 015 bodies reproduces both captured baseline fingerprints, confirming that the pre-migration gate refers to the accepted installed definitions.

All functions belong to `neondb_owner`, revoke PUBLIC execution and set `search_path=pg_catalog, public, pg_temp`. Only `record_league_administration_observation(jsonb)` and the existing nine-argument publication function permit runtime execution. The two immutable-entry/history helpers use invoker security; the remaining affected functions use definer security as declared. Owner remap, annual connection and component activation helpers are not executable by runtime.

All 20 actual noninternal triggers are enabled and their readable definition hashes match: 12 immutable-history triggers, four child-entry sealing triggers and four additions to existing source/observation/publication tables. Their timing, event and function bindings match 016. The source connection recording trigger is AFTER INSERT, preserving ordinary conflict/replay behavior.

## Compatibility and transactional protections

The 015-to-017 function diff changes enrolled membership and its serialization, retaining the prior scoring support, parity, immutable score history, worker-fence, verification-time and pointer-publication checks. Intended membership is exact-season data; a missing intended registration cannot silently reduce the publication group. Existing function signatures and grants remain intact.

Migration 016 seeds new administration tables and adds guards; it does not rewrite existing season scoring bindings, frozen baselines or snapshots. The optional administration lineage checks preserve old callers without that context, while validating new observation and publication lineage under row locks. A changed scoring profile is retained as evidence and cannot silently rebind an existing season. Owner applicability records do not themselves rescore historical results.

The release wrapper checks the exact database, owner, PostgreSQL version, installed 001–015 ledger and baseline catalog, rejects privileged runtime roles and live worker leases, and takes migration and worker-claim locks. Both migrations and ledger entries execute in one migration transaction. Before that transaction commits, the wrapper checks the exact affected catalog, unaffected catalog/ACL/role/default-privilege fingerprints, protected historical row counts and complete 001–017 ledger.

Historical row-count checks are not a byte-for-byte comparison of historical row values. The assurance also depends on the reviewed, checksummed SQL, which contains no migration-time update/delete of those historical records. Neon project and branch identity require the separate fresh service preflight; SQL database/owner checks do not prove a cloud branch identity.

## Finding reproduced and corrected

The initial final success query could falsely report success when a SQL client continued after an already-installed replay failed its precondition: the previously installed ledger and catalog still matched. The database owner reproduced the issue in the isolated database. A per-execution session marker now must survive the successful migration commit before the final query can report success.

The first marker implementation was also challenged using the same previously successful connection. PostgreSQL simple-query batching could roll back the marker clear and restore the prior success marker. The corrected wrapper clears and commits the marker before BEGIN, sets it only after all migration postconditions pass, and checks it alongside database, owner, version, ledger and catalog after COMMIT.

This preliminary COMMIT makes a **fresh dedicated idle connection** an operational requirement. Never run the wrapper in a session with unrelated pending work or reuse an aborted transaction. The generated wrapper, release README and production runbook state this requirement. Within that precondition, the preliminary commit changes only session state; both schema migrations remain atomic in their subsequent transaction.

The concrete `wrapper-verification.integration.json` records nine passing checks, including corrupted-catalog full rollback, the actual valid commit, exact success sentinel, refused installed replay, same-session continue-after-error replay without success and same-session wrong-target failure without success. Its test implementation was inspected; the continued-client checks reuse the successful connection, explicitly end the aborted transaction, and execute the final SELECT again.

## Runbook review and limits

The production runbook orders the compatible schema install before application deployment, performs bounded shadow then authorized write collection from the reviewed revision, and verifies the initial evidence before deploying the new recurring collector. The planned three-league, Weeks 0–2 plus metadata scope is 36 family/period documents. It correctly describes independent family commits and partial completion. Rollback keeps additive history and uses the prior compatible application only while the approved original enrollment and mappings remain unchanged.

The runbook distinguishes a missing sentinel from a proved rollback, preserves the existing production provider failure as separate baseline evidence, and does not claim production health or release authority. Source data collected now cannot reconstruct unobserved past edits. Native league administration, new scoring semantics and historical rescoring remain outside this release.

## Collection-semantics follow-up — 2026-09-16 20:18 UTC

Approved the regenerated catalog for rendering after independently reviewing the release owner’s 11-line SQL correction against commit `9da67a4fe6e9a6e2ac75d1677abe7dc4b34c2f97`. This reviewer made no database connection. A pure synthetic users reproduction confirmed accepted reordered collections have different raw hashes, equal semantic hashes and an `unchanged` pure classification; the previous SQL classified them as changes.

The correction applies semantic comparison only to accepted non-league collections. A raw-different, semantically unchanged capture retains a new immutable observation and provenance, advances its readable raw pointer and valid freshness, and keeps the generation stable. Identical raw content retains the freshness-only fast path. Real material changes and conflict recovery still advance the generation. League lifecycle/counter changes still expose their new raw payload while reusing the unchanged settings version. Stale ordering, unknown-age-cache exact-content gates and equal-time raw conflicts are unchanged.

The three added integration cases were independently inspected for raw content/observation retention, current pointer and provenance, real mutation, stale/cache/equal-time behavior, conflict recovery and raw league operational updates. Their execution and final suite total remain separately recorded by the release owner; source review alone does not claim they ran.

The new real PostgreSQL 180006 capture at `2026-09-16T20:16:08.803Z` was compared with the committed prior catalog. The full baseline, all tables/columns/constraints/indexes/grants, all 20 triggers, and every other affected function are identical. Only `record_league_administration_observation(jsonb)` changes its definition fingerprint, to `79783731c76cdc8041b669b4cd8b6f32`; its captured body exactly matches the corrected migration. All readable definition fingerprints were recomputed and matched. The corrected actual wrapper passed its nine isolated rollback/commit/replay checks again.

| Current evidence | SHA-256 |
| --- | --- |
| Migration 016, normalized LF | `d662d9e9709153a4e9a6cbc93522bdd4d14c5b0a0c74a7c7ea8648455896596c` |
| Migration 017, unchanged normalized LF | `1247dbfbdfbc79f41a448cf3b2e95fb4f9387e951a26f340e9533754e5c9c361` |
| New catalog before its review flag changed | `b26dbd99fdfee8c33f8424fde648c1e7c048a420420e269142e98b32e57c4d2c` |
| New readable definitions, file bytes | `ce1b57a92d26d131ab470f16c222ef56bb37b58e2a810c53209d61119f0ecefb` |
| New wrapper verification before review metadata changed | `bdef65e630d95ffa8f91845838ae438cf821c4138f5c156b879446b8147d5800` |
| JSON.stringify({before: manifest.before, after: manifest.after}) | `a625d37fc33d14103483a7ef7fe717f9e3acd45e228d450a0017c73018e21c18` |
| Expected corrected executable rendering | `f3e710d4f19bd492fe276949bcee240b4bf33cdc37706d7ee4e91507cadb6e07` |
| Expected corrected comments-only rendering | `d87b802b6bb2156067b0f559fa7995bc794a786c027e08f1cbc27207993de8ee` |

The renderer/tooling source hashes from the earlier formatting follow-up remain unchanged. The corrected render hashes were calculated in memory; the release owner must regenerate and compare the actual files. The current manifest is marked reviewed only after the concrete file comparison, and its before/after payload is unchanged by that approval. No unresolved finding remains in this corrective diff or catalog review. This review neither executes a production operation nor substitutes for the separate release authority and execution evidence.

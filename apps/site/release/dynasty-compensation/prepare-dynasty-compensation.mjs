import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Artifact preparation only. This script has no database client or connection.
const artifactRoot = dirname(fileURLToPath(import.meta.url));
const site = join(artifactRoot, '..', '..');
const normalize = (text) => text.replace(/\r\n?/gu, '\n');
const hash = (text) => createHash('sha256').update(text).digest('hex');
const read = async (relative) => normalize(await readFile(join(site, relative), 'utf8'));
const previousManifest = JSON.parse(await read('release/014-catalog.integration.json'));
const manifest = JSON.parse(await read('release/015-catalog.integration.json'));
const forwardSql = await read('migrations/015_all_player_dynasty_publication.sql');
const forwardWrapper = await read('release/015_all_player_dynasty_publication.production.sql');
const { buildAllPlayerDynastyReleaseWrapper, ALL_PLAYER_REPAIR_CHECKSUM } = await import(
  pathToFileURL(join(site, 'scripts', 'all-player-migration-release-wrapper.mjs')).href
);
const installed = await read('migrations/011_all_player_foundation_guards.sql');
if (hash(installed) !== ALL_PLAYER_REPAIR_CHECKSUM || manifest.reviewed !== true
  || previousManifest.reviewed !== true || hash(forwardSql) !== manifest.migrationChecksum
  || forwardWrapper !== buildAllPlayerDynastyReleaseWrapper({
    migrationSql: forwardSql, expectedDatabase: 'neondb', expectedOwner: 'neondb_owner',
    runtimeRole: 'league_one_runtime', previousManifest, manifest,
  })) throw new Error('The reviewed installed sources and executable 015 wrapper must match exactly.');

function position(text, marker, start = 0) {
  const offset = text.indexOf(marker, start);
  if (offset < 0) throw new Error(`Expected reviewed wrapper boundary is absent: ${marker}`);
  return offset;
}
function slice(text, start, end) {
  const from = position(text, start);
  return text.slice(from, position(text, end, from));
}
const restoredFunctions = slice(installed,
  'CREATE OR REPLACE FUNCTION public.all_player_score_set_is_publication_ready(',
  'REVOKE ALL ON FUNCTION public.all_player_score_set_is_publication_ready(uuid,jsonb,uuid)');
const migrationName = '016_all_player_dynasty_publication_compensation.sql';
const migrationSql = `-- Forward compensation for 015, pending separate rollback approval and review.
-- Restores the exact two publication function bodies from installed migration 011.
-- Leaves 001-015, all history, mappings, league registrations and pointers intact.
-- Requires the original two-league application and recurrence disabled beforehand.
-- After approval, commit this exact file as migration 016 before executing its
-- reviewed wrapper. A later reactivation requires another forward migration.

${restoredFunctions}REVOKE ALL ON FUNCTION public.all_player_score_set_is_publication_ready(uuid,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_current_all_player_score_set(text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz) FROM PUBLIC;
`;
const checksum = hash(migrationSql);
const sentinel = `ALL_PLAYER_DYNASTY_COMPENSATION_APPLIED:${migrationName}:${checksum}`;
const beforeBlock = slice(forwardWrapper, 'DO $repair_before$', 'END; $repair_before$;') + 'END; $repair_before$;';
const afterBlock = slice(forwardWrapper, 'DO $repair_after$', 'END; $repair_after$;') + 'END; $repair_after$;';
const identityChecks = slice(beforeBlock, '  IF current_database()', '  IF (SELECT count(*) FROM app_schema_migrations)');
const ownershipChecks = slice(beforeBlock,
  "  IF EXISTS (SELECT 1 FROM pg_roles role WHERE role.rolname <>",
  '  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace');
const historyChecks = slice(afterBlock, '  FOR old_count IN SELECT', 'END; $repair_after$;');
let installedChecks = afterBlock.slice(0, position(afterBlock, '  FOR old_count IN SELECT'));
installedChecks = installedChecks.replace('BEGIN\n', `BEGIN\n${identityChecks}${ownershipChecks}`)
  .replaceAll('$repair_after$', '$compensation_before$') + 'END; $compensation_before$;';

let restoredChecks = beforeBlock.replaceAll('$repair_before$', '$compensation_after$')
  .replace('DECLARE ', 'DECLARE old_count record; ')
  .replace('IF (SELECT count(*) FROM app_schema_migrations) <> 14', 'IF (SELECT count(*) FROM app_schema_migrations) <> 16')
  .replace('expected exactly migrations 001-014', 'expected unchanged migrations 001-015 plus forward compensation 016')
  .replace('END; $compensation_after$;', `
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '${manifest.migrationName}')
    IS DISTINCT FROM '${manifest.migrationChecksum}'
    THEN RAISE EXCEPTION 'compensation assertion failed: unchanged installed 015 checksum'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '${migrationName}')
    IS DISTINCT FROM '${checksum}'
    THEN RAISE EXCEPTION 'compensation assertion failed: exact 016 checksum'; END IF;
${historyChecks}
  IF (SELECT pointers FROM all_player_compensation_before_pointers) IS DISTINCT FROM (
    SELECT COALESCE(jsonb_agg(to_jsonb(pointer) ORDER BY provider,season,season_type,week,scoring_profile_id,scorer_version),'[]'::jsonb)
    FROM public.current_all_player_score_sets pointer
  ) THEN RAISE EXCEPTION 'compensation assertion failed: published pointers changed'; END IF;
END; $compensation_after$;`);
const locking = slice(forwardWrapper, 'BEGIN;\nSET LOCAL', 'DO $repair_before$');
const catalogAndHistoryCapture = forwardWrapper.slice(
  position(forwardWrapper, 'CREATE FUNCTION pg_temp.all_player_release_unaffected_catalog()'),
  position(forwardWrapper, forwardSql.trimEnd()),
);
const wrapper = `-- REVIEW CANDIDATE ONLY: not a current production release authorization.
-- Generated from the exact reviewed 015 production wrapper; no database access.
-- Source 015 checksum: ${manifest.migrationChecksum}
-- Source 015 wrapper SHA256: ${hash(forwardWrapper)}
-- Target restoration catalog: reviewed 014 catalog, with forward ledger entry 016.
-- Execute only after the original two-league application is verified, recurring
-- collection is disabled, all-player owners are drained, fresh service identity
-- is confirmed, and this exact compensation wrapper passes isolated PG18 review.
${locking}${installedChecks}
${catalogAndHistoryCapture}
CREATE TEMP TABLE all_player_compensation_before_pointers ON COMMIT DROP AS
  SELECT COALESCE(jsonb_agg(to_jsonb(pointer) ORDER BY provider,season,season_type,week,scoring_profile_id,scorer_version),'[]'::jsonb) AS pointers
  FROM public.current_all_player_score_sets pointer;
${migrationSql}
INSERT INTO app_schema_migrations(name,checksum) VALUES ('${migrationName}','${checksum}');
${restoredChecks}
COMMIT;
SELECT '${sentinel}' AS success_sentinel;
`;

for (const [label, test] of Object.entries({
  exact_installed_015_assertion: installedChecks.includes("WHERE name = '015_all_player_dynasty_publication.sql'")
    && installedChecks.includes('IF (SELECT count(*) FROM app_schema_migrations) <> 15'),
  forward_016_only: wrapper.match(/INSERT INTO app_schema_migrations\(name,checksum\)/gu)?.length === 1
    && !wrapper.includes('DELETE FROM app_schema_migrations') && !wrapper.includes('UPDATE app_schema_migrations'),
  exact_original_bodies: migrationSql.includes(restoredFunctions),
  no_installed_file_edits: migrationName.startsWith('016_'),
  exact_two_functions: [...migrationSql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/gu)].length === 2,
  publication_enrollment_guard_removed_only_by_restoration: !restoredFunctions.includes("'dynasty'"),
  pg18_only: installedChecks.includes('NOT BETWEEN 180000 AND 189999'),
  no_live_owner: installedChecks.includes('all-player owner is active'),
  explicit_identity: installedChecks.includes("current_database() <> 'neondb'")
    && installedChecks.includes("current_user <> 'neondb_owner'"),
  data_preservation: wrapper.includes('history count changed') && wrapper.includes('published pointers changed'),
  checks_before_ddl: wrapper.indexOf('$compensation_before$') < wrapper.indexOf(migrationSql),
  checks_before_commit: wrapper.indexOf('$compensation_after$;') < wrapper.lastIndexOf('COMMIT;'),
})) if (!test) throw new Error(`Compensation artifact construction failed: ${label}`);

await writeFile(join(artifactRoot, migrationName), migrationSql);
await writeFile(join(artifactRoot, migrationName.replace('.sql', '.production.review.sql')), wrapper);
const evidence = {
  classification: 'Prepared review artifact; no database execution or standalone wrapper integration claimed',
  sourceMigration011Checksum: hash(installed), sourceMigration015Checksum: manifest.migrationChecksum,
  sourceWrapper015Checksum: hash(forwardWrapper),
  beforeCatalogChecksum: hash(JSON.stringify(manifest.catalog)),
  afterCatalogChecksum: hash(JSON.stringify(previousManifest.catalog)),
  forwardCompensationMigration: migrationName, forwardCompensationChecksum: checksum,
  wrapperChecksum: hash(wrapper), sentinel,
  unchangedInstalledLedger: '001-015; append 016 only', expectedDatabase: 'neondb', expectedOwner: 'neondb_owner',
  postgresMajor: 18, runtimeRole: 'league_one_runtime',
  pending: ['Root and independent review', 'Separate rollback authorization',
    'Guarded isolated execution of this exact wrapper and corrupt-assertion rollback proof',
    'Fresh repository, production application, Neon project/branch/database/role, and ownership verification',
    'Commit exact 016 forward migration and reviewed wrapper before production execution'],
};
await writeFile(join(artifactRoot, '015-dynasty-compensation-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

import { ADMINISTRATION_POSTGRES_VERSION, leagueAdministrationCatalogSql, leagueAdministrationDefinitionsSql } from './league-administration-catalog.mjs';
import { ADMINISTRATION_INSTALLED_LEDGER, administrationMigrationChecksum } from './league-administration-release-wrapper.mjs';
import { buildGuardedCatalogReleaseWrapper } from './guarded-catalog-release-wrapper.mjs';

export const PARTIAL_CONTEXT_MIGRATIONS = Object.freeze(['018_all_player_partial_context.sql']);
export const PARTIAL_CONTEXT_INSTALLED_LEDGER = Object.freeze([
  ...ADMINISTRATION_INSTALLED_LEDGER,
  ['016_portable_league_administration.sql', 'd662d9e9709153a4e9a6cbc93522bdd4d14c5b0a0c74a7c7ea8648455896596c'],
  ['017_enrolled_all_player_publication.sql', '1247dbfbdfbc79f41a448cf3b2e95fb4f9387e951a26f340e9533754e5c9c361'],
]);
export const PARTIAL_CONTEXT_FUNCTIONS = Object.freeze([
  'validate_all_player_stat_entry()', 'finish_all_player_job(jsonb,text,jsonb)',
]);
const scope = Object.freeze({ tables: [], triggers: [], functions: PARTIAL_CONTEXT_FUNCTIONS });
export const partialContextCatalogSql = (input = {}) => leagueAdministrationCatalogSql({ ...input, scope });
export const partialContextDefinitionsSql = () => leagueAdministrationDefinitionsSql(scope);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export function partialContextReleaseSentinel(migrations) {
  return 'ALL_PLAYER_PARTIAL_CONTEXT_APPLIED:' + migrations.map(({ name, sql }) => name + ':' + administrationMigrationChecksum(sql)).join('|');
}
export function validatePartialContextReleaseManifest(manifest, migrations, expectedOwner) {
  if (!manifest || manifest.format !== 'all-player-partial-context-release-v1' || manifest.reviewed !== true
    || manifest.postgresVersion !== ADMINISTRATION_POSTGRES_VERSION || manifest.expectedOwner !== expectedOwner) {
    throw new Error('A reviewed PostgreSQL 180006 partial-context manifest with the exact owner is required.');
  }
  if (!Array.isArray(migrations) || migrations.length !== 1 || migrations[0].name !== PARTIAL_CONTEXT_MIGRATIONS[0]
    || !Array.isArray(manifest.migrations) || manifest.migrations.length !== 1
    || manifest.migrations[0].name !== migrations[0].name
    || manifest.migrations[0].checksum !== administrationMigrationChecksum(migrations[0].sql)) {
    throw new Error('Exactly migration 018 with its captured checksum is required.');
  }
  if (!Array.isArray(manifest.protectedTables) || manifest.protectedTables.length < 28
    || manifest.protectedTables.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/u.test(name))
    || new Set(manifest.protectedTables).size !== manifest.protectedTables.length
    || !['all_player_stat_entries','current_all_player_score_sets','league_administration_heads','projection_jobs']
      .every(name => manifest.protectedTables.includes(name))
    || !Array.isArray(manifest.unaffectedConstraintTypes)
    || !manifest.unaffectedConstraintTypes.some(([kind, count]) => kind === 'n' && Number.isSafeInteger(count) && count > 0)) {
    throw new Error('The complete protected table and PostgreSQL 180006 constraint inventories are required.');
  }
  for (const catalog of [manifest.before, manifest.after]) {
    if (!catalog || !Array.isArray(catalog.tables) || catalog.tables.length !== 0
      || !Array.isArray(catalog.triggers) || catalog.triggers.length !== 0
      || !Array.isArray(catalog.constraintTypes) || catalog.constraintTypes.length !== 0
      || !Array.isArray(catalog.functions) || !same(catalog.functions.map(row => row.signature), PARTIAL_CONTEXT_FUNCTIONS)) {
      throw new Error('Migration 018 must affect exactly its two existing functions.');
    }
    for (const fn of catalog.functions) {
      if (fn.owner !== expectedOwner || fn.securityDefiner !== true || fn.publicExecute !== false
        || fn.runtimeExecute !== (fn.signature === 'finish_all_player_job(jsonb,text,jsonb)')
        || !/^[0-9a-f]{32}$/u.test(fn.definitionHash) || !Array.isArray(fn.configuration)
        || !fn.configuration.some(item => item.replaceAll(' ', '') === 'search_path=pg_catalog,public,pg_temp')) {
        throw new Error('Migration 018 ownership, definer search path or least-privilege function contract changed.');
      }
    }
  }
  for (const before of manifest.before.functions) {
    const after = manifest.after.functions.find(row => row.signature === before.signature);
    const metadata = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'definitionHash').sort(([a], [b]) => a.localeCompare(b)));
    if (JSON.stringify(metadata(before)) !== JSON.stringify(metadata(after))) {
      throw new Error('Migration 018 may change function bodies only, preserving owner, ACL and configuration.');
    }
  }
}
export function buildAllPlayerPartialContextReleaseWrapper({ migrations, expectedDatabase, expectedOwner,
  runtimeRole = 'league_one_runtime', manifest }) {
  validatePartialContextReleaseManifest(manifest, migrations, expectedOwner);
  return buildGuardedCatalogReleaseWrapper({ migrations, expectedDatabase, expectedOwner, runtimeRole, manifest,
    installedLedger: PARTIAL_CONTEXT_INSTALLED_LEDGER, catalogSql: partialContextCatalogSql,
    historyTables: manifest.protectedTables, release: {
      key: 'partial_context', marker: 'league_one.partial_context_release_committed',
      title: 'Reviewed all-player partial-context repair', installedLabel: '001-017', catalogLabel: '017',
      postgresVersion: ADMINISTRATION_POSTGRES_VERSION, sentinel: partialContextReleaseSentinel(migrations),
    } });
}
export function requirePartialContextReleaseSentinel(rows, migrations) {
  const sentinel = partialContextReleaseSentinel(migrations);
  if (!rows.some(row => row.success_sentinel === sentinel)) throw new Error('Partial-context success sentinel missing; inspect ledger and catalog before retrying.');
  return sentinel;
}


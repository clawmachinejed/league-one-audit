import { ADMINISTRATION_POSTGRES_VERSION, leagueAdministrationCatalogSql, leagueAdministrationDefinitionsSql } from './league-administration-catalog.mjs';
import { administrationMigrationChecksum } from './league-administration-release-wrapper.mjs';
import { PARTIAL_CONTEXT_INSTALLED_LEDGER } from './all-player-partial-context-release-wrapper.mjs';
import { buildGuardedCatalogReleaseWrapper } from './guarded-catalog-release-wrapper.mjs';

export const LIVE_DEFENSE_MIGRATIONS = Object.freeze(['019_live_defense_weekly_statistics.sql']);
export const LIVE_DEFENSE_INSTALLED_LEDGER = Object.freeze([
  ...PARTIAL_CONTEXT_INSTALLED_LEDGER,
  ['018_all_player_partial_context.sql', 'd8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc'],
]);
export const LIVE_DEFENSE_REPLACED_FUNCTIONS = Object.freeze([
  'assert_all_player_job_fence(jsonb,jsonb,boolean)',
  'claim_all_player_job(text,jsonb,text,integer,timestamp with time zone)',
  'mark_all_player_request(jsonb,jsonb)',
  'finish_all_player_job(jsonb,text,jsonb)',
]);
export const LIVE_DEFENSE_NEW_FUNCTIONS = Object.freeze([
  'weekly_stat_next_request_at(jsonb,timestamp with time zone)',
  'live_weekly_stat_period_is_current(jsonb)',
  'weekly_stat_receipt_is_valid(jsonb,jsonb,integer)',
  'claim_weekly_stat_job(text,jsonb,text,integer,timestamp with time zone,jsonb)',
  'claim_live_defense_stat_job(jsonb,text,integer,timestamp with time zone)',
  'claim_shared_all_player_job(jsonb,text,integer,timestamp with time zone,jsonb)',
  'finish_live_defense_stat_request(jsonb,text,jsonb)',
]);
export const LIVE_DEFENSE_FUNCTIONS = Object.freeze([...LIVE_DEFENSE_REPLACED_FUNCTIONS, ...LIVE_DEFENSE_NEW_FUNCTIONS]);
export const LIVE_DEFENSE_RUNTIME_FUNCTIONS = Object.freeze([...LIVE_DEFENSE_REPLACED_FUNCTIONS,
  'claim_live_defense_stat_job(jsonb,text,integer,timestamp with time zone)',
  'claim_shared_all_player_job(jsonb,text,integer,timestamp with time zone,jsonb)',
  'finish_live_defense_stat_request(jsonb,text,jsonb)',
]);
const scope = Object.freeze({ tables: [], triggers: [], functions: LIVE_DEFENSE_FUNCTIONS });
export const liveDefenseCatalogSql = (input = {}) => leagueAdministrationCatalogSql({ ...input, scope });
export const liveDefenseDefinitionsSql = () => leagueAdministrationDefinitionsSql(scope);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export function liveDefenseReleaseSentinel(migrations) {
  return 'LIVE_DEFENSE_WEEKLY_STATISTICS_APPLIED:' + migrations.map(({ name, sql }) => name + ':' + administrationMigrationChecksum(sql)).join('|');
}
export function validateLiveDefenseReleaseManifest(manifest, migrations, expectedOwner) {
  if (!manifest || manifest.format !== 'live-defense-release-v1' || manifest.reviewed !== true
    || manifest.postgresVersion !== ADMINISTRATION_POSTGRES_VERSION || manifest.expectedOwner !== expectedOwner) {
    throw new Error('A reviewed PostgreSQL 180006 live-defense manifest with the exact owner is required.');
  }
  if (!Array.isArray(migrations) || migrations.length !== 1 || migrations[0].name !== LIVE_DEFENSE_MIGRATIONS[0]
    || !Array.isArray(manifest.migrations) || manifest.migrations.length !== 1
    || manifest.migrations[0].name !== migrations[0].name
    || manifest.migrations[0].checksum !== administrationMigrationChecksum(migrations[0].sql)) {
    throw new Error('Exactly migration 019 with its captured checksum is required.');
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
  for (const [catalog, signatures] of [[manifest.before, LIVE_DEFENSE_REPLACED_FUNCTIONS], [manifest.after, LIVE_DEFENSE_FUNCTIONS]]) {
    if (!catalog || !Array.isArray(catalog.tables) || catalog.tables.length !== 0
      || !Array.isArray(catalog.triggers) || catalog.triggers.length !== 0
      || !Array.isArray(catalog.constraintTypes) || catalog.constraintTypes.length !== 0
      || !Array.isArray(catalog.functions) || !same(catalog.functions.map(row => row.signature), signatures)) {
      throw new Error('Migration 019 must affect exactly four existing and seven new functions.');
    }
    for (const fn of catalog.functions) {
      const runtime = LIVE_DEFENSE_RUNTIME_FUNCTIONS.includes(fn.signature);
      if (fn.owner !== expectedOwner || fn.securityDefiner !== runtime || fn.publicExecute !== false
        || fn.runtimeExecute !== runtime || !/^[0-9a-f]{32}$/u.test(fn.definitionHash) || !Array.isArray(fn.configuration)
        || !fn.configuration.some(item => item.replaceAll(' ', '') === 'search_path=pg_catalog,public,pg_temp')) {
        throw new Error('Migration 019 ownership, search path or least-privilege function contract changed.');
      }
    }
  }
  for (const before of manifest.before.functions) {
    const after = manifest.after.functions.find(row => row.signature === before.signature);
    const metadata = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'definitionHash').sort(([a], [b]) => a.localeCompare(b)));
    if (JSON.stringify(metadata(before)) !== JSON.stringify(metadata(after))) {
      throw new Error('Migration 019 must preserve existing function metadata and permissions.');
    }
  }
}
export function buildLiveDefenseReleaseWrapper({ migrations, expectedDatabase, expectedOwner,
  runtimeRole = 'league_one_runtime', manifest }) {
  validateLiveDefenseReleaseManifest(manifest, migrations, expectedOwner);
  return buildGuardedCatalogReleaseWrapper({ migrations, expectedDatabase, expectedOwner, runtimeRole, manifest,
    installedLedger: LIVE_DEFENSE_INSTALLED_LEDGER, catalogSql: liveDefenseCatalogSql,
    historyTables: manifest.protectedTables, release: {
      key: 'live_defense', marker: 'league_one.live_defense_release_committed',
      title: 'Reviewed shared live defense statistics', installedLabel: '001-018', catalogLabel: '018',
      postgresVersion: ADMINISTRATION_POSTGRES_VERSION, sentinel: liveDefenseReleaseSentinel(migrations),
    } });
}
export function requireLiveDefenseReleaseSentinel(rows, migrations) {
  const sentinel = liveDefenseReleaseSentinel(migrations);
  if (!rows.some(row => row.success_sentinel === sentinel)) throw new Error('Live-defense success sentinel missing; inspect ledger and catalog before retrying.');
  return sentinel;
}

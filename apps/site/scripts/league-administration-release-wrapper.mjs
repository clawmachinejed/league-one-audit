import { createHash } from 'node:crypto';
import { buildGuardedCatalogReleaseWrapper } from './guarded-catalog-release-wrapper.mjs';
import { ACCEPTED_PREVIOUS_MIGRATIONS, ALL_PLAYER_MIGRATION_CHECKSUM, ALL_PLAYER_REPAIR_CHECKSUM,
  ALL_PLAYER_PARTICIPATION_CHECKSUM, ALL_PLAYER_PARTICIPATION_ASSUMPTION_CHECKSUM, ALL_PLAYER_HOURLY_CHECKSUM,
} from './all-player-migration-release-wrapper.mjs';
import { ADMINISTRATION_POSTGRES_VERSION, ADMINISTRATION_TABLES, ADMINISTRATION_NEW_FUNCTIONS,
  ADMINISTRATION_REPLACED_FUNCTIONS, ADMINISTRATION_EXISTING_TABLE_TRIGGERS,
  leagueAdministrationCatalogSql } from './league-administration-catalog.mjs';

export const ADMINISTRATION_MIGRATIONS = Object.freeze([
  '016_portable_league_administration.sql', '017_enrolled_all_player_publication.sql',
]);
export const ADMINISTRATION_INSTALLED_LEDGER = Object.freeze([
  ...ACCEPTED_PREVIOUS_MIGRATIONS,
  ['010_all_player_statistics.sql', ALL_PLAYER_MIGRATION_CHECKSUM],
  ['011_all_player_foundation_guards.sql', ALL_PLAYER_REPAIR_CHECKSUM],
  ['012_all_player_provider_participation.sql', ALL_PLAYER_PARTICIPATION_CHECKSUM],
  ['013_all_player_participation_assumption.sql', ALL_PLAYER_PARTICIPATION_ASSUMPTION_CHECKSUM],
  ['014_all_player_hourly_collection.sql', ALL_PLAYER_HOURLY_CHECKSUM],
  ['015_all_player_dynasty_publication.sql', 'f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a'],
]);

export function administrationMigrationChecksum(value) {
  return createHash('sha256').update(value.replace(/\r\n?/gu, '\n')).digest('hex');
}

const sorted = (values) => [...values].sort();
const same = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

export function validateAdministrationReleaseManifest(manifest, migrations, expectedOwner) {
  if (!manifest || manifest.format !== 'league-administration-release-v1'
    || manifest.postgresVersion !== ADMINISTRATION_POSTGRES_VERSION || manifest.reviewed !== true
    || manifest.expectedOwner !== expectedOwner
    || !Array.isArray(manifest.migrations) || manifest.migrations.length !== 2) {
    throw new Error('A reviewed PostgreSQL 180006 administration catalog with the exact owner is required.');
  }
  if (!Array.isArray(migrations) || migrations.length !== 2) throw new Error('Exactly migrations 016 and 017 are required.');
  migrations.forEach((migration, index) => {
    if (migration.name !== ADMINISTRATION_MIGRATIONS[index] || typeof migration.sql !== 'string'
      || manifest.migrations[index]?.name !== migration.name
      || manifest.migrations[index]?.checksum !== administrationMigrationChecksum(migration.sql)) {
      throw new Error('Administration release migration name, order, or checksum does not match its capture.');
    }
  });
  const before = manifest.before;
  const after = manifest.after;
  if (!before || !after || !Array.isArray(before.tables) || before.tables.length !== 0
    || !Array.isArray(before.triggers) || before.triggers.length !== 0
    || !Array.isArray(before.functions) || !same(before.functions.map((row) => row.signature), ADMINISTRATION_REPLACED_FUNCTIONS)
    || !Array.isArray(after.tables) || !same(after.tables.map((row) => row.name), ADMINISTRATION_TABLES)
    || !Array.isArray(after.functions) || !same(after.functions.map((row) => row.signature), [...ADMINISTRATION_NEW_FUNCTIONS, ...ADMINISTRATION_REPLACED_FUNCTIONS])
    || !Array.isArray(after.triggers) || !after.triggers.length
    || !ADMINISTRATION_EXISTING_TABLE_TRIGGERS.every((key) => after.triggers.some((row) => row.key === key))
    || !Array.isArray(after.constraintTypes) || !after.constraintTypes.some(([kind, count]) => kind === 'n' && count > 0)) {
    throw new Error('Administration capture has an unexpected table, function, trigger, or PostgreSQL 18 constraint inventory.');
  }
  const allowedRuntimeFunctions = new Set([
    'record_league_administration_observation(jsonb)',
    'advance_current_all_player_score_set(text,smallint,text,smallint,uuid,text,uuid,uuid,timestamp with time zone)',
  ]);
  for (const row of after.tables) {
    if (row.owner !== expectedOwner || !same(row.runtimePrivileges ?? [], ['SELECT'])
      || (row.publicPrivileges ?? []).length !== 0) {
      throw new Error('Administration table ownership or least-privilege grants do not match the reviewed contract.');
    }
  }
  for (const row of after.functions) {
    if (row.owner !== expectedOwner || row.publicExecute !== false
      || row.runtimeExecute !== allowedRuntimeFunctions.has(row.signature)
      || !/^[0-9a-f]{32}$/u.test(row.definitionHash)
      || !Array.isArray(row.configuration) || !row.configuration.some((entry) => entry.replaceAll(' ', '') === 'search_path=pg_catalog,public,pg_temp')) {
      throw new Error('Administration function ownership, body, or least-privilege grants do not match the reviewed contract.');
    }
  }
}

export function administrationReleaseSentinel(migrations) {
  const bundle = migrations.map(({ name, sql }) => `${name}:${administrationMigrationChecksum(sql)}`).join('|');
  return `LEAGUE_ADMINISTRATION_APPLIED:${bundle}`;
}

const protectedHistoryTables = [
  'scoring_profiles', 'league_seasons', 'league_source_connections',
  'league_week_observations', 'projection_snapshots', 'pregame_projection_baselines',
  'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations',
  'all_player_score_sets', 'all_player_scores', 'all_player_score_verifications', 'current_all_player_score_sets',
];

/** Render only: execution is a separate, explicitly authorized release action. */
export function buildLeagueAdministrationReleaseWrapper({ migrations, expectedDatabase, expectedOwner,
  runtimeRole = 'league_one_runtime', manifest }) {
  if (typeof expectedDatabase !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(expectedDatabase)
    || typeof expectedOwner !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(expectedOwner)
    || runtimeRole !== 'league_one_runtime') throw new Error('Explicit database, owner and canonical runtime-role identities are required.');
  validateAdministrationReleaseManifest(manifest, migrations, expectedOwner);
  return buildGuardedCatalogReleaseWrapper({ migrations, expectedDatabase, expectedOwner, runtimeRole, manifest,
    installedLedger: ADMINISTRATION_INSTALLED_LEDGER, catalogSql: leagueAdministrationCatalogSql,
    historyTables: protectedHistoryTables, release: { key: 'administration', marker: 'league_one.administration_release_committed',
      title: 'Reviewed portable league administration bundle', installedLabel: '001-015', catalogLabel: '015',
      postgresVersion: ADMINISTRATION_POSTGRES_VERSION, sentinel: administrationReleaseSentinel(migrations) } });
}

export function requireAdministrationReleaseSentinel(rows, migrations) {
  const sentinel = administrationReleaseSentinel(migrations);
  if (!rows.some((row) => row.success_sentinel === sentinel)) {
    throw new Error('Administration release success sentinel is missing; inspect ledger and catalog before retrying.');
  }
  return sentinel;
}

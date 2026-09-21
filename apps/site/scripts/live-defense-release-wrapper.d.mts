import type { AdministrationCatalog, AdministrationReleaseMigration } from './league-administration-release-wrapper.mjs';
export type LiveDefenseReleaseManifest = {
  format: 'live-defense-release-v1'; postgresVersion: number; expectedOwner: string;
  observedAt: string; reviewed: boolean; migrations: { name: string; checksum: string }[];
  before: AdministrationCatalog; after: AdministrationCatalog;
  protectedTables: string[]; unaffectedConstraintTypes: [string, number][];
};
export const LIVE_DEFENSE_MIGRATIONS: readonly string[];
export const LIVE_DEFENSE_INSTALLED_LEDGER: readonly (readonly [string, string])[];
export const LIVE_DEFENSE_FUNCTIONS: readonly string[];
export const LIVE_DEFENSE_REPLACED_FUNCTIONS: readonly string[];
export const LIVE_DEFENSE_NEW_FUNCTIONS: readonly string[];
export const LIVE_DEFENSE_RUNTIME_FUNCTIONS: readonly string[];
export function liveDefenseCatalogSql(input?: { affected?: boolean; runtimeRole?: string }): string;
export function liveDefenseDefinitionsSql(): string;
export function liveDefenseReleaseSentinel(migrations: readonly AdministrationReleaseMigration[]): string;
export function validateLiveDefenseReleaseManifest(manifest: LiveDefenseReleaseManifest,
  migrations: readonly AdministrationReleaseMigration[], expectedOwner: string): void;
export function buildLiveDefenseReleaseWrapper(input: {
  migrations: readonly AdministrationReleaseMigration[]; expectedDatabase: string; expectedOwner: string;
  runtimeRole?: string; manifest: LiveDefenseReleaseManifest;
}): string;
export function requireLiveDefenseReleaseSentinel(rows: readonly Record<string, unknown>[],
  migrations: readonly AdministrationReleaseMigration[]): string;

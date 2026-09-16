import type { AdministrationCatalog, AdministrationReleaseMigration } from './league-administration-release-wrapper.mjs';
export type PartialContextReleaseManifest = {
  format: 'all-player-partial-context-release-v1'; postgresVersion: number; expectedOwner: string;
  observedAt: string; reviewed: boolean; migrations: { name: string; checksum: string }[];
  before: AdministrationCatalog; after: AdministrationCatalog;
  protectedTables: string[]; unaffectedConstraintTypes: [string, number][];
};
export const PARTIAL_CONTEXT_MIGRATIONS: readonly string[];
export const PARTIAL_CONTEXT_INSTALLED_LEDGER: readonly (readonly [string, string])[];
export const PARTIAL_CONTEXT_FUNCTIONS: readonly string[];
export function partialContextCatalogSql(input?: { affected?: boolean; runtimeRole?: string }): string;
export function partialContextDefinitionsSql(): string;
export function partialContextReleaseSentinel(migrations: readonly AdministrationReleaseMigration[]): string;
export function validatePartialContextReleaseManifest(manifest: PartialContextReleaseManifest,
  migrations: readonly AdministrationReleaseMigration[], expectedOwner: string): void;
export function buildAllPlayerPartialContextReleaseWrapper(input: {
  migrations: readonly AdministrationReleaseMigration[]; expectedDatabase: string; expectedOwner: string;
  runtimeRole?: string; manifest: PartialContextReleaseManifest;
}): string;
export function requirePartialContextReleaseSentinel(rows: readonly Record<string, unknown>[],
  migrations: readonly AdministrationReleaseMigration[]): string;


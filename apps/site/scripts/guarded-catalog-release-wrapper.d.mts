import type { AdministrationCatalog, AdministrationReleaseMigration } from './league-administration-release-wrapper.mjs';
export function buildGuardedCatalogReleaseWrapper(input: {
  migrations: readonly AdministrationReleaseMigration[]; expectedDatabase: string; expectedOwner: string; runtimeRole: string;
  manifest: { reviewed: boolean; expectedOwner: string; postgresVersion: number; before: AdministrationCatalog; after: AdministrationCatalog;
    protectedTables?: readonly string[]; unaffectedConstraintTypes?: [string, number][] };
  installedLedger: readonly (readonly [string, string])[];
  catalogSql: (input: { affected?: boolean; runtimeRole?: string }) => string;
  historyTables: readonly string[];
  release: { key: string; title: string; installedLabel: string; catalogLabel: string; marker: string; sentinel: string; postgresVersion: number };
}): string;

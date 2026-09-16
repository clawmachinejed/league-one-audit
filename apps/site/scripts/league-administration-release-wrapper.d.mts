export type AdministrationCatalogTable = {
  name: string; kind: string; owner: string; acl: string; rls: boolean; forceRls: boolean;
  runtimePrivileges: string[] | null; publicPrivileges: string[]; columns: number; columnHash: string;
  constraints: number; notNullConstraints: number; constraintHash: string; indexes: number; indexHash: string;
  policyHash: string;
};
export type AdministrationCatalogFunction = {
  signature: string; definitionHash: string; owner: string; securityDefiner: boolean;
  configuration: string[] | null; acl: string; runtimeExecute: boolean; publicExecute: boolean;
};
export type AdministrationCatalogTrigger = { key: string; function: string; enabled: string; definitionHash: string };
export type AdministrationCatalog = {
  tables: AdministrationCatalogTable[];
  constraintTypes: [string, number][];
  functions: AdministrationCatalogFunction[];
  triggers: AdministrationCatalogTrigger[];
  [key: string]: unknown;
};
export type AdministrationReleaseManifest = {
  format: 'league-administration-release-v1'; postgresVersion: number; expectedOwner: string;
  observedAt: string; reviewed: boolean; migrations: { name: string; checksum: string }[];
  before: AdministrationCatalog; after: AdministrationCatalog;
};
export type AdministrationReleaseMigration = { name: string; sql: string };
export type AdministrationReleaseWrapperInput = {
  migrations: readonly AdministrationReleaseMigration[]; expectedDatabase: string; expectedOwner: string;
  runtimeRole?: string; manifest: AdministrationReleaseManifest;
};
export const ADMINISTRATION_MIGRATIONS: readonly string[];
export const ADMINISTRATION_INSTALLED_LEDGER: readonly (readonly [string, string])[];
export function administrationMigrationChecksum(value: string): string;
export function validateAdministrationReleaseManifest(manifest: AdministrationReleaseManifest,
  migrations: readonly AdministrationReleaseMigration[], expectedOwner: string): void;
export function administrationReleaseSentinel(migrations: readonly AdministrationReleaseMigration[]): string;
export function buildLeagueAdministrationReleaseWrapper(input: AdministrationReleaseWrapperInput): string;
export function requireAdministrationReleaseSentinel(rows: readonly Record<string, unknown>[], migrations: readonly AdministrationReleaseMigration[]): string;

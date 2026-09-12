export type ReviewedTable = [
  name: string,
  columnCount: number,
  columnFingerprint: string,
  constraintCount: number,
  notNullCount: number,
  constraintFingerprint: string,
  indexCount: number,
  indexFingerprint: string,
  runtimeInsert: boolean,
  ownerOverride?: string,
];

export type ReviewedCatalog = {
  tables: ReviewedTable[];
  constraintTypes: [type: string, count: number][];
  triggers: [name: string, table: string, functionName: string, fingerprint: string][];
  functions: [
    name: string,
    identityArguments: string,
    fingerprint: string,
    runtimeExecute: boolean,
  ][];
};

export const ALL_PLAYER_MIGRATION_NAME: string;
export const ALL_PLAYER_MIGRATION_CHECKSUM: string;
export const ALL_PLAYER_MIGRATION_SENTINEL: string;
export const ACCEPTED_PREVIOUS_MIGRATIONS: readonly (readonly [string, string])[];
export const REVIEWED_ALL_PLAYER_CATALOG: Readonly<ReviewedCatalog>;
export function normalizeMigrationText(value: string): string;
export function releaseWrapperSha256(value: string): string;
export function cloneReviewedCatalog(): ReviewedCatalog;
export function buildAllPlayerMigrationReleaseWrapper(input: {
  migrationSql: string;
  expectedDatabase: string;
  expectedOwner: string;
  runtimeRole?: string;
  catalog?: ReviewedCatalog;
}): string;
export function requireAllPlayerMigrationSentinel(
  rows: readonly Readonly<Record<string, unknown>>[],
): string;
export type AllPlayerRepairManifest = {
  migrationName: string;
  migrationChecksum: string;
  postgresMajor: number;
  reviewed: boolean;
  catalog: ReviewedCatalog;
};
export function buildAllPlayerRepairReleaseWrapper(input: {
  migrationSql: string;
  expectedDatabase: string;
  expectedOwner: string;
  runtimeRole?: string;
  manifest: AllPlayerRepairManifest;
}): string;

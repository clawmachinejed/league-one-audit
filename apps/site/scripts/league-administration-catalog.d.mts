export const ADMINISTRATION_POSTGRES_VERSION: number;
export const ADMINISTRATION_TABLES: readonly string[];
export const ADMINISTRATION_NEW_FUNCTIONS: readonly string[];
export const ADMINISTRATION_REPLACED_FUNCTIONS: readonly string[];
export const ADMINISTRATION_EXISTING_TABLE_TRIGGERS: readonly string[];
export function sqlLiteral(value: unknown): string;
export type CatalogScope = { tables?: readonly string[]; functions?: readonly string[]; triggers?: readonly string[] };
export function leagueAdministrationDefinitionsSql(scope?: CatalogScope): string;
export function leagueAdministrationCatalogSql(input?: { affected?: boolean; runtimeRole?: string; scope?: CatalogScope }): string;

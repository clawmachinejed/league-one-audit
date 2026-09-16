export const ADMINISTRATION_POSTGRES_VERSION: number;
export const ADMINISTRATION_TABLES: readonly string[];
export const ADMINISTRATION_NEW_FUNCTIONS: readonly string[];
export const ADMINISTRATION_REPLACED_FUNCTIONS: readonly string[];
export const ADMINISTRATION_EXISTING_TABLE_TRIGGERS: readonly string[];
export function sqlLiteral(value: unknown): string;
export function leagueAdministrationDefinitionsSql(): string;
export function leagueAdministrationCatalogSql(input?: { affected?: boolean; runtimeRole?: string }): string;

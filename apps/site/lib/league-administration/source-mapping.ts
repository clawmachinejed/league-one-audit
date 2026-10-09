import type { AdministrationSourceMapping } from './contracts';
export type { AdministrationSourceMapping } from './contracts';

export function isAdministrationSourceMapping(value: unknown): value is AdministrationSourceMapping {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const uuid = (id: unknown) => typeof id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const text = (input: unknown) => typeof input === 'string' && input.length > 0
    && input.trim() === input && !/[\x00-\x1f\x7f]/.test(input);
  if (!row.scope || typeof row.scope !== 'object') return false;
  const scope = row.scope as Record<string, unknown>;
  return uuid(row.connectionId) && uuid(row.leagueSeasonId) && uuid(row.revisionId)
    && Number.isSafeInteger(row.generation) && Number(row.generation) > 0
    && scope.provider === 'sleeper' && text(scope.leagueKey) && text(scope.externalLeagueId)
    && Number.isInteger(scope.season) && Number(scope.season) >= 1920 && Number(scope.season) <= 2200;
}

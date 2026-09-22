export class AccountInputError extends Error {
  constructor(message = 'Invalid account request.') { super(message); this.name = 'AccountInputError'; }
}
export function accountUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AccountInputError('Invalid identifier.');
  return value.toLowerCase();
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new AccountInputError();
  return value as Record<string, unknown>;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new AccountInputError('A current revision is required.');
  return value;
}
export function profileInput(value: unknown): { displayName: string; revision: number } {
  const input = object(value, ['displayName', 'revision']);
  if (typeof input.displayName !== 'string') throw new AccountInputError();
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 100 || /[\x00-\x1f\x7f]/.test(displayName)) throw new AccountInputError('Use a display name between 1 and 100 characters.');
  return { displayName, revision: revision(input.revision) };
}
export function providerLinkInput(value: unknown): { sourceManagerAccountId: string } {
  const input = object(value, ['sourceManagerAccountId']);
  return { sourceManagerAccountId: accountUuid(input.sourceManagerAccountId) };
}
export function deleteInput(value: unknown): { revision: number } {
  return { revision: revision(object(value, ['revision']).revision) };
}
export function savedLeagueInput(value: unknown): { favorite: boolean; sortPosition: number; preferredSeasonTeamId: string | null; revision: number | null } {
  const input = object(value, ['favorite', 'sortPosition', 'preferredSeasonTeamId', 'revision']);
  if (typeof input.favorite !== 'boolean' || typeof input.sortPosition !== 'number' || !Number.isInteger(input.sortPosition)
    || input.sortPosition < 0 || input.sortPosition > 1_000_000) throw new AccountInputError();
  return { favorite: input.favorite, sortPosition: input.sortPosition,
    preferredSeasonTeamId: input.preferredSeasonTeamId === null ? null : accountUuid(input.preferredSeasonTeamId),
    revision: input.revision === null ? null : revision(input.revision) };
}

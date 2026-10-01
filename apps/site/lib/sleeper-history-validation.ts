import type { SleeperLeague, SleeperRoster, SleeperUser } from './transform';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalRecord(value: unknown): boolean {
  return value === undefined || value === null || isRecord(value);
}

export function isStringArray(value: unknown): boolean {
  return value === undefined || value === null
    || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

export function isSleeperCoOwners(value: unknown): value is string[] | null | undefined {
  return value === undefined || value === null
    || (Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0 && item === item.trim())
      && new Set(value).size === value.length);
}

function validRosterSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!['wins', 'losses', 'ties'].every((field) => {
    const count = value[field];
    return typeof count === 'number' && Number.isInteger(count) && count >= 0;
  })) return false;
  if (typeof value.fpts !== 'number' || !Number.isFinite(value.fpts)) return false;
  const games = Number(value.wins) + Number(value.losses) + Number(value.ties);
  if (games > 0 && (typeof value.fpts_against !== 'number' || !Number.isFinite(value.fpts_against))) return false;
  return ['fpts_decimal', 'fpts_against', 'fpts_against_decimal']
    .every((field) => value[field] === undefined
      || (typeof value[field] === 'number' && Number.isFinite(value[field])));
}

function validRosterViewSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!['wins', 'losses', 'ties'].every((field) => {
    const count = value[field];
    return typeof count === 'number' && Number.isInteger(count) && count >= 0;
  })) return false;
  return typeof value.fpts === 'number' && Number.isFinite(value.fpts)
    && (value.fpts_decimal === undefined
      || (typeof value.fpts_decimal === 'number' && Number.isFinite(value.fpts_decimal)));
}

export function isSleeperRoster(value: unknown): value is SleeperRoster {
  return isRecord(value) && typeof value.roster_id === 'number' && Number.isInteger(value.roster_id)
    && value.roster_id > 0 && isOptionalString(value.owner_id)
    && isSleeperCoOwners(value.co_owners)
    && isStringArray(value.players) && isStringArray(value.starters)
    && isStringArray(value.reserve) && isStringArray(value.taxi)
    && validRosterSettings(value.settings) && isOptionalRecord(value.metadata);
}

export function isSleeperRosterForRosterView(value: unknown): value is SleeperRoster {
  return isRecord(value) && typeof value.roster_id === 'number' && Number.isInteger(value.roster_id)
    && value.roster_id > 0 && isOptionalString(value.owner_id)
    && isSleeperCoOwners(value.co_owners)
    && isStringArray(value.players) && isStringArray(value.starters)
    && isStringArray(value.reserve) && isStringArray(value.taxi)
    && validRosterViewSettings(value.settings) && isOptionalRecord(value.metadata);
}

export function isSleeperUser(value: unknown): value is SleeperUser {
  return isRecord(value) && typeof value.user_id === 'string' && Boolean(value.user_id.trim())
    && isOptionalString(value.display_name) && isOptionalString(value.username)
    && isOptionalString(value.avatar) && isOptionalRecord(value.metadata);
}

export function isSleeperLeague(value: unknown): value is SleeperLeague {
  return isRecord(value) && typeof value.league_id === 'string' && Boolean(value.league_id.trim())
    && typeof value.name === 'string' && Boolean(value.name.trim())
    && typeof value.season === 'string' && /^\d{4}$/u.test(value.season)
    && ['pre_draft', 'drafting', 'in_season', 'complete'].includes(String(value.status))
    && typeof value.total_rosters === 'number' && Number.isInteger(value.total_rosters) && value.total_rosters > 0
    && Array.isArray(value.roster_positions) && value.roster_positions.length > 0
    && value.roster_positions.every((position) => typeof position === 'string' && Boolean(position.trim()))
    && isRecord(value.settings) && isOptionalRecord(value.scoring_settings);
}

export function parseSleeperRows<T>(
  value: unknown,
  path: string,
  validate: (value: unknown) => value is T,
  key: (row: T) => string,
): T[] {
  if (!Array.isArray(value) || value.some((row) => !validate(row))) {
    throw new Error(`Sleeper returned an invalid response for ${path}.`);
  }
  const rows = value as T[];
  const keys = rows.map(key);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Sleeper returned duplicate entries for ${path}.`);
  }
  return rows;
}

export function assertSleeperRosterCompleteness(league: SleeperLeague, rosters: readonly SleeperRoster[]): void {
  if (rosters.length !== league.total_rosters) {
    throw new Error(`Sleeper returned ${rosters.length} of ${league.total_rosters} league rosters.`);
  }
}

export function assertSleeperCoreCompleteness(league: SleeperLeague, rosters: SleeperRoster[], users: SleeperUser[]): void {
  assertSleeperRosterCompleteness(league, rosters);
  const userIds = new Set(users.map((user) => user.user_id));
  if (rosters.some((roster) => roster.owner_id && !userIds.has(roster.owner_id))) {
    throw new Error('Sleeper returned incomplete manager information for the league rosters.');
  }
}


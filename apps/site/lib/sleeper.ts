import 'server-only';

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { normalizeInjuryStatus } from './injury-status';
import {
  addScheduleToMatchups,
  addScheduleToPlayers,
  resolveSleeperSchedule,
  type WeekSchedule,
} from './nfl-schedule';
import type { MatchupsData, OverviewData, ManagerData, Player, TransactionsData } from './types';
import { matchupTemporalState, type MatchupPeriodContext } from './matchup-period';
import {
  canDecorateMatchupWeek,
  involvesRoster,
  matchupSlateExpected,
  matchupStatus,
  normalizeLeague,
  normalizeMatchups,
  normalizeTeams,
  normalizeTransactions,
  managerLineup,
  playerFromId,
  startingSlots,
  sleeperActiveScoringWeek,
  sleeperLeagueLifecycle,
  transactionEndWeek,
  type PlayerCatalog,
  type SleeperLeague,
  type SleeperMatchup,
  type SleeperPlayer,
  type SleeperRoster,
  type SleeperState,
  type SleeperTransaction,
  type SleeperUser,
} from './transform';

export type ProjectionSyncInput = Readonly<{
  sleeperLeagueId: string;
  leagueName: string;
  scoringSettings: Readonly<Record<string, unknown>> | null;
  data: MatchupsData;
  /** Every player currently rostered in the league, including bench, IR, and taxi players. */
  rosteredPlayers: readonly Player[];
  /** Complete weekly NFL schedule, including games without a displayed starter. */
  schedule: WeekSchedule;
  requestStartedAt: string;
  requestCompletedAt: string;
}>;

export type ProjectionTargetPeriod = Readonly<{
  season: number;
  seasonType: 'preseason' | 'regular' | 'postseason';
  week: number;
}>;

export type ProjectionCadenceInput = Readonly<{
  sleeperLeagueId: string;
  season: string;
  defaultDisplayWeek: number;
  /** Week the projection worker should load; active scoring wins over display. */
  week: number;
  activeScoringWeek: number | null;
  leagueLifecycle: 'preseason' | 'active' | 'complete';
  leagueStatus: SleeperLeague['status'];
  schedule: WeekSchedule;
  currentNflSeason: string | null;
  currentNflWeek: number | null;
  currentNflSeasonType: string | null;
  requestStartedAt: string;
  requestCompletedAt: string;
  verifiedAt: string;
}>;

const API = 'https://api.sleeper.app/v1';
const SEASON_SCHEDULE_API = 'https://api.sleeper.com/schedule/nfl/regular';
const SCORES_API = 'https://api.sleeper.com/scores/nfl/regular';
const CORE_CACHE_SECONDS = 60;
const SCHEDULE_CACHE_SECONDS = 300;
const SEASON_SCHEDULE_CACHE_SECONDS = 3_600;
// Sleeper asks consumers to store player data and refresh it at most daily.
const PLAYER_CACHE_SECONDS = 86_400;
// Back off briefly after a catalog failure so an upstream outage does not trigger a large retry on every page request.
const PLAYER_FAILURE_CACHE_SECONDS = 300;
// The public leagues use these player positions. Sleeper's documented position filters keep
// each response small enough to load reliably in a serverless function.
const PLAYER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
type PlayerPosition = typeof PLAYER_POSITIONS[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function fetchJson(path: string, revalidate = CORE_CACHE_SECONDS): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    ...(revalidate > 0 ? { next: { revalidate } } : { cache: 'no-store' as const }),
    signal: AbortSignal.timeout(path.startsWith('/players/nfl') ? 20_000 : 12_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Sleeper could not load ${path} (HTTP ${response.status}).`);
  return response.json();
}

async function fetchExternalJson(url: string, revalidate = SCHEDULE_CACHE_SECONDS): Promise<unknown> {
  const response = await fetch(url, {
    next: { revalidate },
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`NFL schedule data could not be loaded (HTTP ${response.status}).`);
  return response.json();
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalRecord(value: unknown): boolean {
  return value === undefined || value === null || isRecord(value);
}

function isStringArray(value: unknown): boolean {
  return value === undefined || value === null
    || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isNumberArray(value: unknown): boolean {
  return value === undefined || value === null
    || (Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isInteger(item) && item > 0));
}

function isOptionalNumber(value: unknown, nullable = true): boolean {
  return value === undefined || (nullable && value === null)
    || (typeof value === 'number' && Number.isFinite(value));
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

function isSleeperRoster(value: unknown): value is SleeperRoster {
  return isRecord(value) && typeof value.roster_id === 'number' && Number.isInteger(value.roster_id)
    && value.roster_id > 0 && isOptionalString(value.owner_id)
    && isStringArray(value.players) && isStringArray(value.starters)
    && isStringArray(value.reserve) && isStringArray(value.taxi)
    && validRosterSettings(value.settings) && isOptionalRecord(value.metadata);
}

function isSleeperUser(value: unknown): value is SleeperUser {
  return isRecord(value) && typeof value.user_id === 'string' && Boolean(value.user_id.trim())
    && isOptionalString(value.display_name) && isOptionalString(value.username)
    && isOptionalString(value.avatar) && isOptionalRecord(value.metadata);
}

function isPointsMap(value: unknown): boolean {
  return value === undefined || value === null || (isRecord(value)
    && Object.values(value).every((points) => isOptionalNumber(points)));
}

function isSleeperMatchup(value: unknown): value is SleeperMatchup {
  const matchupId = isRecord(value) ? value.matchup_id : undefined;
  return isRecord(value) && typeof value.roster_id === 'number' && Number.isInteger(value.roster_id)
    && value.roster_id > 0
    && Object.prototype.hasOwnProperty.call(value, 'matchup_id')
    && (matchupId === null || (typeof matchupId === 'number' && Number.isInteger(matchupId) && matchupId > 0))
    && isStringArray(value.starters)
    && (value.starters_points === undefined || value.starters_points === null
      || (Array.isArray(value.starters_points) && value.starters_points.every((points) => isOptionalNumber(points))))
    && isPointsMap(value.players_points) && isOptionalNumber(value.points) && isOptionalNumber(value.custom_points);
}

function isRosterMap(value: unknown): boolean {
  return value === undefined || value === null || (isRecord(value)
    && Object.entries(value).every(([playerId, rosterId]) => Boolean(playerId)
      && typeof rosterId === 'number' && Number.isInteger(rosterId) && rosterId > 0));
}

function isDraftPick(value: unknown): boolean {
  return isRecord(value) && typeof value.season === 'string' && Boolean(value.season.trim())
    && ['round', 'roster_id', 'previous_owner_id', 'owner_id'].every((field) => {
      const candidate = value[field];
      return typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0;
    });
}

function isWaiverBudgetMove(value: unknown): boolean {
  return isRecord(value) && ['sender', 'receiver'].every((field) => {
    const candidate = value[field];
    return typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0;
  }) && typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount >= 0;
}

function isSleeperTransaction(value: unknown): value is SleeperTransaction {
  return isRecord(value) && typeof value.transaction_id === 'string' && Boolean(value.transaction_id.trim())
    && isOptionalString(value.type) && isOptionalString(value.status)
    && isOptionalNumber(value.created, false) && isOptionalNumber(value.status_updated, false)
    && isNumberArray(value.roster_ids) && isNumberArray(value.consenter_ids)
    && isRosterMap(value.adds) && isRosterMap(value.drops)
    && (value.draft_picks === undefined || value.draft_picks === null
      || (Array.isArray(value.draft_picks) && value.draft_picks.every(isDraftPick)))
    && (value.waiver_budget === undefined || value.waiver_budget === null
      || (Array.isArray(value.waiver_budget) && value.waiver_budget.every(isWaiverBudgetMove)))
    && isOptionalRecord(value.settings) && isOptionalRecord(value.metadata);
}

function isSleeperLeague(value: unknown): value is SleeperLeague {
  return isRecord(value) && typeof value.league_id === 'string' && Boolean(value.league_id.trim())
    && typeof value.name === 'string' && Boolean(value.name.trim())
    && typeof value.season === 'string' && /^\d{4}$/u.test(value.season)
    && ['pre_draft', 'drafting', 'in_season', 'complete'].includes(String(value.status))
    && typeof value.total_rosters === 'number' && Number.isInteger(value.total_rosters) && value.total_rosters > 0
    && Array.isArray(value.roster_positions) && value.roster_positions.length > 0
    && value.roster_positions.every((position) => typeof position === 'string' && Boolean(position.trim()))
    && isRecord(value.settings) && isOptionalRecord(value.scoring_settings);
}

function isSleeperState(value: unknown): value is SleeperState {
  return isRecord(value) && typeof value.season === 'string' && /^\d{4}$/u.test(value.season)
    && isOptionalString(value.season_type) && isOptionalString(value.season_start_date)
    && ['week', 'leg', 'display_week'].every((field) => {
      const candidate = value[field];
      return candidate === undefined || (typeof candidate === 'number' && Number.isInteger(candidate));
    });
}

async function fetchRows<T>(
  path: string,
  validate: (value: unknown) => value is T,
  key: (row: T) => string,
  revalidate = CORE_CACHE_SECONDS,
): Promise<T[]> {
  const value = await fetchJson(path, revalidate);
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

function assertCoreCompleteness(league: SleeperLeague, rosters: SleeperRoster[], users: SleeperUser[]): void {
  if (rosters.length !== league.total_rosters) {
    throw new Error(`Sleeper returned ${rosters.length} of ${league.total_rosters} league rosters.`);
  }
  const userIds = new Set(users.map((user) => user.user_id));
  if (rosters.some((roster) => roster.owner_id && !userIds.has(roster.owner_id))) {
    throw new Error('Sleeper returned incomplete manager information for the league rosters.');
  }
}

function assertMatchupCompleteness(
  rows: SleeperMatchup[],
  rosters: SleeperRoster[],
  slateExpected: boolean,
): void {
  if (!rows.length) {
    if (slateExpected) throw new Error('Sleeper returned an incomplete matchup slate for this league.');
    return;
  }
  const rosterIds = new Set(rosters.map((roster) => roster.roster_id));
  if (rows.length !== rosterIds.size || rows.some((row) => !rosterIds.has(row.roster_id))) {
    throw new Error('Sleeper returned an incomplete matchup slate for this league.');
  }
  const pairedCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.matchup_id === null || row.matchup_id === undefined) continue;
    const id = String(row.matchup_id);
    pairedCounts.set(id, (pairedCounts.get(id) ?? 0) + 1);
  }
  if ([...pairedCounts.values()].some((count) => count !== 2)) {
    throw new Error('Sleeper returned an invalid matchup grouping for this league.');
  }
}

function projectionTargetWeek(
  targetPeriod: ProjectionTargetPeriod,
  league: SleeperLeague,
  maxWeek: number,
): number {
  if (!Number.isInteger(targetPeriod.season)
    || targetPeriod.season < 2000
    || targetPeriod.season > 2099
    || !Number.isInteger(targetPeriod.week)
    || targetPeriod.week < 1
    || targetPeriod.week > maxWeek) {
    throw new Error('The requested projection period is invalid.');
  }
  if (targetPeriod.seasonType !== 'regular') {
    throw new Error('Sleeper league projections require an NFL regular-season period.');
  }
  if (String(targetPeriod.season) !== league.season) {
    throw new Error('The requested projection season does not match the configured Sleeper league.');
  }
  return targetPeriod.week;
}

function assertProjectionMatchupReadiness(
  rows: SleeperMatchup[],
  rosters: SleeperRoster[],
  rosterPositions: string[],
): void {
  assertMatchupCompleteness(rows, rosters, true);
  if (rows.some((row) => row.matchup_id === null || row.matchup_id === undefined)) {
    throw new Error('Sleeper has not resolved every matchup pairing for the requested projection week.');
  }

  const requiredSlots = startingSlots(rosterPositions);
  if (!requiredSlots.length || rows.some((row) => !Array.isArray(row.starters)
    || row.starters.length !== requiredSlots.length
    || row.starters.some((starter) => !starter.trim()))) {
    throw new Error('Sleeper has not published complete lineups for the requested projection week.');
  }
}

function playerCoverageWarning(catalog: PlayerCatalog, ids: Iterable<string>): string | undefined {
  const missing = new Set<string>();
  for (const id of ids) {
    if (id && id !== '0' && !catalog[id] && !/^[A-Z]{2,3}$/u.test(id)) missing.add(id);
  }
  return missing.size ? `Sleeper did not provide details for ${missing.size} player${missing.size === 1 ? '' : 's'} shown on this page.` : undefined;
}

function joinWarnings(...warnings: Array<string | undefined>): string | undefined {
  return warnings.filter(Boolean).join(' ') || undefined;
}

const getLeagueCalendar = cache(async (leagueId: string, revalidate: number) => {
  const requestStartedAt = new Date().toISOString();
  const [rawLeague, stateResult] = await Promise.all([
    fetchJson(`/league/${leagueId}`, revalidate),
    fetchJson('/state/nfl', revalidate).then(
      (value) => ({ value }),
      () => ({ value: null }),
    ),
  ]);
  if (!isSleeperLeague(rawLeague) || rawLeague.league_id !== leagueId) {
    throw new Error('Sleeper did not return a valid league. Please check the league configuration.');
  }
  const state = isSleeperState(stateResult.value) ? stateResult.value : null;
  const requestCompletedAt = new Date().toISOString();
  return {
    sourceLeague: rawLeague,
    state,
    league: normalizeLeague(rawLeague, state),
    requestStartedAt,
    requestCompletedAt,
  };
});

const getCore = cache(async (leagueId: string) => {
  const [calendar, rosters, users] = await Promise.all([
    getLeagueCalendar(leagueId, CORE_CACHE_SECONDS),
    fetchRows<SleeperRoster>(`/league/${leagueId}/rosters`, isSleeperRoster, (row) => String(row.roster_id)),
    fetchRows<SleeperUser>(`/league/${leagueId}/users`, isSleeperUser, (row) => row.user_id),
  ]);
  const { sourceLeague, state, league } = calendar;
  assertCoreCompleteness(sourceLeague, rosters, users);
  const teams = normalizeTeams(rosters, users);
  const overview: OverviewData = {
    league,
    teams,
    updatedAt: new Date().toISOString(),
    warning: joinWarnings(
      state ? undefined : 'NFL week information is temporarily unavailable; game status cannot be confirmed.',
      teams.length ? undefined : 'Sleeper has not provided any league rosters yet.',
    ),
  };
  return { overview, sourceLeague, state, rosters };
});

function projectPlayerCatalog(raw: unknown): PlayerCatalog {
  if (!isRecord(raw)) throw new Error('Sleeper did not return a valid player catalog.');
  const result: PlayerCatalog = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const player: SleeperPlayer = {};
    for (const field of ['full_name', 'first_name', 'last_name', 'position', 'team'] as const) {
      if (typeof value[field] === 'string' && value[field].trim()) player[field] = value[field].trim();
    }
    const injuryStatus = normalizeInjuryStatus(value.injury_status);
    if (injuryStatus) player.injury_status = injuryStatus;
    if (player.full_name || player.first_name || player.last_name) result[id] = player;
  }
  if (!Object.keys(result).length) throw new Error('Sleeper returned an empty player catalog.');
  return result;
}

// These maps are best-effort protection within a warm server instance. The
// persistent successful result still comes from Next's daily Data Cache entry.
const playerPositionFailures = new Map<PlayerPosition, number>();
const playerPositionRequests = new Map<PlayerPosition, Promise<PlayerCatalog>>();

async function fetchPlayerPosition(position: PlayerPosition): Promise<PlayerCatalog> {
  const failedUntil = playerPositionFailures.get(position);
  if (failedUntil && failedUntil > Date.now()) {
    throw new Error(`Sleeper's ${position} player catalog is in a temporary retry backoff.`);
  }
  if (failedUntil) playerPositionFailures.delete(position);

  const activeRequest = playerPositionRequests.get(position);
  if (activeRequest) return activeRequest;

  const request = fetchJson(`/players/nfl?position=${encodeURIComponent(position)}`, 0)
    .then(projectPlayerCatalog)
    .then((catalog) => {
      playerPositionFailures.delete(position);
      return catalog;
    })
    .catch((error: unknown) => {
      playerPositionFailures.set(position, Date.now() + PLAYER_FAILURE_CACHE_SECONDS * 1_000);
      console.warn(`Sleeper ${position} player catalog could not be loaded.`, error);
      throw error;
    })
    .finally(() => playerPositionRequests.delete(position));
  playerPositionRequests.set(position, request);
  return request;
}

// Cache only the small fields we display. Position-filtered responses avoid the
// full catalog's multi-megabyte cold request, and separate entries let one failed
// position recover without removing names that loaded successfully. The retry
// guard lives inside the cached callback so normal cache hits always remain usable.
// /players/nfl supplies current metadata, not injury history for a requested week.
const cachedPlayerPosition = unstable_cache(
  fetchPlayerPosition,
  ['league-one-player-position-catalog-v1'],
  { revalidate: PLAYER_CACHE_SECONDS },
);

const getPlayers = cache(async () => {
  const results = await Promise.allSettled(PLAYER_POSITIONS.map((position) => cachedPlayerPosition(position)));
  const catalog = Object.assign(
    {},
    ...results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
  ) as PlayerCatalog;
  const failedPositions = PLAYER_POSITIONS.filter((_, index) => results[index].status === 'rejected');
  if (!Object.keys(catalog).length) {
    return {
      catalog,
      warning: 'Player names and injury designations are temporarily unavailable. Sleeper player IDs are shown where necessary.',
    };
  }
  return {
    catalog,
    warning: failedPositions.length
      ? `Some player names and injury designations are temporarily unavailable (${failedPositions.join(', ')}). Sleeper player IDs are shown where necessary.`
      : undefined,
  };
});

async function getWeekSchedule(season: string, week: number): Promise<{
  schedule: WeekSchedule;
  canIdentifyByes: boolean;
  warning?: string;
}> {
  if (!/^\d{4}$/u.test(season)) {
    return { schedule: {}, canIdentifyByes: false, warning: 'NFL opponent and kickoff information is temporarily unavailable.' };
  }
  const [seasonScheduleValue, scoresValue] = await Promise.all([
    fetchExternalJson(`${SEASON_SCHEDULE_API}/${season}`, SEASON_SCHEDULE_CACHE_SECONDS).catch(() => null),
    fetchExternalJson(`${SCORES_API}/${season}/${week}`).catch(() => null),
  ]);
  const result = resolveSleeperSchedule(seasonScheduleValue, scoresValue, season, week);
  return {
    schedule: result.schedule,
    canIdentifyByes: result.canIdentifyByes,
    warning: result.complete ? undefined : 'Some NFL opponent or kickoff information is temporarily unavailable.',
  };
}

export async function getOverview(leagueId: string): Promise<OverviewData> {
  return (await getCore(leagueId)).overview;
}

type MatchupSourceOptions = Readonly<{
  requestedWeek?: number;
  projectionTarget?: ProjectionTargetPeriod;
  freshMatchups?: boolean;
  includeRosteredPlayers?: boolean;
}>;

async function loadMatchupSource(
  leagueId: string,
  options: MatchupSourceOptions = {},
): Promise<{
  data: MatchupsData;
  rosteredPlayers: readonly Player[];
  sourceLeague: SleeperLeague;
  schedule: WeekSchedule;
  requestStartedAt: string;
  requestCompletedAt: string;
}> {
  const {
    requestedWeek,
    projectionTarget,
    freshMatchups = false,
    includeRosteredPlayers = false,
  } = options;
  if (projectionTarget && requestedWeek !== undefined) {
    throw new Error('A matchup load cannot combine website and projection week selection.');
  }
  const core = await getCore(leagueId);
  const week = projectionTarget
    ? projectionTargetWeek(projectionTarget, core.sourceLeague, core.overview.league.maxWeek)
    : requestedWeek === undefined ? core.overview.league.week
      : Number.isInteger(requestedWeek) && requestedWeek >= 1 && requestedWeek <= core.overview.league.maxWeek
        ? requestedWeek : core.overview.league.week;
  const status = matchupStatus(core.sourceLeague, core.state, week);
  const canDecorate = canDecorateMatchupWeek(core.sourceLeague, core.state, week);
  const [matchupObservation, players, nflSchedule] = await Promise.all([
    fetchObservedRows<SleeperMatchup>(
      `/league/${leagueId}/matchups/${week}`,
      isSleeperMatchup,
      (row) => String(row.roster_id),
      freshMatchups ? 0 : CORE_CACHE_SECONDS,
    ),
    getPlayers(),
    canDecorate
      ? getWeekSchedule(core.overview.league.season, week)
      : Promise.resolve({ schedule: {} as WeekSchedule, canIdentifyByes: false, warning: undefined }),
  ]);
  const { rows, requestStartedAt, requestCompletedAt } = matchupObservation;
  if (projectionTarget) {
    assertProjectionMatchupReadiness(rows, core.rosters, core.overview.league.rosterPositions);
  } else {
    const slateExpected = matchupSlateExpected(core.sourceLeague, core.state, week);
    assertMatchupCompleteness(rows, core.rosters, slateExpected);
  }
  const scheduledMatchups = addScheduleToMatchups(
    normalizeMatchups(rows, core.overview.teams, core.overview.league, players.catalog,
      status),
    nflSchedule.schedule,
    nflSchedule.canIdentifyByes,
  );
  const rosteredPlayers = includeRosteredPlayers
    ? addScheduleToPlayers(
      [...new Set(core.rosters.flatMap((roster) => [
        ...(roster.players ?? []),
        ...(roster.starters ?? []),
        ...(roster.reserve ?? []),
        ...(roster.taxi ?? []),
      ]).filter((id): id is string => typeof id === 'string' && id !== '0'))]
        .map((id, index) => playerFromId(id, 'BN', players.catalog, null, index)),
      nflSchedule.schedule,
      nflSchedule.canIdentifyByes,
    )
    : [];
  const displayedRows = scheduledMatchups.reduce((count, matchup) => count + matchup.sides.length, 0);
  return {
    data: {
      ...core.overview,
      updatedAt: requestCompletedAt,
      week,
      matchups: scheduledMatchups,
      warning: joinWarnings(core.overview.warning, players.warning,
        players.warning ? undefined : playerCoverageWarning(players.catalog, rows.flatMap((row) => row.starters ?? [])),
        nflSchedule.warning,
        displayedRows < rows.length ? 'Some matchup entries could not be matched to a unique league roster.' : undefined),
    },
    rosteredPlayers,
    sourceLeague: core.sourceLeague,
    schedule: nflSchedule.schedule,
    requestStartedAt,
    requestCompletedAt,
  };
}

async function fetchObservedRows<T>(
  path: string,
  validate: (value: unknown) => value is T,
  key: (row: T) => string,
  revalidate = CORE_CACHE_SECONDS,
): Promise<Readonly<{ rows: T[]; requestStartedAt: string; requestCompletedAt: string }>> {
  const requestStartedAt = new Date().toISOString();
  const rows = await fetchRows(path, validate, key, revalidate);
  const requestCompletedAt = new Date().toISOString();
  return { rows, requestStartedAt, requestCompletedAt };
}

/**
 * Loads one authoritative Sleeper matchup slate without calculating projections. The projection
 * worker uses this boundary so provider synchronization and database writes remain outside the
 * presentation path.
 */
export async function getProjectionSyncInput(
  leagueId: string,
  targetPeriod: ProjectionTargetPeriod,
): Promise<ProjectionSyncInput> {
  const source = await loadMatchupSource(leagueId, {
    projectionTarget: targetPeriod,
    freshMatchups: true,
    includeRosteredPlayers: true,
  });
  return {
    sleeperLeagueId: leagueId,
    leagueName: source.sourceLeague.name,
    scoringSettings: source.sourceLeague.scoring_settings ?? null,
    data: source.data,
    rosteredPlayers: source.rosteredPlayers,
    schedule: source.schedule,
    requestStartedAt: source.requestStartedAt,
    requestCompletedAt: source.requestCompletedAt,
  };
}

/**
 * Loads only the global calendar inputs needed to decide whether the scheduled
 * worker should wake Neon and fan out across leagues. These requests use a
 * five-minute cache and deliberately omit rosters, managers, players, and scores.
 */
export async function getProjectionCadenceInput(leagueId: string): Promise<ProjectionCadenceInput> {
  const {
    sourceLeague, state, league, requestStartedAt, requestCompletedAt,
  } = await getLeagueCalendar(leagueId, SCHEDULE_CACHE_SECONDS);
  const activeScoringWeek = sleeperActiveScoringWeek(sourceLeague, state);
  const workerWeek = activeScoringWeek ?? league.week;
  const schedule = canDecorateMatchupWeek(sourceLeague, state, workerWeek)
    ? (await getWeekSchedule(league.season, workerWeek)).schedule
    : {};
  const currentNflWeek = state
    ? [state.leg, state.week]
      .find((value): value is number => typeof value === 'number'
        && Number.isInteger(value) && value >= 1 && value <= 18) ?? null
    : null;
  return {
    sleeperLeagueId: leagueId,
    season: league.season,
    defaultDisplayWeek: league.week,
    week: workerWeek,
    activeScoringWeek,
    leagueLifecycle: sleeperLeagueLifecycle(sourceLeague, state),
    leagueStatus: sourceLeague.status,
    schedule,
    currentNflSeason: state?.season ?? null,
    currentNflWeek,
    currentNflSeasonType: state?.season_type ?? null,
    requestStartedAt,
    requestCompletedAt,
    verifiedAt: new Date().toISOString(),
  };
}

/** Returns the current league week without loading rosters, managers, players, scores, or schedules. */
export async function getCurrentLeagueWeek(leagueId: string): Promise<number> {
  return (await getLeagueCalendar(leagueId, CORE_CACHE_SECONDS)).league.week;
}

/** Direct Sleeper fallback for period context when the persisted authority is unavailable. */
export async function getCurrentMatchupPeriodContext(
  leagueId: string,
  requestedWeek?: number,
): Promise<MatchupPeriodContext> {
  const { sourceLeague, state, league } = await getLeagueCalendar(leagueId, CORE_CACHE_SECONDS);
  const season = Number(league.season);
  if (!Number.isInteger(season)) throw new Error('Sleeper returned an invalid league season.');
  const lifecycle = sleeperLeagueLifecycle(sourceLeague, state);
  const activeWeek = sleeperActiveScoringWeek(sourceLeague, state);
  const defaultDisplayPeriod = { season, seasonType: 'regular' as const, week: league.week };
  const activeScoringPeriod = activeWeek === null
    ? null : { season, seasonType: 'regular' as const, week: activeWeek };
  const targetWeek = requestedWeek ?? league.week;
  return {
    defaultSeason: season,
    defaultWeek: league.week,
    activeSeason: activeScoringPeriod?.season ?? null,
    activeWeek,
    lifecycle,
    nflPhase: state?.season_type === 'pre' ? 'preseason'
      : state?.season_type === 'regular' ? 'regular'
        : state?.season_type === 'post' ? 'postseason' : 'unknown',
    temporalState: lifecycle === 'active' && !activeScoringPeriod
      ? (targetWeek < league.week ? 'past' : targetWeek > league.week ? 'future' : 'active')
      : matchupTemporalState({ defaultDisplayPeriod, activeScoringPeriod, lifecycle }, targetWeek),
    refreshDue: false,
  };
}

/**
 * Loads authoritative Sleeper matchup scores and lineups without attaching a
 * static Tank01 pregame estimate. This is the safe degraded path when the live
 * projection worker has not recently verified its stored snapshot.
 */
export async function getOfficialMatchups(
  leagueId: string,
  requestedWeek?: number,
): Promise<MatchupsData> {
  return (await loadMatchupSource(leagueId, { requestedWeek })).data;
}

export async function getManager(leagueId: string, id: number): Promise<ManagerData | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  const core = await getCore(leagueId);
  const team = core.overview.teams.find((candidate) => candidate.id === id);
  const roster = core.rosters.find((candidate) => candidate.roster_id === id);
  if (!team || !roster) return null;
  const players = await getPlayers();
  return {
    ...core.overview,
    team,
    ...managerLineup(roster, core.overview.league, players.catalog),
    warning: joinWarnings(core.overview.warning, players.warning,
      players.warning ? undefined : playerCoverageWarning(players.catalog, [
        ...(roster.players ?? []), ...(roster.starters ?? []), ...(roster.reserve ?? []), ...(roster.taxi ?? []),
      ])),
  };
}

const getTransactionWeeks = cache(async (leagueId: string, lastWeek: number) => {
  const weeks = Array.from({ length: lastWeek + 1 }, (_, week) => week);
  const rows: SleeperTransaction[] = [];
  const failedWeeks: number[] = [];
  let next = 0;
  let succeeded = 0;
  // Four workers cap burst requests to Sleeper while keeping season history responsive.
  await Promise.all(Array.from({ length: Math.min(4, weeks.length) }, async () => {
    while (next < weeks.length) {
      const week = weeks[next++];
      try {
        rows.push(...await fetchRows<SleeperTransaction>(
          `/league/${leagueId}/transactions/${week}`,
          isSleeperTransaction,
          (row) => row.transaction_id,
        ));
        succeeded += 1;
      } catch {
        failedWeeks.push(week);
      }
    }
  }));
  if (!succeeded) throw new Error('Sleeper transaction history is temporarily unavailable. Please try again.');
  return { rows, failedWeeks: failedWeeks.sort((a, b) => a - b) };
});

export async function getTransactions(leagueId: string, id: number): Promise<TransactionsData | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  const core = await getCore(leagueId);
  const team = core.overview.teams.find((candidate) => candidate.id === id);
  if (!team) return null;
  const [history, players] = await Promise.all([
    getTransactionWeeks(leagueId, transactionEndWeek(core.sourceLeague, core.state)),
    getPlayers(),
  ]);
  const partial = history.failedWeeks.length > 0;
  const transactionPlayerIds = history.rows
    .filter((row) => involvesRoster(row, id))
    .flatMap((row) => [...Object.keys(row.adds ?? {}), ...Object.keys(row.drops ?? {})]);
  return {
    ...core.overview,
    team,
    transactions: normalizeTransactions(history.rows, id, core.overview.teams, players.catalog),
    warning: joinWarnings(core.overview.warning, players.warning,
      players.warning ? undefined : playerCoverageWarning(players.catalog, transactionPlayerIds),
      partial
      ? `Some transaction history could not be loaded (weeks ${history.failedWeeks.join(', ')}). The list may be incomplete.`
      : undefined),
  };
}

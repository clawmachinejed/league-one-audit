import 'server-only';

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { assessSleeperLeagueCapabilities, unverifiedLeagueCapabilities } from './league-capabilities';
import type { LeagueCapabilityReport } from './league-capability-contracts';
import { readPageAdministrationSource, type AdministrationFamily } from './page-source';
import { recordProviderCache, sleeperEndpointFamily, startProviderHttp } from './provider-request-telemetry';
import {
  loadFantasyPlayerCatalog,
  loadFantasyPlayerPositionCatalog,
  type FantasyPlayerCatalog,
} from './sleeper-player-catalog';
import {
  assertMatchupCompleteness,
  assertProjectionMatchupReadiness,
  createRawSleeperMatchupLoader,
  parseRawSleeperMatchupFeed,
  parseRawSleeperMatchups,
  sleeperMatchupShape,
  type SleeperMatchupShape,
  type RawSleeperMatchupObservation,
} from './projections/adapters/sleeper/raw-matchups';
import {
  addScheduleToMatchups,
  addScheduleToPlayers,
  normalizeSleeperByeWeeks,
  resolveSleeperSchedule,
  validatedSleeperSeasonGames,
  type WeekSchedule,
} from './nfl-schedule';
import type { LeagueTransactionsData, ManagerData, ManagersData, MatchupsData, OverviewData, Player, ProjectedStandingsBasis, RosterPlayer, RosterSection, RostersData, StandingsData, StandingsTeam, TransactionsData } from './types';
import { leagueOneChampionshipYears, leagueTwoChampionshipYears } from './manager-championships';
import type { ManagerHonors } from './manager-honors';
import { displayedManagerOwnerId, displayedManagerTeams } from './manager-display';
import { findCurrentLeagueKey } from './league-administration/registry';
import type { LeagueKey } from './leagues';
import type { CurrentStandings } from './current-standings';
import { normalizeLeagueTransactions } from './league-transactions';
import { matchupTemporalState, type MatchupPeriodContext } from './matchup-period';
import { LAST_MATCHUP_WEEK } from './matchup-week';
import { calculateTeamPpg, compareRosterStandings, playerMetricBoundary, rosterHistoryBoundary } from './roster-metrics';
import { canonicalNflTeam, NFL_TEAMS } from './nfl-teams';
import { startingSlots } from './sleeper-lineup';
import { resolveSiteWeek, resolveWeeklyPlayerMetrics, type SiteWeekResolution, type WeeklyPlayerMetricWindow } from './site-week';
import { assertSiteCalendarNotRegressed, getRetainedSiteCalendar } from './site-calendar-authority';
import { buildCompletedStandingsBasis, reconcileStandingsBasis, standingsTotalsMatch } from './projected-standings';
import { buildManagerHistory, type ManagerHistorySeason } from './manager-history';
import { buildMyTeamScheduleWeeks, MY_TEAM_SCHEDULE_WEEKS, type MyTeamScheduleData, type ScheduleWeekCount } from './my-team-schedule';
import {
  canDecorateMatchupWeek,
  addWaiverBalances,
  dedupeTransactions,
  involvesRoster,
  matchupSlateExpected,
  matchupStatus,
  normalizeLeague,
  normalizeMatchups,
  normalizeTeams,
  normalizeTransactions,
  managerLineup,
  playerFromId,
  sleeperLeagueLifecycle,
  transactionEndWeek,
  type PlayerCatalog,
  type SleeperLeague,
  type SleeperMatchup,
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
  /** Reuses the catalog already loaded for this source; never a new request. */
  officialPlayerCatalog?: FantasyPlayerCatalog;
  /** Current advisory catalog status applies only to this confirmed active period.
   * This does not establish historical participation or change catalog freshness. */
  currentPlayerStatusPeriod?: ProjectionTargetPeriod | null;
  /** Complete weekly NFL schedule, including games without a displayed starter. */
  schedule: WeekSchedule;
  /** Exact raw response used by the full loader; never reconstructed from presentation. */
  rawMatchups: readonly SleeperMatchup[];
  matchupShape: SleeperMatchupShape;
  requestStartedAt: string;
  requestCompletedAt: string;
  administrationObservations?: readonly CapturedAdministrationDocument[];
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
  matchupShape: SleeperMatchupShape;
  currentNflSeason: string | null;
  currentNflWeek: number | null;
  currentNflSeasonType: string | null;
  requestStartedAt: string;
  requestCompletedAt: string;
  verifiedAt: string;
  siteWeekPolicy?: Readonly<{
    version: string;
    scheduleRevision: string;
    nextRolloverAt: string | null;
    evaluatedAt: string;
  }>;
  /** Unmodified provider week retained separately from the site's operational week. */
  sourceNflWeek?: number | null;
  administrationObservations?: readonly CapturedAdministrationDocument[];
}>;

/** Read-only source evidence, captured at the existing retrieval boundary. */
export type CapturedAdministrationDocument = Readonly<{
  family: AdministrationFamily;
  week: number | null;
  payload: unknown;
  requestStartedAt: string;
  requestCompletedAt: string;
  origin: 'network' | 'cache' | 'bootstrap';
  sourceObservedAt: string | null;
  completeness?: 'complete' | 'partial';
  fallbackReason?: 'missing' | 'disabled' | 'unavailable' | 'stale';
}>;

type AdministrationReadMode = 'page' | 'official' | 'history';

const API = 'https://api.sleeper.app/v1';
const SEASON_SCHEDULE_API = 'https://api.sleeper.com/schedule/nfl/regular';
const SCORES_API = 'https://api.sleeper.com/scores/nfl/regular';
const CORE_CACHE_SECONDS = 60;
const SCHEDULE_CACHE_SECONDS = 300;
const SEASON_SCHEDULE_CACHE_SECONDS = 3_600;
// Sleeper asks consumers to store player data and refresh it at most daily.
const PLAYER_CACHE_SECONDS = 86_400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function administrationPath(leagueId: string, family: AdministrationFamily, week: number | null): string {
  return `/league/${leagueId}${family === 'league' ? '' : `/${family}${week === null ? '' : `/${week}`}`}`;
}

const readOfficialAdministration = cache(async (
  leagueId: string, family: AdministrationFamily, week: number | null, revalidate = CORE_CACHE_SECONDS, signal?: AbortSignal,
): Promise<CapturedAdministrationDocument> => {
  signal?.throwIfAborted();
  const requestStartedAt = new Date().toISOString();
  const payload = await fetchJson(administrationPath(leagueId, family, week), revalidate, signal);
  const requestCompletedAt = new Date().toISOString();
  return { family, week, payload, requestStartedAt, requestCompletedAt,
    origin: revalidate > 0 ? 'cache' : 'network', sourceObservedAt: revalidate > 0 ? null : requestCompletedAt };
});

const readAdministration = cache(async (
  leagueId: string, family: AdministrationFamily, week: number | null,
  mode: AdministrationReadMode = 'page', revalidate = CORE_CACHE_SECONDS, season?: number, leagueKey?: LeagueKey,
): Promise<CapturedAdministrationDocument> => {
  if (mode !== 'official') {
    const stored = await readPageAdministrationSource({ externalLeagueId: leagueId, family, week, season, leagueKey,
      maxAgeSeconds: revalidate, ...(mode === 'history' ? { historicalSeason: true } : {}) });
    if (stored.status === 'available') return { family, week, payload: stored.payload,
      requestStartedAt: stored.requestStartedAt, requestCompletedAt: stored.requestCompletedAt,
      origin: stored.origin, sourceObservedAt: stored.sourceObservedAt };
    return { ...await readOfficialAdministration(leagueId, family, week, revalidate), fallbackReason: stored.reason };
  }
  return readOfficialAdministration(leagueId, family, week, revalidate);
});

async function fetchJson(path: string, revalidate = CORE_CACHE_SECONDS, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(path.startsWith('/players/nfl') ? 20_000 : 12_000);
  const family = sleeperEndpointFamily(path);
  if (revalidate > 0) recordProviderCache('sleeper', family, 'framework-managed');
  const finished = startProviderHttp('sleeper', family, revalidate > 0 ? 'framework-managed' : 'bypass');
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...(revalidate > 0 ? { next: { revalidate } } : { cache: 'no-store' as const }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    finished('unavailable');
    throw error;
  }
  if (!response.ok) {
    finished('unavailable');
    throw new Error(`Sleeper could not load ${path} (HTTP ${response.status}).`);
  }
  try {
    const result: unknown = await response.json();
    finished('available');
    return result;
  } catch (error) {
    finished('invalid');
    throw error;
  }
}

/** The NFL league season can advance before Sleeper's current scoring season. */
export async function getSleeperDiscoverySeason(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const state = await fetchJson('/state/nfl', CORE_CACHE_SECONDS, signal);
  if (!isSleeperState(state) || !isRecord(state) || typeof state.league_season !== 'string'
    || !/^\d{4}$/u.test(state.league_season)) throw new Error('Sleeper discovery season is unavailable.');
  return state.league_season;
}

/** Public identity lookup for account-link confirmation; the stable ID must match the selected source account. */
export async function getSleeperUserIdentity(userId: string, signal?: AbortSignal): Promise<{
  userId: string; username: string; displayName: string; avatarUrl: string | null;
}> {
  if (!/^[1-9]\d{0,31}$/u.test(userId)) throw new Error('Invalid Sleeper user ID.');
  const value = await fetchJson(`/user/${userId}`, CORE_CACHE_SECONDS, signal);
  if (!isRecord(value) || value.user_id !== userId || typeof value.username !== 'string'
    || !value.username.trim() || value.username.length > 100) throw new Error('Sleeper identity is unavailable.');
  const displayName = typeof value.display_name === 'string' && value.display_name.trim()
    && value.display_name.length <= 100 ? value.display_name.trim() : value.username.trim();
  const avatarUrl = typeof value.avatar === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value.avatar)
    ? `https://sleepercdn.com/avatars/thumbs/${value.avatar}` : null;
  return { userId, username: value.username.trim(), displayName, avatarUrl };
}

export async function getSleeperUserLeagues(
  userId: string, season: string, signal?: AbortSignal,
): Promise<{ id: string; name: string; season: string; capabilities?: LeagueCapabilityReport }[]> {
  if (!/^[1-9]\d{0,31}$/u.test(userId) || !/^\d{4}$/u.test(season)) throw new Error('Invalid discovery source.');
  signal?.throwIfAborted();
  const rows = await fetchJson(`/user/${userId}/leagues/nfl/${season}`, CORE_CACHE_SECONDS, signal);
  if (!Array.isArray(rows) || rows.length > 1_000) throw new Error('Sleeper league discovery is unavailable.');
  const leagues = new Map<string, { id: string; name: string; season: string; capabilities?: LeagueCapabilityReport }>();
  const settingsConflicts = new Set<string>();
  const assessedAt = new Date().toISOString();
  for (const row of rows) {
    signal?.throwIfAborted();
    if (!isRecord(row) || typeof row.league_id !== 'string' || !/^[1-9]\d{0,31}$/u.test(row.league_id)
      || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200
      || row.sport !== 'nfl' || row.season !== season) throw new Error('Sleeper returned invalid discovery metadata.');
    const league = { id: row.league_id, name: row.name.trim(), season,
      capabilities: assessSleeperLeagueCapabilities(row, assessedAt) };
    const previous = leagues.get(league.id);
    if (previous && previous.name !== league.name) throw new Error('Sleeper returned contradictory discovery metadata.');
    if (previous && (previous.capabilities?.configurationRevision !== league.capabilities.configurationRevision
      || league.capabilities.configurationRevision === null)) {
      settingsConflicts.add(league.id);
    }
    if (settingsConflicts.has(league.id)) {
      league.capabilities = unverifiedLeagueCapabilities('Sleeper returned conflicting settings for this league.', assessedAt);
    }
    leagues.set(league.id, league);
  }
  return [...leagues.values()];
}

async function fetchExternalJson(url: string, revalidate = SCHEDULE_CACHE_SECONDS): Promise<unknown> {
  const family = url.startsWith(SEASON_SCHEDULE_API) ? 'season-schedule' : url.startsWith(SCORES_API) ? 'weekly-scores' : 'other';
  recordProviderCache('sleeper', family, 'framework-managed');
  const finished = startProviderHttp('sleeper', family, 'framework-managed');
  let response: Response;
  try {
    response = await fetch(url, {
      next: { revalidate },
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    finished('unavailable');
    throw error;
  }
  if (!response.ok) {
    finished('unavailable');
    throw new Error(`NFL schedule data could not be loaded (HTTP ${response.status}).`);
  }
  try {
    const result: unknown = await response.json();
    finished('available');
    return result;
  } catch (error) {
    finished('invalid');
    throw error;
  }
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

function isSleeperCoOwners(value: unknown): value is string[] | null | undefined {
  return value === undefined || value === null
    || (Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0 && item === item.trim())
      && new Set(value).size === value.length);
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

function isSleeperRoster(value: unknown): value is SleeperRoster {
  return isRecord(value) && typeof value.roster_id === 'number' && Number.isInteger(value.roster_id)
    && value.roster_id > 0 && isOptionalString(value.owner_id)
    && isSleeperCoOwners(value.co_owners)
    && isStringArray(value.players) && isStringArray(value.starters)
    && isStringArray(value.reserve) && isStringArray(value.taxi)
    && validRosterSettings(value.settings) && isOptionalRecord(value.metadata);
}

function isSleeperRosterForRosterView(value: unknown): value is SleeperRoster {
  return isRecord(value) && typeof value.roster_id === 'number' && Number.isInteger(value.roster_id)
    && value.roster_id > 0 && isOptionalString(value.owner_id)
    && isSleeperCoOwners(value.co_owners)
    && isStringArray(value.players) && isStringArray(value.starters)
    && isStringArray(value.reserve) && isStringArray(value.taxi)
    && validRosterViewSettings(value.settings) && isOptionalRecord(value.metadata);
}

function isSleeperUser(value: unknown): value is SleeperUser {
  return isRecord(value) && typeof value.user_id === 'string' && Boolean(value.user_id.trim())
    && isOptionalString(value.display_name) && isOptionalString(value.username)
    && isOptionalString(value.avatar) && isOptionalRecord(value.metadata);
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

function parseRows<T>(
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

function assertRosterCompleteness(league: SleeperLeague, rosters: readonly SleeperRoster[]): void {
  if (rosters.length !== league.total_rosters) {
    throw new Error(`Sleeper returned ${rosters.length} of ${league.total_rosters} league rosters.`);
  }
}

function assertCoreCompleteness(league: SleeperLeague, rosters: SleeperRoster[], users: SleeperUser[]): void {
  assertRosterCompleteness(league, rosters);
  const userIds = new Set(users.map((user) => user.user_id));
  if (rosters.some((roster) => roster.owner_id && !userIds.has(roster.owner_id))) {
    throw new Error('Sleeper returned incomplete manager information for the league rosters.');
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

// Reuse the existing season feed/cache across calendar and exact-week schedule
// reads. The decision itself is evaluated per request, never cached for an hour.
const getSeasonSchedule = cache((season: string) => (
  fetchExternalJson(`${SEASON_SCHEDULE_API}/${season}`, SEASON_SCHEDULE_CACHE_SECONDS)
));
const calendarEvaluationTime = cache(() => new Date().toISOString());

const getLeagueCalendar = cache(async (leagueId: string, revalidate: number, evaluatedAt?: string,
  mode: AdministrationReadMode = 'page') => {
  const requestStartedAt = new Date().toISOString();
  const [leagueObservation, stateResult] = await Promise.all([
    readAdministration(leagueId, 'league', null, mode, revalidate),
    fetchJson('/state/nfl', revalidate).then(
      (value) => ({ value }),
      () => ({ value: null }),
    ),
  ]);
  const rawLeague = leagueObservation.payload;
  if (!isSleeperLeague(rawLeague) || rawLeague.league_id !== leagueId) {
    throw new Error('Sleeper did not return a valid league. Please check the league configuration.');
  }
  const state = isSleeperState(stateResult.value) ? stateResult.value : null;
  let lifecycle = sleeperLeagueLifecycle(rawLeague, state);
  const asOf = evaluatedAt ?? calendarEvaluationTime();
  // Sleeper retains league lifecycle authority. Once a league is in season,
  // retain the site's calendar through completion so a later provider phase or
  // last_scored_leg cannot move a published display week backward.
  let siteWeek: SiteWeekResolution | null = null;
  let weeklyMetrics: WeeklyPlayerMetricWindow | null = null;
  let calendarUnavailable = false;
  if (lifecycle !== 'preseason') {
    try {
      const scheduleInput = { season: rawLeague.season,
        seasonSchedule: await getSeasonSchedule(rawLeague.season), evaluatedAt: asOf };
      siteWeek = resolveSiteWeek(scheduleInput);
      weeklyMetrics = resolveWeeklyPlayerMetrics(scheduleInput);
    } catch {
      // A schedule outage must not hide official teams, scores or transactions.
      // A retained display choice is never fresh worker or scoring authority.
      calendarUnavailable = true;
    }
  }
  if (siteWeek?.lastCompletedWeek === 18) lifecycle = 'complete';
  const league = normalizeLeague(rawLeague, state);
  if (siteWeek) league.week = siteWeek.week;
  if (calendarUnavailable && evaluatedAt === undefined) {
    const retained = await getRetainedSiteCalendar(leagueId, Number(rawLeague.season));
    if (retained) { league.week = retained.week; lifecycle = retained.lifecycle; }
  }
  const activeWeek = lifecycle === 'active' ? siteWeek?.week ?? null : null;
  // Current workers check their proposal against the existing batched durable
  // read after SQL publication. Reader calls use the same authority as a floor.
  if (evaluatedAt === undefined) await assertSiteCalendarNotRegressed({
    leagueId, season: Number(rawLeague.season), week: league.week, lifecycle,
  });
  const requestCompletedAt = new Date().toISOString();
  return {
    sourceLeague: rawLeague,
    leagueObservation,
    state,
    league,
    lifecycle,
    activeWeek,
    siteWeek,
    weeklyMetrics,
    calendarUnavailable,
    warning: calendarUnavailable
      ? 'NFL calendar is temporarily unavailable. The displayed week is a fallback; automatic week advancement is paused.'
      : undefined,
    evaluatedAt: asOf,
    requestStartedAt,
    requestCompletedAt,
  };
});

type LeagueRosterFeed = Readonly<{
  observation: CapturedAdministrationDocument;
  rosters: SleeperRoster[];
  malformedRosterIds: readonly number[];
  malformedRowCount: number;
  rosterViewMalformedRowCount: number;
}>;

/** One canonical roster fetch supports both strict legacy consumers and tolerant Rosters UI. */
const getLeagueRosterFeed = cache(async (leagueId: string, mode: AdministrationReadMode = 'page',
  season?: number): Promise<LeagueRosterFeed> => {
  const path = `/league/${leagueId}/rosters`;
  const observation = await readAdministration(leagueId, 'rosters', null, mode, CORE_CACHE_SECONDS, season);
  const value = observation.payload;
  if (!Array.isArray(value)) throw new Error(`Sleeper returned an invalid response for ${path}.`);
  const rosters: SleeperRoster[] = [];
  const malformedRosterIds = new Set<number>();
  const seen = new Set<number>();
  let malformedRowCount = 0;
  let rosterViewMalformedRowCount = 0;
  for (const row of value) {
    const rosterId = isRecord(row) && typeof row.roster_id === 'number'
      && Number.isInteger(row.roster_id) && row.roster_id > 0 ? row.roster_id : null;
    if (rosterId === null || seen.has(rosterId)) {
      malformedRowCount += 1;
      rosterViewMalformedRowCount += 1;
      if (rosterId !== null) malformedRosterIds.add(rosterId);
      continue;
    }
    seen.add(rosterId);
    if (!isSleeperRoster(row)) {
      malformedRowCount += 1;
      malformedRosterIds.add(rosterId);
    }
    if (!isSleeperRosterForRosterView(row)) rosterViewMalformedRowCount += 1;
    // Invalid ownership evidence must not become a valid primary-owner-only row.
    // Strict consumers reject it; tolerant views retain the other valid rosters.
    if (!isSleeperCoOwners(row.co_owners)) continue;
    rosters.push({
      roster_id: rosterId,
      owner_id: typeof row.owner_id === 'string' && row.owner_id.trim() ? row.owner_id : null,
      co_owners: row.co_owners ?? null,
      players: isStringArray(row.players) && Array.isArray(row.players) ? row.players : null,
      starters: isStringArray(row.starters) && Array.isArray(row.starters) ? row.starters : null,
      reserve: isStringArray(row.reserve) && Array.isArray(row.reserve) ? row.reserve : null,
      taxi: isStringArray(row.taxi) && Array.isArray(row.taxi) ? row.taxi : null,
      settings: isRecord(row.settings) ? row.settings : null,
      metadata: isRecord(row.metadata) ? row.metadata : null,
    });
  }
  return { observation, rosters, malformedRosterIds: [...malformedRosterIds], malformedRowCount, rosterViewMalformedRowCount };
});

const getLeagueUsers = cache(async (leagueId: string, mode: AdministrationReadMode = 'page', season?: number) => {
  const observation = await readAdministration(leagueId, 'users', null, mode, CORE_CACHE_SECONDS, season);
  return { observation, users: parseRows<SleeperUser>(observation.payload,
    `/league/${leagueId}/users`, isSleeperUser, (row) => row.user_id) };
});

const getCore = cache(async (leagueId: string, mode: AdministrationReadMode = 'page') => {
  // Official collection retains its existing parallel fetches. Pages first pin
  // the accepted configuration season before requesting exact scoped records.
  const [calendar, rosterFeed, userFeed] = await (mode === 'official'
    ? Promise.all([getLeagueCalendar(leagueId, CORE_CACHE_SECONDS, undefined, mode),
      getLeagueRosterFeed(leagueId, mode), getLeagueUsers(leagueId, mode)])
    : getLeagueCalendar(leagueId, CORE_CACHE_SECONDS).then(async calendar => {
      const [rosters, users] = await Promise.all([
        getLeagueRosterFeed(leagueId, mode, Number(calendar.sourceLeague.season)),
        getLeagueUsers(leagueId, mode, Number(calendar.sourceLeague.season)),
      ]);
      return [calendar, rosters, users] as const;
    }));
  if (rosterFeed.malformedRowCount) throw new Error(`Sleeper returned an invalid response for /league/${leagueId}/rosters.`);
  const rosters = rosterFeed.rosters;
  const users = userFeed.users;
  const { sourceLeague, state, league } = calendar;
  assertCoreCompleteness(sourceLeague, rosters, users);
  const sourceTeams = normalizeTeams(rosters, users);
  const leagueKey = mode === 'page' ? await findCurrentLeagueKey(leagueId) : null;
  const teams = mode === 'page' ? displayedManagerTeams(leagueId, sourceTeams, rosters, leagueKey) : sourceTeams;
  const overview: OverviewData = {
    league,
    teams,
    updatedAt: new Date().toISOString(),
    warning: joinWarnings(
      calendar.warning,
      state ? undefined : 'NFL week information is temporarily unavailable; game status cannot be confirmed.',
      teams.length ? undefined : 'Sleeper has not provided any league rosters yet.',
    ),
  };
  return { overview, sourceLeague, state, rosters, calendar, leagueKey,
    administrationObservations: [calendar.leagueObservation, rosterFeed.observation, userFeed.observation] };
});

const getRosterCore = cache(async (leagueId: string) => {
  const calendar = await getLeagueCalendar(leagueId, CORE_CACHE_SECONDS);
  const [rosterFeed, userFeed] = await Promise.all([
    getLeagueRosterFeed(leagueId, 'page', Number(calendar.sourceLeague.season)),
    getLeagueUsers(leagueId, 'page', Number(calendar.sourceLeague.season)),
  ]);
  const users = userFeed.users;
  const { sourceLeague, state, league } = calendar;
  const leagueKey = await findCurrentLeagueKey(leagueId);
  const teams = displayedManagerTeams(leagueId, normalizeTeams(rosterFeed.rosters, users), rosterFeed.rosters, leagueKey);
  const missing = Math.max(0, sourceLeague.total_rosters - rosterFeed.rosters.length);
  const affected = Math.max(rosterFeed.rosterViewMalformedRowCount, missing);
  const overview: OverviewData = {
    league,
    teams,
    updatedAt: calendar.requestCompletedAt,
    warning: joinWarnings(
      calendar.warning,
      state ? undefined : 'NFL week information is temporarily unavailable; game status cannot be confirmed.',
      teams.length ? undefined : 'Sleeper has not provided any league rosters yet.',
      affected ? `Sleeper returned incomplete or malformed data for ${affected} roster${affected === 1 ? '' : 's'}; other teams remain available.` : undefined,
    ),
  };
  return { overview, sourceLeague, state, rosterFeed, calendar, users, leagueKey };
});

// Cache only the small fields we display. Position-filtered responses avoid the
// full catalog's multi-megabyte cold request, and separate entries let one failed
// position recover without removing names that loaded successfully. The retry
// guard lives inside the cached callback so normal cache hits always remain usable.
// /players/nfl supplies current metadata, not injury history for a requested week.
const cachedPlayerPosition = unstable_cache(
  loadFantasyPlayerPositionCatalog,
  ['league-one-player-position-catalog-v1'],
  { revalidate: PLAYER_CACHE_SECONDS },
);

const getPlayers = cache(() => loadFantasyPlayerCatalog(cachedPlayerPosition));

/** Shared worker/catalog boundary. It deliberately reuses the same daily,
 * position-filtered player catalog as league reads instead of creating an
 * all-player ingestion catalog or per-player request path. */
export async function getFantasyPlayerCatalog(): Promise<FantasyPlayerCatalog> {
  return getPlayers();
}

export async function getWeekSchedule(season: string, week: number): Promise<{
  schedule: WeekSchedule;
  byeWeeks: Record<string, number>;
  canIdentifyByes: boolean;
  warning?: string;
}> {
  if (!/^\d{4}$/u.test(season)) {
    return { schedule: {}, byeWeeks: {}, canIdentifyByes: false, warning: 'NFL opponent and kickoff information is temporarily unavailable.' };
  }
  const [seasonScheduleValue, scoresValue] = await Promise.all([
    getSeasonSchedule(season).catch(() => null),
    fetchExternalJson(`${SCORES_API}/${season}/${week}`).catch(() => null),
  ]);
  const result = resolveSleeperSchedule(seasonScheduleValue, scoresValue, season, week);
  const schedule: WeekSchedule = { ...result.schedule };
  // Canonical bye identities come from complete season evidence, independently
  // of which teams happen to occur in current player metadata or league rosters.
  if (result.canIdentifyByes) for (const team of NFL_TEAMS) schedule[team] ??= { kind: 'bye' };
  return {
    schedule,
    byeWeeks: normalizeSleeperByeWeeks(seasonScheduleValue),
    canIdentifyByes: result.canIdentifyByes,
    warning: result.complete ? undefined : 'Some NFL opponent or kickoff information is temporarily unavailable.',
  };
}

export async function getOverview(leagueId: string): Promise<OverviewData> {
  return (await getCore(leagueId)).overview;
}

/** Reuse accepted page ownership; honors stay separate from official snapshots. */
export async function getManagerHonors(leagueId: string): Promise<ManagerHonors> {
  const { overview, rosterFeed, users, leagueKey } = await getRosterCore(leagueId);
  const owners = new Map(rosterFeed.rosters.map(roster => [roster.roster_id,
    displayedManagerOwnerId(leagueId, roster.roster_id, roster.owner_id, roster.co_owners, leagueKey)]));
  const sourceOwners = new Map(rosterFeed.rosters.map(roster => [roster.roster_id, roster.owner_id]));
  const knownUsers = new Set(users.map(user => user.user_id));
  const ambiguousRosters = new Set(rosterFeed.malformedRosterIds);
  return {
    leagueId,
    season: overview.league.season,
    managers: Object.fromEntries(overview.teams.filter(team => !ambiguousRosters.has(team.id)
      && (knownUsers.has(sourceOwners.get(team.id) ?? '') || knownUsers.has(owners.get(team.id) ?? ''))).map(team => [team.id, {
      managerName: team.managerName,
      championshipYears: leagueOneChampionshipYears(owners.get(team.id)),
      promotionChampionshipYears: leagueTwoChampionshipYears(owners.get(team.id)),
    }])),
  };
}

/** Attach owner-supplied honors using the same accepted roster ownership read. */
export async function getManagers(leagueId: string): Promise<ManagersData> {
  const { overview, rosters, leagueKey } = await getCore(leagueId);
  const ownerByRoster = new Map(rosters.map((roster) => [roster.roster_id,
    displayedManagerOwnerId(leagueId, roster.roster_id, roster.owner_id, roster.co_owners, leagueKey)]));
  return {
    ...overview,
    teams: overview.teams.map((team) => ({
      ...team,
      championshipYears: leagueOneChampionshipYears(ownerByRoster.get(team.id)),
      promotionChampionshipYears: leagueTwoChampionshipYears(ownerByRoster.get(team.id)),
    })),
  };
}

/** History is requested only when its tab is opened. It uses official weekly
 * results, never projections or season aggregates that may include playoffs. */
export async function getManagersHistory(leagueId: string, leagueKey: LeagueKey): Promise<ManagersData> {
  const [data, core] = await Promise.all([getManagers(leagueId), getCore(leagueId)]);
  const currentSeason = Number(core.sourceLeague.season);
  const regularEnd = (league: SleeperLeague) => {
    const start = league.settings?.playoff_week_start;
    return typeof start === 'number' && Number.isInteger(start) && start > 0
      ? Math.max(0, Math.min(14, start - 1)) : 14;
  };
  const unsupported = (league: SleeperLeague) =>
    Number(league.settings?.league_average_match ?? 0) !== 0
    || Number(league.settings?.best_ball ?? 0) !== 0
    || Number(league.settings?.start_week ?? 1) !== 1;
  const throughWeek = core.calendar.lifecycle === 'preseason' ? 0
    : core.calendar.lifecycle === 'complete' ? regularEnd(core.sourceLeague)
      : core.calendar.activeWeek === null ? null : Math.min(regularEnd(core.sourceLeague), core.calendar.activeWeek - 1);
  const current = await loadRosterHistory(leagueId, throughWeek, currentSeason);
  const seasons: ManagerHistorySeason[] = [{
    season: currentSeason, externalLeagueId: leagueId, teams: data.teams, rosters: core.rosters, throughWeek,
    rows: current.rows.map((rows, index) => current.malformedWeeks.includes(index + 1) ? null : rows),
    ...(unsupported(core.sourceLeague) ? { unavailableReason: `${currentSeason} uses unsupported extra-match or season settings.` } : {}),
  }];
  let source = core.sourceLeague;
  // League One includes its approved 2024 history; the other leagues retain
  // their existing 2025 boundary. Future renewals retain these starting years.
  const firstSeason = leagueKey === 'league1' ? 2024 : 2025;
  // A bounded chain prevents corrupt or circular provider links from fanout.
  const seen = new Set([leagueId]);
  for (let season = currentSeason - 1; season >= firstSeason; season -= 1) {
    let historicalId = source.previous_league_id;
    try {
      if (seen.size >= 20 || typeof historicalId !== 'string' || !/^\d+$/u.test(historicalId)
        || seen.has(historicalId)) throw new Error('The prior-season league connection is missing or invalid.');
      seen.add(historicalId);
      const observation = await readAdministration(historicalId, 'league', null, 'history', 86_400, season, leagueKey);
      if (!isSleeperLeague(observation.payload) || observation.payload.league_id !== historicalId
        || observation.payload.season !== String(season) || observation.payload.status !== 'complete') {
        throw new Error('The prior-season league identity or completed status could not be verified.');
      }
      source = observation.payload;
      const [rosterObservation, userObservation] = await Promise.all([
        readAdministration(historicalId, 'rosters', null, 'history', 86_400, season, leagueKey),
        readAdministration(historicalId, 'users', null, 'history', 86_400, season, leagueKey),
      ]);
      const rosters = parseRows<SleeperRoster>(rosterObservation.payload, 'historical rosters', isSleeperRoster, row => String(row.roster_id));
      const users = parseRows<SleeperUser>(userObservation.payload, 'historical users', isSleeperUser, row => row.user_id);
      assertCoreCompleteness(source, rosters, users);
      const historicalThroughWeek = regularEnd(source);
      const history = await loadRosterHistory(historicalId, historicalThroughWeek, season, 'history', leagueKey);
      seasons.push({ season, externalLeagueId: historicalId, teams: normalizeTeams(rosters, users), rosters,
        throughWeek: historicalThroughWeek,
        rows: history.rows.map((rows, index) => history.malformedWeeks.includes(index + 1) ? null : rows),
        ...(unsupported(source) ? { unavailableReason: `${season} uses unsupported extra-match or season settings.` } : {}),
      });
    } catch {
      historicalId = typeof historicalId === 'string' ? historicalId : '';
      seasons.push({ season, externalLeagueId: historicalId, teams: [], rosters: [], throughWeek: null, rows: [],
        unavailableReason: `${season} manager history is unavailable; its league connection, owners, and weekly results must be verified.` });
      break;
    }
  }
  return { ...data, history: { ...buildManagerHistory(seasons, currentSeason, leagueKey),
    label: `${firstSeason}–${currentSeason} · Regular season · Weeks 1–14` } };
}

/** Reuse current official standings order without loading projected standings history. */
export async function getCurrentStandings(leagueId: string): Promise<CurrentStandings> {
  const { overview, sourceLeague } = await getCore(leagueId);
  const playoffTeams = sourceLeague.settings?.playoff_teams;
  return {
    leagueId,
    season: overview.league.season,
    playoffTeams: typeof playoffTeams === 'number' && Number.isInteger(playoffTeams)
      && playoffTeams >= 0 && playoffTeams <= overview.teams.length ? playoffTeams : null,
    places: Object.fromEntries(overview.teams.map((team, index) => [team.id, index + 1])),
  };
}

export async function getStandings(leagueId: string): Promise<StandingsData> {
  const { overview, rosters, sourceLeague, calendar } = await getCore(leagueId);
  const teams = addWaiverBalances(overview.teams, rosters, sourceLeague.settings?.waiver_budget);
  return {
    ...overview,
    teams,
    projectionBasis: await getStandingsProjectionBasis(leagueId, sourceLeague, calendar.activeWeek, rosters, teams),
  };
}

async function getStandingsProjectionBasis(
  leagueId: string,
  league: SleeperLeague,
  week: number | null,
  rosters: readonly SleeperRoster[],
  teams: readonly StandingsTeam[],
): Promise<ProjectedStandingsBasis> {
  if (week === null) return { kind: 'unavailable', reason: 'There is no confirmed active regular-season week.' };
  const settings = league.settings;
  const playoffStart = settings?.playoff_week_start;
  // These leagues use ordinary head-to-head records. Do not silently project a
  // median game, division seed, best-ball result, or an unproved scoring period.
  if (settings?.start_week !== 1 || settings.league_average_match !== 0 || settings.best_ball !== 0
    || (settings.divisions !== undefined && settings.divisions !== 0)
    || rosters.some((roster) => roster.settings?.division != null && roster.settings.division !== 0)
    || typeof playoffStart !== 'number' || !Number.isInteger(playoffStart) || playoffStart < 0 || playoffStart > 18
    || (playoffStart > 0 && week >= playoffStart)) {
    return { kind: 'unavailable', reason: 'Projected standings are unavailable for these league settings.' };
  }
  const history = await loadRosterHistory(leagueId, week - 1, Number(league.season));
  if (history.failedWeeks.length || history.malformedWeeks.length) {
    return { kind: 'unavailable', reason: 'Completed matchup history is temporarily incomplete.' };
  }
  const basis = buildCompletedStandingsBasis(teams, week, history.rows);
  if (basis.kind === 'unavailable' || standingsTotalsMatch(teams, basis.teams)) return basis;
  // Aggregates may already include this week. Prove that from the existing raw
  // reader rather than trusting last_scored_leg or subtracting projected points.
  try {
    const current = await getCachedRosterWeek(leagueId, week, Number(league.season));
    return reconcileStandingsBasis(basis, teams, current.invalidRowCount ? null : current.rows);
  } catch {
    return { kind: 'unavailable', reason: 'Official standings could not be reconciled with matchup history.' };
  }
}

function lastScoredWeek(league: SleeperLeague): number | null {
  const value = league.settings?.last_scored_leg;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 18 ? value : null;
}

function rosterRecord(roster: SleeperRoster | undefined): Readonly<{ wins: number; losses: number; ties: number }> | null {
  const wins = roster?.settings?.wins;
  const losses = roster?.settings?.losses;
  const ties = roster?.settings?.ties;
  return [wins, losses, ties].every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)
    ? { wins: wins as number, losses: losses as number, ties: ties as number }
    : null;
}

function standingsPointsForAvailable(roster: SleeperRoster | undefined): boolean {
  return typeof roster?.settings?.fpts === 'number' && Number.isFinite(roster.settings.fpts)
    && (roster.settings.fpts_decimal === undefined
      || (typeof roster.settings.fpts_decimal === 'number' && Number.isFinite(roster.settings.fpts_decimal)));
}

const getCachedRosterWeek = cache(async (leagueId: string, week: number, season?: number,
  mode: AdministrationReadMode = 'page', leagueKey?: LeagueKey) => (
  loadAdministrationMatchups(leagueId, week, mode, mode === 'history' ? 86_400 : CORE_CACHE_SECONDS, true, season, leagueKey)
));

async function loadRosterHistory(leagueId: string, throughWeek: number | null, season?: number,
  mode: AdministrationReadMode = 'page', leagueKey?: LeagueKey): Promise<{
  rows: Array<SleeperMatchup[] | null>;
  failedWeeks: number[];
  malformedWeeks: number[];
}> {
  if (throughWeek === null || throughWeek < 1) return { rows: [], failedWeeks: [], malformedWeeks: [] };
  const rows: Array<SleeperMatchup[] | null> = Array.from({ length: throughWeek }, () => null);
  const failedWeeks: number[] = [];
  const malformedWeeks: number[] = [];
  let next = 1;
  await Promise.all(Array.from({ length: Math.min(4, throughWeek) }, async () => {
    while (next <= throughWeek) {
      const week = next++;
      try {
        const observation = mode === 'page' ? await getCachedRosterWeek(leagueId, week, season)
          : await getCachedRosterWeek(leagueId, week, season, mode, leagueKey);
        const invalidIds = new Set(observation.invalidRosterIds ?? []);
        rows[week - 1] = observation.rows.filter((row) => !invalidIds.has(row.roster_id));
        if (observation.invalidRowCount) malformedWeeks.push(week);
      } catch {
        failedWeeks.push(week);
      }
    }
  }));
  return {
    rows,
    failedWeeks: failedWeeks.sort((a, b) => a - b),
    malformedWeeks: malformedWeeks.sort((a, b) => a - b),
  };
}

/** Reuse the cached official history reader; schedule cards need no player or projection loads. */
export async function getMyTeamSchedule(
  leagueId: string,
  throughWeek: ScheduleWeekCount = MY_TEAM_SCHEDULE_WEEKS,
): Promise<MyTeamScheduleData> {
  const core = await getCore(leagueId);
  const [history, seasonSchedule] = await Promise.all([
    loadRosterHistory(leagueId, throughWeek, Number(core.sourceLeague.season)),
    core.calendar.siteWeek ? getSeasonSchedule(core.sourceLeague.season) : Promise.resolve(null),
  ]);
  // The existing calendar validates the complete season's identities and dates.
  // Exact-week complete-game evidence may finish before the display's noon rollover.
  // A retained display week or last_scored_leg alone never manufactures a result.
  const games = core.calendar.siteWeek ? validatedSleeperSeasonGames(seasonSchedule) : null;
  const completedWeeks = games ? Array.from({ length: throughWeek }, (_, index) => index + 1)
    .filter(week => week <= core.calendar.siteWeek!.week
      && games.filter(game => game.week === week).every(game => game.status === 'complete')) : [];
  return {
    ...core.overview,
    // A malformed row may conceal a third side or conflicting pairing. The
    // tolerant history loader omits it, so this new display must withhold that
    // week's pairings rather than infer a result from the remaining two rows.
    weeks: buildMyTeamScheduleWeeks(core.overview.teams,
      history.rows.map((rows, index) => history.malformedWeeks.includes(index + 1) ? null : rows), {
      completedWeeks, activeWeek: core.calendar.activeWeek, preseason: core.calendar.lifecycle === 'preseason',
    }, throughWeek),
    warning: joinWarnings(core.overview.warning,
      history.failedWeeks.length || history.malformedWeeks.length
        ? 'Some weekly schedule or result data is temporarily unavailable.' : undefined),
  };
}

function validLineupMembership(row: SleeperMatchup | undefined, slots: readonly string[]): row is SleeperMatchup & { players: string[]; starters: string[] } {
  if (!row || !Array.isArray(row.players) || !Array.isArray(row.starters)) return false;
  const playerIds = row.players;
  const starterIds = row.starters;
  const validPlayerIds = playerIds.every((id) => typeof id === 'string' && id !== '0'
    && id.trim() === id && Boolean(id));
  const validStarterIds = starterIds.every((id) => typeof id === 'string'
    && id.trim() === id && Boolean(id));
  const nonEmptyStarters = starterIds.filter((id) => id !== '0');
  return validPlayerIds && new Set(playerIds).size === playerIds.length
    && starterIds.length === slots.length
    && validStarterIds && new Set(nonEmptyStarters).size === nonEmptyStarters.length
    && nonEmptyStarters.every((id) => playerIds.includes(id));
}

function rosterPlayer(
  id: string | null | undefined,
  slot: string,
  catalog: PlayerCatalog,
  schedule: WeekSchedule,
  byeWeeks: Record<string, number>,
  canDecorate: boolean,
  showInjury: boolean,
  index: number,
): RosterPlayer {
  const player = playerFromId(id, slot, catalog, null, index);
  const nflTeam = canonicalNflTeam(player.nflTeam);
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    nflTeam: player.nflTeam,
    injuryStatus: showInjury ? player.injuryStatus : null,
    game: canDecorate && nflTeam ? schedule[nflTeam] ?? null : null,
    slot,
    byeWeek: canDecorate && nflTeam ? byeWeeks[nflTeam] ?? null : null,
    positionRank: null,
    ppg: null,
  };
}

export type RosterMetricContext = Readonly<{
  season: number | null;
  seasonType: 'reg';
  throughWeek: number | null;
  provisionalWeek: number | null;
  asOf: string | null;
  nextRefreshAt: string | null;
  /** Distinguishes a proved nonactive selection from temporarily missing authority. */
  activeWeekKnown: boolean;
}>;

export type RostersLoad = Readonly<{
  data: RostersData;
  metricContext: RosterMetricContext;
}>;

/** One bounded league/week load supplies every expandable roster card. */
export async function getRostersWithMetricContext(
  leagueId: string,
  requestedWeek?: number,
): Promise<RostersLoad> {
  const core = await getRosterCore(leagueId);
  const currentWeek = core.overview.league.week;
  const selectedWeek = requestedWeek === undefined ? currentWeek
    : Number.isInteger(requestedWeek) && requestedWeek >= 1 && requestedWeek <= core.overview.league.maxWeek
      ? requestedWeek : currentWeek;
  const lifecycle = core.calendar.lifecycle;
  const boundaryInput = {
    selectedWeek,
    activeWeek: core.calendar.activeWeek,
    lastScoredWeek: lastScoredWeek(core.sourceLeague),
    lifecycle,
  } as const;
  const historyThrough = rosterHistoryBoundary(boundaryInput);
  const metricBoundary = playerMetricBoundary({ selectedWeek, window: core.calendar.weeklyMetrics });
  const canDecorate = canDecorateMatchupWeek(core.sourceLeague, core.state, selectedWeek, core.calendar);
  const [selectedObservation, history, players, nflSchedule] = await Promise.all([
    getCachedRosterWeek(leagueId, selectedWeek, Number(core.sourceLeague.season)),
    loadRosterHistory(leagueId, historyThrough, Number(core.sourceLeague.season)),
    getPlayers(),
    canDecorate
      ? getWeekSchedule(core.overview.league.season, selectedWeek)
      : Promise.resolve({ schedule: {} as WeekSchedule, byeWeeks: {} as Record<string, number>, canIdentifyByes: false, warning: undefined }),
  ]);
  const rosterIds = core.rosterFeed.rosters.map((roster) => roster.roster_id);
  const teamPpg = calculateTeamPpg(history.rows, historyThrough ?? 0, rosterIds);
  const averageRanksAvailable = rosterIds.length === core.sourceLeague.total_rosters;
  const selectedByRoster = new Map(selectedObservation.rows.map((row) => [row.roster_id, row]));
  const sourceRosterById = new Map(core.rosterFeed.rosters.map((roster) => [roster.roster_id, roster]));
  const standingsTeams = addWaiverBalances(core.overview.teams, core.rosterFeed.rosters, core.sourceLeague.settings?.waiver_budget);
  const standingsAvailable = standingsTeams.length === core.sourceLeague.total_rosters
    && standingsTeams.every((team) => rosterRecord(sourceRosterById.get(team.id)) !== null
      && standingsPointsForAvailable(sourceRosterById.get(team.id))
      && Boolean(team.name.trim()));
  const rankedTeams = standingsAvailable
    ? [...standingsTeams].sort(compareRosterStandings)
    : [...standingsTeams].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id);
  const slots = startingSlots(core.overview.league.rosterPositions);
  // The same site calendar controls lineup reference, history and metric bounds.
  const rosterReferenceWeek = boundaryInput.activeWeek ?? core.overview.league.week;
  let futureSlateReady = true;
  if (selectedWeek > rosterReferenceWeek) {
    try {
      assertProjectionMatchupReadiness(selectedObservation.rows, core.rosterFeed.rosters, core.overview.league.rosterPositions);
    } catch {
      futureSlateReady = false;
    }
  }
  const currentMetadataAuthoritative = selectedWeek === rosterReferenceWeek
    && !core.calendar.calendarUnavailable
    && lifecycle !== 'complete' && core.sourceLeague.season === core.state?.season;
  const showCurrentGroups = currentMetadataAuthoritative;
  const showCurrentInjury = currentMetadataAuthoritative;
  const teams = rankedTeams.map((team, teamIndex) => {
    const row = selectedByRoster.get(team.id);
    const sourceRoster = sourceRosterById.get(team.id);
    const sourceRecord = rosterRecord(sourceRoster);
    const membershipAvailable = futureSlateReady
      && !(selectedObservation.invalidRosterIds ?? []).includes(team.id)
      && validLineupMembership(row, slots);
    const sections: RosterSection[] = [];
    if (membershipAvailable) {
      const starterIds = new Set(row.starters.filter((id) => id !== '0'));
      const reserveIds = showCurrentGroups ? new Set(sourceRoster?.reserve ?? []) : new Set<string>();
      const taxiIds = showCurrentGroups ? new Set(sourceRoster?.taxi ?? []) : new Set<string>();
      sections.push({
        name: 'Starters',
        players: row.starters.map((id, index) => rosterPlayer(id, slots[index] ?? '—', players.catalog,
          nflSchedule.schedule, nflSchedule.byeWeeks, canDecorate, showCurrentInjury, index)),
      });
      const categorize = (predicate: (id: string) => boolean, slot: string) => row.players
        .filter((id) => id !== '0' && !starterIds.has(id) && predicate(id))
        .map((id, index) => rosterPlayer(id, slot, players.catalog, nflSchedule.schedule,
          nflSchedule.byeWeeks, canDecorate, showCurrentInjury, index));
      sections.push({ name: 'Bench', players: categorize((id) => !reserveIds.has(id) && !taxiIds.has(id), 'BN') });
      const reserve = categorize((id) => reserveIds.has(id), 'IR');
      if (reserve.length) sections.push({ name: 'IR', players: reserve });
      const taxi = categorize((id) => taxiIds.has(id) && !reserveIds.has(id), 'TAXI');
      if (taxi.length) sections.push({ name: 'Taxi', players: taxi });
    }
    const metric = teamPpg.get(team.id);
    return {
      id: team.id,
      name: team.name,
      managerName: team.managerName,
      avatar: team.avatar,
      wins: sourceRecord?.wins ?? null,
      losses: sourceRecord?.losses ?? null,
      ties: sourceRecord?.ties ?? null,
      pointsFor: team.pointsFor,
      waiverOrder: team.waiverOrder,
      waiverBudgetRemaining: team.waiverBudgetRemaining,
      standingsRank: standingsAvailable ? teamIndex + 1 : null,
      averagePpg: metric?.ppg ?? null,
      averagePpgRank: averageRanksAvailable ? metric?.rank ?? null : null,
      rosterAvailable: membershipAvailable,
      sections,
    };
  });
  const historyProblems = [...new Set([...history.failedWeeks, ...history.malformedWeeks])].sort((a, b) => a - b);
  const data: RostersData = {
    league: { ...core.overview.league, week: currentWeek },
    week: selectedWeek,
    currentWeek,
    rostersAvailable: teams.some((team) => team.rosterAvailable),
    playerMetrics: { status: 'unavailable', observedAt: null, throughWeek: null },
    teams,
    updatedAt: selectedObservation.requestCompletedAt,
    warning: joinWarnings(core.overview.warning, players.warning, nflSchedule.warning,
      selectedObservation.invalidRowCount ? 'Some selected-week roster entries were malformed; affected teams are unavailable.' : undefined,
      futureSlateReady ? undefined : 'Sleeper has not established complete lineups for this future week.',
      historyThrough === null ? 'Sleeper did not identify the last completed scoring week; team averages are unavailable.' : undefined,
      historyProblems.length ? `Official scoring history could not be proved for week${historyProblems.length === 1 ? '' : 's'} ${historyProblems.join(', ')}; affected averages and rankings are unavailable.` : undefined),
  };
  const season = Number(core.sourceLeague.season);
  return {
    data,
    metricContext: {
      season: Number.isSafeInteger(season) && season >= 1920 && season <= 2200 ? season : null,
      seasonType: 'reg',
      ...metricBoundary,
      activeWeekKnown: !core.calendar.calendarUnavailable,
    },
  };
}

export async function getRosters(leagueId: string, requestedWeek?: number): Promise<RostersData> {
  return (await getRostersWithMetricContext(leagueId, requestedWeek)).data;
}

type MatchupSourceOptions = Readonly<{
  requestedWeek?: number;
  projectionTarget?: ProjectionTargetPeriod;
  freshMatchups?: boolean;
  includeRosteredPlayers?: boolean;
  loadPlayerCatalog?: () => Promise<FantasyPlayerCatalog>;
}>;

const loadRawMatchups = createRawSleeperMatchupLoader({
  readJson: fetchJson,
  now: () => new Date().toISOString(),
});

async function loadAdministrationMatchups(leagueId: string, week: number, mode: AdministrationReadMode,
  revalidate: number, allowPartial = false, season?: number, leagueKey?: LeagueKey): Promise<RawSleeperMatchupObservation & {
    administrationObservation: CapturedAdministrationDocument;
  }> {
  const observation = await readAdministration(leagueId, 'matchups', week, mode, revalidate, season, leagueKey);
  const path = administrationPath(leagueId, 'matchups', week);
  const parsed = allowPartial ? parseRawSleeperMatchupFeed(observation.payload, path)
    : { rows: parseRawSleeperMatchups(observation.payload, path) };
  return { ...parsed, requestStartedAt: observation.requestStartedAt, requestCompletedAt: observation.requestCompletedAt,
    administrationObservation: observation };
}

/** Bounded collection entry points reuse the same raw administration retrieval. */
/** A bounded fresh recheck of one changed cached document, with no ancillary feeds. */
export async function getOfficialAdministrationObservation(
  leagueId: string, family: AdministrationFamily, week: number | null, revalidate = 0, signal?: AbortSignal,
) {
  if (!leagueId.trim()) throw new Error('A league source ID is required.');
  if (family === 'matchups' || family === 'transactions') {
    if (!Number.isInteger(week) || week === null || week < (family === 'matchups' ? 1 : 0) || week > LAST_MATCHUP_WEEK) {
      throw new Error('Administration week is outside the supported range.');
    }
  } else if (!['league', 'rosters', 'users', 'traded_picks', 'winners_bracket', 'losers_bracket'].includes(family) || week !== null) {
    throw new Error('Administration family does not accept a week.');
  }
  return readOfficialAdministration(leagueId, family, week, revalidate, signal);
}

export type AdministrationMetadataCollection = Readonly<{
  observations: readonly CapturedAdministrationDocument[];
  providerRequests: number;
  reason?: 'metadata-request-budget-exceeded' | 'draft-inventory-limit' | 'metadata-source-partial';
}>;
type AdministrationMetadataOptions = Readonly<{ signal?: AbortSignal; maxRequests: number; maxDrafts?: number }>;

function validateMetadataRequest(leagueId: string, season: number, options: AdministrationMetadataOptions) {
  if (!leagueId.trim() || !Number.isInteger(season) || season < 1920 || season > 2200
    || !Number.isInteger(options.maxRequests) || options.maxRequests < 0 || options.maxRequests > 120
    || !Number.isInteger(options.maxDrafts ?? 8) || (options.maxDrafts ?? 8) < 1 || (options.maxDrafts ?? 8) > 8) {
    throw new Error('Invalid bounded administration metadata request.');
  }
  options.signal?.throwIfAborted();
}

function metadataDocument(family: AdministrationFamily, payload: unknown, started: string, complete: boolean): CapturedAdministrationDocument {
  const completed = new Date().toISOString();
  return { family, week: null, payload, requestStartedAt: started, requestCompletedAt: completed,
    sourceObservedAt: complete ? completed : null, origin: 'network', completeness: complete ? 'complete' : 'partial' };
}

/** Each bundle retains all four provider bodies. The envelope span is a sequence
 * of reads, not a claim that catalog/details/picks were an atomic snapshot. */
export async function getOfficialDraftAdministration(
  leagueId: string, season: number, options: AdministrationMetadataOptions,
): Promise<AdministrationMetadataCollection> {
  validateMetadataRequest(leagueId, season, options);
  const started = new Date().toISOString();
  if (options.maxRequests < 1) return { observations: [metadataDocument('drafts', null, started, false)],
    providerRequests: 0, reason: 'metadata-request-budget-exceeded' };
  let catalog: unknown;
  try { catalog = await fetchJson(`/league/${leagueId}/drafts`, 0, options.signal); }
  catch {
    options.signal?.throwIfAborted();
    return { observations: [metadataDocument('drafts', null, started, false)], providerRequests: 1, reason: 'metadata-source-partial' };
  }
  if (!Array.isArray(catalog)) return { observations: [metadataDocument('drafts', catalog, started, false)],
    providerRequests: 1, reason: 'metadata-source-partial' };
  const bundles = catalog.map(entry => ({ catalog: entry as unknown, draft: null as unknown,
    picks: null as unknown, traded_picks: null as unknown }));
  const partial = (reason: NonNullable<AdministrationMetadataCollection['reason']>): AdministrationMetadataCollection => ({
    observations: [metadataDocument('drafts', bundles, started, false)], providerRequests: 1, reason,
  });
  if (catalog.length > (options.maxDrafts ?? 8)) return partial('draft-inventory-limit');
  // Establish catalog ownership and unique resource IDs before constructing any
  // draft endpoint. Never follow an arbitrary URL or an unowned source draft ID.
  const ids = new Set<string>();
  for (const entry of catalog) {
    if (!isRecord(entry) || typeof entry.draft_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(entry.draft_id)
      || entry.league_id !== leagueId || entry.season !== String(season)
      || (entry.sport !== undefined && entry.sport !== 'nfl') || ids.has(entry.draft_id)) return partial('metadata-source-partial');
    ids.add(entry.draft_id);
  }
  if (1 + catalog.length * 3 > options.maxRequests) return partial('metadata-request-budget-exceeded');
  let providerRequests = 1;
  let complete = true;
  // At most three draft requests are in flight; the entire bundle has one deadline.
  for (const [index, id] of [...ids].entries()) {
    options.signal?.throwIfAborted();
    providerRequests += 3;
    const responses = await Promise.allSettled([
      fetchJson(`/draft/${id}`, 0, options.signal),
      fetchJson(`/draft/${id}/picks`, 0, options.signal),
      fetchJson(`/draft/${id}/traded_picks`, 0, options.signal),
    ]);
    options.signal?.throwIfAborted();
    const [draft, picks, traded] = responses.map(result => result.status === 'fulfilled' ? result.value : null);
    bundles[index] = { ...bundles[index], draft, picks, traded_picks: traded };
    if (responses.some(result => result.status === 'rejected') || !isRecord(draft)
      || draft.draft_id !== id || draft.league_id !== leagueId || draft.season !== String(season)
      || !Array.isArray(picks) || !Array.isArray(traded)) complete = false;
  }
  return { observations: [metadataDocument('drafts', bundles, started, complete)], providerRequests,
    ...(!complete ? { reason: 'metadata-source-partial' as const } : {}) };
}

/** Four metadata families share one explicit global request allowance. */
export async function getOfficialAdministrationMetadata(
  leagueId: string, season: number, options: AdministrationMetadataOptions,
): Promise<AdministrationMetadataCollection> {
  validateMetadataRequest(leagueId, season, options);
  const families = ['traded_picks', 'winners_bracket', 'losers_bracket'] as const;
  const started = new Date().toISOString();
  if (options.maxRequests < 4) return { observations: [...families, 'drafts' as const]
    .map(family => metadataDocument(family, null, started, false)), providerRequests: 0, reason: 'metadata-request-budget-exceeded' };
  const observations = await Promise.all(families.map(async family => {
    const requestedAt = new Date().toISOString();
    try { return await getOfficialAdministrationObservation(leagueId, family, null, 0, options.signal); }
    catch {
      options.signal?.throwIfAborted();
      return metadataDocument(family, null, requestedAt, false);
    }
  }));
  const drafts = await getOfficialDraftAdministration(leagueId, season, { ...options, maxRequests: options.maxRequests - 3 });
  // Sleeper can successfully return JSON null before publishing either bracket.
  // Keep that source state distinct from an empty array and from a failed read.
  const partial = observations.some(document => document.completeness === 'partial'
    || (!Array.isArray(document.payload) && !(document.payload === null
      && (document.family === 'winners_bracket' || document.family === 'losers_bracket'))));
  return { observations: [...observations, ...drafts.observations], providerRequests: 3 + drafts.providerRequests,
    ...(drafts.reason || partial ? { reason: drafts.reason ?? 'metadata-source-partial' as const } : {}) };
}

export async function getOfficialLeagueAdministration(leagueId: string, options: { revalidate?: number; signal?: AbortSignal } = {}) {
  if (!leagueId.trim()) throw new Error('Invalid league administration collection target.');
  const revalidate = options.revalidate ?? CORE_CACHE_SECONDS;
  const observations = await Promise.all((['league', 'rosters', 'users'] as const)
    .map(family => readOfficialAdministration(leagueId, family, null, revalidate, options.signal)));
  return observations;
}

export async function getOfficialMatchupObservation(leagueId: string, week: number, revalidate = CORE_CACHE_SECONDS, signal?: AbortSignal) {
  if (!leagueId.trim() || !Number.isInteger(week) || week < 1 || week > 18) throw new Error('Invalid matchup collection target.');
  return readOfficialAdministration(leagueId, 'matchups', week, revalidate, signal);
}

export async function getOfficialTransactionWeek(leagueId: string, week: number, revalidate = CORE_CACHE_SECONDS, signal?: AbortSignal) {
  if (!leagueId.trim() || !Number.isInteger(week) || week < 0 || week > 18) throw new Error('Invalid transaction collection target.');
  return readOfficialAdministration(leagueId, 'transactions', week, revalidate, signal);
}

/** Thin observers use this exact full-loader boundary, with no ancillary endpoint calls. */
export async function getRawLineupMatchups(
  leagueId: string, week: number, signal?: AbortSignal,
): Promise<RawSleeperMatchupObservation> {
  if (!leagueId.trim() || !Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error('Invalid lineup request target.');
  }
  return loadRawMatchups(leagueId, week, 0, signal);
}

async function loadMatchupSource(
  leagueId: string,
  options: MatchupSourceOptions = {},
): Promise<{
  data: MatchupsData;
  rosteredPlayers: readonly Player[];
  officialPlayerCatalog: FantasyPlayerCatalog;
  currentPlayerStatusPeriod: ProjectionTargetPeriod | null;
  sourceLeague: SleeperLeague;
  schedule: WeekSchedule;
  rawMatchups: readonly SleeperMatchup[];
  matchupShape: SleeperMatchupShape;
  requestStartedAt: string;
  requestCompletedAt: string;
  administrationObservations: readonly CapturedAdministrationDocument[];
}> {
  const {
    requestedWeek,
    projectionTarget,
    freshMatchups = false,
    includeRosteredPlayers = false,
    loadPlayerCatalog = getPlayers,
  } = options;
  if (projectionTarget && requestedWeek !== undefined) {
    throw new Error('A matchup load cannot combine website and projection week selection.');
  }
  const mode: AdministrationReadMode = projectionTarget ? 'official' : 'page';
  const core = await getCore(leagueId, mode);
  if (projectionTarget && core.calendar.calendarUnavailable) {
    throw new Error('NFL calendar authority is unavailable for projection or statistics ingestion.');
  }
  const defaultWeek = core.overview.league.week;
  const week = projectionTarget
    ? projectionTargetWeek(projectionTarget, core.sourceLeague, core.overview.league.maxWeek)
    : requestedWeek === undefined ? defaultWeek
      : Number.isInteger(requestedWeek) && requestedWeek >= 1 && requestedWeek <= core.overview.league.maxWeek
        ? requestedWeek : defaultWeek;
  const status = matchupStatus(core.sourceLeague, core.state, week, Date.parse(core.calendar.evaluatedAt), core.calendar);
  const canDecorate = canDecorateMatchupWeek(core.sourceLeague, core.state, week, core.calendar);
  const [matchupObservation, players, nflSchedule] = await Promise.all([
    loadAdministrationMatchups(
      leagueId,
      week,
      mode,
      freshMatchups ? 0 : CORE_CACHE_SECONDS,
      false,
      Number(core.sourceLeague.season),
    ),
    loadPlayerCatalog(),
    (projectionTarget || canDecorate)
      ? getWeekSchedule(core.overview.league.season, week)
      : Promise.resolve({ schedule: {} as WeekSchedule, canIdentifyByes: false, warning: undefined }),
  ]);
  const { rows, requestStartedAt, requestCompletedAt } = matchupObservation;
  if (projectionTarget) {
    assertProjectionMatchupReadiness(rows, core.rosters, core.overview.league.rosterPositions);
  } else {
    const slateExpected = matchupSlateExpected(core.sourceLeague, core.state, week,
      Date.parse(core.calendar.evaluatedAt), core.calendar);
    assertMatchupCompleteness(rows, core.rosters, slateExpected);
  }
  const currentGroupsAuthoritative = week === (core.calendar.activeWeek ?? core.overview.league.week)
    && !core.calendar.calendarUnavailable && core.calendar.lifecycle !== 'complete'
    && core.sourceLeague.season === core.state?.season;
  const currentPlayerStatusPeriod: ProjectionTargetPeriod | null = currentGroupsAuthoritative
    && core.calendar.lifecycle === 'active' && core.calendar.activeWeek === week
    && core.state?.season_type === 'regular'
    ? { season: Number(core.sourceLeague.season), seasonType: 'regular', week } : null;
  const excludedBenchIds = currentGroupsAuthoritative ? new Map(core.rosters.map((roster) => [
    roster.roster_id, new Set([...(roster.reserve ?? []), ...(roster.taxi ?? [])]),
  ])) : undefined;
  const scheduledMatchups = addScheduleToMatchups(
    normalizeMatchups(rows, core.overview.teams, core.overview.league, players.catalog,
      status, excludedBenchIds),
    canDecorate ? nflSchedule.schedule : {},
    canDecorate && nflSchedule.canIdentifyByes,
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
      canDecorate ? nflSchedule.schedule : {},
      canDecorate && nflSchedule.canIdentifyByes,
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
    officialPlayerCatalog: players,
    currentPlayerStatusPeriod,
    sourceLeague: core.sourceLeague,
    schedule: nflSchedule.schedule,
    rawMatchups: rows,
    matchupShape: sleeperMatchupShape(core.rosters, core.overview.league.rosterPositions),
    requestStartedAt,
    requestCompletedAt,
    administrationObservations: [...core.administrationObservations, matchupObservation.administrationObservation],
  };
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
  return projectionSyncInput(leagueId, source);
}

function projectionSyncInput(
  leagueId: string,
  source: Awaited<ReturnType<typeof loadMatchupSource>>,
): ProjectionSyncInput {
  return {
    sleeperLeagueId: leagueId,
    leagueName: source.sourceLeague.name,
    scoringSettings: source.sourceLeague.scoring_settings ?? null,
    data: source.data,
    rosteredPlayers: source.rosteredPlayers,
    officialPlayerCatalog: source.officialPlayerCatalog,
    currentPlayerStatusPeriod: source.currentPlayerStatusPeriod,
    schedule: source.schedule,
    rawMatchups: source.rawMatchups,
    matchupShape: source.matchupShape,
    requestStartedAt: source.requestStartedAt,
    requestCompletedAt: source.requestCompletedAt,
    administrationObservations: source.administrationObservations,
  };
}

/** Standalone operator counterpart to getProjectionSyncInput. The league-week
 * translation is unchanged, but every catalog read stays outside Next's cache. */
export async function getOperatorProjectionSyncInput(
  leagueId: string,
  targetPeriod: ProjectionTargetPeriod,
  loadPlayerCatalog: () => Promise<FantasyPlayerCatalog> = loadFantasyPlayerCatalog,
): Promise<ProjectionSyncInput> {
  const source = await loadMatchupSource(leagueId, {
    projectionTarget: targetPeriod,
    freshMatchups: true,
    includeRosteredPlayers: true,
    loadPlayerCatalog,
  });
  return projectionSyncInput(leagueId, source);
}

/**
 * Loads only the global calendar inputs needed to decide whether the scheduled
 * worker should wake Neon and fan out across leagues. These requests use a
 * one-minute operational cache and the shared roster metadata. Schedule caching
 * remains unchanged; managers, player catalogs and matchup scores are omitted.
 */
export async function getProjectionCadenceInput(leagueId: string, evaluatedAt?: string): Promise<ProjectionCadenceInput> {
  const [calendar, rosterFeed] = await Promise.all([
    getLeagueCalendar(leagueId, CORE_CACHE_SECONDS, evaluatedAt, 'official'), getLeagueRosterFeed(leagueId, 'official'),
  ]);
  if (rosterFeed.malformedRowCount) throw new Error(`Sleeper returned an invalid response for /league/${leagueId}/rosters.`);
  const rosters = rosterFeed.rosters;
  const {
    sourceLeague, state, league, requestStartedAt, requestCompletedAt,
  } = calendar;
  if (calendar.calendarUnavailable) {
    throw new Error('NFL calendar authority is unavailable for worker cadence.');
  }
  assertRosterCompleteness(sourceLeague, rosters);
  const activeScoringWeek = calendar.activeWeek;
  const workerWeek = activeScoringWeek ?? league.week;
  // Keep the final week's canonical schedule available for the existing final
  // capture/correction lane even after the site calendar finishes Week 18.
  const schedule = calendar.siteWeek || canDecorateMatchupWeek(sourceLeague, state, workerWeek, calendar)
    ? (await getWeekSchedule(league.season, workerWeek)).schedule
    : {};
  const sourceNflWeek = state
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
    leagueLifecycle: calendar.lifecycle,
    leagueStatus: sourceLeague.status,
    schedule,
    matchupShape: sleeperMatchupShape(rosters, league.rosterPositions),
    currentNflSeason: calendar.siteWeek ? league.season : state?.season ?? null,
    currentNflWeek: calendar.siteWeek ? calendar.siteWeek.week : sourceNflWeek,
    currentNflSeasonType: state?.season_type ?? null,
    sourceNflWeek,
    ...(calendar.siteWeek ? { siteWeekPolicy: {
      version: calendar.siteWeek.policyVersion,
      scheduleRevision: calendar.siteWeek.scheduleRevision,
      nextRolloverAt: calendar.siteWeek.nextRolloverAt,
      evaluatedAt: calendar.evaluatedAt,
    } } : {}),
    requestStartedAt,
    requestCompletedAt,
    verifiedAt: new Date().toISOString(),
    administrationObservations: [calendar.leagueObservation, rosterFeed.observation],
  };
}

/** Shared calendar only: league identity, NFL phase and the cached season schedule. */
export async function getCurrentLeagueWeek(leagueId: string): Promise<number> {
  return (await getLeagueCalendar(leagueId, CORE_CACHE_SECONDS)).league.week;
}

/** Browser refresh signal from the same server decision used by worker authority. */
export async function getSiteWeekRollover(leagueId: string): Promise<{
  week: number; nextRolloverAt: string | null; evaluatedAt: string;
}> {
  const calendar = await getLeagueCalendar(leagueId, CORE_CACHE_SECONDS);
  return { week: calendar.league.week, nextRolloverAt: calendar.siteWeek?.nextRolloverAt ?? null,
    evaluatedAt: calendar.evaluatedAt };
}

/** Shared site-calendar fallback when the persisted authority is unavailable. */
export async function getCurrentMatchupPeriodContext(
  leagueId: string,
  requestedWeek?: number,
): Promise<MatchupPeriodContext> {
  const { state, league, lifecycle, activeWeek } = await getLeagueCalendar(leagueId, CORE_CACHE_SECONDS);
  const season = Number(league.season);
  if (!Number.isInteger(season)) throw new Error('Sleeper returned an invalid league season.');
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

export const getTransactionWeeks = cache(async (leagueId: string, lastWeek: number, season?: number) => {
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
        const observation = await readAdministration(leagueId, 'transactions', week, 'page', CORE_CACHE_SECONDS, season);
        rows.push(...parseRows<SleeperTransaction>(observation.payload,
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

export async function getLeagueTransactions(leagueId: string, leagueKey: LeagueKey): Promise<LeagueTransactionsData> {
  const core = await getCore(leagueId);
  const [history, players] = await Promise.all([
    getTransactionWeeks(leagueId, Math.max(core.overview.league.week, transactionEndWeek(core.sourceLeague, core.state)), Number(core.sourceLeague.season)),
    getPlayers(),
  ]);
  const partial = history.failedWeeks.length > 0;
  const activities = normalizeLeagueTransactions(history.rows, leagueKey, core.overview.teams, players.catalog);
  const transactionPlayerIds = dedupeTransactions(history.rows)
    .filter(row => !['pending', 'processing', 'queued'].includes(row.status?.toLowerCase() ?? ''))
    .flatMap(row => [...Object.keys(row.adds ?? {}), ...Object.keys(row.drops ?? {})]);
  return {
    league: core.overview.league,
    updatedAt: core.overview.updatedAt,
    activities,
    warning: joinWarnings(core.overview.warning, players.warning,
      players.warning ? undefined : playerCoverageWarning(players.catalog, transactionPlayerIds),
      partial
        ? `Some transaction history could not be loaded (weeks ${history.failedWeeks.join(', ')}). The list may be incomplete.`
        : undefined),
  };
}

export async function getTransactions(leagueId: string, id: number): Promise<TransactionsData | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  const core = await getCore(leagueId);
  const team = core.overview.teams.find((candidate) => candidate.id === id);
  if (!team) return null;
  const [history, players] = await Promise.all([
    getTransactionWeeks(leagueId, Math.max(core.overview.league.week, transactionEndWeek(core.sourceLeague, core.state)), Number(core.sourceLeague.season)),
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

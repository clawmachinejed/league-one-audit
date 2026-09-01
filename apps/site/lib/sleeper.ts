import 'server-only';

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { LEAGUE_ID } from './config';
import { normalizeInjuryStatus } from './injury-status';
import {
  addScheduleToMatchups,
  resolveSleeperSchedule,
  type WeekSchedule,
} from './nfl-schedule';
import type { MatchupsData, OverviewData, OwnerData, TransactionsData } from './types';
import {
  matchupStatus,
  normalizeLeague,
  normalizeMatchups,
  normalizeTeams,
  normalizeTransactions,
  ownerLineup,
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

const API = 'https://api.sleeper.app/v1';
const SEASON_SCHEDULE_API = 'https://api.sleeper.com/schedule/nfl/regular';
const SCORES_API = 'https://api.sleeper.com/scores/nfl/regular';
const CORE_CACHE_SECONDS = 60;
const SCHEDULE_CACHE_SECONDS = 300;
const SEASON_SCHEDULE_CACHE_SECONDS = 3_600;
// Injury designations change more frequently than names; refresh the catalog hourly.
const PLAYER_CACHE_SECONDS = 3_600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function fetchJson(path: string, revalidate = CORE_CACHE_SECONDS): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    ...(revalidate > 0 ? { next: { revalidate } } : { cache: 'no-store' as const }),
    signal: AbortSignal.timeout(path === '/players/nfl' ? 20_000 : 12_000),
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

async function fetchRows<T>(path: string, key: string): Promise<T[]> {
  const value = await fetchJson(path);
  if (!Array.isArray(value) || value.some((row) => {
    if (!isRecord(row)) return true;
    return key === 'roster_id'
      ? typeof row[key] !== 'number' || !Number.isInteger(row[key]) || row[key] < 1
      : typeof row[key] !== 'string' || !row[key].trim();
  })) {
    throw new Error(`Sleeper returned an invalid response for ${path}.`);
  }
  return value as T[];
}

function joinWarnings(...warnings: Array<string | undefined>): string | undefined {
  return warnings.filter(Boolean).join(' ') || undefined;
}

const getCore = cache(async () => {
  const [rawLeague, rosters, users, stateResult] = await Promise.all([
    fetchJson(`/league/${LEAGUE_ID}`),
    fetchRows<SleeperRoster>(`/league/${LEAGUE_ID}/rosters`, 'roster_id'),
    fetchRows<SleeperUser>(`/league/${LEAGUE_ID}/users`, 'user_id'),
    fetchJson('/state/nfl').then(
      (value) => ({ value }),
      () => ({ value: null }),
    ),
  ]);
  if (!isRecord(rawLeague) || typeof rawLeague.league_id !== 'string'
    || typeof rawLeague.season !== 'string' || typeof rawLeague.status !== 'string') {
    throw new Error('Sleeper did not return a valid league. Please check the league configuration.');
  }
  const sourceLeague = rawLeague as unknown as SleeperLeague;
  const state = isRecord(stateResult.value) && typeof stateResult.value.season === 'string'
    ? stateResult.value as SleeperState : null;
  const league = normalizeLeague(sourceLeague, state);
  const teams = normalizeTeams(rosters, users, league);
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

// Cache the small fields we display, not Sleeper's entire multi-megabyte player response.
// The raw endpoint is not placed in Next's response cache, whose entry size is limited.
// /players/nfl supplies current metadata, not injury history for a requested week.
const cachedPlayers = unstable_cache(async (): Promise<PlayerCatalog> => {
  const raw = await fetchJson('/players/nfl', 0);
  if (!isRecord(raw)) throw new Error('Sleeper did not return a valid player catalog.');
  const result: PlayerCatalog = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const player: SleeperPlayer = {};
    for (const field of ['full_name', 'first_name', 'last_name', 'position', 'team'] as const) {
      if (typeof value[field] === 'string') player[field] = value[field];
    }
    const injuryStatus = normalizeInjuryStatus(value.injury_status);
    if (injuryStatus) player.injury_status = injuryStatus;
    result[id] = player;
  }
  if (!Object.keys(result).length) throw new Error('Sleeper returned an empty player catalog.');
  return result;
}, ['league-one-player-catalog-v2'], { revalidate: PLAYER_CACHE_SECONDS });

const getPlayers = cache(async () => {
  try {
    return { catalog: await cachedPlayers(), warning: undefined };
  } catch {
    return {
      catalog: {} as PlayerCatalog,
      warning: 'Player names and injury designations are temporarily unavailable. Sleeper player IDs are shown where necessary.',
    };
  }
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

export async function getOverview(): Promise<OverviewData> {
  return (await getCore()).overview;
}

export async function getMatchups(requestedWeek?: number): Promise<MatchupsData> {
  const core = await getCore();
  const week = requestedWeek === undefined ? core.overview.league.week
    : Number.isInteger(requestedWeek) && requestedWeek >= 1 && requestedWeek <= core.overview.league.maxWeek
      ? requestedWeek : core.overview.league.week;
  const [rows, players, nflSchedule] = await Promise.all([
    fetchRows<SleeperMatchup>(`/league/${LEAGUE_ID}/matchups/${week}`, 'roster_id'),
    getPlayers(),
    getWeekSchedule(core.overview.league.season, week),
  ]);
  const matchups = addScheduleToMatchups(
    normalizeMatchups(rows, core.overview.teams, core.overview.league, players.catalog,
      matchupStatus(core.sourceLeague, core.state, week)),
    nflSchedule.schedule,
    nflSchedule.canIdentifyByes,
  );
  const displayedRows = matchups.reduce((count, matchup) => count + matchup.sides.length, 0);
  return {
    ...core.overview,
    week,
    matchups,
    warning: joinWarnings(core.overview.warning, players.warning, nflSchedule.warning,
      displayedRows < rows.length ? 'Some matchup entries could not be matched to a unique league roster.' : undefined),
  };
}

export async function getOwner(id: number): Promise<OwnerData | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  const core = await getCore();
  const team = core.overview.teams.find((candidate) => candidate.id === id);
  const roster = core.rosters.find((candidate) => candidate.roster_id === id);
  if (!team || !roster) return null;
  const players = await getPlayers();
  return {
    ...core.overview,
    team,
    ...ownerLineup(roster, core.overview.league, players.catalog),
    warning: joinWarnings(core.overview.warning, players.warning),
  };
}

const getTransactionWeeks = cache(async (lastWeek: number) => {
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
        rows.push(...await fetchRows<SleeperTransaction>(`/league/${LEAGUE_ID}/transactions/${week}`, 'transaction_id'));
        succeeded += 1;
      } catch {
        failedWeeks.push(week);
      }
    }
  }));
  if (!succeeded) throw new Error('Sleeper transaction history is temporarily unavailable. Please try again.');
  return { rows, failedWeeks: failedWeeks.sort((a, b) => a - b) };
});

export async function getTransactions(id: number): Promise<TransactionsData | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  const core = await getCore();
  const team = core.overview.teams.find((candidate) => candidate.id === id);
  if (!team) return null;
  const [history, players] = await Promise.all([
    getTransactionWeeks(transactionEndWeek(core.sourceLeague, core.state)),
    getPlayers(),
  ]);
  const partial = history.failedWeeks.length > 0;
  return {
    ...core.overview,
    team,
    transactions: normalizeTransactions(history.rows, id, core.overview.teams, players.catalog),
    partial,
    warning: joinWarnings(core.overview.warning, players.warning, partial
      ? `Some transaction history could not be loaded (weeks ${history.failedWeeks.join(', ')}). The list may be incomplete.`
      : undefined),
  };
}

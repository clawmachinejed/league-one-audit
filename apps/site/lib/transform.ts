import { normalizeInjuryStatus } from './injury-status';
import type {
  League,
  Matchup,
  Player,
  Team,
  Transaction,
  TransactionLine,
  TransactionResult,
} from './types';

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  status: 'pre_draft' | 'drafting' | 'in_season' | 'complete';
  total_rosters: number;
  roster_positions?: string[];
  settings?: Record<string, unknown>;
  scoring_settings?: Record<string, unknown>;
}

export interface SleeperState {
  season?: string;
  season_type?: string;
  season_start_date?: string;
  week?: number;
  leg?: number;
  display_week?: number;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id?: string | null;
  players?: string[] | null;
  starters?: string[] | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  settings?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface SleeperUser {
  user_id: string;
  display_name?: string;
  username?: string;
  avatar?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SleeperPlayer {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
  injury_status?: unknown;
}

export type PlayerCatalog = Record<string, SleeperPlayer>;

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number | null;
  starters?: string[] | null;
  starters_points?: Array<number | null> | null;
  players_points?: Record<string, number | null> | null;
  points?: number | null;
  custom_points?: number | null;
}

export interface DraftPickMove {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface WaiverBudgetMove {
  sender: number;
  receiver: number;
  amount: number;
}

export interface SleeperTransaction {
  transaction_id: string;
  type?: string;
  status?: string;
  created?: number;
  status_updated?: number;
  roster_ids?: number[] | null;
  consenter_ids?: number[] | null;
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  draft_picks?: DraftPickMove[] | null;
  waiver_budget?: WaiverBudgetMove[] | null;
  waiver_bid?: unknown;
  settings?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/** Do not let null, an empty string, or a boolean become a real zero score/bid. */
export function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function weekWithinSeason(value: unknown, fallback = 1): number {
  const parsed = numberOrNull(value);
  return parsed === null ? fallback : Math.max(1, Math.min(18, Math.floor(parsed)));
}

function lastLeagueWeek(league: SleeperLeague, sameSeasonState: SleeperState | null): number {
  for (const candidate of [
    league.settings?.last_scored_leg,
    league.settings?.leg,
    sameSeasonState?.display_week,
    sameSeasonState?.leg,
    sameSeasonState?.week,
  ]) {
    const parsed = numberOrNull(candidate);
    if (parsed !== null && parsed >= 1) return weekWithinSeason(parsed);
  }
  return 1;
}

export function currentWeek(league: SleeperLeague, state: SleeperState | null): number {
  const leagueYear = numberOrNull(league.season);
  const stateYear = numberOrNull(state?.season);
  if (league.status === 'complete') return lastLeagueWeek(league, null);
  if (leagueYear !== null && stateYear !== null && leagueYear < stateYear) return lastLeagueWeek(league, null);
  if (leagueYear !== null && stateYear !== null && leagueYear > stateYear) return 1;
  if (state?.season_type === 'post') return lastLeagueWeek(league, state);
  if (state?.season_type === 'pre') return 1;
  return weekWithinSeason(state?.display_week ?? state?.leg ?? state?.week ?? league.settings?.leg);
}

/** Current player-team metadata is safe only for this season's active or future weeks. */
export function canDecorateMatchupWeek(
  league: SleeperLeague,
  state: SleeperState | null,
  week: number,
): boolean {
  if (!state || league.status === 'complete' || league.season !== state.season
    || !Number.isInteger(week) || week < 1 || week > 18) return false;
  if (state.season_type === 'pre') return true;
  if (state.season_type !== 'regular') return false;
  const scoringWeek = weekWithinSeason(state.leg ?? state.week ?? state.display_week ?? league.settings?.leg);
  return week >= scoringWeek;
}

export function transactionEndWeek(league: SleeperLeague, state: SleeperState | null): number {
  // If NFL state is unavailable, check the entire season instead of hiding later transactions.
  if (!state) return 18;
  return Math.max(
    currentWeek(league, state),
    weekWithinSeason(league.settings?.leg),
    weekWithinSeason(league.settings?.last_scored_leg),
  );
}

export function normalizeLeague(raw: SleeperLeague, state: SleeperState | null): League {
  return {
    season: raw.season,
    rosterPositions: Array.isArray(raw.roster_positions) ? raw.roster_positions : [],
    week: currentWeek(raw, state),
    // The current league's playoff_week_start is 0. That is not a real last week.
    maxWeek: 18,
  };
}

export function safeAvatar(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  if (/^[a-zA-Z0-9_-]{1,128}$/.test(candidate)) {
    return `https://sleepercdn.com/avatars/thumbs/${candidate}`;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Sleeper stores the fractional part of season totals as hundredths. */
export function seasonPoints(whole: unknown, decimal: unknown): number {
  const base = numberOrNull(whole) ?? 0;
  const fraction = numberOrNull(decimal) ?? 0;
  return Math.round((base + fraction / 100) * 100) / 100;
}

export function normalizeTeams(
  rosters: SleeperRoster[],
  users: SleeperUser[],
): Team[] {
  const userById = new Map(users.map((user) => [user.user_id, user]));
  return rosters.map((roster): Team => {
    const user = roster.owner_id ? userById.get(roster.owner_id) : undefined;
    const settings = roster.settings ?? {};
    const managerName = text(user?.display_name) ?? text(user?.username) ?? 'Unassigned manager';
    return {
      id: roster.roster_id,
      managerName,
      name: text(user?.metadata?.team_name) ?? text(roster.metadata?.team_name)
        ?? text(user?.display_name) ?? `Team ${roster.roster_id}`,
      avatar: safeAvatar(user?.metadata?.avatar) ?? safeAvatar(user?.avatar)
        ?? safeAvatar(roster.metadata?.avatar),
      wins: numberOrNull(settings.wins) ?? 0,
      losses: numberOrNull(settings.losses) ?? 0,
      ties: numberOrNull(settings.ties) ?? 0,
      pointsFor: seasonPoints(settings.fpts, settings.fpts_decimal),
      pointsAgainst: numberOrNull(settings.fpts_against) === null
        ? null : seasonPoints(settings.fpts_against, settings.fpts_against_decimal),
    };
  }).sort(compareTeams);
}

export function compareTeams(a: Team, b: Team): number {
  const gamesA = a.wins + a.losses + a.ties;
  const gamesB = b.wins + b.losses + b.ties;
  const rateA = gamesA ? (a.wins + a.ties * 0.5) / gamesA : 0;
  const rateB = gamesB ? (b.wins + b.ties * 0.5) / gamesB : 0;
  const pointsAgainstDifference = a.pointsAgainst === null && b.pointsAgainst === null
    ? 0 : (b.pointsAgainst ?? Number.NEGATIVE_INFINITY) - (a.pointsAgainst ?? Number.NEGATIVE_INFINITY);
  return rateB - rateA || b.pointsFor - a.pointsFor || pointsAgainstDifference
    || a.name.localeCompare(b.name) || a.id - b.id;
}

export function startingSlots(positions: string[]): string[] {
  return positions.filter((position) => !['BN', 'IR', 'TAXI'].includes(position));
}

export function playerFromId(
  rawId: string | null | undefined,
  slot: string,
  catalog: PlayerCatalog,
  points: unknown = null,
  emptyIndex = 0,
): Player {
  const id = rawId && rawId !== '0' ? String(rawId) : null;
  if (!id) {
    return { id: `empty-${slot}-${emptyIndex}`, name: 'Empty slot', position: '—', nflTeam: null, injuryStatus: null, game: null, slot, points: null, projectedPoints: null };
  }
  const player = catalog[id];
  const fullName = text(player?.full_name)
    ?? text([player?.first_name, player?.last_name].filter(Boolean).join(' '));
  const isDefense = /^[A-Z]{2,3}$/.test(id);
  return {
    id,
    name: fullName ?? (isDefense ? `${id} Defense` : `Player ${id}`),
    position: text(player?.position) ?? (isDefense ? 'DEF' : '—'),
    nflTeam: text(player?.team) ?? (isDefense ? id : null),
    injuryStatus: normalizeInjuryStatus(player?.injury_status),
    game: null,
    slot,
    points: numberOrNull(points),
    projectedPoints: null,
  };
}

export function lineup(
  ids: string[] | null | undefined,
  positions: string[],
  catalog: PlayerCatalog,
  scores?: Array<number | null> | null,
  pointsByPlayer?: Record<string, number | null> | null,
): Player[] {
  const starters = ids ?? [];
  const slots = startingSlots(positions);
  return Array.from({ length: Math.max(starters.length, slots.length) }, (_, index) => {
    const id = starters[index];
    const starterPoints = scores && index < scores.length ? numberOrNull(scores[index]) : null;
    const points = starterPoints ?? (id ? numberOrNull(pointsByPlayer?.[id]) : null);
    return playerFromId(id, slots[index] ?? 'UTIL', catalog, points, index);
  });
}

export function managerLineup(roster: SleeperRoster, league: League, catalog: PlayerCatalog) {
  const starterIds = new Set(roster.starters ?? []);
  const reserveIds = new Set(roster.reserve ?? []);
  const taxiIds = new Set(roster.taxi ?? []);
  return {
    starters: lineup(roster.starters, league.rosterPositions, catalog),
    bench: (roster.players ?? []).filter((id) => !starterIds.has(id) && !reserveIds.has(id) && !taxiIds.has(id))
      .map((id) => playerFromId(id, 'BN', catalog)),
    reserve: [
      ...Array.from(reserveIds).map((id) => playerFromId(id, 'IR', catalog)),
      ...Array.from(taxiIds).filter((id) => !reserveIds.has(id)).map((id) => playerFromId(id, 'TAXI', catalog)),
    ],
  };
}

export function matchupStatus(
  league: SleeperLeague,
  state: SleeperState | null,
  week: number,
  now = Date.now(),
): Matchup['status'] {
  const leagueYear = numberOrNull(league.season);
  const stateYear = numberOrNull(state?.season);
  if (league.status === 'complete' || (leagueYear !== null && stateYear !== null && leagueYear < stateYear)) return 'final';
  if (leagueYear !== null && stateYear !== null && leagueYear > stateYear) return 'upcoming';
  if (!state || leagueYear === null || stateYear === null) return 'unknown';
  const seasonStart = state.season_start_date ? Date.parse(`${state.season_start_date}T00:00:00Z`) : NaN;
  if (state.season_type === 'pre' || (Number.isFinite(seasonStart) && now < seasonStart)) return 'upcoming';
  if (state.season_type === 'post') return 'final';
  if (state.season_type !== 'regular') return 'unknown';
  // display_week may advance ahead of the scoring week. Use leg/week to decide finality.
  const scoringWeek = weekWithinSeason(state.leg ?? state.week);
  if (week < scoringWeek) return 'final';
  if (week > scoringWeek) return 'upcoming';
  // A scoring week alone does not establish that an NFL game is live right now.
  return 'unknown';
}

export function matchupSlateExpected(
  league: SleeperLeague,
  state: SleeperState | null,
  week: number,
  now = Date.now(),
): boolean {
  if (!['in_season', 'complete'].includes(league.status)
    || matchupStatus(league, state, week, now) === 'upcoming') return false;
  const leagueYear = numberOrNull(league.season);
  const stateYear = numberOrNull(state?.season);
  const useLeagueHorizon = league.status === 'complete' || !state
    || (leagueYear !== null && stateYear !== null && leagueYear !== stateYear);
  const horizon = useLeagueHorizon
    ? lastLeagueWeek(league, null)
    : state?.season_type === 'regular'
      ? weekWithinSeason(state.leg ?? state.week ?? league.settings?.leg)
      : lastLeagueWeek(league, state);
  return week <= horizon;
}

export function normalizeMatchups(
  rows: SleeperMatchup[],
  teams: Team[],
  league: League,
  catalog: PlayerCatalog,
  status: Matchup['status'],
): Matchup[] {
  const byRoster = new Map(teams.map((team) => [team.id, team]));
  const groups = new Map<string, Matchup>();
  const seen = new Set<number>();
  for (const row of rows) {
    const team = byRoster.get(row.roster_id);
    if (!team || seen.has(row.roster_id)) continue;
    seen.add(row.roster_id);
    const id = row.matchup_id === null || row.matchup_id === undefined
      ? `unpaired-${row.roster_id}` : String(row.matchup_id);
    const group = groups.get(id) ?? { id, sides: [], status };
    group.sides.push({
      team,
      points: numberOrNull(row.custom_points) ?? numberOrNull(row.points),
      projectedPoints: null,
      starters: lineup(row.starters, league.rosterPositions, catalog, row.starters_points, row.players_points),
    });
    groups.set(id, group);
  }
  const rank = new Map(teams.map((team, index) => [team.id, index]));
  return Array.from(groups.values()).sort((a, b) => {
    const bestRank = (matchup: Matchup) => Math.min(...matchup.sides.map((side) => rank.get(side.team.id) ?? Infinity));
    return bestRank(a) - bestRank(b);
  });
}

export function transactionResult(transaction: SleeperTransaction): TransactionResult {
  if (transaction.status === 'complete') return transaction.type === 'waiver' ? 'Won' : 'Complete';
  if (transaction.status === 'failed') return transaction.type === 'waiver' ? 'Lost' : 'Failed';
  if (['pending', 'processing', 'queued'].includes(transaction.status ?? '')) return 'Pending';
  if (['canceled', 'cancelled', 'rejected', 'expired'].includes(transaction.status ?? '')) return 'Failed';
  return 'Unknown';
}

export function waiverBid(transaction: SleeperTransaction): number | null {
  if (transaction.type !== 'waiver') return null;
  for (const candidate of [transaction.settings?.waiver_bid, transaction.waiver_bid, transaction.metadata?.waiver_bid]) {
    const bid = numberOrNull(candidate);
    if (bid !== null && bid >= 0) return bid;
  }
  return null;
}

export function involvesRoster(transaction: SleeperTransaction, rosterId: number): boolean {
  const rosterValues = [
    ...(transaction.roster_ids ?? []),
    ...(transaction.consenter_ids ?? []),
    ...Object.values(transaction.adds ?? {}),
    ...Object.values(transaction.drops ?? {}),
    ...(transaction.draft_picks ?? []).flatMap((pick) => [pick.previous_owner_id, pick.owner_id]),
    ...(transaction.waiver_budget ?? []).flatMap((move) => [move.sender, move.receiver]),
  ];
  return rosterValues.some((value) => numberOrNull(value) === rosterId);
}

function transactionTimestamp(transaction: SleeperTransaction): number {
  for (const candidate of [transaction.status_updated, transaction.created]) {
    const timestamp = numberOrNull(candidate);
    if (timestamp !== null && timestamp > 0 && Number.isFinite(new Date(timestamp).getTime())) return timestamp;
  }
  return 0;
}

function transactionType(type: string | undefined): string {
  const labels: Record<string, string> = {
    free_agent: 'Free agent', waiver: 'Waiver', trade: 'Trade', commissioner: 'Commissioner',
    ir: 'Injured reserve', reversal: 'Reversal',
  };
  if (!type) return 'Transaction';
  return labels[type] ?? type.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function normalizeTransactions(
  rows: SleeperTransaction[],
  rosterId: number,
  teams: Team[],
  catalog: PlayerCatalog,
): Transaction[] {
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const teamName = (id: unknown) => {
    const parsed = numberOrNull(id);
    return parsed === null ? 'Unknown team' : teamNames.get(parsed) ?? `Team ${parsed}`;
  };
  const describePlayer = (id: string) => {
    const player = playerFromId(id, '', catalog);
    const details = [player.position === '—' ? null : player.position, player.nflTeam].filter(Boolean).join(' · ');
    return `${player.name}${details ? ` (${details})` : ''}`;
  };
  // Week endpoints can overlap. Keep the most recently updated copy of each event.
  const unique = new Map<string, SleeperTransaction>();
  for (const row of rows) {
    const previous = unique.get(row.transaction_id);
    if (!previous || transactionTimestamp(row) >= transactionTimestamp(previous)) unique.set(row.transaction_id, row);
  }
  return Array.from(unique.values())
    .filter((row) => involvesRoster(row, rosterId))
    .sort((a, b) => transactionTimestamp(b) - transactionTimestamp(a) || b.transaction_id.localeCompare(a.transaction_id))
    .map((row): Transaction => {
      const lines: TransactionLine[] = [];
      const assetsFor = (assets: Record<string, number> | null | undefined, id: number) => Object.entries(assets ?? {})
        .filter(([, recipientRosterId]) => numberOrNull(recipientRosterId) === id).map(([playerId]) => describePlayer(playerId));
      if (row.type === 'trade') {
        const receivers = Array.from(new Set(Object.values(row.adds ?? {}).map(numberOrNull)))
          .filter((id): id is number => id !== null)
          .sort((a, b) => a === rosterId ? -1 : b === rosterId ? 1 : teamName(a).localeCompare(teamName(b)));
        for (const receiver of receivers) {
          lines.push({ label: `${teamName(receiver)} receives`, text: assetsFor(row.adds, receiver).join(', ') });
        }
        // Preserve outgoing assets when Sleeper has not included their destination.
        const unmappedDrops = Object.entries(row.drops ?? {}).filter(([id]) => !(id in (row.adds ?? {})));
        for (const [id, sender] of unmappedDrops) lines.push({ label: `${teamName(sender)} sends`, text: describePlayer(id) });
      } else {
        const added = assetsFor(row.adds, rosterId);
        const dropped = assetsFor(row.drops, rosterId);
        if (added.length) lines.push({ label: 'Add', text: added.join(', ') });
        if (dropped.length) lines.push({ label: 'Drop', text: dropped.join(', ') });
      }
      for (const pick of row.draft_picks ?? []) {
        lines.push({
          label: 'Draft pick',
          text: `${text(pick.season) ?? 'Unknown season'} round ${numberOrNull(pick.round) ?? '?'} (${teamName(pick.roster_id)} original pick): ${teamName(pick.previous_owner_id)} → ${teamName(pick.owner_id)}`,
        });
      }
      for (const move of row.waiver_budget ?? []) {
        const amount = numberOrNull(move.amount);
        lines.push({ label: 'FAAB transfer', text: `${amount === null ? 'Unknown amount' : `$${amount}`} · ${teamName(move.sender)} → ${teamName(move.receiver)}` });
      }
      const note = text(row.metadata?.notes) ?? text(row.metadata?.note) ?? text(row.metadata?.reason)
        ?? text(row.metadata?.failure_reason);
      if (note) lines.push({ label: 'Note', text: note });
      if (!lines.length) {
        const otherTeams = (row.roster_ids ?? []).filter((id) => id !== rosterId).map(teamName);
        lines.push({ label: 'Details', text: row.type === 'trade' && otherTeams.length
          ? `Trade with ${otherTeams.join(', ')}. Sleeper did not provide asset details.`
          : 'Sleeper did not provide asset details for this transaction.' });
      }
      const timestamp = transactionTimestamp(row);
      return {
        id: row.transaction_id,
        date: timestamp ? new Date(timestamp).toISOString() : null,
        type: transactionType(row.type),
        result: transactionResult(row),
        bid: waiverBid(row),
        lines,
      };
    });
}

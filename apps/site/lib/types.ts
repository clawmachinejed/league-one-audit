export interface League {
  season: string;
  rosterPositions: string[];
  week: number;
  maxWeek: number;
}

export interface Team {
  id: number;
  managerName: string;
  name: string;
  avatar: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number | null;
}

export interface StandingsTeam extends Team {
  waiverOrder: number | null;
  waiverBudgetRemaining: number | null;
}

export interface Player {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  /** Current Sleeper metadata, including when viewing an earlier matchup week. */
  injuryStatus: string | null;
  game: NflGame | null;
  slot: string;
  points: number | null;
  projectedPoints: number | null;
}

export interface RosterPlayer extends Omit<Player, 'points' | 'projectedPoints'> {
  byeWeek: number | null;
  positionRank: number | null;
  ppg: number | null;
}

export type PlayerMetricStatus = 'published' | 'provisional' | 'unavailable';

export interface PlayerMetricMetadata {
  status: PlayerMetricStatus;
  observedAt: string | null;
  throughWeek: number | null;
}

export interface RosterSection {
  name: 'Starters' | 'Bench' | 'IR' | 'Taxi';
  players: RosterPlayer[];
}

export interface RosterTeam extends Pick<StandingsTeam,
  'id' | 'managerName' | 'name' | 'avatar' | 'pointsFor' | 'waiverOrder' | 'waiverBudgetRemaining'> {
  wins: number | null;
  losses: number | null;
  ties: number | null;
  standingsRank: number | null;
  averagePpg: number | null;
  averagePpgRank: number | null;
  rosterAvailable: boolean;
  sections: RosterSection[];
}

export interface RostersData extends Pick<OverviewData, 'league' | 'updatedAt' | 'warning'> {
  week: number;
  currentWeek: number;
  rostersAvailable: boolean;
  playerMetrics: PlayerMetricMetadata;
  teams: RosterTeam[];
}

export type NflGame = {
  kind: 'scheduled';
  opponent: string;
  location: 'home' | 'away';
  date: string;
  kickoffAt: string | null;
  /** Present only for a final NFL game; scores are from this player's team perspective. */
  finalScore?: { teamScore: number; opponentScore: number };
  /** Latest observed live game state; the clock is not a browser countdown. */
  liveScore?: {
    teamScore: number;
    opponentScore: number;
    phase: 'q1' | 'q2' | 'halftime' | 'q3' | 'q4' | 'overtime';
    clockSeconds: number | null;
  };
} | {
  kind: 'bye';
};

export interface OverviewData {
  league: League;
  teams: Team[];
  updatedAt: string;
  warning?: string;
}

export interface StandingsData extends Omit<OverviewData, 'teams'> {
  teams: StandingsTeam[];
  /** Official completed-week totals used only by the optional live projection view. */
  projectionBasis?: ProjectedStandingsBasis;
}

export type ProjectedStandingsBasis = {
  kind: 'ready';
  week: number;
  teams: StandingsTeam[];
} | {
  kind: 'unavailable';
  reason: string;
};

export interface MatchupSide {
  team: Team;
  points: number | null;
  projectedPoints: number | null;
  starters: Player[];
}

export interface Matchup {
  id: string;
  sides: MatchupSide[];
  status: 'upcoming' | 'live' | 'final' | 'unknown';
}

export interface MatchupsData extends OverviewData {
  week: number;
  matchups: Matchup[];
}

export interface ManagerData extends OverviewData {
  team: Team;
  starters: Player[];
  bench: Player[];
  reserve: Player[];
}

export type TransactionResult = 'Won' | 'Lost' | 'Pending' | 'Complete' | 'Failed' | 'Unknown';
export interface TransactionLine { label: string; text: string }
export interface Transaction {
  id: string;
  date: string | null;
  type: string;
  result: TransactionResult;
  bid: number | null;
  lines: TransactionLine[];
}

export interface TransactionsData extends OverviewData {
  team: Team;
  transactions: Transaction[];
}

export interface TransactionPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
}

export interface LeagueTransactionLine {
  label: string;
  text: string;
}

export interface LeagueTransactionClaim {
  id: string;
  team: string;
  bid: number | null;
  result: TransactionResult;
}

export interface LeagueWaiverWinner {
  id: string;
  team: string;
  added: TransactionPlayer[];
  dropped: TransactionPlayer[];
}

export interface LeagueWaiverActivity {
  kind: 'waiver';
  id: string;
  timestamp: string | null;
  processedAt: string | null;
  day: string | null;
  player: TransactionPlayer | null;
  claims: LeagueTransactionClaim[];
  winners: LeagueWaiverWinner[];
}

export interface LeagueMoveActivity {
  kind: 'add_drop';
  id: string;
  timestamp: string | null;
  title: string;
  type: string;
  result: TransactionResult;
  lines: LeagueTransactionLine[];
}

export interface LeagueTradeAsset {
  type: 'Player' | 'Pick' | 'FAAB' | 'Details';
  text: string;
}

export interface LeagueTradeParticipant {
  id: number;
  team: string;
  receives: LeagueTradeAsset[];
}

export interface LeagueTradeActivity {
  kind: 'trade';
  id: string;
  timestamp: string | null;
  title: string;
  result: TransactionResult;
  lines: LeagueTransactionLine[];
  participants: LeagueTradeParticipant[];
  unassigned?: LeagueTradeAsset[];
}

export type LeagueTransactionActivity = LeagueWaiverActivity | LeagueMoveActivity | LeagueTradeActivity;

export interface LeagueTransactionsData extends Pick<OverviewData, 'league' | 'updatedAt' | 'warning'> {
  activities: LeagueTransactionActivity[];
}

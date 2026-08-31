export interface League {
  id: string;
  name: string;
  season: string;
  status: string;
  rosterPositions: string[];
  week: number;
  maxWeek: number;
  faabBudget: number;
  scoringLabel: string;
}

export interface Team {
  id: number;
  ownerId: string | null;
  ownerName: string;
  name: string;
  avatar: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  faabRemaining: number | null;
}

export interface Player {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  slot: string;
  points: number | null;
}

export interface OverviewData {
  league: League;
  teams: Team[];
  updatedAt: string;
  warning?: string;
}

export interface MatchupSide {
  team: Team;
  points: number | null;
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

export interface OwnerData extends OverviewData {
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
  partial: boolean;
}

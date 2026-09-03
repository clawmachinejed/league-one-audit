import type {
  ExternalGameRef,
  ExternalLeagueRef,
  ExternalPlayerRef,
  ExternalRosterRef,
  ExternalScoringEntityRef,
  ExternalTeamDefenseRef,
  ProviderKey,
} from '../shared/provider-identity';
import type { ProjectionScoringRules } from './scoring-events';

export const NFL_TEAM_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
] as const;

export type NflTeam = typeof NFL_TEAM_CODES[number];
export type SeasonType = 'preseason' | 'regular' | 'postseason';
export type Cadence = 'forced' | 'live-window' | 'hourly' | 'idle';

export type LeaguePeriod = Readonly<{
  season: number;
  seasonType: SeasonType;
  week: number;
}>;

export type LeagueConfiguration = Readonly<{
  key: string;
  displayName: string;
  leagueRef: ExternalLeagueRef;
}>;

export type ScheduledTeamWeek = Readonly<{
  kind: 'scheduled';
  opponent: NflTeam;
  location: 'home' | 'away';
  date: string;
  kickoffAt: string | null;
}>;

export type ByeTeamWeek = Readonly<{ kind: 'bye' }>;
export type TeamWeek = ScheduledTeamWeek | ByeTeamWeek;
export type NflWeekSchedule = Readonly<Partial<Record<NflTeam, TeamWeek>>>;

export type ProjectionParticipant = Readonly<{
  rosterRef: ExternalRosterRef;
  managerName: string;
  teamName: string;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number | null;
}>;

type ScoringEntityBase = Readonly<{
  displayName: string;
  nflTeam: NflTeam | null;
  position: string;
  injuryStatus: string | null;
}>;

export type PlayerScoringEntity = ScoringEntityBase & Readonly<{
  kind: 'player';
  externalRef: ExternalPlayerRef;
}>;

export type TeamDefenseScoringEntity = ScoringEntityBase & Readonly<{
  kind: 'team-defense';
  externalRef: ExternalTeamDefenseRef;
  nflTeam: NflTeam;
}>;

export type ScoringEntity = PlayerScoringEntity | TeamDefenseScoringEntity;

export type EmptyLineupSlot = Readonly<{
  kind: 'empty';
  slot: string;
}>;

export type OccupiedLineupSlot = Readonly<{
  kind: 'occupied';
  slot: string;
  entity: ScoringEntity;
  officialPoints: number | null;
}>;

export type LineupSlot = EmptyLineupSlot | OccupiedLineupSlot;

export type OfficialMatchupSide = Readonly<{
  rosterRef: ExternalRosterRef;
  officialPoints: number | null;
  starters: readonly LineupSlot[];
}>;

export type MatchupStatus = 'upcoming' | 'live' | 'final' | 'unknown';

export type OfficialMatchup = Readonly<{
  matchupId: string;
  status: MatchupStatus;
  sides: readonly OfficialMatchupSide[];
}>;

export type SourceScoringSettings = Readonly<{
  provider: ProviderKey;
  /** Raw source values are intentionally deferred; they may be null or invalid. */
  rawRules: Readonly<Record<string, unknown>> | null;
}>;

export type ScoringProvenance = Readonly<{
  provider: ProviderKey;
  /** Exact validated source rules retained for compatible persistence and audit. */
  rawRules: Readonly<Record<string, number>>;
  supportedSourceKeys: readonly string[];
  unsupportedSourceKeys: readonly string[];
  aggregateTwoPointConversionSupported: boolean;
  usesPointsAllowedBucketProxy: boolean;
}>;

export type CanonicalScoringProfile = Readonly<{
  rules: ProjectionScoringRules;
  provenance: ScoringProvenance;
}>;

export type LeagueWeekState = Readonly<{
  configuration: LeagueConfiguration;
  leagueName: string;
  period: LeaguePeriod;
  maxWeek: number;
  rosterPositions: readonly string[];
  participants: readonly ProjectionParticipant[];
  matchups: readonly OfficialMatchup[];
  /** Includes bench, reserve, and taxi entities needed to freeze late lineup changes safely. */
  rosteredEntities: readonly ScoringEntity[];
  schedule: NflWeekSchedule;
  scoringSettings: SourceScoringSettings;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  sourceRevision: string;
  warning?: string;
}>;

export type LeagueCadenceState = Readonly<{
  configuration: LeagueConfiguration;
  period: LeaguePeriod;
  periodAuthority: LeaguePeriodAuthority;
  currentPeriod: Readonly<{
    season: number | null;
    week: number | null;
    /** Kept raw so unknown/null source values preserve cadence decisions exactly. */
    seasonType: string | null;
  }>;
  schedule: NflWeekSchedule;
}>;

export type LeagueLifecycle = 'preseason' | 'active' | 'complete';
export type NflPhase = 'preseason' | 'regular' | 'postseason' | 'unknown';
export type MatchupTemporalState = 'past' | 'active' | 'future';

/**
 * Provider-neutral authority for matchup navigation and freshness. The default
 * display period may advance before the active scoring period does, so the two
 * periods must never be inferred from one another.
 */
export type LeaguePeriodAuthority = Readonly<{
  configuration: LeagueConfiguration;
  defaultDisplayPeriod: LeaguePeriod;
  activeScoringPeriod: LeaguePeriod | null;
  lifecycle: LeagueLifecycle;
  nflPhase: NflPhase;
  source: ProviderKey;
  sourceRevision: string;
  observedAt: string;
  verifiedAt: string;
}>;

export type OffenseProjectionStats = Readonly<{
  kind: 'offense';
  passingYards?: number | null;
  passingTouchdowns?: number | null;
  passingInterceptions?: number | null;
  rushingYards?: number | null;
  rushingTouchdowns?: number | null;
  receptions?: number | null;
  receivingYards?: number | null;
  receivingTouchdowns?: number | null;
  twoPointConversions?: number | null;
  fumblesLost?: number | null;
}>;

export type DefenseProjectionStats = Readonly<{
  kind: 'defense';
  sacks?: number | null;
  interceptions?: number | null;
  fumbleRecoveries?: number | null;
  defensiveTouchdowns?: number | null;
  specialTeamsTouchdowns?: number | null;
  safeties?: number | null;
  blockedKicks?: number | null;
  pointsAllowed?: number | null;
}>;

export type KickerProjectionStats = Readonly<{
  kind: 'kicker';
  fieldGoalsMade?: number | null;
  fieldGoalsMissed?: number | null;
  extraPointsMade?: number | null;
  extraPointsMissed?: number | null;
}>;

export type ProjectionStats =
  | OffenseProjectionStats
  | DefenseProjectionStats
  | KickerProjectionStats;

export type ProjectionIdentity = Readonly<{
  primary: ExternalScoringEntityRef;
  aliases: readonly ExternalScoringEntityRef[];
}>;

export type ProjectionObservation = Readonly<{
  identity: ProjectionIdentity;
  nflTeam: NflTeam | null;
  position: string | null;
  stats: Readonly<Record<string, unknown>>;
  scoringStats: ProjectionStats;
  missingFields: readonly string[];
}>;

export type ProjectionSlateCoverage = Readonly<{
  crosswalkRows: number;
  crosswalkEntries: number;
  malformedCrosswalkRows: number;
  ambiguousCrosswalkRows: number;
  playerRows: number;
  matchedPlayers: number;
  unmatchedPlayers: number;
  malformedPlayers: number;
  incompletePlayers: number;
  defenseRows: number;
  usableDefenses: number;
  malformedDefenses: number;
  incompleteDefenses: number;
}>;

export type ProjectionSlate = Readonly<{
  source: ProviderKey;
  period: LeaguePeriod;
  quality: 'complete' | 'partial';
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  sourceRevision: string;
  projections: readonly ProjectionObservation[];
  coverage: ProjectionSlateCoverage;
  warnings: readonly string[];
}>;

export type NflGamePhase =
  | 'pregame'
  | 'q1'
  | 'q2'
  | 'halftime'
  | 'q3'
  | 'q4'
  | 'overtime'
  | 'final'
  | 'postponed'
  | 'suspended'
  | 'unknown';

export type NflGameStatusCode = 0 | 1 | 2 | 3 | 4;

export type GameStateObservation = Readonly<{
  gameRef: ExternalGameRef;
  period: LeaguePeriod;
  homeTeam: NflTeam;
  awayTeam: NflTeam;
  statusCode: NflGameStatusCode;
  statusText: string | null;
  sourcePeriod: string | null;
  gameClock: string | null;
  phase: NflGamePhase;
  clockSeconds: number | null;
  remainingFraction: number | null;
  homeScore: number | null;
  awayScore: number | null;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  sourceRevision: string;
}>;

export type GameStateSlate = Readonly<{
  source: ProviderKey;
  period: LeaguePeriod;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  games: readonly GameStateObservation[];
}>;

export type ProjectionPointQuality =
  | 'estimated'
  | 'official-final'
  | 'pregame-baseline'
  | 'defense-baseline-held'
  | 'missing-baseline'
  | 'retained-prior'
  | 'unavailable';

export type ProjectionComputation = Readonly<{
  entityRef: ExternalScoringEntityRef;
  gameRef: ExternalGameRef | null;
  officialPoints: number | null;
  baselinePoints: number | null;
  priorProjectedPoints: number | null;
  remainingFraction: number | null;
  projectedPoints: number | null;
  quality: ProjectionPointQuality;
}>;

export type ProjectedOccupiedLineupSlot = OccupiedLineupSlot & Readonly<{
  projectedPoints: number;
  projectionQuality: Exclude<ProjectionPointQuality, 'unavailable'>;
}>;

export type ProjectedLineupSlot = EmptyLineupSlot | ProjectedOccupiedLineupSlot;

export type ProjectedMatchupSide = Readonly<{
  rosterRef: ExternalRosterRef;
  officialPoints: number | null;
  projectedPoints: number | null;
  starters: readonly ProjectedLineupSlot[];
}>;

export type ProjectedMatchup = Readonly<{
  matchupId: string;
  status: MatchupStatus;
  sides: readonly ProjectedMatchupSide[];
}>;

/** Complete canonical snapshot before conversion to the stable public presentation payload. */
export type ProjectedMatchupSnapshot = Readonly<{
  configuration: LeagueConfiguration;
  leagueName: string;
  period: LeaguePeriod;
  maxWeek: number;
  rosterPositions: readonly string[];
  participants: readonly ProjectionParticipant[];
  calculatedAt: string;
  matchups: readonly ProjectedMatchup[];
  warning?: string;
}>;

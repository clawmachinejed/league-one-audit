import { calculateLiveProjection } from '../domain/live-calculation';
import type {
  GameStateSlate,
  LeagueWeekState,
  NflWeekSchedule,
  ProjectedLineupSlot,
  ProjectedMatchupSnapshot,
  ProjectionPointQuality,
  ScoringEntity,
} from '../domain/contracts';
import type { ProjectionBaselineRecord } from '../ports/projection-repository';
import { externalReferenceKey } from '../shared/provider-identity';
import type { MatchupsData, NflGame, Player, Team } from '../../types';
import { matchupStatus, startedGame, stateForEntity } from './game-context';
import type { PregameProjectionSet } from './contracts';
import { activeStarters, finite, projectionKind } from './roster-context';

export type BuildSnapshotInput = Readonly<{
  source: LeagueWeekState;
  games: GameStateSlate;
  scored: PregameProjectionSet;
  latest: readonly ProjectionBaselineRecord[];
  frozen: readonly ProjectionBaselineRecord[];
  prior: MatchupsData | null;
  calculatedAt: string;
}>;

export function baselineMap(
  records: readonly ProjectionBaselineRecord[],
): Map<string, ProjectionBaselineRecord> {
  return new Map(records.map((record) => [
    externalReferenceKey(record.officialEntityRef),
    record,
  ]));
}

function priorProjectionMap(data: MatchupsData | null): Map<string, number> {
  const result = new Map<string, number>();
  if (!data) return result;
  for (const matchup of data.matchups) {
    for (const side of matchup.sides) {
      for (const player of side.starters) {
        if (!player.id.startsWith('empty-') && finite(player.projectedPoints)) {
          result.set(player.id, player.projectedPoints);
        }
      }
    }
  }
  return result;
}

function pregameProjectionMap(input: PregameProjectionSet): Map<string, Readonly<{
  points: number;
  quality: 'complete' | 'missing';
}>> {
  return new Map(input.projections.map((projection) => [
    externalReferenceKey(projection.entityRef),
    { points: projection.points, quality: projection.quality },
  ]));
}

function projectedPlayerMap(input: BuildSnapshotInput): Map<string, Readonly<{
  projectedPoints: number;
  projectionQuality: Exclude<ProjectionPointQuality, 'unavailable'>;
}>> {
  const latest = baselineMap(input.latest);
  const frozen = baselineMap(input.frozen);
  const fallback = pregameProjectionMap(input.scored);
  const prior = priorProjectionMap(input.prior);
  const result = new Map<string, Readonly<{
    projectedPoints: number;
    projectionQuality: Exclude<ProjectionPointQuality, 'unavailable'>;
  }>>();

  for (const { starter } of activeStarters(input.source)) {
    const entity = starter.entity;
    const key = externalReferenceKey(entity.externalRef);
    const state = stateForEntity(entity, input.games, input.source.schedule);
    const record = state && startedGame(state) ? frozen.get(key) : latest.get(key);
    const fallbackProjection = fallback.get(key);
    const baseline = state && startedGame(state) && !record
      ? { points: 0, quality: 'missing' as const }
      : record
        ? {
            points: record.projectionPoints,
            quality: record.quality === 'missing' ? 'missing' as const : 'complete' as const,
          }
        : fallbackProjection && finite(fallbackProjection.points)
          ? fallbackProjection
          : null;
    const gameState = state
      ? { phase: state.phase, remainingFraction: state.remainingFraction }
      : { phase: 'pregame' as const, remainingFraction: 1 };
    if (state?.phase === 'final' && !finite(starter.officialPoints)) {
      throw new Error('The league source did not provide a final official score for a starter.');
    }
    const calculated = calculateLiveProjection({
      kind: projectionKind(entity),
      gameState,
      baseline,
      officialPoints: finite(starter.officialPoints) ? starter.officialPoints : null,
      priorProjectedPoints: prior.get(String(entity.externalRef.externalId)) ?? null,
    });
    if (!finite(calculated.projectedPoints) || calculated.quality === 'unavailable') {
      throw new Error('A complete player projection could not be calculated.');
    }
    result.set(key, {
      projectedPoints: calculated.projectedPoints,
      projectionQuality: calculated.quality,
    });
  }
  return result;
}

export function buildProjectedMatchupSnapshot(
  input: BuildSnapshotInput,
): ProjectedMatchupSnapshot {
  const projections = projectedPlayerMap(input);
  const matchups = input.source.matchups.map((matchup) => ({
    matchupId: matchup.matchupId,
    status: matchupStatus(matchup, input.source.schedule, input.games),
    sides: matchup.sides.map((side) => {
      const starters: ProjectedLineupSlot[] = side.starters.map((slot) => {
        if (slot.kind === 'empty') return slot;
        const projection = projections.get(externalReferenceKey(slot.entity.externalRef));
        if (!projection) throw new Error('A complete player projection could not be calculated.');
        return { ...slot, ...projection };
      });
      const occupied = starters.filter((slot) => slot.kind === 'occupied');
      const projectedPoints = occupied.length > 0
        ? occupied.reduce((total, slot) => total + slot.projectedPoints, 0)
        : null;
      if (occupied.length > 0 && !finite(projectedPoints)) {
        throw new Error('A complete team projection could not be calculated.');
      }
      return {
        rosterRef: side.rosterRef,
        officialPoints: side.officialPoints,
        projectedPoints,
        starters,
      };
    }),
  }));

  return {
    configuration: input.source.configuration,
    leagueName: input.source.leagueName,
    period: input.source.period,
    maxWeek: input.source.maxWeek,
    rosterPositions: input.source.rosterPositions,
    participants: input.source.participants,
    calculatedAt: input.calculatedAt,
    matchups,
    warning: input.source.warning,
  };
}

function rosterNumber(reference: ProjectedMatchupSnapshot['participants'][number]['rosterRef']): number {
  const id = Number(reference.externalId);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error('The matchup presentation requires a positive numeric roster ID.');
  }
  return id;
}

function presentationTeam(
  participant: ProjectedMatchupSnapshot['participants'][number],
): Team {
  return {
    id: rosterNumber(participant.rosterRef),
    managerName: participant.managerName,
    name: participant.teamName,
    avatar: participant.avatarUrl,
    wins: participant.wins,
    losses: participant.losses,
    ties: participant.ties,
    pointsFor: participant.pointsFor,
    pointsAgainst: participant.pointsAgainst,
  };
}

function presentationGame(entity: ScoringEntity, schedule: NflWeekSchedule): NflGame | null {
  if (!entity.nflTeam) return null;
  const game = schedule[entity.nflTeam];
  if (!game) return null;
  return game.kind === 'bye' ? { kind: 'bye' } : { ...game };
}

function presentationPlayer(
  slot: ProjectedLineupSlot,
  index: number,
  schedule: NflWeekSchedule,
): Player {
  if (slot.kind === 'empty') {
    return {
      id: `empty-${slot.slot}-${index}`,
      name: 'Empty slot',
      position: '—',
      nflTeam: null,
      injuryStatus: null,
      game: null,
      slot: slot.slot,
      points: null,
      projectedPoints: null,
    };
  }
  return {
    id: String(slot.entity.externalRef.externalId),
    name: slot.entity.displayName,
    position: slot.entity.position,
    nflTeam: slot.entity.nflTeam,
    injuryStatus: slot.entity.injuryStatus,
    game: presentationGame(slot.entity, schedule),
    slot: slot.slot,
    points: slot.officialPoints,
    projectedPoints: slot.projectedPoints,
  };
}

/** The single canonical-to-public DTO conversion used before snapshot persistence. */
export function toMatchupsData(
  snapshot: ProjectedMatchupSnapshot,
  schedule: NflWeekSchedule,
): MatchupsData {
  const teams = snapshot.participants.map(presentationTeam);
  const teamByRoster = new Map(snapshot.participants.map((participant, index) => [
    externalReferenceKey(participant.rosterRef),
    teams[index],
  ]));
  const matchups = snapshot.matchups.map((matchup) => ({
    id: matchup.matchupId,
    status: matchup.status,
    sides: matchup.sides.map((side) => {
      const team = teamByRoster.get(externalReferenceKey(side.rosterRef));
      if (!team) throw new Error('A matchup side has no league participant.');
      return {
        team,
        points: side.officialPoints,
        projectedPoints: side.projectedPoints,
        starters: side.starters.map((slot, index) => presentationPlayer(slot, index, schedule)),
      };
    }),
  }));
  return {
    league: {
      season: String(snapshot.period.season),
      rosterPositions: [...snapshot.rosterPositions],
      week: snapshot.period.week,
      maxWeek: snapshot.maxWeek,
    },
    teams,
    updatedAt: snapshot.calculatedAt,
    week: snapshot.period.week,
    matchups,
    warning: snapshot.warning,
  };
}

/** Builds canonical state first, then performs one presentation conversion. */
export function buildSnapshot(input: BuildSnapshotInput): MatchupsData {
  return toMatchupsData(buildProjectedMatchupSnapshot(input), input.source.schedule);
}

import { calculateLiveProjection } from '../domain/live-calculation';
import { DEFENSE_PROJECTION_MODEL_VERSION } from '../domain/live-defense';
import type { CanonicalScoringProfile, DefenseProjectionStats } from '../domain/contracts';
import type { LiveDefenseStatResult } from '../ports/live-defense-stat-source';
import { calculateWinProbability, type WinProbabilityPlayerInput } from '../domain/win-probability';
import type {
  GameStateSlate,
  LeaguePeriod,
  LeagueWeekState,
  NflWeekSchedule,
  ProjectedLineupSlot,
  ProjectedMatchup,
  ProjectedMatchupSnapshot,
  ProjectionPointQuality,
  ScoringEntity,
} from '../domain/contracts';
import type { ProjectionBaselineRecord } from '../ports/projection-repository';
import { externalReferenceKey, sameExternalReference } from '../shared/provider-identity';
import type { MatchupsData, NflGame, Player, Team } from '../../types';
import { MAX_SOURCE_SKEW_MS, matchupStatus, startedGame, stateForEntity } from './game-context';
import type { PregameProjectionSet } from './contracts';
import { activeStarters, availableBench, finite, projectionKind } from './roster-context';

export type BuildSnapshotInput = Readonly<{
  source: LeagueWeekState;
  games: GameStateSlate;
  scored: PregameProjectionSet;
  latest: readonly ProjectionBaselineRecord[];
  frozen: readonly ProjectionBaselineRecord[];
  prior: MatchupsData | null;
  calculatedAt: string;
  liveDefenseStats?: LiveDefenseStatResult;
  scoringProfile?: CanonicalScoringProfile;
}>;

type DefenseCalculation = Readonly<{ team: string; quality: ProjectionPointQuality; reason?: string }>;

function currentDefenseStatistics(input: BuildSnapshotInput): boolean {
  const source = input.liveDefenseStats;
  if (source?.status !== 'available' || !samePeriod(source.capture.period, input.source.period)
    || !samePeriod(input.games.period, input.source.period)) return false;
  const times = [source.capture.requestStartedAt, source.capture.requestCompletedAt, source.capture.observedAt,
    input.source.requestCompletedAt, input.calculatedAt,
    ...input.games.games.filter((game) => game.statusCode === 1).map((game) => game.requestCompletedAt)].map(Date.parse);
  return times.every(Number.isFinite) && times[0] <= times[2] && times[2] <= times[1]
    && Math.max(...times) - Math.min(...times) <= MAX_SOURCE_SKEW_MS;
}

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
      for (const player of [...side.starters, ...(side.bench ?? [])]) {
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

function projectedPlayerMap(input: BuildSnapshotInput, defenseCalculations: DefenseCalculation[]): Map<string, Readonly<{
  projectedPoints: number | null;
  presentationProjectedPoints: number | null;
  projectionQuality: ProjectionPointQuality;
  probabilityInput?: WinProbabilityPlayerInput;
}>> {
  const latest = baselineMap(input.latest);
  const frozen = baselineMap(input.frozen);
  const fallback = pregameProjectionMap(input.scored);
  const prior = priorProjectionMap(input.prior);
  const currentDefenseStats = currentDefenseStatistics(input);
  const result = new Map<string, Readonly<{
    projectedPoints: number | null;
    presentationProjectedPoints: number | null;
    projectionQuality: ProjectionPointQuality;
    probabilityInput?: WinProbabilityPlayerInput;
  }>>();

  const entries = [
    ...activeStarters(input.source).map((entry) => ({ ...entry, required: true })),
    ...availableBench(input.source).map((entry) => ({ ...entry, required: false })),
  ];
  for (const { starter, required } of entries) {
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
    const scheduled = entity.nflTeam ? input.source.schedule[entity.nflTeam] : undefined;
    const benchContextValid = scheduled?.kind === 'bye' || scheduled?.kind === 'scheduled'
      && state !== null && samePeriod(state.period, input.source.period)
      && scheduled.opponent === (state.homeTeam === entity.nflTeam ? state.awayTeam : state.homeTeam)
      && scheduled.location === (state.homeTeam === entity.nflTeam ? 'home' : 'away')
      && state.phase !== 'unknown'
      && (state.statusCode !== 1 || finite(state.remainingFraction)
        && state.remainingFraction >= 0 && state.remainingFraction <= 1);
    // Current catalog status is advisory for this active period only. Apply it to
    // the runtime forecast without changing immutable baselines or official points.
    const expectedRemainingPointsZero = required && entity.kind === 'player'
      && entity.injuryStatus?.trim().toLowerCase() === 'out'
      && input.source.currentPlayerStatusPeriod != null
      && samePeriod(input.source.currentPlayerStatusPeriod, input.source.period)
      && samePeriod(input.games.period, input.source.period)
      && benchContextValid && scheduled?.kind === 'scheduled'
      && input.games.games.filter((game) => game.homeTeam === entity.nflTeam || game.awayTeam === entity.nflTeam).length === 1
      && state !== null && (state.statusCode === 0 && state.phase === 'pregame'
        || state.statusCode === 1
          && ['q1', 'q2', 'halftime', 'q3', 'q4', 'overtime'].includes(state.phase)
          && finite(state.remainingFraction) && state.remainingFraction >= 0 && state.remainingFraction <= 1)
      && (state.phase === 'pregame' ? starter.officialPoints === null || starter.officialPoints === 0
        : finite(starter.officialPoints));
    const effectiveBaseline = expectedRemainingPointsZero ? { points: 0, quality: 'complete' as const } : baseline;
    const frozenDefenseStats = record?.scoringStats
      ?? (record?.projectedStats.kind === 'defense' ? record.projectedStats as DefenseProjectionStats : undefined);
    const defense = entity.kind === 'team-defense' && state?.statusCode === 1
      && benchContextValid && record?.quality === 'complete' && frozenDefenseStats
      && entity.externalRef.externalId === entity.nflTeam
      && input.liveDefenseStats && input.scoringProfile
      ? {
          ...input.liveDefenseStats.mapping,
          profile: input.scoringProfile,
          projection: frozenDefenseStats,
          stats: currentDefenseStats && input.liveDefenseStats.status === 'available'
            ? input.liveDefenseStats.capture.entries.find((entry) => entry.team === entity.nflTeam)?.stats ?? null : null,
        } : undefined;
    if (!required && (!benchContextValid || scheduled?.kind !== 'bye' && (!effectiveBaseline || effectiveBaseline.quality !== 'complete')
      || state && startedGame(state) && !finite(starter.officialPoints))) {
      result.set(key, { projectedPoints: null, presentationProjectedPoints: null, projectionQuality: 'unavailable' });
      continue;
    }
    if (required && state?.phase === 'final' && !finite(starter.officialPoints)) {
      throw new Error('The league source did not provide a final official score for a starter.');
    }
    const calculated = calculateLiveProjection({
      kind: projectionKind(entity),
      gameState,
      baseline: effectiveBaseline,
      officialPoints: finite(starter.officialPoints) ? starter.officialPoints : null,
      priorProjectedPoints: prior.get(String(entity.externalRef.externalId)) ?? null,
      defense,
    });
    if (entity.kind === 'team-defense' && state?.statusCode === 1) {
      defenseCalculations.push({ team: entity.nflTeam, quality: calculated.quality,
        ...(calculated.quality === 'defense-estimated' ? {} : {
          reason: input.liveDefenseStats?.status === 'unavailable' ? input.liveDefenseStats.reason
            : input.liveDefenseStats?.status === 'available' && !currentDefenseStats ? 'stale-or-wrong-period-statistics'
              : calculated.defenseReason ?? 'missing-component-evidence',
        }) });
    }
    if (required && (!finite(calculated.projectedPoints) || calculated.quality === 'unavailable')) {
      throw new Error('A complete player projection could not be calculated.');
    }
    result.set(key, {
      projectedPoints: calculated.projectedPoints,
      presentationProjectedPoints: state?.phase === 'final'
        ? record?.quality === 'complete' && finite(record.projectionPoints)
          ? record.projectionPoints
          : null
        : calculated.projectedPoints,
      projectionQuality: calculated.quality,
      probabilityInput: {
        position: entity.position,
        kind: projectionKind(entity),
        phase: scheduled?.kind === 'bye' ? 'bye'
          : benchContextValid && samePeriod(input.games.period, input.source.period)
            && input.games.games.filter((game) => game.homeTeam === entity.nflTeam || game.awayTeam === entity.nflTeam).length === 1
            ? state!.phase : 'unknown',
        remainingFraction: state?.remainingFraction ?? null,
        baselinePoints: effectiveBaseline?.quality === 'complete' ? effectiveBaseline.points : null,
        expectedRemainingPointsZero,
        projectionQuality: calculated.quality,
        officialPoints: starter.officialPoints,
      },
    });
  }
  return result;
}

export function buildProjectedMatchupSnapshot(
  input: BuildSnapshotInput,
  defenseCalculations: DefenseCalculation[] = [],
): ProjectedMatchupSnapshot {
  assertMatchupScopes(input.source);
  const projections = projectedPlayerMap(input, defenseCalculations);
  const benchKeys = new Set(availableBench(input.source).map(({ starter }) => externalReferenceKey(starter.entity.externalRef)));
  const matchups = input.source.matchups.map((matchup) => ({
    matchupRef: matchup.matchupRef,
    status: matchupStatus(matchup, input.source.schedule, input.games),
    sides: matchup.sides.map((side) => {
      const starters: ProjectedLineupSlot[] = side.starters.map((slot) => {
        if (slot.kind === 'empty') return slot;
        const projection = projections.get(externalReferenceKey(slot.entity.externalRef));
        if (!projection || !finite(projection.projectedPoints) || projection.projectionQuality === 'unavailable') {
          throw new Error('A complete player projection could not be calculated.');
        }
        return { ...slot, projectedPoints: projection.projectedPoints,
          presentationProjectedPoints: projection.presentationProjectedPoints,
          projectionQuality: projection.projectionQuality };
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
        ...(side.bench === undefined ? {} : {
          bench: side.starters.length === 0 || side.bench === null
            || side.bench.some((slot) => !benchKeys.has(externalReferenceKey(slot.entity.externalRef)))
            ? null : side.bench.map((slot) => ({ ...slot,
              presentationProjectedPoints: projections.get(externalReferenceKey(slot.entity.externalRef))!.presentationProjectedPoints,
            })),
        }),
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
    matchups: matchups.map((matchup) => ({
      ...matchup,
      winProbability: calculateWinProbability({ status: matchup.status, sides: matchup.sides.map((side) => {
        const occupied = side.starters.filter((slot) => slot.kind === 'occupied');
        // Respect official team adjustments without changing clock-v1 projections.
        const adjustment = finite(side.officialPoints) && occupied.every((slot) => finite(slot.officialPoints))
          ? side.officialPoints - occupied.reduce((total, slot) => total + slot.officialPoints!, 0) : 0;
        return {
          officialPoints: side.officialPoints,
          projectedPoints: side.projectedPoints === null && side.starters.length === 0
            ? null : (side.projectedPoints ?? 0) + adjustment,
          lineupAvailable: side.starters.length > 0,
          players: occupied.map((slot) => projections.get(externalReferenceKey(slot.entity.externalRef))!.probabilityInput!),
        };
      }) }),
    })),
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

function samePeriod(left: LeaguePeriod, right: LeaguePeriod): boolean {
  return left.season === right.season && left.seasonType === right.seasonType && left.week === right.week;
}

function presentationGame(
  entity: ScoringEntity,
  schedule: NflWeekSchedule,
  period: LeaguePeriod,
  games?: GameStateSlate,
): NflGame | null {
  if (!entity.nflTeam) return null;
  const game = schedule[entity.nflTeam];
  if (!game) return null;
  if (game.kind === 'bye') return { kind: 'bye' };
  if (!games || !samePeriod(games.period, period)) return { ...game };
  const candidates = games.games.filter((candidate) => (
    candidate.homeTeam === entity.nflTeam || candidate.awayTeam === entity.nflTeam
  ));
  const state = candidates.length === 1 ? candidates[0] : null;
  if (!state || !samePeriod(state.period, period)
    || state.homeScore === null || state.awayScore === null
    || !Number.isSafeInteger(state.homeScore) || state.homeScore < 0
    || !Number.isSafeInteger(state.awayScore) || state.awayScore < 0) return { ...game };
  const isHome = state.homeTeam === entity.nflTeam;
  if (game.opponent !== (isHome ? state.awayTeam : state.homeTeam)
    || game.location !== (isHome ? 'home' : 'away')) return { ...game };
  const scores = {
    teamScore: isHome ? state.homeScore : state.awayScore,
    opponentScore: isHome ? state.awayScore : state.homeScore,
  };
  if (state.statusCode === 2 && state.phase === 'final') return { ...game, finalScore: scores };
  if (state.statusCode !== 1) return { ...game };
  if (state.phase === 'halftime') {
    return { ...game, liveScore: { ...scores, phase: 'halftime', clockSeconds: null } };
  }
  if (state.phase !== 'q1' && state.phase !== 'q2' && state.phase !== 'q3'
    && state.phase !== 'q4' && state.phase !== 'overtime') return { ...game };
  // Overtime has no remaining regulation projection and may arrive without a
  // clock. Regulation quarters require the existing canonical 0–15 minute clock.
  if (state.clockSeconds === null ? state.phase !== 'overtime'
    : !Number.isInteger(state.clockSeconds) || state.clockSeconds < 0 || state.clockSeconds > 900) {
    return { ...game };
  }
  return { ...game, liveScore: { ...scores, phase: state.phase, clockSeconds: state.clockSeconds } };
}

function presentationPlayer(
  slot: ProjectedLineupSlot | NonNullable<ProjectedMatchup['sides'][number]['bench']>[number],
  index: number,
  schedule: NflWeekSchedule,
  period: LeaguePeriod,
  games?: GameStateSlate,
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
    game: presentationGame(slot.entity, schedule, period, games),
    slot: slot.slot,
    points: slot.officialPoints,
    projectedPoints: slot.presentationProjectedPoints,
  };
}

/** The single canonical-to-public DTO conversion used before snapshot persistence. */
export function toMatchupsData(
  snapshot: ProjectedMatchupSnapshot,
  schedule: NflWeekSchedule,
  games?: GameStateSlate,
): MatchupsData {
  assertMatchupScopes(snapshot);
  const teams = snapshot.participants.map(presentationTeam);
  const teamByRoster = new Map(snapshot.participants.map((participant, index) => [
    externalReferenceKey(participant.rosterRef),
    teams[index],
  ]));
  const matchups = snapshot.matchups.map((matchup) => ({
    id: matchup.matchupRef.externalId,
    status: matchup.status,
    ...(matchup.winProbability === undefined ? {} : { winProbability: matchup.winProbability.status === 'unavailable'
      ? matchup.winProbability
      : {
          modelVersion: matchup.winProbability.modelVersion,
          status: matchup.winProbability.status,
          teams: [
            { teamId: rosterNumber(matchup.sides[0].rosterRef), probability: matchup.winProbability.probabilities[0] },
            { teamId: rosterNumber(matchup.sides[1].rosterRef), probability: matchup.winProbability.probabilities[1] },
          ] as const,
        } }),
    sides: matchup.sides.map((side) => {
      const team = teamByRoster.get(externalReferenceKey(side.rosterRef));
      if (!team) throw new Error('A matchup side has no league participant.');
      return {
        team,
        points: side.officialPoints,
        projectedPoints: side.projectedPoints,
        starters: side.starters.map((slot, index) => presentationPlayer(slot, index, schedule, snapshot.period, games)),
        ...(side.bench === undefined ? {} : {
          bench: side.bench === null ? null : side.bench.map((slot, index) => presentationPlayer(slot, index, schedule, snapshot.period, games)),
        }),
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

/** Canonical matchup IDs repeat between leagues and weeks; only the scoped identity is safe. */
function assertMatchupScopes(snapshot: Pick<ProjectedMatchupSnapshot, 'configuration' | 'period'>
  & Readonly<{ matchups: readonly Pick<ProjectedMatchup, 'matchupRef'>[] }>) {
  const { leagueRef } = snapshot.configuration;
  for (const { matchupRef } of snapshot.matchups) {
    if (matchupRef.resource !== 'matchup' || matchupRef.provider !== leagueRef.provider
      || !sameExternalReference(matchupRef.league, leagueRef)
      || matchupRef.period.season !== snapshot.period.season
      || matchupRef.period.seasonType !== snapshot.period.seasonType
      || matchupRef.period.week !== snapshot.period.week) {
      throw new Error('A matchup identity does not belong to this league period.');
    }
  }
}

/** Builds canonical state first, then performs one presentation conversion. */
export function buildSnapshot(input: BuildSnapshotInput): MatchupsData {
  return toMatchupsData(buildProjectedMatchupSnapshot(input), input.source.schedule, input.games);
}

/** Retain compact component lineage alongside the existing official observation. */
export function buildSnapshotWithDefenseEvidence(input: BuildSnapshotInput) {
  const calculations: DefenseCalculation[] = [];
  const payload = toMatchupsData(buildProjectedMatchupSnapshot(input, calculations), input.source.schedule, input.games);
  const uniqueCalculations = [...new Map(calculations.map((entry) => [entry.team, entry])).values()];
  const capture = input.liveDefenseStats?.status === 'available' && currentDefenseStatistics(input)
    ? input.liveDefenseStats.capture : null;
  const appliedTeams = new Set(uniqueCalculations.filter((entry) => entry.quality === 'defense-estimated').map((entry) => entry.team));
  const entries = capture?.entries.filter((entry) => appliedTeams.has(entry.team)) ?? [];
  const liveDefense = uniqueCalculations.length === 0 ? undefined : entries.length > 0 && capture
    ? { version: DEFENSE_PROJECTION_MODEL_VERSION, status: 'available' as const,
        period: capture.period, requestStartedAt: capture.requestStartedAt,
        requestCompletedAt: capture.requestCompletedAt, observedAt: capture.observedAt,
        sourceRevision: capture.sourceRevision, entries, calculations: uniqueCalculations }
    : { version: DEFENSE_PROJECTION_MODEL_VERSION, status: 'unavailable' as const,
        reason: input.liveDefenseStats?.status === 'unavailable' ? input.liveDefenseStats.reason : 'no-applied-statistics',
        calculations: uniqueCalculations };
  return { payload, liveDefense };
}

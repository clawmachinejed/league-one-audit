import { describe, expect, it } from 'vitest';
import capture from './fixtures/out-starter-week2.public.json';
import {
  NFL_TEAM_CODES,
  type GameStateObservation,
  type LeaguePeriod,
  type LeagueWeekState,
  type NflTeam,
  type ScoringEntity,
  type TeamWeek,
} from '../domain/contracts';
import type { NflGameId, ScoringEntityId } from '../ports/identity-crosswalk';
import type { ProjectionBaselineRecord, ProjectionRunId } from '../ports/projection-repository';
import {
  externalGameRef, externalLeagueRef, externalMatchupRef, externalPlayerRef,
  externalRosterRef, externalTeamDefenseRef, providerKey,
} from '../shared/provider-identity';
import { buildSnapshot, type BuildSnapshotInput } from './snapshot-builder';

type RawCase = typeof capture.cases[number];
type CapturedPlayer = {
  id: string; name: string; position: string; nflTeam: string; slot: string;
  injuryStatus: string | null; points: number; projectedPoints: number;
  game: { date: string; kind: string; location: string; opponent: string; kickoffAt: string;
    finalScore?: { teamScore: number; opponentScore: number } };
};
type CapturedCase = Omit<RawCase, 'matchup'> & {
  matchup: Omit<RawCase['matchup'], 'sides'> & {
    sides: { teamId: number; points: number; projectedPoints: number; starters: CapturedPlayer[] }[];
  };
};
const official = providerKey('sleeper');
const constructedProvider = providerKey('constructed-public-fixture');

function team(value: string): NflTeam {
  const result = NFL_TEAM_CODES.find((code) => code === value);
  if (!result) throw new Error(`Fixture contains an unknown NFL team: ${value}`);
  return result;
}

function entityFor(player: CapturedPlayer): ScoringEntity {
  const common = { displayName: player.name, position: player.position,
    nflTeam: team(player.nflTeam), injuryStatus: player.injuryStatus };
  return player.position === 'DEF'
    ? { ...common, kind: 'team-defense', externalRef: externalTeamDefenseRef(official, player.id) }
    : { ...common, kind: 'player', externalRef: externalPlayerRef(official, player.id) };
}

/** Public observations cannot reconstruct private baseline quality or source
 * records. These are explicitly constructed canonical inputs using captured
 * scores, display projections, schedule and identities, as the JSON documents.
 * Only the target's baseline is deliberately omitted to model the failure. */
function canonicalInput(
  observed: CapturedCase,
  currentPlayerStatusPeriod: LeaguePeriod | null,
  requestedWeek = observed.period.week,
): BuildSnapshotInput {
  const period: LeaguePeriod = { season: Number(observed.period.season), seasonType: 'regular', week: requestedWeek };
  const leagueRef = externalLeagueRef(official, `constructed-${observed.leagueKey}`);
  const timestamp = observed.provenance.full.checkedAt;
  const players = observed.matchup.sides.flatMap((side) => side.starters);
  const schedule: Partial<Record<NflTeam, TeamWeek>> = {};
  const gameStates = new Map<string, GameStateObservation>();
  const latest: ProjectionBaselineRecord[] = [];
  const frozen: ProjectionBaselineRecord[] = [];

  for (const player of players) {
    const entity = entityFor(player);
    const observedGame = player.game;
    if (observedGame.kind !== 'scheduled'
      || (observedGame.location !== 'home' && observedGame.location !== 'away')) {
      throw new Error('This capture only contains scheduled games.');
    }
    const nflTeam = team(player.nflTeam);
    const opponent = team(observedGame.opponent);
    schedule[nflTeam] = { kind: 'scheduled', opponent, location: observedGame.location,
      date: observedGame.date, kickoffAt: observedGame.kickoffAt };
    const home = observedGame.location === 'home';
    const homeTeam = home ? nflTeam : opponent;
    const awayTeam = home ? opponent : nflTeam;
    const gameId = `constructed-${period.week}-${homeTeam}-${awayTeam}`;
    const gameRef = externalGameRef(constructedProvider, gameId);
    const finalScore = observedGame.finalScore;
    if (!finalScore && Date.parse(observedGame.kickoffAt) <= Date.parse(timestamp)) {
      throw new Error('A past kickoff without captured final evidence cannot be constructed as pregame.');
    }
    gameStates.set(gameId, {
      gameRef, period, homeTeam, awayTeam,
      statusCode: finalScore ? 2 : 0, phase: finalScore ? 'final' : 'pregame',
      statusText: null, sourcePeriod: null, gameClock: null, clockSeconds: null,
      remainingFraction: finalScore ? 0 : 1,
      homeScore: finalScore ? (home ? finalScore.teamScore : finalScore.opponentScore) : null,
      awayScore: finalScore ? (home ? finalScore.opponentScore : finalScore.teamScore) : null,
      requestStartedAt: timestamp, requestCompletedAt: timestamp, observedAt: timestamp,
      sourceRevision: gameId,
    });
    if (player.id === observed.targetPlayerId) continue;
    const record: ProjectionBaselineRecord = {
      officialEntityRef: entity.externalRef,
      entityId: `constructed-entity-${player.id}` as ScoringEntityId,
      entityKind: entity.kind, displayName: entity.displayName, nflTeam: entity.nflTeam,
      gameId: gameId as NflGameId, projectionGameRef: gameRef,
      projectionPoints: player.projectedPoints, projectedStats: {}, quality: 'complete',
      sourceProjectionRunId: `constructed-run-${player.id}` as ProjectionRunId,
      projectionSource: constructedProvider, modelVersion: 'clock-v1',
      observedAt: timestamp, frozenAt: finalScore ? observedGame.kickoffAt : null,
    };
    (finalScore ? frozen : latest).push(record);
  }

  const rosterRefs = observed.matchup.sides.map((side) => externalRosterRef(leagueRef, String(side.teamId)));
  const source: LeagueWeekState = {
    configuration: { key: observed.leagueKey, displayName: 'Constructed fixture league', leagueRef,
      matchupWeekRange: { firstWeek: 1, lastWeek: 18 } },
    leagueName: 'Constructed fixture league', period, currentPlayerStatusPeriod, maxWeek: 18,
    lineupShape: { expectedRosterCount: 2, expectedStarterSlotCount: 9, expectedRosterRefs: rosterRefs },
    rosterPositions: observed.matchup.sides[0].starters.map((player) => player.slot),
    participants: rosterRefs.map((rosterRef, index) => ({
      rosterRef, managerName: 'Fixture manager', teamName: `Fixture roster ${index + 1}`,
      avatarUrl: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: null,
    })),
    matchups: [{ matchupRef: externalMatchupRef(leagueRef, period, observed.matchup.id), status: 'unknown',
      sides: observed.matchup.sides.map((side, index) => ({
        rosterRef: rosterRefs[index], officialPoints: side.points,
        starters: side.starters.map((player) => ({
          kind: 'occupied', slot: player.slot, entity: entityFor(player), officialPoints: player.points,
        })),
      })),
    }],
    rosteredEntities: players.map(entityFor), schedule,
    // No scorer is invoked: the test supplies already-scored baseline values.
    scoringSettings: { provider: official, rawRules: null },
    requestStartedAt: timestamp, requestCompletedAt: timestamp, observedAt: timestamp,
    sourceRevision: `constructed-from-${observed.provenance.full.headers['x-projection-snapshot-revision']}`,
    lineup: { revisionVersion: 'lineup-v1', lineupRevision: 'c'.repeat(64) },
  };
  return { source, games: { source: constructedProvider, period,
    requestStartedAt: timestamp, requestCompletedAt: timestamp, observedAt: timestamp,
    games: [...gameStates.values()] }, scored: { status: 'available', projections: [] },
  latest, frozen, prior: null, calculatedAt: timestamp };
}

function activePeriod(observed: CapturedCase): LeaguePeriod {
  return { season: Number(observed.period.season), seasonType: 'regular', week: observed.period.week };
}

function assertObservedScoresAndProjections(observed: CapturedCase, input: BuildSnapshotInput) {
  const matchup = buildSnapshot(input).matchups[0];
  expect(matchup.status).toBe(observed.matchup.status);
  for (const [index, side] of matchup.sides.entries()) {
    const expected = observed.matchup.sides[index];
    expect(side.team.id).toBe(expected.teamId);
    expect(side.points).toBe(expected.points);
    expect(side.projectedPoints).toBeCloseTo(expected.projectedPoints, 12);
    expect(side.starters.map(({ id, points, projectedPoints, injuryStatus, game }) => (
      { id, points, projectedPoints, injuryStatus, game }
    ))).toEqual(expected.starters.map(({ id, points, projectedPoints, injuryStatus, game }) => (
      { id, points, projectedPoints, injuryStatus, game }
    )));
  }
}

describe.each(capture.cases)('$leagueKey captured Week 2 Out starter', (observed) => {
  it('retains the observed unavailable result without requested-period status authority', () => {
    expect(observed.provenance.sameRevision).toBe(true);
    expect(observed.matchup.winProbability).toMatchObject({ status: 'unavailable', reason: 'missing-projection' });
    const input = canonicalInput(observed, null);
    expect(buildSnapshot(input).matchups[0].winProbability)
      .toMatchObject({ status: 'unavailable', reason: 'missing-projection' });
    assertObservedScoresAndProjections(observed, input);
  });

  it('permits complementary estimates for the active Out zero without changing actuals or frozen display values', () => {
    const input = canonicalInput(observed, activePeriod(observed));
    const before = structuredClone(input);
    const odds = buildSnapshot(input).matchups[0].winProbability;
    expect(odds?.status).toBe('estimated');
    if (!odds || odds.status !== 'estimated') throw new Error('Expected an available active-period estimate.');
    expect(odds.teams.map((entry) => entry.teamId)).toEqual(observed.matchup.sides.map((side) => side.teamId));
    expect(odds.teams.every((entry) => entry.probability > 0 && entry.probability < 1)).toBe(true);
    expect(odds.teams[0].probability + odds.teams[1].probability).toBeCloseTo(1, 12);
    assertObservedScoresAndProjections(observed, input);
    expect(input).toEqual(before);
  });

  it.each([null, 'Questionable', 'Doubtful', 'Inactive'])('does not turn a missing %s baseline into an Out zero', (injuryStatus) => {
    const changed = structuredClone(observed);
    for (const player of changed.matchup.sides.flatMap((side) => side.starters)) {
      if (player.id === observed.targetPlayerId) player.injuryStatus = injuryStatus;
    }
    expect(buildSnapshot(canonicalInput(changed, activePeriod(changed))).matchups[0].winProbability)
      .toMatchObject({ status: 'unavailable', reason: 'missing-projection' });
  });

  it.each([1, 3])('does not apply current Out metadata to a constructed Week %s without status scope', (week) => {
    const input = canonicalInput(observed, null, week);
    expect(buildSnapshot(input).matchups[0].winProbability)
      .toMatchObject({ status: 'unavailable', reason: 'missing-projection' });
    expect(buildSnapshot({ ...input, source: { ...input.source,
      currentPlayerStatusPeriod: activePeriod(observed) } }).matchups[0].winProbability)
      .toMatchObject({ status: 'unavailable', reason: 'missing-projection' });
  });
});

it('preserves the real completed Out-player control rather than erasing already-earned negative actuals', () => {
  const control = capture.completedOutControl.player;
  expect(control).toMatchObject({ id: '4983', injuryStatus: 'Out', points: -0.1, projectedPoints: 12.11 });
  // Construct a pair around the captured single-player control. Its enclosing
  // team total is adjusted explicitly; it is not a third captured full matchup.
  const observed: CapturedCase = structuredClone(capture.cases[0]);
  const side = observed.matchup.sides[0];
  const index = side.starters.findIndex((player) => player.game.finalScore !== undefined);
  const prior = side.starters[index];
  side.points += control.points - prior.points;
  side.projectedPoints += control.points - prior.points;
  side.starters[index] = control;
  const input = canonicalInput(observed, activePeriod(observed));
  assertObservedScoresAndProjections(observed, input);
  expect(buildSnapshot(input).matchups[0].winProbability?.status).toBe('estimated');
});

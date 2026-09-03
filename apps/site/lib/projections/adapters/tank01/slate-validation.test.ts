import { describe, expect, it } from 'vitest';
import { NFL_TEAMS } from '../../../nfl-teams';
import type {
  NflTeam,
  NflWeekSchedule,
  ProjectionObservation,
  ProjectionSlate,
} from '../../domain/contracts';
import {
  externalPlayerRef,
  externalTeamDefenseRef,
  providerKey,
} from '../../shared/provider-identity';
import {
  assessProjectionSlate,
  hasPlausibleTank01ProjectionEnvelope,
} from './slate-validation';

const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
const tank = providerKey('tank01');
const official = providerKey('sleeper');

function scheduleFor(teams: readonly NflTeam[] = NFL_TEAMS): NflWeekSchedule {
  const schedule: Partial<Record<NflTeam, NflWeekSchedule[NflTeam]>> = {};
  for (let index = 0; index < teams.length; index += 2) {
    const home = teams[index];
    const away = teams[index + 1];
    schedule[home] = {
      kind: 'scheduled', opponent: away, location: 'home', date: '2026-09-13', kickoffAt: null,
    };
    schedule[away] = {
      kind: 'scheduled', opponent: home, location: 'away', date: '2026-09-13', kickoffAt: null,
    };
  }
  return schedule;
}

function playerProjection(
  team: NflTeam,
  position: typeof CORE_POSITIONS[number],
): ProjectionObservation {
  const id = `${team}-${position}`;
  return {
    identity: {
      primary: externalPlayerRef(tank, `tank-${id}`),
      aliases: [externalPlayerRef(official, `official-${id}`)],
    },
    nflTeam: team,
    position,
    stats: {},
    scoringStats: {
      kind: 'offense',
      passingYards: 0,
      passingTouchdowns: 0,
      passingInterceptions: 0,
      rushingYards: 0,
      rushingTouchdowns: 0,
      receptions: 0,
      receivingYards: 0,
      receivingTouchdowns: 0,
      twoPointConversions: 0,
      fumblesLost: 0,
    },
    missingFields: [],
  };
}

function defenseProjection(team: NflTeam): ProjectionObservation {
  return {
    identity: { primary: externalTeamDefenseRef(tank, team), aliases: [] },
    nflTeam: team,
    position: 'DEF',
    stats: {},
    scoringStats: {
      kind: 'defense',
      sacks: 0,
      interceptions: 0,
      fumbleRecoveries: 0,
      defensiveTouchdowns: 0,
      specialTeamsTouchdowns: 0,
      safeties: 0,
      blockedKicks: 0,
      pointsAllowed: 0,
    },
    missingFields: [],
  };
}

function slateFor(
  teams: readonly NflTeam[] = NFL_TEAMS,
  options: Readonly<{
    positions?: readonly typeof CORE_POSITIONS[number][];
    omit?: readonly string[];
    incomplete?: readonly string[];
  }> = {},
): ProjectionSlate {
  const positions = options.positions ?? CORE_POSITIONS;
  const omitted = new Set(options.omit ?? []);
  const incomplete = new Set(options.incomplete ?? []);
  const projections = teams.flatMap((team) => [
    ...positions.flatMap((position) => {
      const key = `${team}-${position}`;
      if (omitted.has(key)) return [];
      const projection = playerProjection(team, position);
      return [incomplete.has(key)
        ? {
            ...projection,
            scoringStats: projection.scoringStats.kind === 'offense'
              ? { ...projection.scoringStats, passingTouchdowns: null }
              : projection.scoringStats,
          } satisfies ProjectionObservation
        : projection];
    }),
    ...(!omitted.has(`${team}-DEF`) ? [(() => {
      const projection = defenseProjection(team);
      return incomplete.has(`${team}-DEF`)
        ? {
            ...projection,
            scoringStats: projection.scoringStats.kind === 'defense'
              ? { ...projection.scoringStats, sacks: null }
              : projection.scoringStats,
          } satisfies ProjectionObservation
        : projection;
    })()] : []),
  ]);
  return {
    source: tank,
    period: { season: 2026, seasonType: 'regular', week: 1 },
    quality: 'complete',
    requestStartedAt: '2026-09-01T12:00:00.000Z',
    requestCompletedAt: '2026-09-01T12:00:00.000Z',
    observedAt: '2026-09-01T12:00:00.000Z',
    sourceRevision: 'fixture',
    projections,
    coverage: {
      crosswalkRows: 0, crosswalkEntries: 0, malformedCrosswalkRows: 0, ambiguousCrosswalkRows: 0,
      playerRows: 0, matchedPlayers: 0, unmatchedPlayers: 0, malformedPlayers: 0,
      incompletePlayers: 0, defenseRows: 0, usableDefenses: 0, malformedDefenses: 0,
      incompleteDefenses: 0,
    },
    warnings: [],
  };
}

describe('canonical weekly projection slate assessment', () => {
  it('accepts distributed coverage with the existing two-team omission tolerance', () => {
    const result = slateFor(NFL_TEAMS, {
      omit: ['ARI-RB', 'ATL-RB', 'BUF-TE', 'CAR-DEF', 'CHI-DEF'],
    });
    expect(assessProjectionSlate(result, scheduleFor())).toEqual({
      complete: true,
      expectedTeams: 32,
      requiredTeamsPerCategory: 30,
      coveredTeams: { QB: 32, RB: 30, WR: 32, TE: 31, DEF: 30 },
    });
  });

  it('rejects the same missing teams across all offense categories', () => {
    const missing = ['ARI', 'ATL'] as const;
    const result = slateFor(NFL_TEAMS, {
      omit: missing.flatMap((team) => CORE_POSITIONS.map((position) => `${team}-${position}`)),
    });
    expect(assessProjectionSlate(result, scheduleFor())).toMatchObject({
      complete: false,
      coveredTeams: { QB: 30, RB: 30, WR: 30, TE: 30, DEF: 32 },
    });
  });

  it('excludes incomplete rows while allowing one isolated unusable row', () => {
    const broadlyIncomplete = NFL_TEAMS.flatMap((team) => CORE_POSITIONS.map((position) => (
      `${team}-${position}`
    )));
    expect(assessProjectionSlate(
      slateFor(NFL_TEAMS, { incomplete: broadlyIncomplete }),
      scheduleFor(),
    ).complete).toBe(false);
    expect(assessProjectionSlate(
      slateFor(NFL_TEAMS, { incomplete: ['ARI-RB'] }),
      scheduleFor(),
    )).toMatchObject({ complete: true, coveredTeams: { RB: 31 } });
  });

  it('rejects broad category truncation and a one-player response', () => {
    expect(assessProjectionSlate(
      slateFor(NFL_TEAMS, { positions: ['QB'] }),
      scheduleFor(),
    )).toMatchObject({ complete: false, coveredTeams: { QB: 32, RB: 0, WR: 0, TE: 0, DEF: 32 } });

    const onePlayer = {
      ...slateFor([], { positions: [] }),
      projections: [playerProjection('ARI', 'QB'), ...NFL_TEAMS.map(defenseProjection)],
    };
    expect(assessProjectionSlate(onePlayer, scheduleFor()).complete).toBe(false);
  });

  it('derives expected coverage from a valid bye week', () => {
    const playing = NFL_TEAMS.slice(0, 28);
    const schedule = { ...scheduleFor(playing) };
    for (const team of NFL_TEAMS.slice(28)) schedule[team] = { kind: 'bye' };
    expect(assessProjectionSlate(slateFor(playing), schedule)).toEqual({
      complete: true,
      expectedTeams: 28,
      requiredTeamsPerCategory: 26,
      coveredTeams: { QB: 28, RB: 28, WR: 28, TE: 28, DEF: 28 },
    });
  });

  it('rejects incomplete or contradictory schedules', () => {
    const incompleteSchedule = scheduleFor(NFL_TEAMS.slice(0, 24));
    const contradictory = { ...scheduleFor() };
    contradictory.ARI = {
      kind: 'scheduled', opponent: 'ATL', location: 'home', date: '2026-09-14', kickoffAt: null,
    };
    expect(assessProjectionSlate(slateFor(), incompleteSchedule).complete).toBe(false);
    expect(assessProjectionSlate(slateFor(), contradictory).complete).toBe(false);
  });

  it('rejects a defense whose canonical team conflicts with its opaque projection identity', () => {
    const slate = slateFor();
    const mismatched = slate.projections.map((projection) => (
      projection.identity.primary.entityKind === 'team-defense' && projection.nflTeam === 'ARI'
        ? { ...projection, identity: { primary: externalTeamDefenseRef(tank, 'ATL'), aliases: [] } }
        : projection
    ));
    expect(assessProjectionSlate({ ...slate, projections: mismatched }, scheduleFor())).toMatchObject({
      complete: true,
      coveredTeams: { DEF: 31 },
    });
  });
});

describe('pre-cache Tank01 envelope gate', () => {
  it('requires 24 complete teams in every category before persistent caching', () => {
    const complete = slateFor().projections;
    const players = complete.filter(({ scoringStats }) => scoringStats.kind === 'offense').map((value) => ({
      nflTeam: value.nflTeam, position: value.position, scoringStats: value.scoringStats,
    }));
    const defenses = complete.filter(({ scoringStats }) => scoringStats.kind === 'defense').map((value) => ({
      nflTeam: value.nflTeam, scoringStats: value.scoringStats,
    }));
    expect(hasPlausibleTank01ProjectionEnvelope(players, defenses)).toBe(true);
    expect(hasPlausibleTank01ProjectionEnvelope(players.slice(0, 1), defenses)).toBe(false);
    const incomplete = players.map((value) => ({
      ...value,
      scoringStats: { ...value.scoringStats, passingTouchdowns: null },
    }));
    expect(hasPlausibleTank01ProjectionEnvelope(incomplete, defenses)).toBe(false);
  });
});

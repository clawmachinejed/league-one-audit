import { describe, expect, it } from 'vitest';
import { NFL_TEAMS, type NflTeam } from './nfl-teams';
import type { WeekSchedule } from './nfl-schedule';
import { assessTank01ProjectionSlate } from './projection-slate';
import type {
  Tank01AvailableResult,
  Tank01DefenseProjection,
  Tank01PlayerProjection,
} from './tank01';

const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

function scheduleFor(teams: readonly NflTeam[] = NFL_TEAMS): WeekSchedule {
  const schedule: WeekSchedule = {};
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

function playerProjection(team: NflTeam, position: typeof CORE_POSITIONS[number]): Tank01PlayerProjection {
  const id = `${team}-${position}`;
  return {
    tank01PlayerId: `tank-${id}`,
    sleeperPlayerId: `sleeper-${id}`,
    team,
    position,
    stats: {
      passing: { attempts: 0, completions: 0, yards: 0, touchdowns: 0, interceptions: 0 },
      rushing: { carries: 0, yards: 0, touchdowns: 0 },
      receiving: { targets: 0, receptions: 0, yards: 0, touchdowns: 0 },
      kicking: {
        fieldGoalsMade: null, fieldGoalsMissed: null, extraPointsMade: null, extraPointsMissed: null,
      },
      twoPointConversions: 0,
      fumblesLost: 0,
    },
    scoringProjection: {
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

function defenseProjection(team: NflTeam): Tank01DefenseProjection {
  return {
    team,
    stats: {
      returnTouchdowns: 0, defensiveTouchdowns: 0, safeties: 0, fumbleRecoveries: 0,
      pointsAllowed: 0, interceptions: 0, sacks: 0, blockedKicks: 0,
    },
    scoringProjection: {
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

function resultFor(
  teams: readonly NflTeam[] = NFL_TEAMS,
  options: Readonly<{
    positions?: readonly typeof CORE_POSITIONS[number][];
    omit?: readonly string[];
    incomplete?: readonly string[];
  }> = {},
): Tank01AvailableResult {
  const positions = options.positions ?? CORE_POSITIONS;
  const omitted = new Set(options.omit ?? []);
  const incomplete = new Set(options.incomplete ?? []);
  const players = Object.fromEntries(teams.flatMap((team) => positions.flatMap((position) => {
    const key = `${team}-${position}`;
    if (omitted.has(key)) return [];
    const projection = playerProjection(team, position);
    return [[key, incomplete.has(key)
      ? {
          ...projection,
          scoringProjection: { ...projection.scoringProjection, passingTouchdowns: null },
        }
      : projection] as const];
  })));
  const defenses = Object.fromEntries(teams.flatMap((team) => (
    omitted.has(`${team}-DEF`) ? [] : [[team, incomplete.has(`${team}-DEF`)
      ? {
          ...defenseProjection(team),
          scoringProjection: { ...defenseProjection(team).scoringProjection, sacks: null },
        }
      : defenseProjection(team)] as const]
  )));
  return {
    status: 'available',
    season: '2026',
    week: 1,
    fetchedAt: '2026-09-01T12:00:00.000Z',
    projections: { bySleeperId: players, byDefenseTeam: defenses },
    coverage: {
      playerListRows: Object.keys(players).length,
      crosswalkEntries: Object.keys(players).length,
      malformedPlayerListRows: 0,
      ambiguousPlayerListRows: 0,
      playerProjectionRows: Object.keys(players).length,
      matchedPlayerProjections: Object.keys(players).length,
      unmatchedPlayerProjections: 0,
      malformedPlayerProjections: 0,
      incompletePlayerProjections: 0,
      defenseProjectionRows: Object.keys(defenses).length,
      usableDefenseProjections: Object.keys(defenses).length,
      malformedDefenseProjections: 0,
      incompleteDefenseProjections: 0,
    },
    warnings: [],
  };
}

describe('Tank01 whole-slate assessment', () => {
  it('accepts distributed weekly coverage while tolerating isolated player-position and defense omissions', () => {
    const result = resultFor(NFL_TEAMS, {
      omit: ['ARI-RB', 'ATL-RB', 'BUF-TE', 'CAR-DEF', 'CHI-DEF'],
    });

    expect(assessTank01ProjectionSlate(result, scheduleFor())).toEqual({
      complete: true,
      expectedTeams: 32,
      requiredTeamsPerCategory: 30,
      coveredTeams: { QB: 32, RB: 30, WR: 32, TE: 31, DEF: 30 },
    });
  });

  it('rejects the same teams being absent across the entire weekly slate', () => {
    const result = resultFor(NFL_TEAMS, {
      omit: CORE_POSITIONS.flatMap((position) => [
        `ARI-${position}`,
        `ATL-${position}`,
      ]).concat(['ARI-DEF', 'ATL-DEF']),
    });

    expect(assessTank01ProjectionSlate(result, scheduleFor())).toMatchObject({
      complete: false,
      coveredTeams: { QB: 30, RB: 30, WR: 30, TE: 30, DEF: 30 },
    });
  });

  it('rejects a team whose offense is absent even when its defense is present', () => {
    const result = resultFor(NFL_TEAMS, {
      omit: CORE_POSITIONS.map((position) => `ARI-${position}`),
    });

    expect(assessTank01ProjectionSlate(result, scheduleFor())).toMatchObject({
      complete: false,
      coveredTeams: { QB: 31, RB: 31, WR: 31, TE: 31, DEF: 32 },
    });
  });

  it('rejects identity-bearing rows whose projected statistics are incomplete', () => {
    const incomplete = NFL_TEAMS.flatMap((team) => CORE_POSITIONS.map((position) => (
      `${team}-${position}`
    ))).concat(NFL_TEAMS.map((team) => `${team}-DEF`));

    expect(assessTank01ProjectionSlate(
      resultFor(NFL_TEAMS, { incomplete }),
      scheduleFor(),
    )).toMatchObject({
      complete: false,
      coveredTeams: { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 },
    });
  });

  it('accepts an isolated unusable scoring row after excluding it from coverage', () => {
    expect(assessTank01ProjectionSlate(
      resultFor(NFL_TEAMS, { incomplete: ['ARI-RB'] }),
      scheduleFor(),
    )).toMatchObject({
      complete: true,
      coveredTeams: { QB: 32, RB: 31, WR: 32, TE: 32, DEF: 32 },
    });
  });

  it('rejects a one-player response even when every scheduled defense is present', () => {
    const base = resultFor(NFL_TEAMS, { positions: [] });
    const result: Tank01AvailableResult = {
      ...base,
      projections: {
        ...base.projections,
        bySleeperId: { 'only-player': playerProjection('ARI', 'QB') },
      },
    };

    expect(assessTank01ProjectionSlate(result, scheduleFor())).toMatchObject({
      complete: false,
      expectedTeams: 32,
      coveredTeams: { QB: 1, RB: 0, WR: 0, TE: 0, DEF: 32 },
    });
  });

  it('rejects broad position truncation even when every scheduled team and defense appears', () => {
    const result = resultFor(NFL_TEAMS, { positions: ['QB'] });

    expect(assessTank01ProjectionSlate(result, scheduleFor())).toMatchObject({
      complete: false,
      coveredTeams: { QB: 32, RB: 0, WR: 0, TE: 0, DEF: 32 },
    });
  });

  it('derives the expected coverage from a bye-week schedule instead of an exact 32-team count', () => {
    const byeWeekTeams = NFL_TEAMS.slice(0, 28);

    expect(assessTank01ProjectionSlate(resultFor(byeWeekTeams), scheduleFor(byeWeekTeams))).toMatchObject({
      complete: true,
      expectedTeams: 28,
      requiredTeamsPerCategory: 26,
    });
  });

  it('refuses to certify an incomplete or internally inconsistent NFL schedule', () => {
    const incompleteSchedule = scheduleFor(NFL_TEAMS.slice(0, 24));
    const inconsistentSchedule = scheduleFor();
    inconsistentSchedule.ARI = {
      kind: 'scheduled', opponent: 'BAL', location: 'home', date: '2026-09-13', kickoffAt: null,
    };

    expect(assessTank01ProjectionSlate(resultFor(), incompleteSchedule).complete).toBe(false);
    expect(assessTank01ProjectionSlate(resultFor(), inconsistentSchedule).complete).toBe(false);
  });
});

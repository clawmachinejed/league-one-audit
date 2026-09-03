import { describe, expect, it, vi } from 'vitest';
import type { ProjectionSyncInput } from '../../../sleeper';
import type { MatchupsData, Player, Team } from '../../../types';
import {
  externalLeagueRef,
  externalPlayerRef,
  externalRosterRef,
  externalTeamDefenseRef,
} from '../../shared/provider-identity';
import { compatibleRevision } from '../../shared/revision-compatibility';
import { createSleeperLeagueSource } from './league-source';

const leagueRef = externalLeagueRef('official-source', 'league-001');
const configuration = {
  key: 'premier',
  displayName: 'Premier League',
  leagueRef,
  matchupWeekRange: { firstWeek: 1, lastWeek: 18 },
};
const targetPeriod = { season: 2026, seasonType: 'regular' as const, week: 1 };

const teamOne: Team = {
  id: 1,
  managerName: 'Manager One',
  name: 'One Team',
  avatar: 'https://example.com/one.png',
  wins: 1,
  losses: 0,
  ties: 0,
  pointsFor: 101.25,
  pointsAgainst: 88.5,
};

const teamTwo: Team = {
  id: 2,
  managerName: 'Manager Two',
  name: 'Two Team',
  avatar: null,
  wins: 0,
  losses: 1,
  ties: 0,
  pointsFor: 88.5,
  pointsAgainst: 101.25,
};

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: `Player ${id}`,
    position: 'RB',
    nflTeam: 'KC',
    injuryStatus: null,
    game: null,
    slot: 'RB',
    points: null,
    projectedPoints: null,
    ...overrides,
  };
}

function input(overrides: Partial<ProjectionSyncInput> = {}): ProjectionSyncInput {
  const scoringSettings = { pass_td: 6, rush_yd: 0.1 };
  const starter = player('p1', { name: 'Starter Copy', points: 12.3, injuryStatus: 'Q' });
  const defense = player('JAX', {
    name: 'JAX Defense',
    position: 'DEF',
    nflTeam: 'JAX',
    slot: 'DEF',
    points: 8,
  });
  const empty = player('empty-FLEX-1', {
    name: 'Empty slot',
    position: '—',
    nflTeam: null,
    slot: 'FLEX',
  });
  const data: MatchupsData = {
    league: {
      season: '2026',
      rosterPositions: ['RB', 'FLEX', 'DEF', 'BN'],
      week: 1,
      maxWeek: 18,
    },
    teams: [teamOne, teamTwo],
    updatedAt: '2026-09-03T00:00:02.000Z',
    warning: 'Source warning.',
    week: 1,
    matchups: [{
      id: '7',
      status: 'live',
      sides: [
        { team: teamOne, points: 20.3, projectedPoints: null, starters: [starter, empty, defense] },
        { team: teamTwo, points: 4, projectedPoints: null, starters: [player('p3', { points: 4 })] },
      ],
    }],
  };
  return {
    sleeperLeagueId: 'league-001',
    leagueName: 'League API Name',
    scoringSettings,
    rawMatchups: [
      { roster_id: 1, matchup_id: 7, starters: ['p1', '0', 'JAX'] },
      { roster_id: 2, matchup_id: 7, starters: ['p3', '0', '0'] },
    ],
    matchupShape: { rosterIds: [1, 2], expectedRosterCount: 2, expectedStarterSlotCount: 3, starterSlots: ['RB', 'FLEX', 'DEF'] },
    data,
    rosteredPlayers: [
      player('p1', { name: 'Bench Copy', slot: 'BN' }),
      player('p2', { name: 'Bench Player', slot: 'BN' }),
      player('JAX', { name: 'Old Defense Copy', position: 'DEF', nflTeam: 'JAX', slot: 'BN' }),
    ],
    schedule: {
      KC: {
        kind: 'scheduled',
        opponent: 'JAX',
        location: 'away',
        date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
      JAX: {
        kind: 'scheduled',
        opponent: 'KC',
        location: 'home',
        date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
    },
    requestStartedAt: '2026-09-03T00:00:01.000Z',
    requestCompletedAt: '2026-09-03T00:00:02.000Z',
    ...overrides,
  };
}

describe('Sleeper league-source adapter', () => {
  it('loads once and translates identities, participants, lineups, and source metadata', async () => {
    const source = input();
    const load = vi.fn(async () => source);
    const result = await createSleeperLeagueSource(load).getLeagueWeek(configuration, targetPeriod);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('league-001', targetPeriod);
    expect(result.configuration).toBe(configuration);
    expect(result.leagueName).toBe('League API Name');
    expect(result.period).toEqual({ season: 2026, seasonType: 'regular', week: 1 });
    expect(result.maxWeek).toBe(18);
    expect(result.lineupShape).toEqual({ expectedRosterCount: 2, expectedStarterSlotCount: 3,
      expectedRosterRefs: [externalRosterRef(leagueRef, '1'), externalRosterRef(leagueRef, '2')] });
    expect(result.rosterPositions).toBe(source.data.league.rosterPositions);
    expect(result.participants).toEqual([
      {
        rosterRef: externalRosterRef(leagueRef, '1'),
        managerName: 'Manager One',
        teamName: 'One Team',
        avatarUrl: 'https://example.com/one.png',
        wins: 1,
        losses: 0,
        ties: 0,
        pointsFor: 101.25,
        pointsAgainst: 88.5,
      },
      {
        rosterRef: externalRosterRef(leagueRef, '2'),
        managerName: 'Manager Two',
        teamName: 'Two Team',
        avatarUrl: null,
        wins: 0,
        losses: 1,
        ties: 0,
        pointsFor: 88.5,
        pointsAgainst: 101.25,
      },
    ]);
    expect(result.matchups[0]).toMatchObject({
      matchupId: '7',
      status: 'live',
      sides: [
        {
          rosterRef: externalRosterRef(leagueRef, '1'),
          officialPoints: 20.3,
          starters: [
            {
              kind: 'occupied',
              slot: 'RB',
              officialPoints: 12.3,
              entity: {
                kind: 'player',
                externalRef: externalPlayerRef(leagueRef.provider, 'p1'),
                displayName: 'Starter Copy',
                injuryStatus: 'Q',
              },
            },
            { kind: 'empty', slot: 'FLEX' },
            {
              kind: 'occupied',
              slot: 'DEF',
              officialPoints: 8,
              entity: {
                kind: 'team-defense',
                externalRef: externalTeamDefenseRef(leagueRef.provider, 'JAX'),
                nflTeam: 'JAX',
              },
            },
          ],
        },
        { rosterRef: externalRosterRef(leagueRef, '2'), officialPoints: 4 },
      ],
    });
    expect(result.rosteredEntities.map((entity) => [entity.externalRef.externalId, entity.displayName]))
      .toEqual([
        ['p1', 'Starter Copy'],
        ['p2', 'Bench Player'],
        ['JAX', 'JAX Defense'],
        ['p3', 'Player p3'],
      ]);
    expect(result.schedule).toEqual(source.schedule);
    expect(result.scoringSettings.rawRules).toBe(source.scoringSettings);
    expect(result.scoringSettings.provider).toBe(leagueRef.provider);
    expect(result.requestStartedAt).toBe(source.requestStartedAt);
    expect(result.requestCompletedAt).toBe(source.requestCompletedAt);
    expect(result.observedAt).toBe(source.requestCompletedAt);
    expect(result.sourceRevision).toBe(compatibleRevision({
      requestStartedAt: source.requestStartedAt,
      requestCompletedAt: source.requestCompletedAt,
      data: source.data,
    }));
    expect(result.warning).toBe('Source warning.');
  });

  it('preserves invalid raw scoring for deferred publication validation', async () => {
    const rawRules = { pass_td: 'six', unsupported_bonus: 1 };
    const result = await createSleeperLeagueSource(async () => input({
      scoringSettings: rawRules,
    })).getLeagueWeek(configuration, targetPeriod);

    expect(result.scoringSettings.rawRules).toBe(rawRules);
  });

  it('carries explicit starter and roster bye information into the canonical schedule', async () => {
    const source = input();
    const bye = player('bye-player', {
      nflTeam: 'BUF',
      slot: 'BN',
      game: { kind: 'bye' },
    });
    const result = await createSleeperLeagueSource(async () => ({
      ...source,
      rosteredPlayers: [...source.rosteredPlayers, bye],
    })).getLeagueWeek(configuration, targetPeriod);

    expect(result.schedule.BUF).toEqual({ kind: 'bye' });
  });

  it('uses the runtime display name only when the source league name is empty', async () => {
    const result = await createSleeperLeagueSource(async () => input({ leagueName: '' }))
      .getLeagueWeek(configuration, targetPeriod);
    expect(result.leagueName).toBe('Premier League');
  });

  it('rejects a returned league identity mismatch before translating data', async () => {
    await expect(createSleeperLeagueSource(async () => input({
      sleeperLeagueId: 'another-league',
    })).getLeagueWeek(configuration, targetPeriod)).rejects.toThrow(
      'Sleeper returned matchup data for a different league.',
    );
  });

  it('rejects data returned for a period other than the explicitly requested target', async () => {
    const load = vi.fn(async () => input());

    await expect(createSleeperLeagueSource(load).getLeagueWeek(configuration, {
      ...targetPeriod,
      week: 2,
    })).rejects.toThrow('Sleeper returned matchup data for a different projection period.');

    expect(load).toHaveBeenCalledWith('league-001', {
      season: 2026,
      seasonType: 'regular',
      week: 2,
    });
  });
});

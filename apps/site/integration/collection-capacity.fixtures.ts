import { createHash } from 'node:crypto';
import type { PlayerCatalog, SleeperMatchup } from '../lib/transform';
import { NFL_TEAM_CODES, type LeagueConfiguration, type LeaguePeriod, type LeagueWeekState,
  type NflWeekSchedule, type ProjectionSlate } from '../lib/projections/domain/contracts';
import { externalMatchupRef, externalPlayerRef, externalRosterRef, externalTeamDefenseRef, providerKey } from '../lib/projections/shared/provider-identity';
import { scoreSparseStatistics } from '../lib/projections/domain/scoring';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../lib/projections/adapters/sleeper/scoring-profile';
import retainedSettings from '../test-support/fixtures/sleeper-capability-settings.json';

export const CAPACITY_INVENTORY_SIZE = 4385;
export const CAPACITY_PLAYER_COUNT = CAPACITY_INVENTORY_SIZE - NFL_TEAM_CODES.length;
export const CAPACITY_STARTERS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'DEF'] as const;
const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'QB', 'K', 'RB', 'WR', 'TE', 'QB', 'WR', 'RB', 'WR', 'TE', 'QB', 'RB', 'WR'] as const;
// Sleeper player IDs are numeric strings; D/ST IDs are uppercase team codes.
// Lowercase invented player IDs introduce an unrelated JS/SQL collation mismatch.
export const capacityPlayerId = (index: number) => String(900_000_000 + index);
export const capacityCatalog: PlayerCatalog = Object.fromEntries(Array.from({ length: CAPACITY_PLAYER_COUNT }, (_, index) => [
  capacityPlayerId(index), { full_name: `Synthetic player ${index}`, position: positions[index % positions.length],
    team: NFL_TEAM_CODES[index % NFL_TEAM_CODES.length], active: true },
]));
export function capacityStats(correction: number): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return Object.fromEntries([
    ...Object.entries(capacityCatalog).map(([id, player], index) => [id, {
      gms_active: 1, gp: 1, pass_yd: player.position === 'QB' ? 210 + index % 80 : 0,
      pass_td: player.position === 'QB' ? 2 + (index === 0 ? correction : 0) : 0,
      pass_int: player.position === 'QB' ? index % 2 : 0,
      rush_att: player.position === 'RB' ? 12 : 2, rush_yd: player.position === 'RB' ? 64 : 9,
      rush_td: player.position === 'RB' ? index % 2 : 0,
      rec: ['WR', 'TE', 'RB'].includes(player.position ?? '') ? 3 + index % 5 : 0,
      rec_yd: ['WR', 'TE', 'RB'].includes(player.position ?? '') ? 35 + index % 60 : 0,
      rec_td: player.position === 'WR' ? index % 2 : 0,
      fgm: player.position === 'K' ? 2 : 0, xpm: player.position === 'K' ? 3 : 0, fum_lost: 0,
    }]),
    ...NFL_TEAM_CODES.map(team => [team, { gms_active: 1, gp: 1, sack: 2, int: 1, fum_rec: 0, pts_allow: 21 }]),
  ]);
}
export function capacityRules(index: number, distinct: boolean): Readonly<Record<string, number>> {
  const retained = retainedSettings.leagues[0].scoring_settings as Record<string, number>;
  return { ...retained, pass_td: retained.pass_td + (distinct ? index / 10 : 0) };
}
export function capacitySchedule(kickoffAt: string): NflWeekSchedule {
  return Object.fromEntries(NFL_TEAM_CODES.map((team, index) => [team, {
    kind: 'scheduled', opponent: NFL_TEAM_CODES[index % 2 === 0 ? index + 1 : index - 1],
    location: index % 2 === 0 ? 'home' : 'away', date: kickoffAt.slice(0, 10), kickoffAt,
  }]));
}
export function capacityProjectionSlate(period: LeaguePeriod, observedAt: string): ProjectionSlate {
  // This models the existing shared stored full-catalog read, not a provider request.
  const projections = Object.entries(capacityCatalog).map(([id, player]) => ({
    identity: { primary: externalPlayerRef('tank01', `tank-${id}`), aliases: [externalPlayerRef('sleeper', id)] },
    nflTeam: player.team as typeof NFL_TEAM_CODES[number], position: player.position!,
    stats: { rushYds: 10 }, scoringStats: { kind: 'offense' as const, rushingYards: 10 }, missingFields: [],
  }));
  return { source: providerKey('tank01'), period, quality: 'complete', sourceRevision: `synthetic-slate-${period.season}`,
    requestStartedAt: observedAt, requestCompletedAt: observedAt, observedAt, projections, warnings: [],
    coverage: { crosswalkRows: projections.length, crosswalkEntries: projections.length, malformedCrosswalkRows: 0,
      ambiguousCrosswalkRows: 0, playerRows: projections.length, matchedPlayers: projections.length,
      unmatchedPlayers: 0, malformedPlayers: 0, incompletePlayers: 0, defenseRows: 0,
      usableDefenses: 0, malformedDefenses: 0, incompleteDefenses: 0 } };
}
export function capacityLeagueFixture(input: {
  configuration: LeagueConfiguration; period: LeaguePeriod; schedule: NflWeekSchedule;
  rules: Readonly<Record<string, number>>; stats: ReturnType<typeof capacityStats>; observedAt: string;
  dynasty: boolean; parityFailure?: boolean;
}) {
  const { configuration, period, schedule, rules, stats, observedAt } = input;
  const rosterCount = input.dynasty ? 10 : 12;
  const rosterSize = input.dynasty ? 20 : 14;
  const leagueIndex = Number(configuration.key.split('-').at(-1)) || 0;
  const rosterRefs = Array.from({ length: rosterCount }, (_, index) => externalRosterRef(configuration.leagueRef, String(index + 1)));
  const points = (id: string) => {
    const result = scoreSparseStatistics(stats[id], rules, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
    if (!result.available || result.points === null) throw new Error('Synthetic fixture scoring failed');
    return result.points;
  };
  const rawMatchups: SleeperMatchup[] = rosterRefs.map((_, index) => {
    const players = Array.from({ length: rosterSize }, (_, slot) => slot === 8
      ? NFL_TEAM_CODES[(index + leagueIndex) % NFL_TEAM_CODES.length]
      : capacityPlayerId(leagueIndex * 60 + index * 20 + slot));
    const starters = players.slice(0, CAPACITY_STARTERS.length);
    const players_points = Object.fromEntries(players.map(id => [id, points(id)]));
    if (input.parityFailure && index === 0) players_points[players.at(-1)!] += 1;
    return { roster_id: index + 1, matchup_id: Math.floor(index / 2) + 1, players, starters, players_points,
      points: starters.reduce((sum, id) => sum + players_points[id], 0) };
  });
  const entity = (id: string) => NFL_TEAM_CODES.includes(id as typeof NFL_TEAM_CODES[number])
    ? { kind: 'team-defense' as const, externalRef: externalTeamDefenseRef('sleeper', id), displayName: id,
      nflTeam: id as typeof NFL_TEAM_CODES[number], position: 'DEF', injuryStatus: null }
    : ({ kind: 'player' as const, externalRef: externalPlayerRef('sleeper', id),
    displayName: id, nflTeam: capacityCatalog[id].team as typeof NFL_TEAM_CODES[number],
    position: capacityCatalog[id].position!, injuryStatus: null });
  const state: LeagueWeekState = {
    configuration, period, leagueName: configuration.displayName, maxWeek: 18,
    rosterPositions: [...CAPACITY_STARTERS, ...Array.from({ length: rosterSize - CAPACITY_STARTERS.length }, () => 'BN')],
    lineupShape: { expectedRosterCount: rosterCount, expectedStarterSlotCount: CAPACITY_STARTERS.length, expectedRosterRefs: rosterRefs },
    participants: rosterRefs.map((rosterRef, index) => ({ rosterRef, managerName: `Manager ${index}`, teamName: `Team ${index}`,
      avatarUrl: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 })),
    matchups: Array.from({ length: rosterCount / 2 }, (_, match) => ({
      matchupRef: externalMatchupRef(configuration.leagueRef, period, String(match + 1)), status: 'final' as const,
      sides: rawMatchups.slice(match * 2, match * 2 + 2).map(row => ({
        rosterRef: rosterRefs[row.roster_id - 1], officialPoints: row.points ?? null,
        starters: row.starters!.map((id, slot) => ({ kind: 'occupied' as const, slot: CAPACITY_STARTERS[slot], entity: entity(id), officialPoints: row.players_points![id] })),
        bench: row.players!.slice(CAPACITY_STARTERS.length).map(id => ({ kind: 'occupied' as const, slot: 'BN', entity: entity(id), officialPoints: row.players_points![id] })),
      })),
    })),
    rosteredEntities: rawMatchups.flatMap(row => row.players!.map(entity)), schedule,
    scoringSettings: { provider: providerKey('sleeper'), rawRules: rules },
    requestStartedAt: observedAt, requestCompletedAt: observedAt, observedAt,
    sourceRevision: `synthetic-league:${configuration.key}:${observedAt}`,
    lineup: { revisionVersion: 'lineup-v1', lineupRevision: createHash('sha256').update(JSON.stringify(rawMatchups)).digest('hex') },
  };
  return { state, rawMatchups, expectedRosterIds: rawMatchups.map(row => row.roster_id), starterSlots: CAPACITY_STARTERS };
}

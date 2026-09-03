import type { ProjectionSyncInput } from '../../../sleeper';
import { canonicalNflTeam } from '../../../nfl-teams';
import type { Player } from '../../../types';
import type {
  LeagueConfiguration,
  LeagueWeekState,
  LineupSlot,
  NflWeekSchedule,
  ProjectionParticipant,
  ScoringEntity,
} from '../../domain/contracts';
import type { LeagueSourcePort } from '../../ports/league-source';
import {
  externalPlayerRef,
  externalReferenceKey,
  externalRosterRef,
  externalTeamDefenseRef,
  type ProviderKey,
} from '../../shared/provider-identity';
import { compatibleRevision } from '../../shared/revision-compatibility';
import {
  sleeperRegularSeasonPeriod,
  translateSleeperWeekSchedule,
} from './nfl-calendar';

export type SleeperLeagueWeekLoader = (
  leagueId: string,
) => Promise<ProjectionSyncInput>;

function isEmptySlot(player: Player): boolean {
  return player.id.startsWith('empty-');
}

function isTeamDefense(player: Player): boolean {
  return player.position.trim().toUpperCase() === 'DEF'
    || player.slot.trim().toUpperCase() === 'DEF';
}

function scoringEntity(player: Player, provider: ProviderKey): ScoringEntity {
  const nflTeam = canonicalNflTeam(player.nflTeam);
  const common = {
    displayName: player.name,
    nflTeam,
    position: player.position,
    injuryStatus: player.injuryStatus,
  };

  if (!isTeamDefense(player)) {
    return {
      ...common,
      kind: 'player',
      externalRef: externalPlayerRef(provider, player.id),
    };
  }

  const defenseTeam = nflTeam ?? canonicalNflTeam(player.id);
  if (!defenseTeam) {
    throw new Error('Sleeper returned a defense without a valid NFL team.');
  }
  return {
    ...common,
    kind: 'team-defense',
    externalRef: externalTeamDefenseRef(provider, player.id),
    nflTeam: defenseTeam,
  };
}

function lineupSlot(player: Player, provider: ProviderKey): LineupSlot {
  if (isEmptySlot(player)) return { kind: 'empty', slot: player.slot };
  return {
    kind: 'occupied',
    slot: player.slot,
    entity: scoringEntity(player, provider),
    officialPoints: player.points,
  };
}

function participants(
  source: ProjectionSyncInput,
  configuration: LeagueConfiguration,
): ProjectionParticipant[] {
  return source.data.teams.map((team) => ({
    rosterRef: externalRosterRef(configuration.leagueRef, String(team.id)),
    managerName: team.managerName,
    teamName: team.name,
    avatarUrl: team.avatar,
    wins: team.wins,
    losses: team.losses,
    ties: team.ties,
    pointsFor: team.pointsFor,
    pointsAgainst: team.pointsAgainst,
  }));
}

function rosteredEntities(
  source: ProjectionSyncInput,
  provider: ProviderKey,
): ScoringEntity[] {
  const playersBySourceId = new Map<string, Player>();
  for (const player of source.rosteredPlayers) {
    if (!isEmptySlot(player)) playersBySourceId.set(player.id, player);
  }
  for (const matchup of source.data.matchups) {
    for (const side of matchup.sides) {
      for (const player of side.starters) {
        if (!isEmptySlot(player)) playersBySourceId.set(player.id, player);
      }
    }
  }

  const entitiesByReference = new Map<string, ScoringEntity>();
  for (const player of playersBySourceId.values()) {
    const entity = scoringEntity(player, provider);
    entitiesByReference.set(externalReferenceKey(entity.externalRef), entity);
  }
  return [...entitiesByReference.values()];
}

function leagueWeekSchedule(source: ProjectionSyncInput): NflWeekSchedule {
  const schedule = { ...translateSleeperWeekSchedule(source.schedule) };
  const players = [
    ...source.rosteredPlayers,
    ...source.data.matchups.flatMap((matchup) => matchup.sides
      .flatMap((side) => side.starters)),
  ];
  for (const player of players) {
    if (player.game?.kind !== 'bye') continue;
    const team = canonicalNflTeam(player.nflTeam);
    if (!team) throw new Error('Sleeper returned a bye without a valid NFL team.');
    if (schedule[team]?.kind === 'scheduled') {
      throw new Error('Sleeper returned conflicting NFL schedule information.');
    }
    schedule[team] = { kind: 'bye' };
  }
  return schedule;
}

/**
 * Adapts one authoritative, uncached Sleeper league-week load into canonical
 * projection input without adding provider requests or interpreting scoring.
 */
export function createSleeperLeagueSource(
  loadLeagueWeek: SleeperLeagueWeekLoader,
): LeagueSourcePort {
  return {
    async getLeagueWeek(configuration: LeagueConfiguration): Promise<LeagueWeekState> {
      const leagueId = String(configuration.leagueRef.externalId);
      const source = await loadLeagueWeek(leagueId);
      if (source.sleeperLeagueId !== leagueId) {
        throw new Error('Sleeper returned matchup data for a different league.');
      }

      const period = sleeperRegularSeasonPeriod(source.data.league.season, source.data.week);
      const provider = configuration.leagueRef.provider;
      return {
        configuration,
        leagueName: source.leagueName || configuration.displayName,
        period,
        maxWeek: source.data.league.maxWeek,
        rosterPositions: source.data.league.rosterPositions,
        participants: participants(source, configuration),
        matchups: source.data.matchups.map((matchup) => ({
          matchupId: matchup.id,
          status: matchup.status,
          sides: matchup.sides.map((side) => ({
            rosterRef: externalRosterRef(configuration.leagueRef, String(side.team.id)),
            officialPoints: side.points,
            starters: side.starters.map((player) => lineupSlot(player, provider)),
          })),
        })),
        rosteredEntities: rosteredEntities(source, provider),
        schedule: leagueWeekSchedule(source),
        scoringSettings: {
          provider,
          rawRules: source.scoringSettings,
        },
        requestStartedAt: source.requestStartedAt,
        requestCompletedAt: source.requestCompletedAt,
        observedAt: source.requestCompletedAt,
        sourceRevision: compatibleRevision({
          requestStartedAt: source.requestStartedAt,
          requestCompletedAt: source.requestCompletedAt,
          data: source.data,
        }),
        warning: source.data.warning,
      };
    },
  };
}

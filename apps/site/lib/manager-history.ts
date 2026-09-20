import 'server-only';

import { leagueOneChampionshipYears, leagueTwoChampionshipYears } from './manager-championships';
import { displayedManagerOwnerId, displayedManagerTeams } from './manager-display';
import { buildCompletedStandingsBasis } from './projected-standings';
import type { SleeperMatchup, SleeperRoster } from './transform';
import type { Team } from './types';

export type ManagerHistorySeason = Readonly<{
  season: number;
  externalLeagueId: string;
  teams: readonly Team[];
  rosters: readonly SleeperRoster[];
  throughWeek: number | null;
  rows: readonly (readonly SleeperMatchup[] | null)[];
  unavailableReason?: string;
}>;

export type ManagerHistoryEntry = Readonly<{
  ownerId: string;
  currentTeamId: number | null;
  managerName: string;
  avatar: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  seasons: readonly number[];
  championshipYears: readonly number[];
  promotionChampionshipYears: readonly number[];
}>;

type Participant = {
  ownerId: string;
  currentTeamId: number | null;
  managerName: string;
  avatar: string | null;
  namedSeason: number;
  wins: number;
  losses: number;
  ties: number;
  seasons: Set<number>;
};

function counts(values: readonly number[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

/** One permanent league per call. Annual roster IDs and display names are never manager identities. */
export function buildManagerHistory(seasons: readonly ManagerHistorySeason[], currentSeason: number, leagueKey?: string): {
  managers: ManagerHistoryEntry[]; warning?: string;
} {
  const participants = new Map<string, Participant>();
  const warnings = new Set<string>();
  const seasonCounts = counts(seasons.map(value => value.season));
  if (!Number.isInteger(currentSeason) || seasonCounts.get(currentSeason) !== 1) {
    warnings.add('Current-season membership is unavailable or duplicated. Reload before using combined records.');
  }
  for (const source of seasons) {
    const label = `${source.season} history`;
    let identityComplete = source.teams.length >= 2 && source.rosters.length === source.teams.length;
    const rosterCounts = counts(source.rosters.map(roster => roster.roster_id));
    const teamCounts = counts(source.teams.map(team => team.id));
    const teams = displayedManagerTeams(source.externalLeagueId, [...source.teams], source.rosters, leagueKey);
    const ownerByRoster = new Map<number, string>();
    const ownerCounts = new Map<string, number>();
    const owners = source.rosters.map(roster => {
      const rawOwner = roster.owner_id;
      const effectiveOwner = displayedManagerOwnerId(source.externalLeagueId, roster.roster_id, rawOwner, roster.co_owners, leagueKey);
      const ownerId = typeof effectiveOwner === 'string' && effectiveOwner.trim() ? effectiveOwner : null;
      if (ownerId) ownerCounts.set(ownerId, (ownerCounts.get(ownerId) ?? 0) + 1);
      else identityComplete = false;
      return { roster, ownerId };
    });
    for (const { roster, ownerId } of owners) {
      const uniqueRoster = Number.isSafeInteger(roster.roster_id) && roster.roster_id > 0
        && rosterCounts.get(roster.roster_id) === 1 && teamCounts.get(roster.roster_id) === 1;
      if (!uniqueRoster || !ownerId || ownerCounts.get(ownerId) !== 1) identityComplete = false;
      if (!ownerId) continue; // An unknown account cannot be assigned a fabricated manager identity.
      const team = uniqueRoster ? teams.find(candidate => candidate.id === roster.roster_id) : undefined;
      const name = team?.managerName.trim();
      if (!name) identityComplete = false;
      let participant = participants.get(ownerId);
      if (!participant) {
        participant = { ownerId, currentTeamId: null, managerName: 'Manager name unavailable', avatar: null,
          namedSeason: Number.NEGATIVE_INFINITY, wins: 0, losses: 0, ties: 0, seasons: new Set() };
        participants.set(ownerId, participant);
      }
      participant.seasons.add(source.season);
      if (name && source.season <= currentSeason && source.season > participant.namedSeason) {
        participant.managerName = name;
        participant.avatar = team?.avatar ?? null;
        participant.namedSeason = source.season;
      }
      if (source.season === currentSeason && seasonCounts.get(currentSeason) === 1
        && uniqueRoster && ownerCounts.get(ownerId) === 1) participant.currentTeamId = roster.roster_id;
      if (uniqueRoster && ownerCounts.get(ownerId) === 1) ownerByRoster.set(roster.roster_id, ownerId);
    }
    if (!identityComplete) warnings.add(`${label}: manager ownership or names are incomplete or ambiguous. Verify this season's rosters and users.`);
    if (!Number.isInteger(source.season) || source.season > currentSeason || seasonCounts.get(source.season) !== 1
      || !source.externalLeagueId.trim()) {
      warnings.add(`${label}: season identity is invalid or duplicated. Verify the annual league connection.`);
      continue;
    }
    if (source.unavailableReason) {
      warnings.add(`${label}: ${source.unavailableReason}`);
      continue;
    }
    if (source.throughWeek === null || !Number.isInteger(source.throughWeek) || source.throughWeek < 0) {
      warnings.add(`${label}: completed weeks are unconfirmed. Reload when the official scoring period is available.`);
      continue;
    }
    const throughWeek = Math.min(14, source.throughWeek);
    // The canonical completed-result calculator supplies the neutral season baseline;
    // current roster aggregates may already contain live games or playoff results.
    const basis = buildCompletedStandingsBasis(teams.map(team => ({ ...team,
      wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
      waiverOrder: null, waiverBudgetRemaining: null,
    })), throughWeek + 1, source.rows.slice(0, throughWeek));
    if (basis.kind === 'unavailable') {
      warnings.add(`${label}: ${basis.reason} Reload after the missing official results are available.`);
      continue;
    }
    if (!identityComplete) continue;
    for (const team of basis.teams) {
      const participant = participants.get(ownerByRoster.get(team.id)!);
      if (!participant) continue;
      participant.wins += team.wins;
      participant.losses += team.losses;
      participant.ties += team.ties;
    }
  }
  // A missing season can conceal memberships as well as results. Never present a
  // partial total as a complete combined record, including for apparently new owners.
  const unavailable = warnings.size > 0;
  const managers = [...participants.values()].map((participant): ManagerHistoryEntry => ({
    ownerId: participant.ownerId, currentTeamId: participant.currentTeamId,
    managerName: participant.managerName, avatar: participant.avatar,
    wins: unavailable ? null : participant.wins,
    losses: unavailable ? null : participant.losses,
    ties: unavailable ? null : participant.ties,
    seasons: [...participant.seasons].sort((left, right) => left - right),
    // Explicit empty arrays also prevent current-roster honors context from leaking
    // into a historical manager whose old roster number now belongs to someone else.
    championshipYears: leagueOneChampionshipYears(participant.ownerId),
    promotionChampionshipYears: leagueTwoChampionshipYears(participant.ownerId),
  })).sort((left, right) => left.managerName.localeCompare(right.managerName) || left.ownerId.localeCompare(right.ownerId));
  return { managers, ...(unavailable ? { warning: [...warnings].join(' ') } : {}) };
}

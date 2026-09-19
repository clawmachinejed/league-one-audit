import type { MatchupsData, Team } from './types';

// Owner-confirmed September 19, 2026. This exception belongs to the evidenced
// 2026 connection/roster, not every team with a matching name or a future renewal.
const correction = {
  leagueId: '1378850360529014784',
  leagueKey: 'league2',
  season: '2026',
  rosterId: 1,
  sourceOwnerId: '95628446075863040',
  sourceManagerName: 'eneerg',
  managerId: '862177751849877504',
  managerName: 'tylerawildman',
} as const;

function correctsOwner(leagueId: string, rosterId: number, ownerId: string | null | undefined): boolean {
  return leagueId === correction.leagueId && rosterId === correction.rosterId
    && ownerId === correction.sourceOwnerId;
}

/** Effective identity for presentation/honors only. Never replace provider ownership evidence. */
export function displayedManagerOwnerId(leagueId: string, rosterId: number, ownerId: string | null | undefined) {
  return correctsOwner(leagueId, rosterId, ownerId) ? correction.managerId : ownerId;
}

/** Current official roster identity proves where the page-only name correction applies. */
export function displayedManagerTeams(leagueId: string, teams: Team[],
  rosters: readonly { roster_id: number; owner_id?: string | null }[]): Team[] {
  if (leagueId !== correction.leagueId) return teams;
  const ownerByRoster = new Map(rosters.map(roster => [roster.roster_id, roster.owner_id]));
  return teams.map(team => correctsOwner(leagueId, team.id, ownerByRoster.get(team.id))
    ? { ...team, managerName: correction.managerName } : team);
}

/**
 * Legacy snapshots have no owner ID. Use only the evidenced league, season,
 * roster and source name at render time, including after a polling update.
 * The snapshot, API payload, revision, team artwork and every score stay intact.
 */
export function displayedMatchupManagers(leagueKey: string, data: MatchupsData): MatchupsData {
  if (leagueKey !== correction.leagueKey || data.league.season !== correction.season) return data;
  const display = (team: Team): Team => team.id === correction.rosterId
    && team.managerName === correction.sourceManagerName
    ? { ...team, managerName: correction.managerName } : team;
  const teams = data.teams.map(display);
  const matchups = data.matchups.map(matchup => {
    const sides = matchup.sides.map(side => {
      const team = display(side.team);
      return team === side.team ? side : { ...side, team };
    });
    return sides.every((side, index) => side === matchup.sides[index]) ? matchup : { ...matchup, sides };
  });
  return teams.every((team, index) => team === data.teams[index])
    && matchups.every((matchup, index) => matchup === data.matchups[index])
    ? data : { ...data, teams, matchups };
}

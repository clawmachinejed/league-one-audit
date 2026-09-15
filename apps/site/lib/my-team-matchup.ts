import { compareTeams } from './transform';
import type { Matchup, Team } from './types';

/** A display default never changes the league-scoped saved My Team preference. */
export function selectMyTeamMatchup(
  teams: readonly Team[], matchups: readonly Matchup[], selected: number | null,
): { team: Team | null; matchup: Matchup | null } {
  const team = teams.find(candidate => candidate.id === selected)
    ?? [...teams].sort(compareTeams)[0] ?? null;
  if (!team) return { team: null, matchup: null };
  const matchup = matchups.find(candidate => candidate.sides.some(side => side.team.id === team.id));
  if (!matchup) return { team, matchup: null };
  const ownSide = matchup.sides.find(side => side.team.id === team.id)!;
  return { team, matchup: { ...matchup, sides: [ownSide, ...matchup.sides.filter(side => side !== ownSide)] } };
}

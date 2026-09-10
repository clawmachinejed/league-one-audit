import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEAGUE_SITES } from '../lib/leagues';
import type { Matchup, Player, Team } from '../lib/types';
import { LeagueSiteProvider } from './league-context';
import { MatchupBoard } from './matchup-board';

const team = (id: number): Team => ({
  id,
  managerName: `Manager ${id}`,
  name: `Team ${id}`,
  avatar: null,
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  pointsAgainst: 0,
});

const player = (id: string, projectedPoints: number | null): Player => ({
  id,
  name: `Player ${id}`,
  position: 'WR',
  nflTeam: 'SEA',
  injuryStatus: null,
  game: {
    kind: 'scheduled',
    opponent: 'NE',
    location: 'home',
    date: '2026-09-10',
    kickoffAt: '2026-09-10T00:00:00.000Z',
  },
  slot: 'WR',
  points: 23.2,
  projectedPoints,
});

describe('MatchupBoard player projection presentation', () => {
  it('renders a missing final baseline as a dash and a valid frozen zero as 0.00', () => {
    const matchup: Matchup = {
      id: '1',
      status: 'final',
      sides: [
        { team: team(1), points: 23.2, projectedPoints: 23.2, starters: [player('missing', null)] },
        { team: team(2), points: 23.2, projectedPoints: 23.2, starters: [player('zero', 0)] },
      ],
    };
    const html = renderToStaticMarkup(
      <LeagueSiteProvider site={LEAGUE_SITES.league1}>
        <MatchupBoard matchups={[matchup]} selected={null} avatar={() => null} />
      </LeagueSiteProvider>,
    );
    const playerProjections = [...html.matchAll(/data-player-projection-number="true"[^>]*>([^<]+)</gu)]
      .map((match) => match[1]);

    expect(playerProjections).toEqual(['—', '0.00']);
    expect(html).toContain('projected score unavailable');
    expect(html).toContain('projected score 0.00 points');
  });
});

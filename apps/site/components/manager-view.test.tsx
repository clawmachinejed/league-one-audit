import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LEAGUE_SITES } from '../lib/leagues';
import type { ManagerData, Player, Team } from '../lib/types';
import { LeagueSiteProvider } from './league-context';
import { ManagerView } from './manager-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const team: Team = { id: 1, name: 'Dynasty Team', managerName: 'Manager', avatar: null,
  wins: 1, losses: 0, ties: 0, pointsFor: 115, pointsAgainst: 100 };
const player: Player = { id: '1', name: 'Quarterback', position: 'QB', nflTeam: 'BUF',
  injuryStatus: null, game: null, slot: 'SUPER_FLEX', points: 20, projectedPoints: 21 };

describe('manager roster presentation', () => {
  it('uses the same compact super flex label as League rosters and Matchups', () => {
    const data: ManagerData = {
      league: { season: '2026', rosterPositions: ['SUPER_FLEX', 'BN'], week: 2, maxWeek: 18 },
      teams: [team], team, starters: [player], bench: [{ ...player, id: '2', slot: 'BN' }], reserve: [],
      updatedAt: '2026-09-16T01:00:00Z',
    };
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <ManagerView data={data} />
    </LeagueSiteProvider>);
    expect(html).toContain('class="roster-slot" aria-label="Wide receiver, running back, tight end or quarterback" title="Wide receiver, running back, tight end or quarterback" data-roster-slot="SUPER_FLEX"');
    expect(html).toContain('>BN</span>');
    expect(html).toContain('<span>W</span><span>R</span><span>T</span><span>Q</span>');
    expect(html).not.toContain('>SUPER_FLEX<');
    expect(data.starters[0].slot).toBe('SUPER_FLEX');
  });
});

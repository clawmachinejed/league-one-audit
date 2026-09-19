import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEAGUE_SITES } from '../lib/leagues';
import type { ManagerHonors } from '../lib/manager-honors';
import { LeagueSiteProvider } from './league-context';
import { ManagerHonorsProvider, ManagerHonorsSeason } from './manager-honors';
import { ManagerName, useManagerNameLabel } from './manager-name';

const team = { id: 1, managerName: 'eneerg' };
const honors: ManagerHonors = { leagueId: 'accepted-connection', season: '2026',
  managers: { 1: { managerName: 'eneerg', championshipYears: [2010, 2012, 2017] } } };

function Control({ identity = team }) {
  const label = useManagerNameLabel(identity);
  return <button aria-label={label}><ManagerName team={identity} /></button>;
}

function render({ connection = honors.leagueId, season = '2026', payloadSeason = season,
  identity = team, data = honors } : {
    connection?: string; season?: string; payloadSeason?: string;
    identity?: typeof team; data?: ManagerHonors | null;
  } = {}) {
  return renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1} leagueId={connection}>
    <ManagerHonorsProvider data={data} season={season}><ManagerHonorsSeason season={payloadSeason}>
      <Control identity={identity} />
    </ManagerHonorsSeason></ManagerHonorsProvider>
  </LeagueSiteProvider>);
}

describe('shared manager name honors', () => {
  it('renders one decorative trophy per title and exposes years on an enclosing control', () => {
    const html = render();
    expect(html.match(/class="manager-championship-trophy"/gu)).toHaveLength(3);
    expect(html).toContain('aria-label="eneerg, 3 League One championships: 2010, 2012, 2017"');
    expect(html).toContain('aria-label="3 League One championships: 2010, 2012, 2017"');
    expect(html.match(/alt=""/gu)).toHaveLength(3);
  });

  it.each([
    { connection: 'different-league' }, { season: '2027' }, { payloadSeason: '2027' },
    { identity: { ...team, id: 2 } }, { identity: { ...team, managerName: 'tylerawildman' } },
    { data: null },
  ])('does not transfer honors without matching connection, season and manager evidence (%j)', options => {
    expect(render(options)).not.toContain('manager-championship-trophy');
  });

  it('leaves an unawarded manager as plain text', () => {
    const data = { ...honors, managers: { 1: { managerName: 'tylerawildman', championshipYears: [] } } };
    const html = render({ identity: { ...team, managerName: 'tylerawildman' }, data });
    expect(html).toContain('tylerawildman');
    expect(html).not.toContain('manager-championships');
  });
});

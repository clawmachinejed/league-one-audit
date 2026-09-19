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

  it('keeps both leagues distinct for a manager with championships in each', () => {
    const identity = { id: 1, managerName: 'jwbaute' };
    const data = { ...honors, managers: { 1: { managerName: 'jwbaute',
      championshipYears: [2008, 2009, 2014, 2025], promotionChampionshipYears: [2020, 2022] } } };
    const html = render({ identity, data });
    expect(html.match(/class="manager-championship-trophy"/gu)).toHaveLength(6);
    expect(html).toContain('aria-label="jwbaute, 4 League One championships: 2008, 2009, 2014, 2025, 2 League Two championships: 2020, 2022"');
    expect(html).toContain('data-championship-league="league1"');
    expect(html).toContain('data-championship-league="league2"');
    expect(html).toContain('League Two Promotion Bowl champion: 2020, 2022');
    expect(html).toContain('league-two-champion-v1.png');
    expect(render({ identity, data, payloadSeason: '2027' })).not.toContain('manager-championship-trophy');
    expect(render({ identity: { id: 1, managerName: 'tylerawildman' }, data })).not.toContain('manager-championship-trophy');
  });

  it('shows League Two-only titles without a blue trophy or a League One label', () => {
    const identity = { id: 1, managerName: 'tthomen' };
    const data = { ...honors, managers: { 1: { managerName: 'tthomen',
      championshipYears: [], promotionChampionshipYears: [2025] } } };
    const html = render({ identity, data });
    expect(html.match(/class="manager-championship-trophy"/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="tthomen, 1 League Two championship: 2025"');
    expect(html).not.toContain('League One');
    expect(html).not.toContain('league-one-champion-v1.png');
  });
});

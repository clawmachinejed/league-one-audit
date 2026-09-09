import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RostersData } from '../lib/types';
import { ordinal, rosterCacheKey, RosterContent } from './rosters-view';

const data: RostersData = {
  league: { season: '2026', rosterPositions: ['QB', 'BN'], week: 3, maxWeek: 18 },
  week: 3, currentWeek: 3, rostersAvailable: true, updatedAt: '2026-09-08T12:00:00.000Z',
  teams: [{
    id: 2, name: 'A Team Name That Can Wrap Safely', managerName: 'Manager Name', avatar: null,
    wins: 6, losses: 2, ties: 0, pointsFor: 899, pointsAgainst: 700,
    waiverOrder: null, waiverBudgetRemaining: null, standingsRank: 2, averagePpg: 112.4, averagePpgRank: 4,
    rosterAvailable: true, sections: [{ name: 'Starters', players: [{
      id: 'qb', name: 'An Exceptionally Long Quarterback Name', position: 'QB', nflTeam: 'IND', injuryStatus: 'Questionable',
      game: { kind: 'scheduled', opponent: 'HOU', location: 'away', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z' },
      slot: 'QB', byeWeek: 12,
    }] }, { name: 'Bench', players: [] }],
  }, {
    id: 1, name: 'First Place', managerName: 'Other Manager', avatar: null,
    wins: 7, losses: 1, ties: 0, pointsFor: 920, pointsAgainst: 680,
    waiverOrder: null, waiverBudgetRemaining: null, standingsRank: 1, averagePpg: null, averagePpgRank: null,
    rosterAvailable: false, sections: [],
  }],
};

describe('rosters presentation', () => {
  it('uses honest ordinal and missing-value formatting', () => {
    expect([ordinal(1), ordinal(2), ordinal(3), ordinal(4), ordinal(11), ordinal(null)])
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '—']);
  });

  it('shows team headings once and the BYE heading once per section', () => {
    const html = renderToStaticMarkup(<RosterContent data={data} selected={2} />);
    expect(html.match(/>TEAM</gu)).toHaveLength(1);
    expect(html.match(/>RECORD</gu)).toHaveLength(1);
    expect(html.match(/>AVG PPG</gu)).toHaveLength(1);
    expect(html.match(/>BYE</gu)).toHaveLength(2);
    expect(html).toContain('>12<');
    expect(html).toContain('Sun 1:00 PM @ HOU');
    expect(html).not.toMatch(/projected|time remaining|live game clock|position rank/iu);
  });

  it('puts My Team first, retains its ranks, and keeps roster content outside the summary button', () => {
    const html = renderToStaticMarkup(<RosterContent data={data} selected={2} />);
    expect(html.indexOf('A Team Name')).toBeLessThan(html.indexOf('First Place'));
    expect(html).toContain('record 6–2, standings 2nd');
    expect(html).toMatch(/<button[^>]*data-roster-toggle="true"[^>]*aria-expanded="true"[^>]*>.*?<\/button><div[^>]*data-roster-content="true"/su);
  });

  it('keys cached responses by league and week', () => {
    expect(rosterCacheKey('league1', 3)).toBe('league1:3');
    expect(rosterCacheKey('league2', 3)).toBe('league2:3');
  });

  it('uses mobile-safe geometry and a bottom-right chevron', () => {
    const css = readFileSync(new URL('./rosters.module.css', import.meta.url), 'utf8');
    expect(css).toContain('.summary{position:relative;');
    expect(css).toContain('min-height:76px');
    expect(css).toContain('.chevron{position:absolute;right:7px;bottom:6px');
    expect(css).toContain('text-overflow:ellipsis');
  });
});

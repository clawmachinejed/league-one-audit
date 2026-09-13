import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RostersData } from '../lib/types';
import { nextRosterRefreshAt, ordinal, rosterCacheKey, rosterMetricsRegressed, rosterProvisionalWeek, rosterResponseMatchesSelection, RosterContent } from './rosters-view';

const data: RostersData = {
  league: { season: '2026', rosterPositions: ['QB', 'BN'], week: 3, maxWeek: 18 },
  week: 3, currentWeek: 3, rostersAvailable: true, updatedAt: '2026-09-08T12:00:00.000Z',
  playerMetrics: { status: 'provisional', observedAt: '2026-09-08T12:00:00.000Z', throughWeek: 3 },
  teams: [{
    id: 2, name: 'A Team Name That Can Wrap Safely', managerName: 'Manager Name', avatar: null,
    wins: 6, losses: 2, ties: 0, pointsFor: 899,
    waiverOrder: null, waiverBudgetRemaining: null, standingsRank: 2, averagePpg: 112.4, averagePpgRank: 4,
    rosterAvailable: true, sections: [{ name: 'Starters', players: [{
      id: '5859', name: 'A.J. Brown', position: 'WR', nflTeam: 'PHI', injuryStatus: 'Questionable',
      game: { kind: 'scheduled', opponent: 'HOU', location: 'away', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z' },
      slot: 'WR', byeWeek: 12, positionRank: 1, ppg: 4.1,
    }] }, { name: 'Bench', players: [{
      id: '7527', name: 'Mac Jones', position: 'QB', nflTeam: 'SF', injuryStatus: null,
      game: null, slot: 'BN', byeWeek: 14, positionRank: null, ppg: null,
    }, {
      id: '12529', name: 'TreVeyon Henderson', position: 'RB', nflTeam: 'NE', injuryStatus: null,
      game: null, slot: 'BN', byeWeek: 14, positionRank: null, ppg: 0,
    }, {
      id: 'wide-rank', name: 'Long Rank Example', position: 'WR', nflTeam: 'IND', injuryStatus: null,
      game: null, slot: 'BN', byeWeek: 11, positionRank: 125, ppg: -12.4,
    }] }],
  }, {
    id: 1, name: 'First Place', managerName: 'Other Manager', avatar: null,
    wins: 7, losses: 1, ties: 0, pointsFor: 920,
    waiverOrder: null, waiverBudgetRemaining: null, standingsRank: 1, averagePpg: null, averagePpgRank: null,
    rosterAvailable: false, sections: [],
  }],
};

describe('rosters presentation', () => {
  it('uses honest ordinal and missing-value formatting', () => {
    expect([ordinal(1), ordinal(2), ordinal(3), ordinal(4), ordinal(11), ordinal(null)])
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '—']);
  });

  it('shows player metric headings once per section and compact values only in expanded content', () => {
    const html = renderToStaticMarkup(<RosterContent data={data} selected={2} />);
    expect(html.match(/>TEAM</gu)).toHaveLength(1);
    expect(html.match(/>RECORD</gu)).toHaveLength(1);
    expect(html.match(/>AVG PPG</gu)).toHaveLength(1);
    expect(html.match(/>POS\. RANK</gu)).toHaveLength(2);
    expect(html.match(/>PPG</gu)).toHaveLength(2);
    expect(html.match(/>BYE</gu)).toHaveLength(2);
    expect(html).toContain('>WR1<');
    expect(html).toContain('>4.1<');
    expect(html).toContain('>WR125<');
    expect(html).toContain('>-12.4<');
    expect(html).toContain('Points per game unavailable');
    expect(html).not.toContain('>0.0<');
    expect(html).toContain('>12<');
    expect(html).toContain('Sun 1:00 PM @ HOU');
    expect(html).not.toMatch(/projected|time remaining|live game clock/iu);
    const firstSummary = html.match(/<button[^>]*data-roster-toggle="true"[^>]*>.*?<\/button>/su)?.[0] ?? '';
    expect(firstSummary).not.toMatch(/POS\. RANK|WR1|4\.1/gu);
  });

  it('puts My Team first, retains its ranks, and starts every roster collapsed', () => {
    const html = renderToStaticMarkup(<RosterContent data={data} selected={2} />);
    expect(html.indexOf('A Team Name')).toBeLessThan(html.indexOf('First Place'));
    expect(html).toContain('record 6–2, standings 2nd');
    expect(html.match(/aria-expanded="false"/gu)).toHaveLength(data.teams.length);
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).toMatch(/<button[^>]*data-roster-toggle="true"[^>]*aria-expanded="false"[^>]*>.*?<\/button><div[^>]*hidden=""[^>]*data-roster-content="true"/su);
  });

  it('suppresses alphabetical standings positions while every record is 0–0', () => {
    const preseason: RostersData = {
      ...data,
      teams: data.teams.map(team => ({ ...team, wins: 0, losses: 0, ties: 0 })),
    };
    const html = renderToStaticMarkup(<RosterContent data={preseason} selected={2} />);
    expect(html).toContain('record 0–0, standings —');
    expect(html.match(/data-standings-rank=""/gu)).toHaveLength(preseason.teams.length);
    expect(html).not.toMatch(/standings \d+(?:st|nd|rd|th)/u);
  });

  it('keys cached responses by league, season, and week', () => {
    expect(rosterCacheKey('league1', '2026', 3)).toBe('league1:2026:3');
    expect(rosterCacheKey('league2', '2026', 3)).toBe('league2:2026:3');
    expect(rosterCacheKey('league1', '2027', 3)).toBe('league1:2027:3');
  });

  it('rejects another league, season, or week before adopting its roster', () => {
    expect(rosterResponseMatchesSelection(data, 'league1', 'league1', '2026', 3)).toBe(true);
    expect(rosterResponseMatchesSelection(data, 'league2', 'league1', '2026', 3)).toBe(false);
    expect(rosterResponseMatchesSelection(data, null, 'league1', '2026', 3)).toBe(false);
    expect(rosterResponseMatchesSelection(data, 'league1', 'league1', '2027', 3)).toBe(false);
    expect(rosterResponseMatchesSelection(data, 'league1', 'league1', '2026', 2)).toBe(false);
    expect(rosterResponseMatchesSelection({ ...data, currentWeek: 19 }, 'league1', 'league1', '2026', 3)).toBe(false);
    expect(rosterResponseMatchesSelection({ ...data, currentWeek: 4 }, 'league1', 'league1', '2026', 3)).toBe(false);
    expect(rosterResponseMatchesSelection({ ...data, currentWeek: 4, league: { ...data.league, week: 4 } },
      'league1', 'league1', '2026', 3)).toBe(true);
  });

  it('checks stored metrics after the hourly collection window, including midnight and winter Eastern time', () => {
    const next = (value: string) => new Date(nextRosterRefreshAt(Date.parse(value))).toISOString();
    expect(next('2026-09-13T15:59:00.000Z')).toBe('2026-09-13T16:03:00.000Z');
    expect(next('2026-09-13T16:03:00.000Z')).toBe('2026-09-13T17:03:00.000Z');
    expect(next('2026-09-14T03:59:00.000Z')).toBe('2026-09-14T04:03:00.000Z');
    expect(next('2026-09-14T04:03:00.000Z')).toBe('2026-09-14T16:03:00.000Z');
    expect(next('2026-11-02T16:59:00.000Z')).toBe('2026-11-02T17:03:00.000Z');
  });

  it('distinguishes active scoring from display week, proven closure, and unknown authority', () => {
    expect(rosterProvisionalWeek('2', data)).toBe(2);
    expect(rosterProvisionalWeek('none', data)).toBeNull();
    expect(rosterProvisionalWeek('unknown', data)).toBe('unknown');
    expect(rosterProvisionalWeek(null, data)).toBeUndefined();
    expect(rosterProvisionalWeek('4', data)).toBeUndefined();
    expect(rosterProvisionalWeek('0', data)).toBeUndefined();
    expect(rosterProvisionalWeek('1.5', data)).toBeUndefined();
    expect(rosterProvisionalWeek('2', { ...data, week: 2, currentWeek: 1, league: { ...data.league, week: 1 } })).toBe(2);
  });

  it('retains saved metrics across unavailable or older reads but accepts newer partial evidence', () => {
    const older = { ...data, playerMetrics: { ...data.playerMetrics, observedAt: '2026-09-07T12:00:00.000Z' } };
    const newer = { ...data, playerMetrics: { ...data.playerMetrics, observedAt: '2026-09-09T12:00:00.000Z' } };
    const unavailable: RostersData = { ...data, playerMetrics: { status: 'unavailable', observedAt: null, throughWeek: null } };
    expect(rosterMetricsRegressed(data, older)).toBe(true);
    expect(rosterMetricsRegressed(data, unavailable)).toBe(true);
    expect(rosterMetricsRegressed(data, data)).toBe(false);
    expect(rosterMetricsRegressed(data, newer)).toBe(false);
    expect(rosterMetricsRegressed(unavailable, data)).toBe(false);
  });

  it('labels the saved-stat timestamp separately from newly refreshed roster metadata', () => {
    const html = renderToStaticMarkup(<RosterContent data={{ ...data,
      updatedAt: '2026-09-13T19:00:00.000Z',
      playerMetrics: { status: 'provisional', observedAt: '2026-09-12T16:00:00.000Z', throughWeek: 3 },
    }} selected={2} />);
    expect(html).toContain('Player stats saved Sep 12, 12:00 PM ET');
    expect(html).toContain('Partial statistics');
    expect(html).toContain('Page refreshed 3:00 PM ET');
  });

  it('uses mobile-safe geometry and a bottom-right chevron', () => {
    const css = readFileSync(new URL('./rosters.module.css', import.meta.url), 'utf8');
    expect(css).toContain('.summary{position:relative;');
    expect(css).toContain('min-height:60px');
    expect(css).toContain('.chevron{position:absolute;right:7px;bottom:6px');
    expect(css).toMatch(/\.teamName\{[^}]*text-wrap:balance;overflow-wrap:anywhere/gu);
    expect(css).not.toMatch(/\.teamName\{[^}]*(?:text-overflow:ellipsis|white-space:nowrap)/gu);
    expect(css).toMatch(/\.managerMeta :global\(\.avatar\)\{width:14px;height:14px/gu);
    expect(css).toContain('grid-template-columns:32px minmax(0,1fr) 48px 42px 30px');
    expect(css).toContain('font-variant-numeric:tabular-nums');
  });
});

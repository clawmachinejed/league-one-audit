import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEAGUE_SITES } from '../lib/leagues';
import type { StandingsData, StandingsTeam } from '../lib/types';
import { LeagueSiteProvider } from './league-context';
import { formatStandingsPoints, formatWaiverBalance, StandingsView, standingsHaveScoringEvidence } from './standings-view';

const team = (overrides: Partial<StandingsTeam> = {}): StandingsTeam => ({
  id: 1, name: 'Team One', managerName: 'Manager One', avatar: null,
  wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: null,
  waiverOrder: 1, waiverBudgetRemaining: 100, ...overrides,
});

const data = (teams: StandingsTeam[]): StandingsData => ({
  league: { season: '2026', week: 1, maxWeek: 18, rosterPositions: [] },
  teams,
  updatedAt: '2026-09-10T12:00:00.000Z',
});

function renderedPointCells(teams: StandingsTeam[], league: keyof typeof LEAGUE_SITES = 'league1') {
  const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES[league]}><StandingsView data={data(teams)} /></LeagueSiteProvider>);
  return {
    html,
    points: [...html.matchAll(/<td class="metric-cell points-cell">([^<]+)<\/td>/gu)].map(match => match[1]),
  };
}

describe('Standings waiver balance presentation', () => {
  it('shows valid zero as $0', () => {
    expect(formatWaiverBalance(0)).toBe('$0');
  });

  it('shows unavailable balances as an em dash instead of $0', () => {
    expect(formatWaiverBalance(null)).toBe('—');
  });

  it('does not clamp transferred or adjusted balances', () => {
    expect(formatWaiverBalance(125)).toBe('$125');
  });
});

describe('Standings shared view presentation', () => {
  it('uses League as the visible heading without renaming the internal tabs', () => {
    const source = readFileSync(new URL('./standings-view.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<PageIntro title="League"');
    expect(source).toContain("{ value: 'standings', label: 'Standings' }");
    expect(source).toContain("{ value: 'waivers', label: 'Waivers' }");
    expect(source).toContain("{ value: 'transactions', label: 'Transactions' }");
    expect(source).toContain("{ value: 'rosters', label: 'Rosters' }");
  });

  it('renders PF and PA as unavailable while the entire league remains unplayed', () => {
    const teams = [team({ id: 1, pointsAgainst: 0 }), team({ id: 2, pointsAgainst: null })];
    expect(standingsHaveScoringEvidence(teams)).toBe(false);
    expect(renderedPointCells(teams).points).toEqual(['—', '—', '—', '—']);
  });

  it('renders positive, zero, and negative finite totals once scoring has begun', () => {
    const teams = [
      team({ id: 1, pointsFor: 12.345, pointsAgainst: 9.5 }),
      team({ id: 2, pointsFor: 0, pointsAgainst: -1 }),
    ];
    expect(standingsHaveScoringEvidence(teams)).toBe(true);
    expect(renderedPointCells(teams).points).toEqual(['12.35', '9.50', '0.00', '-1.00']);
  });

  it('treats a completed record as scoring evidence while preserving missing totals', () => {
    const teams = [team({ id: 1, wins: 1, pointsFor: 0, pointsAgainst: 0 }), team({ id: 2 })];
    expect(standingsHaveScoringEvidence(teams)).toBe(true);
    expect(renderedPointCells(teams).points).toEqual(['0.00', '0.00', '0.00', '—']);
  });

  it('always renders missing, malformed, and non-finite totals as unavailable', () => {
    const invalid = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '12'];
    expect(invalid.map(value => formatStandingsPoints(value as number | null | undefined, true)))
      .toEqual(['—', '—', '—', '—', '—', '—']);
  });

  it('uses the same scoring-availability rule in League One and League Two', () => {
    const teams = [team({ id: 1, pointsFor: 1 }), team({ id: 2, pointsFor: 0, pointsAgainst: -1 })];
    const leagueOne = renderedPointCells(teams, 'league1');
    const leagueTwo = renderedPointCells(teams, 'league2');
    expect(leagueOne.points).toEqual(['1.00', '—', '0.00', '-1.00']);
    expect(leagueTwo.points).toEqual(leagueOne.points);
    expect(leagueOne.html).toContain('href="/managers/1"');
    expect(leagueTwo.html).toContain('href="/league2/managers/1"');
  });

  it('adds Rosters immediately after Transactions while keeping Standings first', () => {
    const source = readFileSync(new URL('./standings-view.tsx', import.meta.url), 'utf8');
    expect(source.indexOf("value: 'standings'")).toBeLessThan(source.indexOf("value: 'waivers'"));
    expect(source.indexOf("value: 'transactions'")).toBeLessThan(source.indexOf("value: 'rosters'"));
    expect(source).toContain("useState<StandingsViewName>('standings')");
  });

  it('uses one fixed panel gap and no transaction-specific top offset', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.standings-view-tabs\{[^}]*margin:0 0 14px/gu);
    expect(css).toContain('.standings-view-panel{min-width:0}');
    expect(css).toContain('.league-transactions-panel{min-width:0;margin-top:0}');
  });

  it('keeps table names accessible without rendering redundant visible headings', () => {
    const source = readFileSync(new URL('./standings-view.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('className="section-label"');
    expect(source).toContain('<caption className="sr-only">');
    expect(source).not.toContain('<h2>Standings table</h2>');
    expect(source).not.toContain('<h2>Waiver table</h2>');
  });

  it('uses normal-weight ranks and places the existing avatar beside the manager', () => {
    const source = readFileSync(new URL('./standings-view.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(source).toContain('<td className="rank-cell"><span>{team.rank}</span></td>');
    expect(source).not.toContain('rank-top');
    expect(css).not.toContain('.rank-top');
    expect(source).toMatch(/className="manager-meta"><Avatar team=\{team\} \/>/u);
    expect(css).toMatch(/\.manager-meta \.avatar\{width:14px;height:14px/gu);
  });
});

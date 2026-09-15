import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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
  it('uses the same player rows for unequal benches while preserving sourced zero, missing values and team totals', () => {
    const matchup: Matchup = { id: '1', status: 'upcoming', sides: [
      { team: team(1), points: 23.2, projectedPoints: 40, starters: [player('starter', 40)],
        bench: [{ ...player('bench-zero', 0), slot: 'BN', points: 0 },
          { ...player('bench-unknown', null), slot: 'BN', points: null }] },
      { team: team(2), points: 7, projectedPoints: 30, starters: [player('other-starter', 30)],
        bench: [{ ...player('other-bench', 14), slot: 'BN', points: 12 }] },
    ] };
    const render = (showBench: boolean) => renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[matchup]} selected={1} avatar={() => null} showBench={showBench} />
    </LeagueSiteProvider>);
    const original = JSON.stringify(matchup);
    const html = render(true);
    expect(html).toContain('Expand starting lineups and benches');
    expect([...html.matchAll(/data-bench-row="true"/gu)]).toHaveLength(2);
    expect(html).toContain('Official score 0.00 points; projected score 0.00 points');
    expect(html).toContain('Official score unavailable; projected score unavailable');
    expect(html).toContain('official score 23.20 points, projected score 40.00 points');
    expect(html).not.toContain('Empty slot');
    expect(render(false)).not.toContain('bench-zero');
    expect(JSON.stringify(matchup)).toBe(original);
  });

  it('keeps legacy or unavailable bench membership unknown instead of inventing bench players', () => {
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[{ id: '1', status: 'unknown', sides: [
        { team: team(1), points: 0, projectedPoints: null, starters: [], bench: null },
        { team: team(2), points: 0, projectedPoints: 20, starters: [player('known', 20)] },
      ] }]} selected={1} avatar={() => null} showBench />
    </LeagueSiteProvider>);
    expect(html).toContain('Bench unavailable');
    expect(html).toContain('Awaiting Sleeper');
    expect(html).not.toContain('No bench players');
    expect(html).not.toContain('Empty slot');
  });

  it('keeps bench box-score rows separate from starting-position disclosures', () => {
    const live = { ...player('bench-live', 9), slot: 'BN', game: {
      kind: 'scheduled' as const, opponent: 'TEN', location: 'away' as const, date: '2026-09-13',
      kickoffAt: '2026-09-13T17:00:00Z',
      liveScore: { teamScore: 10, opponentScore: 7, phase: 'q2' as const, clockSeconds: 120 },
    } };
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[{ id: '1', status: 'upcoming', sides: [
        { team: team(1), points: 0, projectedPoints: 20, starters: [player('starter', 20)], bench: [live] },
      ] }]} selected={1} avatar={() => null} showBench />
    </LeagueSiteProvider>);
    expect(html).toContain('data-bench-box-score-toggle="true"');
    expect(html).toContain('Bench row 1 game statistics for both teams');
    expect(html).not.toContain('data-starter-box-score-toggle');
  });
  it('labels the missing team lineup without claiming its slots are empty or hiding the opponent projection', () => {
    const matchups: Matchup[] = [{ id: '1', status: 'live', sides: [
      { team: team(1), points: 23.2, projectedPoints: 40, starters: [player('known', 40)] },
      { team: team(2), points: 7, projectedPoints: null, starters: [] },
    ] }];
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={matchups} selected={null} avatar={() => null} />
    </LeagueSiteProvider>);
    expect(html).toContain('Lineup unavailable');
    expect(html).toContain('Awaiting Sleeper');
    expect(html).not.toContain('Empty slot');
    expect(html).toContain('projected score 40.00 points');
    expect(html).toContain('official score 7.00 points, projected score unavailable');
  });

  it('offers one initially collapsed control per starter slot without nesting score groups or loading data', () => {
    const live = player('live', 20);
    const final = player('final', 21);
    live.game = { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13',
      kickoffAt: '2026-09-13T17:00:00.000Z',
      liveScore: { teamScore: 23, opponentScore: 10, phase: 'q3', clockSeconds: 165 } };
    final.game = { kind: 'scheduled', opponent: 'NYJ', location: 'home', date: '2026-09-13',
      kickoffAt: '2026-09-13T17:00:00.000Z', finalScore: { teamScore: 10, opponentScore: 24 } };
    const onBoxScoreOpen = vi.fn();
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[{ id: '1', status: 'live', sides: [
        { team: team(1), points: 46.4, projectedPoints: 60, starters: [live, { ...live, id: 'live-2' }] },
        { team: team(2), points: 46.4, projectedPoints: 62, starters: [final, { ...final, id: 'final-2' }] },
      ] }]} selected={null} avatar={() => null} onBoxScoreOpen={onBoxScoreOpen} />
    </LeagueSiteProvider>);
    const controls = [...html.matchAll(/<button[^>]*data-starter-box-score-toggle="true"[^>]*><\/button>/gu)].map((match) => match[0]);
    expect(controls).toHaveLength(2);
    const panelIds: string[] = [];
    for (const [index, control] of controls.entries()) {
      expect(control).toContain('aria-expanded="false"');
      expect(control).toContain(`aria-label="WR row ${index + 1} game statistics for both teams"`);
      expect(control).toContain(`data-starter-index="${index}"`);
      const panelId = /aria-controls="([^"]+)"/u.exec(control)![1];
      panelIds.push(panelId);
      const row = [...html.matchAll(/<div[^>]*data-starter-box-score-row[^>]*>/gu)].map((match) => match[0])
        .find((row) => row.includes(`id="${panelId}"`));
      expect(row).toContain('hidden=""');
    }
    expect(new Set(panelIds).size).toBe(2);
    expect([...html.matchAll(/role="group" aria-label="Official score/gu)]).toHaveLength(4);
    expect(html).not.toContain('data-player-box-score-toggle');
    expect(onBoxScoreOpen).not.toHaveBeenCalled();
  });

  it('does not expose a box-score control for scheduled, bye, or unknown games despite current Active metadata and nonzero points', () => {
    const scheduled = { ...player('scheduled', 10), injuryStatus: 'Active' };
    const bye = { ...player('bye', 10), injuryStatus: 'Active', game: { kind: 'bye' as const } };
    const unknown = { ...player('unknown', 10), injuryStatus: 'Active', game: null };
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[{ id: '1', status: 'live', sides: [
        { team: team(1), points: 69.6, projectedPoints: 30, starters: [scheduled, bye, unknown] },
      ] }]} selected={null} avatar={() => null} />
    </LeagueSiteProvider>);
    expect(html).not.toContain('data-starter-box-score-toggle');
    expect(html).not.toContain('data-player-box-score="true"');
    expect([...html.matchAll(/data-player-name="true"/gu)]).toHaveLength(6);
    expect(html).toContain('Official score 23.20 points');
  });

  it.each(['league1', 'league2'] as const)('%s shows each live NFL clock and Half label without changing fantasy points', (league) => {
    const away = player('away', 20);
    const home = player('home', 21);
    away.game = { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13',
      kickoffAt: '2026-09-13T17:00:00.000Z',
      liveScore: { teamScore: 23, opponentScore: 10, phase: 'q3', clockSeconds: 165 } };
    home.game = { kind: 'scheduled', opponent: 'NYJ', location: 'home', date: '2026-09-13',
      kickoffAt: '2026-09-13T17:00:00.000Z',
      liveScore: { teamScore: 10, opponentScore: 24, phase: 'halftime', clockSeconds: null } };
    const html = renderToStaticMarkup(
      <LeagueSiteProvider site={LEAGUE_SITES[league]}>
        <MatchupBoard matchups={[{ id: '1', status: 'live', sides: [
          { team: team(1), points: 23.2, projectedPoints: 30, starters: [away] },
          { team: team(2), points: 23.2, projectedPoints: 31, starters: [home] },
        ] }]} selected={null} avatar={() => null} />
      </LeagueSiteProvider>,
    );
    expect(html).toContain('02:45 3rd 23-10 @ TEN');
    expect(html).toContain('Half 10-24 vs NYJ');
    expect(html).not.toContain('Sun 1:00 PM');
    expect(html).not.toContain('Final W');
    expect(html).toContain('In progress');
    expect([...html.matchAll(/data-player-score-number="true"[^>]*>([^<]+)</gu)].map((match) => match[1]))
      .toEqual(['23.20', '23.20']);
    expect([...html.matchAll(/data-player-projection-number="true"[^>]*>([^<]+)</gu)].map((match) => match[1]))
      .toEqual(['20.00', '21.00']);
  });

  it('shows each final NFL result while the fantasy matchup remains live', () => {
    const away = player('away', 20);
    const home = player('home', 21);
    away.game = { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13',
      kickoffAt: '2026-09-13T17:00:00.000Z', finalScore: { teamScore: 23, opponentScore: 10 } };
    home.game = { kind: 'scheduled', opponent: 'NYJ', location: 'home', date: '2026-09-13',
      kickoffAt: '2026-09-13T17:00:00.000Z', finalScore: { teamScore: 10, opponentScore: 24 } };
    const html = renderToStaticMarkup(
      <LeagueSiteProvider site={LEAGUE_SITES.league1}>
        <MatchupBoard matchups={[{ id: '1', status: 'live', sides: [
          { team: team(1), points: 23.2, projectedPoints: 23.2, starters: [away] },
          { team: team(2), points: 23.2, projectedPoints: 23.2, starters: [home] },
        ] }]} selected={null} avatar={() => null} />
      </LeagueSiteProvider>,
    );
    expect(html).toContain('Final W 23-10 @ TEN');
    expect(html).toContain('Final L 10-24 vs NYJ');
    expect(html).not.toContain('Sun 1:00 PM');
    expect(html).toContain('In progress');
  });

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

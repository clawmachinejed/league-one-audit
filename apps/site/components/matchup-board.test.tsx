import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LEAGUE_SITES } from '../lib/leagues';
import type { Matchup, Player, Team } from '../lib/types';
import { LeagueSiteProvider } from './league-context';
import { MatchupBoard } from './matchup-board';
import { matchupWithTeamOnLeft } from '../lib/my-team-matchup';

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

function chanceMatchup(probability: number): Matchup {
  return { id: '1', status: 'live', sides: [
    { team: team(1), points: 23.2, projectedPoints: 40, starters: [player('first', 40)], bench: [] },
    { team: team(2), points: 7, projectedPoints: 50, starters: [player('second', 50)], bench: [] },
  ], winProbability: { modelVersion: 'normal-v2', status: 'estimated', teams: [
    { teamId: 1, probability }, { teamId: 2, probability: 1 - probability },
  ] } };
}

function chanceBars(html: string) {
  return {
    halves: [...html.matchAll(/<[^>]*data-win-chance-half="([^"]+)"[^>]*>/gu)].map(match => ({
      side: match[1], tone: /data-win-chance-tone="([^"]+)"/u.exec(match[0])?.[1],
    })),
    widths: [...html.matchAll(/<[^>]*data-win-chance-fill[^>]*>/gu)].map(match => (
      Number(/width:([^%;"]+)%/u.exec(match[0])?.[1])
    )),
  };
}

describe('My Fantasy shared matchup presentation', () => {
  const render = (matchup: Matchup, selected = 1) => renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
    <MatchupBoard matchups={[matchup]} selected={selected} avatar={() => null} presentation="fantasy" leagueSize={12}
      standings={{ leagueId: 'league', season: '2026', playoffTeams: 6, places: { 1: 9, 2: 6 } }}
      summaryFooter={<span>9th → 6th</span>} summaryDescription="Current rank ninth; projected rank sixth." />
  </LeagueSiteProvider>);

  it.each([
    [0.68, 'favored'], [0.28, 'underdog'], [0.5, 'neutral'], [0.49999, 'underdog'],
  ])('represents user probability %s against one full-width track with %s emphasis', (probability, tone) => {
    const html = render(chanceMatchup(probability as number));
    expect(html).toContain('data-matchup-presentation="fantasy"');
    expect(html).toContain(`data-win-chance-tone="${tone}"`);
    expect([...html.matchAll(/data-win-chance-track/gu)]).toHaveLength(1);
    expect(chanceBars(html).halves).toHaveLength(0);
    expect(chanceBars(html).widths).toHaveLength(1);
    expect(chanceBars(html).widths[0]).toBeCloseTo((probability as number) * 100, 10);
    expect(html).toContain('Current rank ninth; projected rank sixth.');
    expect(html).toContain('data-team-place="1" data-place-tone="lower"');
    expect(html).toContain('data-team-place="2" data-place-tone="middle"');
  });

  it('keeps the selected user on the left without mutating provider order or assigning the opponent a colored segment', () => {
    const matchup = chanceMatchup(0.28);
    const original = JSON.stringify(matchup);
    const html = render(matchup, 2);
    expect([...html.matchAll(/data-team-name="true"[^>]*>([^<]+)</gu)].map(match => match[1])).toEqual(['Team 2', 'Team 1']);
    expect(html).toContain('data-win-chance-side="left" data-win-chance-team="2">72%</span>');
    expect(html).toContain('data-win-chance-side="right" data-win-chance-team="1">28%</span>');
    expect(chanceBars(html).widths).toEqual([72]);
    expect(JSON.stringify(matchup)).toBe(original);
  });

  it('leaves missing win probability neutral and unfilled instead of presenting it as zero', () => {
    const matchup = chanceMatchup(0.28);
    delete matchup.winProbability;
    const html = render(matchup);
    expect(html).toContain('data-win-chance="unavailable"');
    expect(html).toContain('data-win-chance-tone="neutral"');
    expect(chanceBars(html).widths).toHaveLength(0);
    expect([...html.matchAll(/data-win-chance-side="(?:left|right)"[^>]*>([^<]+)</gu)].map(match => match[1]))
      .toEqual(['—', '—']);
    expect(html).toContain('Win chance unavailable.');
  });
});

describe.each([false, true])('player actual-score states (benches %s)', showBench => {
  const observedAt = '2026-09-10T00:00:00.000Z';
  const scheduled = {
    kind: 'scheduled' as const, opponent: 'NE', location: 'home' as const,
    date: '2026-09-10', kickoffAt: '2026-09-10T01:00:00.000Z',
  };
  const rows = (html: string) => [...html.matchAll(/<span\b[^>]*data-player-score-number="true"[^>]*>([^<]+)<\/span>/gu)]
    .map(match => ({ text: match[1], final: match[0].includes('data-player-score-final="true"') }));
  const render = (left: Player[], right: Player[], timestamp: string | undefined = observedAt) => {
    const matchup: Matchup = { id: 'score-states', status: 'live', sides: [
      { team: team(1), points: 0, projectedPoints: 40, starters: left,
        bench: left.map(item => ({ ...item, id: `bench-${item.id}`, slot: 'BN' })) },
      { team: team(2), points: -2.5, projectedPoints: 30, starters: right,
        bench: right.map(item => ({ ...item, id: `bench-${item.id}`, slot: 'BN' })) },
    ] };
    const before = JSON.stringify(matchup);
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[matchup]} selected={null} avatar={() => null} showBench={showBench} observedAt={timestamp} />
    </LeagueSiteProvider>);
    expect(JSON.stringify(matchup)).toBe(before);
    return html;
  };

  it('shows a dash only for the pregame zero while retaining nonzero actuals, projections and team totals', () => {
    const html = render([
      { ...player('pregame-zero', 0), points: 0, game: scheduled },
    ], [
      { ...player('pregame-nonzero', 11), points: -2.5, game: scheduled },
    ]);
    const expected = [{ text: '—', final: false }, { text: '-2.50', final: false }];
    expect(rows(html)).toEqual(showBench ? [...expected, ...expected] : expected);
    expect([...html.matchAll(/data-player-projection-number="true"[^>]*>([^<]+)</gu)].map(match => match[1]))
      .toEqual(showBench ? ['0.00', '11.00', '0.00', '11.00'] : ['0.00', '11.00']);
    expect([...html.matchAll(/data-score-number="true"[^>]*>([^<]+)</gu)].map(match => match[1])).toEqual(['0.00', '-2.50']);
    expect([...html.matchAll(/data-team-projection-number="true"[^>]*>([^<]+)</gu)].map(match => match[1])).toEqual(['40.00', '30.00']);
  });

  it('preserves live, past-kickoff, unknown and bye zeroes instead of inferring that they have not started', () => {
    const games: Player['game'][] = [
      { ...scheduled, liveScore: { teamScore: 0, opponentScore: 0, phase: 'q1', clockSeconds: 900 } },
      { ...scheduled, kickoffAt: '2026-09-09T23:59:59.999Z' },
      { ...scheduled, kickoffAt: observedAt },
      { ...scheduled, kickoffAt: null },
      { ...scheduled, kickoffAt: 'invalid-kickoff' },
      null,
      { kind: 'bye' },
    ];
    const left = games.map((game, index) => ({ ...player(`zero-${index}`, 0), points: 0, game }));
    const right = left.map(item => ({ ...item, id: `opponent-${item.id}` }));
    const html = render(left, right);
    expect(rows(html)).toEqual(Array.from({ length: games.length * (showBench ? 4 : 2) }, () => ({ text: '0.00', final: false })));
  });

  it('requires a valid observation timestamp before hiding a scheduled zero', () => {
    for (const timestamp of ['', 'invalid-observation']) {
      const zero = { ...player('zero', 0), points: 0, game: scheduled };
      expect(rows(render([zero], [{ ...zero, id: 'opponent' }], timestamp)), timestamp || 'missing observation')
        .toEqual(Array.from({ length: showBench ? 4 : 2 }, () => ({ text: '0.00', final: false })));
    }
    // Omitting the optional prop must preserve legacy callers' sourced zeroes.
    const zero = { ...player('legacy-zero', 0), points: 0, game: scheduled };
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[{ id: 'legacy', status: 'upcoming', sides: [
        { team: team(1), points: 0, projectedPoints: 0, starters: [zero], bench: [zero] },
        { team: team(2), points: 0, projectedPoints: 0, starters: [zero], bench: [zero] },
      ] }]} selected={null} avatar={() => null} showBench={showBench} />
    </LeagueSiteProvider>);
    expect(rows(html)).toEqual(Array.from({ length: showBench ? 4 : 2 }, () => ({ text: '0.00', final: false })));
  });

  it('marks only finite final-game actuals for bold display, including zero and negative points', () => {
    const finalGame = { ...scheduled, finalScore: { teamScore: 23, opponentScore: 10 } };
    const left = [0, -2.5, 23.2, null, Number.POSITIVE_INFINITY].map((points, index) => ({
      ...player(`final-${index}`, index), points, game: finalGame,
    }));
    const right = left.map((item, index) => ({ ...item, id: `live-${index}`, points: 0,
      game: { ...scheduled, liveScore: { teamScore: 0, opponentScore: 0, phase: 'halftime' as const, clockSeconds: null } },
    }));
    const html = render(left, right);
    const expected = ['0.00', '-2.50', '23.20', '—', '—'].flatMap((text, index) => [
      { text, final: index < 3 }, { text: '0.00', final: false },
    ]);
    expect(rows(html)).toEqual(showBench ? [...expected, ...expected] : expected);
    expect([...html.matchAll(/<span\b[^>]*data-player-projection-number[^>]*>/gu)].every(match => !match[0].includes('data-player-score-final'))).toBe(true);
    expect([...html.matchAll(/data-player-projection-number="true"[^>]*>([^<]+)</gu)].map(match => match[1]))
      .toEqual(Array.from({ length: showBench ? 2 : 1 }, () => ['0.00', '0.00', '1.00', '1.00', '2.00', '2.00', '3.00', '3.00', '4.00', '4.00']).flat());
  });
});

describe('MatchupBoard player projection presentation', () => {
  it.each([false, true])('shows team-scoped win estimates in the expandable shared header (benches %s)', showBench => {
    const matchup = chanceMatchup(0.3);
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[matchupWithTeamOnLeft(matchup, 2)]} selected={2} avatar={() => null} showBench={showBench} />
    </LeagueSiteProvider>);
    expect(html).toContain('Win chance: Team 2 70%; Team 1 30%.');
    expect(html).not.toContain('Estimated win chance');
    expect(html).toContain('data-win-chance-side="left" data-win-chance-team="2">70%</span>');
    expect(html).toContain('data-win-chance-side="right" data-win-chance-team="1">30%</span>');
    expect(html).toContain('data-win-chance="estimated" aria-hidden="true"');
    expect(chanceBars(html)).toEqual({
      halves: [{ side: 'left', tone: 'favored' }, { side: 'right', tone: 'underdog' }], widths: [70, 30],
    });
    expect([...html.matchAll(/data-win-chance-track/gu)]).toHaveLength(2);
    expect(html).toContain('data-matchup-toggle="true" aria-expanded="false"');
    expect(html).toContain(showBench ? 'Expand starting lineups and benches.' : 'Expand starting lineups.');
    expect([...html.matchAll(/data-score-number="true"[^>]*>([^<]+)</gu)].map(match => match[1])).toEqual(['7.00', '23.20']);
    expect([...html.matchAll(/data-team-projection-number="true"[^>]*>([^<]+)</gu)].map(match => match[1])).toEqual(['50.00', '40.00']);
  });

  it.each([0.49999, 0.5])('sizes and colors both half-card bars using raw probability %s instead of the rounded label', probability => {
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[chanceMatchup(probability)]} selected={null} avatar={() => null} />
    </LeagueSiteProvider>);
    const bars = chanceBars(html);
    expect(bars.halves).toEqual([
      { side: 'left', tone: probability >= 0.5 ? 'favored' : 'underdog' },
      { side: 'right', tone: 'favored' },
    ]);
    expect(bars.widths).toHaveLength(2);
    expect(bars.widths[0]).toBeCloseTo(probability * 100, 10);
    expect(bars.widths[1]).toBeCloseTo((1 - probability) * 100, 10);
    expect([...html.matchAll(/data-win-chance-side="(?:left|right)"[^>]*>([^<]+)</gu)].map(match => match[1]))
      .toEqual(['50%', '50%']);
  });

  it.each(['final', 'tie', 'unavailable'] as const)('shows honest %s bar states without changing official totals', status => {
    const matchup = chanceMatchup(0.3);
    if (status === 'unavailable') delete matchup.winProbability;
    else {
      matchup.status = 'final';
      if (status === 'tie') matchup.sides[1].points = matchup.sides[0].points;
    }
    const original = JSON.stringify(matchup);
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[matchup]} selected={null} avatar={() => null} />
    </LeagueSiteProvider>);
    const bars = chanceBars(html);
    expect(bars.halves).toEqual(status === 'final'
      ? [{ side: 'left', tone: 'favored' }, { side: 'right', tone: 'underdog' }]
      : [{ side: 'left', tone: 'neutral' }, { side: 'right', tone: 'neutral' }]);
    expect(bars.widths).toEqual(status === 'final' ? [100, 0] : [0, 0]);
    expect([...html.matchAll(/data-win-chance-side="(?:left|right)"[^>]*>([^<]+)</gu)].map(match => match[1]))
      .toEqual(status === 'final' ? ['100%', '0%'] : status === 'tie' ? ['Tie', 'Tie'] : ['—', '—']);
    expect(JSON.stringify(matchup)).toBe(original);
  });

  it.each([false, true])('uses a compact super flex chip with a full disclosure name (benches %s)', (showBench) => {
    const starter = { ...player('super-flex', 20), slot: 'SUPER_FLEX', game: {
      kind: 'scheduled' as const, opponent: 'TEN', location: 'away' as const, date: '2026-09-13',
      kickoffAt: '2026-09-13T17:00:00Z', finalScore: { teamScore: 23, opponentScore: 10 },
    } };
    const html = renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES.league1}>
      <MatchupBoard matchups={[{ id: '1', status: 'final', sides: [
        { team: team(1), points: 23.2, projectedPoints: 23.2, starters: [starter], bench: [] },
      ] }]} selected={1} avatar={() => null} showBench={showBench} />
    </LeagueSiteProvider>);
    expect(html).toContain('aria-label="Wide receiver, running back, tight end or quarterback" title="Wide receiver, running back, tight end or quarterback" data-roster-slot="SUPER_FLEX"');
    expect(html).toContain('Wide receiver, running back, tight end or quarterback row 1 game statistics for both teams');
    expect(html).toContain('<span>W</span><span>R</span><span>T</span><span>Q</span>');
    expect(html).not.toContain('>SUPER_FLEX<');
    expect(starter.slot).toBe('SUPER_FLEX');
  });

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

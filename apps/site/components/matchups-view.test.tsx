import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LEAGUE_SITES } from '../lib/leagues';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import type { MatchupsData } from '../lib/types';
import { LeagueSiteProvider } from './league-context';
import { MatchupsView } from './matchups-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('./team-preference', () => ({
  useTeamPreference: () => ({ selected: null }),
  useTeamPreferenceContext: () => ({ selected: null, select: vi.fn() }),
}));
vi.mock('./use-matchup-snapshot', () => ({
  useMatchupSnapshot: ({ data, periodContext }: { data: MatchupsData; periodContext: MatchupPeriodContext }) => ({
    data, periodContext, updatedAt: data.updatedAt, refreshing: false,
  }),
}));

const context: MatchupPeriodContext = {
  defaultSeason: 2026, defaultWeek: 1, activeSeason: 2026, activeWeek: 2,
  lifecycle: 'active', nflPhase: 'regular', temporalState: 'past', refreshDue: false,
};

function render(leagueKey: 'league1' | 'league2', week: number, periodContext = context, mode: 'matchups' | 'my-team' = 'matchups') {
  const data: MatchupsData = {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    week, matchups: [], teams: [], updatedAt: '2026-09-15T14:00:00.000Z',
  };
  return renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES[leagueKey]}>
    <MatchupsView mode={mode} data={data} periodContext={periodContext} snapshotRevision={null} verifiedAt={null} />
  </LeagueSiteProvider>);
}

describe.each(['matchups', 'my-team'] as const)('%s current-week control', mode => {
  it.each(['league1', 'league2'] as const)('marks active Week 2 and links back to it from explicit Week 1 in %s', leagueKey => {
    const html = render(leagueKey, 1, context, mode);
    const currentLink = html.match(/<a[^>]*aria-label="Back to current"[^>]*>Current<\/a>/u)?.[0];
    expect(html).toContain('>Week 2 · Current</option>');
    expect(html).not.toContain('>Week 1 · Current</option>');
    expect(currentLink).toContain(`href="${LEAGUE_SITES[leagueKey].prefix}/${mode}"`);
    expect(html).toContain(`href="${LEAGUE_SITES[leagueKey].prefix}/${mode}?week=2"`);
    expect(html).toContain('value="1" selected=""');
  });

  it('does not offer a reset while already viewing the active week despite a lagging display week', () => {
    const html = render('league1', 2, { ...context, temporalState: 'active' }, mode);
    expect(html).toContain('>Week 2 · Current</option>');
    expect(html).not.toContain('aria-label="Back to current"');
  });

  it('does not mark a leading display week current while the preceding week is still scoring', () => {
    const html = render('league1', 3, { ...context, defaultWeek: 3, temporalState: 'future' }, mode);
    expect(html).toContain('>Week 2 · Current</option>');
    expect(html).not.toContain('>Week 3 · Current</option>');
  });

  it('retains the preseason display default when there is no active scoring week', () => {
    const html = render('league1', 2, { ...context, lifecycle: 'preseason', nflPhase: 'preseason',
      activeSeason: null, activeWeek: null, temporalState: 'future' }, mode);
    expect(html).toContain('>Week 1 · Current</option>');
    expect(html).toContain(`href="/${mode}"`);
  });

  it('keeps navigation within the supported week bounds', () => {
    const first = render('league2', 1, context, mode);
    const last = render('league2', 18, { ...context, temporalState: 'future' }, mode);
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous week, week 1"/u);
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next week, week 18"/u);
    expect(last).toContain(`href="/league2/${mode}?week=17"`);
    expect(first).not.toContain('?week=0');
    expect(last).not.toContain('?week=19');
  });
});

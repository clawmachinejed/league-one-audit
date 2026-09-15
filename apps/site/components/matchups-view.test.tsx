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

function render(leagueKey: 'league1' | 'league2', week: number, periodContext = context) {
  const data: MatchupsData = {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    week, matchups: [], teams: [], updatedAt: '2026-09-15T14:00:00.000Z',
  };
  return renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES[leagueKey]}>
    <MatchupsView data={data} periodContext={periodContext} snapshotRevision={null} verifiedAt={null} />
  </LeagueSiteProvider>);
}

describe('Matchups current-week control', () => {
  it.each(['league1', 'league2'] as const)('marks active Week 2 and links back to it from explicit Week 1 in %s', leagueKey => {
    const html = render(leagueKey, 1);
    const currentLink = html.match(/<a[^>]*aria-label="Back to current"[^>]*>Current<\/a>/u)?.[0];
    expect(html).toContain('>Week 2 · Current</option>');
    expect(html).not.toContain('>Week 1 · Current</option>');
    expect(currentLink).toContain(`href="${LEAGUE_SITES[leagueKey].prefix}/matchups?week=2"`);
    expect(html).toContain('value="1" selected=""');
  });

  it('does not offer a reset while already viewing the active week despite a lagging display week', () => {
    const html = render('league1', 2, { ...context, temporalState: 'active' });
    expect(html).toContain('>Week 2 · Current</option>');
    expect(html).not.toContain('aria-label="Back to current"');
  });

  it('does not mark a leading display week current while the preceding week is still scoring', () => {
    const html = render('league1', 3, { ...context, defaultWeek: 3, temporalState: 'future' });
    expect(html).toContain('>Week 2 · Current</option>');
    expect(html).not.toContain('>Week 3 · Current</option>');
  });

  it('retains the preseason display default when there is no active scoring week', () => {
    const html = render('league1', 2, { ...context, lifecycle: 'preseason', nflPhase: 'preseason',
      activeSeason: null, activeWeek: null, temporalState: 'future' });
    expect(html).toContain('>Week 1 · Current</option>');
    expect(html).toContain('href="/matchups?week=1"');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyFantasyLeagueSummary, myFantasyStandingsEvidence } from '../lib/my-fantasy';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import type { MatchupsData, StandingsData, StandingsTeam } from '../lib/types';
import { watchMyFantasyStandingsRefresh, type MyFantasyStandingsRefreshState } from './use-my-fantasy-standings-refresh';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const context: MatchupPeriodContext = { defaultSeason: 2026, defaultWeek: 1, activeSeason: 2026, activeWeek: 1,
  lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false };

function fixture() {
  const teams: StandingsTeam[] = [1, 2].map(id => ({ id, name: `Team ${id}`, managerName: `Manager ${id}`,
    avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, waiverOrder: id, waiverBudgetRemaining: 100 }));
  const standings: StandingsData = { league: { season: '2026', week: 1, maxWeek: 18, rosterPositions: ['QB'] },
    teams, updatedAt: '2026-09-13T12:00:00Z' };
  const data: MatchupsData = { ...standings, week: 1, matchups: [{ id: 'one', status: 'live',
    sides: teams.map(team => ({ team, points: 0, projectedPoints: 100, starters: [] })) }] };
  return { data, standings };
}

describe('bounded My Fantasy standings refresh', () => {
  let surface: EventTarget;
  let visible: boolean;
  let state: MyFantasyStandingsRefreshState;
  const cleanups: Array<() => void> = [];
  const refresh = vi.fn<() => void>();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
    visible = true;
    surface = new EventTarget();
    Object.defineProperty(surface, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' });
    vi.stubGlobal('document', surface);
    state = { evidence: null, attempts: 0, nextDue: null };
    refresh.mockReset();
  });
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  function watch(evidence: string) {
    const cleanup = watchMyFantasyStandingsRefresh(evidence, refresh, state);
    cleanups.push(cleanup);
    return cleanup;
  }
  function visibility(value: boolean) {
    visible = value;
    surface.dispatchEvent(new Event('visibilitychange'));
  }
  function changed(evidence = 'changed') {
    watch('initial')();
    return watch(evidence);
  }

  it('does not refresh the initial evidence or ordinary unchanged renders', () => {
    const stop = watch('initial');
    vi.advanceTimersByTime(1_000_000);
    stop();
    watch('initial');
    visibility(false); visibility(true);
    vi.advanceTimersByTime(1_000_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('allows an immediate request and two settling retries, then stops even without any committed response', () => {
    let stop = changed();
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    stop();
    stop = watch('changed');
    // Reattachment retains the remaining 35 seconds rather than restarting 65.
    vi.advanceTimersByTime(34_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    // A rerender/effect reattachment must preserve the remaining attempt budget.
    stop();
    stop = watch('changed');
    vi.advanceTimersByTime(65_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    watch('changed');
    vi.advanceTimersByTime(3_600_000);
    visibility(false); visibility(true);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers the current record after a failed refresh and a stale successful refresh without another scoring change', () => {
    const { data, standings } = fixture();
    const advanced = structuredClone(data);
    advanced.teams[0].wins = 1;
    advanced.teams[1].losses = 1;
    advanced.matchups[0].status = 'final';
    let serverStandings = standings;
    refresh.mockImplementationOnce(() => { throw new Error('The first routing request failed.'); })
      .mockImplementationOnce(() => { serverStandings = { ...standings, updatedAt: new Date().toISOString() }; })
      .mockImplementationOnce(() => { serverStandings = { ...standings,
        teams: advanced.teams.map(team => ({ ...team, waiverOrder: team.id, waiverBudgetRemaining: 100 })) }; });
    watch(myFantasyStandingsEvidence(data))();
    let stop = watch(myFantasyStandingsEvidence(advanced));
    const record = () => getMyFantasyLeagueSummary(advanced, context, serverStandings, 1).team?.wins;
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(record()).toBe(0);
    vi.advanceTimersByTime(65_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(serverStandings).not.toBe(standings);
    expect(record()).toBe(0);
    // New server-prop identity and render timestamp do not prove cache freshness.
    stop();
    stop = watch(myFantasyStandingsEvidence(advanced));
    vi.advanceTimersByTime(65_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(record()).toBe(1);
    stop();
    watch(myFantasyStandingsEvidence(advanced));
    vi.advanceTimersByTime(1_000_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('does not burst overdue retries after returning from a hidden page', () => {
    changed();
    visibility(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility(true);
    expect(refresh).toHaveBeenCalledTimes(2);
    visibility(false); visibility(true);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(64_999);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('defers the first attempt if evidence changes while hidden', () => {
    visibility(false);
    changed();
    vi.advanceTimersByTime(1_000_000);
    expect(refresh).not.toHaveBeenCalled();
    visibility(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(65_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('supersedes the earlier retry timer when new record or final evidence arrives', () => {
    const old = changed('first result');
    vi.advanceTimersByTime(30_000);
    old();
    watch('second result');
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(35_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(65_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(1_000_000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('cancels retry timers and visibility listeners when leaving the page', () => {
    const stop = changed();
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000_000);
    visibility(false); visibility(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from 'vitest';
import { buildMyTeamScheduleWeeks, selectMyTeamSchedule, type MyTeamScheduleData } from './my-team-schedule';
import type { SleeperMatchup } from './transform';
import type { Team } from './types';

const alpha: Team = { id: 1, name: 'Alpha', managerName: 'A', avatar: null,
  wins: 1, losses: 0, ties: 0, pointsFor: 100, pointsAgainst: 90 };
const bravo: Team = { ...alpha, id: 2, name: 'Bravo', pointsFor: 110 };
const charlie: Team = { ...alpha, id: 3, name: 'Charlie' };
const delta: Team = { ...alpha, id: 4, name: 'Delta' };
const teams = [alpha, bravo, charlie, delta];
const rows = (left: number | null = 100, right: number | null = 80): SleeperMatchup[] => [
  { roster_id: 1, matchup_id: 1, points: left, starters: [] },
  { roster_id: 2, matchup_id: 1, points: right, starters: null },
];
function data(history: (SleeperMatchup[] | null)[], completedWeeks = [1]): MyTeamScheduleData {
  return { league: { season: '2026', week: 2, maxWeek: 18, rosterPositions: ['QB'] },
    teams, updatedAt: '2026-09-16T00:00:00Z',
    weeks: buildMyTeamScheduleWeeks(teams, history, { completedWeeks, activeWeek: 2, preseason: false }) };
}

describe('My Team schedule evidence and selection', () => {
  it('returns only weeks 1 through 15 and does not require starters to display official team results', () => {
    const schedule = selectMyTeamSchedule(data([rows()]), alpha.id);
    expect(schedule.weeks.map(week => week.week)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect(schedule.weeks[0]).toEqual({ week: 1, status: 'final', opponent: bravo,
      points: 100, opponentPoints: 80, result: 'W' });
    expect(schedule.weeks[14].opponent).toBeNull();
  });

  it('keeps the selected team on the own side and returns a loss without mutating the source', () => {
    const source = data([rows()]);
    const original = JSON.stringify(source);
    const schedule = selectMyTeamSchedule(source, bravo.id);
    expect(schedule.team).toBe(bravo);
    expect(schedule.weeks[0]).toMatchObject({ opponent: alpha, points: 80, opponentPoints: 100, result: 'L' });
    expect(JSON.stringify(source)).toBe(original);
  });

  it.each([null, 999])('uses the same official first-place fallback for absent/stale selection %s', selected => {
    expect(selectMyTeamSchedule(data([rows()]), selected).team).toBe(bravo);
  });

  it('uses alphabetical and roster-ID ties exactly as the My Team matchup default', () => {
    const source = data([rows()]);
    source.teams = [charlie, { ...alpha, id: 5 }, alpha];
    expect(selectMyTeamSchedule(source, null).team).toBe(alpha);
  });

  it('preserves commissioner zero overrides and never rounds away an official winning margin', () => {
    const adjusted = rows(99, 0);
    adjusted[0].custom_points = 0;
    expect(selectMyTeamSchedule(data([adjusted]), alpha.id).weeks[0]).toMatchObject({ points: 0, result: 'T' });
    expect(selectMyTeamSchedule(data([rows(10.004, 10)]), alpha.id).weeks[0].result).toBe('W');
  });

  it.each([null, undefined, NaN, Infinity, '80'])('does not manufacture a score or result from %s', value => {
    const incomplete = rows();
    incomplete[1].points = value as number;
    expect(selectMyTeamSchedule(data([incomplete]), alpha.id).weeks[0]).toMatchObject({ opponentPoints: null, result: null });
  });

  it('withholds current/future W-L even when the official feed has numeric totals', () => {
    const schedule = selectMyTeamSchedule(data([rows(), rows(), rows()]), alpha.id);
    expect(schedule.weeks[1]).toMatchObject({ status: 'unknown', result: null });
    expect(schedule.weeks[2]).toMatchObject({ status: 'upcoming', result: null });
  });

  it('can show the completed active week before the display rolls over when independently proven', () => {
    expect(selectMyTeamSchedule(data([rows(), rows()], [1, 2]), alpha.id).weeks[1])
      .toMatchObject({ status: 'final', result: 'W' });
  });

  it.each(['missing-week', 'missing-side', 'null-pairing', 'duplicate-roster', 'three-sides', 'unknown-opponent'])
    ('keeps %s unavailable without affecting another known matchup or week', kind => {
      const invalid = rows();
      if (kind === 'missing-side') invalid.pop();
      if (kind === 'null-pairing') invalid[0].matchup_id = null;
      if (kind === 'duplicate-roster') invalid.push({ ...invalid[0], matchup_id: 2 });
      if (kind === 'three-sides') invalid.push({ roster_id: 3, matchup_id: 1, points: 9 });
      if (kind === 'unknown-opponent') invalid[1].roster_id = 999;
      const schedule = selectMyTeamSchedule(data([kind === 'missing-week' ? null : invalid, rows()], [1, 2]), alpha.id);
      expect(schedule.weeks[0]).toMatchObject({ opponent: null, points: null, opponentPoints: null, result: null });
      expect(schedule.weeks[1]).toMatchObject({ opponent: bravo, result: 'W' });
    });

  it('isolates an invalid pair instead of hiding the rest of the league', () => {
    const source = data([[...rows(), { roster_id: 3, matchup_id: 2, points: 5 },
      { roster_id: 4, matchup_id: 2, points: 3 }, { roster_id: 1, matchup_id: 3, points: 20 }]]);
    expect(selectMyTeamSchedule(source, alpha.id).weeks[0].opponent).toBeNull();
    expect(selectMyTeamSchedule(source, charlie.id).weeks[0]).toMatchObject({ opponent: delta, result: 'W' });
  });

  it('returns no substitute team when the league has no teams', () => {
    expect(selectMyTeamSchedule({ ...data([]), teams: [] }, null)).toMatchObject({ team: null });
  });
});

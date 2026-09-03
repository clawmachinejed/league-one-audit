import type { MatchupPeriodContext } from '../lib/matchup-period';
import { matchupPeriodHeaders } from '../lib/matchup-period';
import { SNAPSHOT_REVISION_HEADER, SNAPSHOT_VERIFIED_AT_HEADER } from '../lib/matchup-snapshot-metadata';
import type { MatchupsData } from '../lib/types';

export const SNAPSHOT_A = 'a'.repeat(64);
export const SNAPSHOT_B = 'b'.repeat(64);
export const SNAPSHOT_C = 'c'.repeat(64);
export const SNAPSHOT_TIME = '2026-09-03T12:00:00.000Z';
export const NEXT_SNAPSHOT_TIME = '2026-09-03T12:01:00.000Z';
export function snapshotFixture(week = 5, name = 'Fixture Alpha'): MatchupsData {
  const teams = ['Fixture Alpha', 'Fixture Beta'].map((teamName, index) => ({ id: index + 1,
    name: index === 0 ? name : teamName, managerName: `Fixture Manager ${index + 1}`, avatar: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
  return { league: { season: '2026', week, maxWeek: 18, rosterPositions: ['QB'] }, teams,
    week, updatedAt: SNAPSHOT_TIME, matchups: [{ id: 'fixture-matchup', status: 'upcoming',
      sides: teams.map((team, index) => ({ team, points: 0, projectedPoints: 20 + index,
        starters: [{ id: `fixture-player-${index}`, name: `Fixture Player ${index + 1}`, position: 'QB',
          nflTeam: 'LAC', injuryStatus: null, game: null, slot: 'QB', points: 0, projectedPoints: 20 + index }] })) }] };
}
export function contextFixture(temporalState: MatchupPeriodContext['temporalState'] = 'future', week = 5): MatchupPeriodContext {
  return { defaultSeason: 2026, defaultWeek: temporalState === 'past' ? week + 1 : temporalState === 'active' ? week : 1,
    activeSeason: 2026, activeWeek: temporalState === 'past' ? week + 1 : temporalState === 'active' ? week : 1,
    lifecycle: 'active', nflPhase: 'regular', temporalState, refreshDue: false };
}
export function snapshotHeaders(revision = SNAPSHOT_A, verifiedAt = SNAPSHOT_TIME, context = contextFixture()): Headers {
  const headers = matchupPeriodHeaders(context);
  headers.set(SNAPSHOT_REVISION_HEADER, revision);
  headers.set(SNAPSHOT_VERIFIED_AT_HEADER, verifiedAt);
  return headers;
}

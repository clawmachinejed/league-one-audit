import { describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import { projectExactMatchups } from './exact-matchups';

const scope = { leagueKey: 'league1', provider: 'sleeper' as const, externalLeagueId: 'source-2026', season: 2026 };
const identities = [1, 2, 3].map(number => ({ externalRosterId: String(number), seasonTeamId: `season-team-${number}` }));
function capture(payload: unknown, week = 3, externalLeagueId = scope.externalLeagueId) {
  const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: { ...scope, externalLeagueId },
    family: 'matchups', week, completeness: 'complete', payload: payload as JsonValue,
    provenance: { origin: 'network', requestStartedAt: '2026-09-29T12:00:00.000Z',
      requestCompletedAt: '2026-09-29T12:00:01.000Z', sourceObservedAt: '2026-09-29T12:00:01.000Z',
      checkedAt: '2026-09-29T12:00:02.000Z' } };
  return normalizeAdministrationObservation(envelope);
}
const source = [
  { roster_id: 1, matchup_id: 8, players: ['a', 'b'], starters: ['a', '0'],
    starters_points: [0, null], players_points: { a: 13.25, b: -2.5 }, points: 10.75, custom_points: 0 },
  { roster_id: 2, matchup_id: 8, players: ['c'], starters: ['c'],
    starters_points: [7.5], players_points: { c: 9 }, points: 7.5 },
  { roster_id: 3, matchup_id: null, players: [], starters: [], points: null },
];

describe('same-capture exact matchup projection', () => {
  it('preserves official custom zero, starter-index priority, a known empty slot and an unpaired team', () => {
    const normalized = capture(source);
    const legacy = JSON.stringify(normalized.value);
    const projected = projectExactMatchups(normalized, identities,
      { nativePeriodWeek: 3, nativeRosterPositions: ['QB', 'RB', 'BN'], evidenceRef: 'same-capture-config' });
    expect(JSON.stringify(normalized.value)).toBe(legacy);
    expect(projected.teams[0]).toMatchObject({ seasonTeamId: 'season-team-1',
      officialTeamPoints: { raw: '10.75', custom: '0', effective: '0', adjustment: 'custom-override', adjustmentReason: null },
      starters: [{ playerExternalId: 'a', officialPoints: '0', pointSource: 'starter-index' },
        { playerExternalId: null, empty: true, officialPoints: null }],
      bench: [{ playerExternalId: 'b', officialPoints: '-2.5' }] });
    expect(projected.teams[1].starters?.[0].officialPoints).toBe('7.5');
    expect(projected.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ format: 'paired', participantTeamIds: ['season-team-1', 'season-team-2'] }),
      expect.objectContaining({ format: 'unpaired', participantTeamIds: ['season-team-3'] }),
    ]));
    expect(projected.period).toMatchObject({ nativeWeek: 3, nflWeekMappings: [] });
    expect(projected.state).toMatchObject({ provider: 'unknown', local: 'unknown' });
  });

  it('keeps missing lineup, missing membership, empty bench and unknown historical reserve groups distinct', () => {
    const cases = [
      { roster_id: 1, matchup_id: 1, players: ['a'], starters: null, points: 0 },
      { roster_id: 2, matchup_id: 1, players: null, starters: ['c'], points: null },
      { roster_id: 3, matchup_id: null, players: [], starters: [], points: 0 },
    ];
    const result = projectExactMatchups(capture(cases), identities,
      { nativePeriodWeek: 3, nativeRosterPositions: ['BN'], evidenceRef: 'proved-empty-lineup-config' });
    expect(result.teams[0]).toMatchObject({ starters: null, bench: null, coverage: { status: 'partial' } });
    expect(result.teams[1]).toMatchObject({ players: null, bench: null, coverage: { status: 'partial' } });
    expect(result.teams[2]).toMatchObject({ players: [], starters: [], bench: [], coverage: { status: 'complete' } });
    expect(result.teams.every(team => team.reserveAndTaxi.state === 'unknown')).toBe(true);
  });

  it('separates identical native matchup IDs across weeks and refuses foreign or incomplete team mappings', () => {
    const first = projectExactMatchups(capture(source, 3), identities);
    const second = projectExactMatchups(capture(source, 4), identities);
    expect(first.groups[0].identity).not.toBe(second.groups[0].identity);
    const otherLeague = projectExactMatchups(capture(source, 3, 'other-league'), identities);
    expect(first.groups[0].identity).not.toBe(otherLeague.groups[0].identity);
    expect(() => projectExactMatchups(capture(source), identities.slice(0, 2))).toThrow('population');
    expect(() => projectExactMatchups(capture(source), [...identities.slice(0, 2),
      { externalRosterId: '4', seasonTeamId: 'foreign' }])).toThrow('Unmapped');
  });

  it('limits an unsupported multi-participant grouping and refuses contradictory starter score evidence', () => {
    const allTogether = source.map(item => ({ ...item, matchup_id: 8 }));
    expect(projectExactMatchups(capture(allTogether), identities).groups[0]).toMatchObject({
      format: 'multiple-participants', resultSupport: 'limited', participantTeamIds: ['season-team-1', 'season-team-2', 'season-team-3'],
    });
    const malformed = capture([{ ...source[0], starters_points: [] }, source[1], source[2]]);
    expect(malformed.status).toBe('rejected');
    expect(() => projectExactMatchups(malformed, identities)).toThrow('Complete exact matchup capture required');
  });

  it('keeps an unproved short lineup from claiming bench coverage or slot labels', () => {
    const projected = projectExactMatchups(capture(source), identities);
    expect(projected.teams[0].bench).toBeNull();
    expect(projected.teams[0].starters?.[0].nativeSlot).toBeNull();
    expect(projected.teams[0].coverage).toMatchObject({ status: 'partial', reasons: ['slot_definition_unproved'] });
    expect(projected.lineupDefinitionRef).toBeNull();
  });

  it('expands parsed exponent scores into decimal text without implying lost source scale', () => {
    const numeric = [{ ...source[0], points: 1e-7, custom_points: null }, source[1], source[2]];
    const projected = projectExactMatchups(capture(numeric), identities);
    expect(projected.teams[0].officialTeamPoints).toMatchObject({ raw: '0.0000001', effective: '0.0000001' });
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { JsonValue } from '../league-administration/contracts';
import { canonicalStoredOfficialDecimal, projectExactMatchupValues } from './exact-matchup-values';
import { projectExactMatchups } from './exact-matchups';

function capture(payload: unknown, week = 15) {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: { leagueKey: 'cp10', provider: 'sleeper', externalLeagueId: '9007199254740993001', season: 2026 },
    family: 'matchups', week, completeness: 'complete', payload: payload as JsonValue,
    provenance: { origin: 'network', requestStartedAt: '2026-10-10T10:00:00Z', requestCompletedAt: '2026-10-10T10:00:01Z',
      sourceObservedAt: '2026-10-10T10:00:01Z', checkedAt: '2026-10-10T10:00:02Z' } });
}
const identities = [1, 2, 3].map(number => ({ externalRosterId: String(number), seasonTeamId: `team-${number}` }));

describe('exact native matchup values', () => {
  it('distinguishes missing, explicit null and empty containers while leaving v1 unchanged', () => {
    const normalized = capture([{ roster_id: 1 }, { roster_id: 2, matchup_id: null, players: null, starters: null,
      points: null, custom_points: null, starters_points: null, players_points: null },
    { roster_id: 3, players: [], starters: [], starters_points: [], players_points: {}, points: 0 }]);
    const before = JSON.stringify(normalized), legacy = projectExactMatchups(normalized, identities);
    const value = projectExactMatchupValues(normalized, identities);
    expect(value.teams[0]).toMatchObject({ nativeMatchupId: { state: 'missing' }, players: { state: 'missing' },
      starters: { state: 'missing' }, rawPoints: { state: 'missing' }, customPoints: { state: 'missing' },
      starterPoints: { state: 'missing' }, playerPoints: { state: 'missing' }, effectivePoints: { value: null, source: 'unavailable' } });
    expect(value.teams[1]).toMatchObject({ nativeMatchupId: { state: 'null' }, players: { state: 'null' }, starters: { state: 'null' },
      rawPoints: { state: 'null' }, customPoints: { state: 'null' }, starterPoints: { state: 'null' }, playerPoints: { state: 'null' } });
    expect(value.teams[2]).toMatchObject({ players: { state: 'supplied', value: [] }, starters: { state: 'supplied', value: [] },
      starterPoints: { state: 'supplied', value: [] }, playerPoints: { state: 'supplied', value: {} },
      rawPoints: { state: 'supplied', value: '0' }, effectivePoints: { value: '0', source: 'raw' } });
    expect(JSON.stringify(normalized)).toBe(before);
    expect(projectExactMatchups(normalized, identities)).toEqual(legacy);
  });

  it('retains native starter scores at vacant slots, unrelated map entries and original source/player order', () => {
    const value = projectExactMatchupValues(capture([{ roster_id: 2, matchup_id: 7, players: ['00001', 'NE', 'b'],
      starters: ['NE', '0', '0'], starters_points: [null, 3.125, 0],
      players_points: { NE: 12, '00001': 0, b: null, not_on_roster: -0.0000001 }, points: 19.123456789012344, custom_points: 0 },
    { roster_id: 1, matchup_id: 7, points: 0 }, { roster_id: 3, matchup_id: null }]), identities);
    expect(value.teams.map(team => [team.externalRosterId, team.sourceOrdinal])).toEqual([['2', 0], ['1', 1], ['3', 2]]);
    expect(value.teams[0]).toMatchObject({ nativeMatchupId: { state: 'supplied', value: '7' },
      players: { state: 'supplied', value: ['00001', 'NE', 'b'] }, starters: { state: 'supplied', value: ['NE', '0', '0'] },
      starterPoints: { state: 'supplied', value: [null, '3.125', '0'] },
      playerPoints: { state: 'supplied', value: { NE: '12', '00001': '0', b: null, not_on_roster: '-0.0000001' } },
      rawPoints: { state: 'supplied', value: '19.123456789012344' }, effectivePoints: { value: '0', source: 'custom-override' } });
    expect(value.teams[2].nativeMatchupId).toEqual({ state: 'null' });
  });

  it('keeps each native multiweek leg separate and never infers a winner or finality from tied scores', () => {
    const source = [{ roster_id: 1, matchup_id: 4, points: 0 }, { roster_id: 2, matchup_id: 4, points: 0 }, { roster_id: 3, matchup_id: null, points: 0 }];
    const first = projectExactMatchupValues(capture(source, 15), identities), next = projectExactMatchupValues(capture(source, 16), identities);
    expect(first.nativeWeek).toBe(15); expect(next.nativeWeek).toBe(16);
    expect(first.teams).toEqual(next.teams);
    expect(first).not.toHaveProperty('winner'); expect(first).not.toHaveProperty('finality');
  });

  it('preserves C1 characters in native IDs allowed by the unchanged source contract', () => {
    const player = `native\u0085\u009fID`;
    const value = projectExactMatchupValues(capture([{ roster_id: 1, players: [player], starters: [player], players_points: { [player]: 0 } }]), identities.slice(0, 1));
    expect(value.teams[0].players).toEqual({ state: 'supplied', value: [player] });
    expect(value.teams[0].playerPoints).toEqual({ state: 'supplied', value: { [player]: '0' } });
  });

  it.each(['\u00a0id', 'id\u00a0', '\ufeffid', 'id\ufeff'])('rejects native boundary whitespace without rewriting %s', player => {
    const normalized = capture([{ roster_id: 1, players: [player], starters: [player], players_points: { [player]: 0 } }]);
    expect(normalized.status).toBe('rejected');
    expect(() => projectExactMatchupValues(normalized, identities.slice(0, 1))).toThrow();
  });

  it('preserves interior Unicode whitespace as part of native player identity', () => {
    const player = 'native\u00a0\ufeffID';
    expect(projectExactMatchupValues(capture([{ roster_id: 1, players: [player], players_points: { [player]: 0 } }]), identities.slice(0, 1))
      .teams[0].players).toEqual({ state: 'supplied', value: [player] });
  });

  it.each([{ points: '0' }, { custom_points: false }, { starters_points: ['0'] }, { players_points: { a: '1' } },
    { players: [42] }, { starters: ['a', 'a'] }, { roster_id: 9007199254740992 }, { matchup_id: 9007199254740992 }])(
    'rejects invalid native capture without replacing it with null: %j', change => {
      const normalized = capture([{ roster_id: 1, ...change }]);
      expect(normalized.status).toBe('rejected');
      expect(() => projectExactMatchupValues(normalized, identities.slice(0, 1))).toThrow();
    });

  it.each([[0, '0'], [-0, '0'], [1e-7, '0.0000001'], [-1e21, '-1000000000000000000000'],
    [Number.MIN_VALUE, `0.${'0'.repeat(323)}5`], [1.2345678901234567, '1.2345678901234567']])(
    'keeps parsed-number magnitude %s as exact decimal text', (points, expected) => {
      const team = projectExactMatchupValues(capture([{ roster_id: 1, points }]), identities.slice(0, 1)).teams[0];
      expect(team.rawPoints).toEqual({ state: 'supplied', value: expected });
    });

  it.each([['000.000', '0'], ['-0.00', '0'], ['12345678901234567890123456789.12000', '12345678901234567890123456789.12'],
    ['-0000.0000000000000000000100', '-0.00000000000000000001']])('normalizes SQL scale losslessly: %s', (value, expected) => {
    expect(canonicalStoredOfficialDecimal(value)).toBe(expected);
  });
  it.each([0, null, '', 'NaN', 'Infinity', '1e-7', ' 1 ', '1.'])('rejects nondecimal stored text %s', value => {
    expect(() => canonicalStoredOfficialDecimal(value)).toThrow();
  });
});

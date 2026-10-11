import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import retained from '../../test-support/fixtures/all-player-foundation/runtime-source-supplement.json';
import { OFFICIAL_STANDINGS_BYTE_LIMIT, OFFICIAL_STANDINGS_TEAM_LIMIT, OFFICIAL_STANDINGS_VERSION,
  projectOfficialStandings } from './official-standings';

function capture(payload: JsonValue, externalLeagueId = '987654321098765432') {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: { provider: 'sleeper', leagueKey: 'unrelated-2026', externalLeagueId, season: 2026 },
    family: 'rosters', week: null, completeness: 'complete', payload,
    provenance: { origin: 'network', requestStartedAt: '2026-10-11T10:00:00Z', requestCompletedAt: '2026-10-11T10:00:01Z',
      sourceObservedAt: '2026-10-11T10:00:01Z', checkedAt: '2026-10-11T10:00:02Z' } });
}
const settings = { wins: 3, losses: 1, ties: 0, fpts: 123.456, fpts_decimal: 0.1,
  fpts_against: -20, fpts_against_decimal: 25, rank: 2, seed: 1 };

describe('independent native standings fields', () => {
  it('qualifies exact supplied facts despite unrelated malformed players, ownership and display fields', () => {
    const source = capture([{ roster_id: 7, players: 'invalid', owner_id: {}, co_owners: false, metadata: null, settings }]);
    expect(source.status).toBe('rejected');
    const before = JSON.stringify(source), result = projectOfficialStandings(source);
    expect(result).toMatchObject({ version: OFFICIAL_STANDINGS_VERSION, status: 'qualified', reasons: [], teams: [{
      externalRosterId: '7', sourceOrdinal: 0, record: { wins: { state: 'known', value: 3 }, ties: { state: 'known', value: 0 } },
      pointsFor: { state: 'known', value: '123.457', whole: { value: 123.456 }, fraction: { value: 0.1 } },
      pointsAgainst: { value: '-19.75' }, providerRank: { value: 2 }, providerSeed: { value: 1 },
    }] });
    expect(result.teams[0]).not.toHaveProperty('seasonTeamId');
    expect(result.teams[0]).not.toHaveProperty('players');
    expect(result).not.toHaveProperty('entitySet');
    expect(JSON.stringify(source)).toBe(before);
  });

  it('retains independently invalid, absent, null and zero facts without synthesizing defaults', () => {
    const result = projectOfficialStandings(capture([{ roster_id: 1, settings: { wins: null, losses: -1, ties: 0,
      fpts: 0, fpts_decimal: 0, fpts_against: 1, fpts_against_decimal: null, rank: 0, seed: null } }]));
    expect(result.status).toBe('qualified');
    expect(result.teams[0]).toMatchObject({ record: {
      wins: { state: 'null', value: null, sourcePath: 'settings.wins' }, losses: { state: 'invalid', value: null },
      ties: { state: 'known', value: 0 }, }, pointsFor: { state: 'known', value: '0' },
    pointsAgainst: { state: 'null', value: null, whole: { value: 1 } },
    providerRank: { state: 'invalid', value: null }, providerSeed: { state: 'null', value: null } });
    const missing = projectOfficialStandings(capture([{ roster_id: 1 }])).teams[0];
    expect(missing.record.wins.state).toBe('absent');
    expect(missing.providerRank.state).toBe('absent');
    expect(missing.pointsFor).toMatchObject({ state: 'absent', value: null });
  });

  it.each([null, [], 'invalid'])('isolates malformed settings %j from a usable native team identity', settingsValue => {
    const result = projectOfficialStandings(capture([{ roster_id: 1, settings: settingsValue }]));
    expect(result.status).toBe('qualified');
    expect(result.teams[0].record.wins.state).toBe('invalid');
    expect(result.teams[0].pointsFor.state).toBe('invalid');
  });

  it('preserves source ordering, independent corrections and exact optional fractions', () => {
    const first = capture([{ roster_id: 2, settings: { fpts: 1e-7, fpts_decimal: 1e-7 } }, { roster_id: 1, settings: { fpts: -0 } }]);
    const result = projectOfficialStandings(first);
    expect(result.teams.map(team => [team.externalRosterId, team.sourceOrdinal, team.pointsFor.value]))
      .toEqual([['2', 0, '0.000000101'], ['1', 1, '0']]);
    expect(result.teams[1].pointsFor.fraction.state).toBe('absent');
    expect(projectOfficialStandings(capture([{ roster_id: 2, settings: { fpts_decimal: 25 } }])).teams[0].pointsFor)
      .toMatchObject({ state: 'absent', value: null });
    const correction = projectOfficialStandings(capture([{ roster_id: 2, settings: { wins: 2, losses: 2, fpts: -1.005 } }]));
    expect(correction.teams[0]).toMatchObject({ record: { wins: { value: 2 }, losses: { value: 2 } }, pointsFor: { value: '-1.005' } });
    expect(projectOfficialStandings(first)).toEqual(result);
  });

  it.each([null, {}, [null], [{ roster_id: 0 }], [{ roster_id: -1 }], [{ roster_id: 1.5 }],
    [{ roster_id: '1' }], [{ roster_id: Number.MAX_SAFE_INTEGER + 1 }], [{ roster_id: 1 }, { roster_id: 1 }],
    [{ roster_id: 1, league_id: null }], [{ roster_id: 1, league_id: 'foreign' }]])('rejects ambiguous roster identity %j', payload => {
    expect(projectOfficialStandings(capture(payload))).toEqual({ version: OFFICIAL_STANDINGS_VERSION,
      status: 'invalid', teams: [], reasons: ['invalid_roster_identity'] });
  });

  it('reports capacity without truncation and leaves empty entity-set interpretation to stored qualification', () => {
    const rows = Array.from({ length: OFFICIAL_STANDINGS_TEAM_LIMIT }, (_, index) => ({ roster_id: index + 1 }));
    expect(projectOfficialStandings(capture(rows)).teams).toHaveLength(20);
    expect(projectOfficialStandings(capture([...rows, { roster_id: 21 }]))).toEqual({ version: OFFICIAL_STANDINGS_VERSION,
      status: 'capacity', teams: [], reasons: ['standings_team_limit_exceeded'] });
    expect(projectOfficialStandings(capture([]))).toEqual({ version: OFFICIAL_STANDINGS_VERSION, status: 'qualified', teams: [], reasons: [] });
    const largeUnrelatedField = projectOfficialStandings(capture([{ roster_id: 1, metadata: { ignored: 'x'.repeat(OFFICIAL_STANDINGS_BYTE_LIMIT) } }]));
    expect(JSON.stringify(largeUnrelatedField).length).toBeLessThan(OFFICIAL_STANDINGS_BYTE_LIMIT);
    expect(largeUnrelatedField.status).toBe('qualified');
  });

  it.each(['league1', 'league2'] as const)('replays retained %s source zeros without upgrading absent PA, rank or seed', key => {
    // These settings came from the later, separately timed source supplement, not the original matchup capture.
    const payload = Object.entries(retained.leagues[key].rosters).map(([id, row]) => ({ roster_id: Number(id), ...row }));
    const result = projectOfficialStandings(capture(payload));
    expect(result.status).toBe('qualified');
    expect(result.teams).toHaveLength(12);
    for (const team of result.teams) {
      expect(team.record).toMatchObject({ wins: { state: 'known', value: 0 }, losses: { state: 'known', value: 0 }, ties: { state: 'known', value: 0 } });
      expect(team.pointsFor).toMatchObject({ state: 'known', value: '0' });
      expect(team.pointsAgainst.state).toBe('absent');
      expect(team.providerRank.state).toBe('absent');
      expect(team.providerSeed.state).toBe('absent');
    }
  });
});

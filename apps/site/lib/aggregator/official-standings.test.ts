import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import retained from '../../test-support/fixtures/all-player-foundation/runtime-source-supplement.json';
import liveSource from '../../test-support/fixtures/cp13-live-source-2026/source.json';
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

describe('retained October 12 public standings observations', () => {
  // Fixed independently inspected totals; native integer/hundredths components are checked separately below.
  const totals: Record<string, readonly (readonly [string, string])[]> = {
    league1: [['442.78', '442.84'], ['422.2', '458.52'], ['412.06', '437.04'], ['465.04', '413.6'],
      ['449.44', '445.22'], ['439.44', '390.76'], ['495.2', '470.74'], ['445.16', '418.98'],
      ['353.72', '465.78'], ['507.18', '498.54'], ['452.4', '440.8'], ['470.34', '472.14']],
    league2: [['453.84', '442.94'], ['519.6', '402.32'], ['445.36', '504.78'], ['481.5', '428.66'],
      ['446.56', '476.64'], ['365.86', '473.94'], ['426.52', '443.34'], ['439.22', '512.24'],
      ['431.38', '402.76'], ['409.28', '353.84'], ['419.76', '474.32'], ['438.78', '361.88']],
    dynasty: [['534.1', '511.38'], ['406.98', '413.68'], ['431.1', '433.26'], ['578.66', '491.22'],
      ['431.66', '547.58'], ['419.02', '429.78'], ['478', '464.92'], ['520.54', '459.02'],
      ['456.44', '332.18'], ['302.86', '476.34']],
    'keeper-sample': [['499.45', '565'], ['463.3', '516.2'], ['587.99', '461.75'], ['408.55', '491.4'],
      ['587.4', '545.25'], ['506.15', '533'], ['534.1', '464.8'], ['461.5', '529.1'],
      ['506.65', '524.9'], ['461.5', '488.9'], ['583.55', '492.75'], ['498.15', '485.25']],
    'redraft-sample': [['449.02', '494'], ['546.54', '473.94'], ['499.96', '523.7'], ['617.7', '472.14'],
      ['555.5', '489.16'], ['510.16', '541.68'], ['526.04', '522.3'], ['533.34', '519.4'],
      ['336.24', '574.99'], ['599.38', '471.78'], ['444.02', '518.86'], ['549.06', '564.99']],
  };

  it('preserves all source slice identities, original clocks and the stopped-attempt request count', () => {
    expect(liveSource.acquisition.manifestSha256).toBe('85ab60e5e4e5e785342122d6147520d14aac21859d1b6b5bea3391988818155a');
    expect(liveSource.acquisition).toMatchObject({ priorNetworkRequests: 1, resumedNetworkRequests: 24, totalNetworkRequests: 25,
      stoppedAttempt: { outcome: 'stopped', failure: { name: 'AssertionError', message: 'Current native leg unproved' } } });
    let documents = 0;
    for (const sample of liveSource.samples) {
      expect(sample.resources.league.document.payload).toMatchObject({ league_id: sample.externalLeagueId, sport: 'nfl',
        season: '2026', settings: { leg: sample.selectedNativeWeek } });
      for (const [family, resource] of Object.entries(sample.resources)) {
        const document = resource.document;
        const suffix = family === 'league' ? '' : `/${family}${document.week === null ? '' : `/${document.week}`}`;
        expect(resource.source.endpoint).toBe(`https://api.sleeper.app/v1/league/${sample.externalLeagueId}${suffix}`);
        expect(resource.source.responseUrl).toBe(resource.source.endpoint);
        expect(resource.source.httpStatus).toBe(200);
        expect(resource.source.serializedDocumentSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(createHash('sha256').update(JSON.stringify(document)).digest('hex')).toBe(resource.sliceSha256);
        expect(document.origin).toBe('network');
        expect(document.sourceObservedAt).toBe(document.requestCompletedAt);
        expect(Date.parse(document.requestStartedAt)).toBeLessThanOrEqual(Date.parse(document.sourceObservedAt));
        documents += 1;
      }
    }
    expect(documents).toBe(25);
    expect(liveSource.samples[0].resources.league.source.newNetworkRequestInResumedAttempt).toBe(false);
    expect(liveSource.samples[0].resources.league.document.sourceObservedAt).toBe('2026-10-12T15:36:56.262Z');
  });

  it.each(liveSource.samples)('preserves every native count and PF/PA component for $key without supplied rank or seed', sample => {
    const document = sample.resources.rosters.document;
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: { provider: 'sleeper', leagueKey: sample.key, externalLeagueId: sample.externalLeagueId, season: 2026 },
      family: 'rosters', week: null, completeness: 'complete', payload: document.payload,
      provenance: { origin: 'network', requestStartedAt: document.requestStartedAt,
        requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt,
        checkedAt: document.requestCompletedAt } });
    const result = projectOfficialStandings(normalized);
    expect(result.status).toBe('qualified');
    expect(result.reasons).toEqual([]);
    expect(result.teams).toHaveLength(sample.resources.league.document.payload.total_rosters);
    expect(result.teams).toHaveLength(totals[sample.key].length);
    for (const [index, native] of document.payload.entries()) {
      const team = result.teams[index];
      expect(native.league_id).toBe(sample.externalLeagueId);
      expect(Object.keys(native)).toEqual(['league_id', 'roster_id', 'settings']);
      expect(team.externalRosterId).toBe(String(native.roster_id));
      expect(team.sourceOrdinal).toBe(index);
      for (const field of ['wins', 'losses', 'ties'] as const) {
        expect(team.record[field]).toEqual({ state: 'known', value: native.settings[field], sourcePath: `settings.${field}` });
      }
      for (const [field, whole, fraction, total] of [
        ['pointsFor', 'fpts', 'fpts_decimal', totals[sample.key][index][0]],
        ['pointsAgainst', 'fpts_against', 'fpts_against_decimal', totals[sample.key][index][1]],
      ] as const) {
        expect(team[field]).toEqual({ state: 'known', value: total, policy: 'sleeper-whole-plus-hundredths-v1',
          whole: { state: 'known', value: native.settings[whole], sourcePath: `settings.${whole}` },
          fraction: { state: 'known', value: native.settings[fraction], sourcePath: `settings.${fraction}` } });
        expect(native.settings[whole]).toBeGreaterThan(0);
      }
      expect(Object.hasOwn(native.settings, 'rank')).toBe(false);
      expect(Object.hasOwn(native.settings, 'seed')).toBe(false);
      expect(team.providerRank).toEqual({ state: 'absent', value: null, sourcePath: 'settings.rank' });
      expect(team.providerSeed).toEqual({ state: 'absent', value: null, sourcePath: 'settings.seed' });
      expect(team).not.toHaveProperty('seasonTeamId');
    }
    expect(result).not.toHaveProperty('entitySet');
    expect(result).not.toHaveProperty('finality');
  });

  it('retains two positive season tie counts among 58 rosters without assigning them to a matchup', () => {
    const native = liveSource.samples.flatMap(sample => sample.resources.rosters.document.payload.map(row => ({
      key: sample.key, rosterId: row.roster_id, ties: row.settings.ties } )));
    expect(native).toHaveLength(58);
    expect(native.filter(row => row.ties > 0)).toEqual([
      { key: 'keeper-sample', rosterId: 10, ties: 1 }, { key: 'keeper-sample', rosterId: 12, ties: 1 },
    ]);
  });
});

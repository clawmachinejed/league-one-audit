import { describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationEnvelope, JsonObject, JsonValue } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from './current-roster';
import { normalizeTeams } from '../transform';
import { projectSeasonOverviewSource, type SeasonOverviewSourceInput } from './season-overview-source';

const id = (prefix: string) => `${prefix}0000000-0000-4000-8000-000000000001`;
type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const mapping: AdministrationSourceMapping = {
  connectionId: id('1'), leagueSeasonId: id('2'), revisionId: id('3'), generation: 3,
  scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'source', season: 2026 },
};
const provenance: AdministrationEnvelope['provenance'] = { origin: 'network',
  requestStartedAt: '2026-09-25T12:00:00.000Z', requestCompletedAt: '2026-09-25T12:00:01.000Z',
  sourceObservedAt: '2026-09-25T12:00:01.000Z', checkedAt: '2026-09-25T12:00:02.000Z' };
const settings: JsonObject = { wins: 3, losses: 1, ties: 0, fpts: 123.456, fpts_decimal: 0.1,
  fpts_against: -20, fpts_against_decimal: 25, rank: 2, seed: 1, division: 0, waiver_position: 7, waiver_budget_used: -10 };
const roster: JsonObject = { roster_id: 7, players: ['p1'], owner_id: 'owner', co_owners: ['co'],
  metadata: { team_name: 'Current name', avatar: 'avatar' }, settings };
function input(raw: JsonValue = [roster]): SeasonOverviewSourceInput {
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
    family: 'rosters', week: null, completeness: 'complete', provenance, payload: raw });
  return { normalized, mapping, accepted: { scope: currentRosterScope(mapping),
    canonicalNormalizerVersion: CURRENT_ROSTER_POLICY.canonicalNormalizerVersion, sourceMappingRevisionId: mapping.revisionId,
    contentId: id('4'), observationIds: [id('5')], validationVersion: CURRENT_ROSTER_POLICY.validationVersion,
    acceptedGeneration: 2, verifiedAt: provenance.sourceObservedAt, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' },
  receipt: { id: id('5'), attemptId: id('6'), ordinal: 3, provenance, configurationContentId: id('7'),
    expectedTeamCount: 1, legacyObservationId: id('8') }, seasonTeams: [{ externalRosterId: '7', seasonTeamId: id('9') }] };
}
function available(source = input()) {
  const result = projectSeasonOverviewSource(source);
  if (result.status !== 'available') throw new Error('Expected source projection.');
  return result;
}
function withSettings(value: JsonValue) { return available(input([{ ...roster, settings: value }])); }

describe('optional exact season overview source facts', () => {
  it('preserves unrounded official components and native supplied rank independently of compatibility ordering', () => {
    const source = input(); const result = available(source); const team = result.teams[0];
    expect(team.record).toEqual({ wins: { state: 'known', value: 3, sourcePath: 'settings.wins' },
      losses: { state: 'known', value: 1, sourcePath: 'settings.losses' }, ties: { state: 'known', value: 0, sourcePath: 'settings.ties' } });
    expect(team.pointsFor).toEqual({ whole: { state: 'known', value: 123.456, sourcePath: 'settings.fpts' },
      fraction: { state: 'known', value: 0.1, sourcePath: 'settings.fpts_decimal' }, value: '123.457', state: 'known',
      policy: 'sleeper-whole-plus-hundredths-v1' });
    expect(team.pointsAgainst.value).toBe('-19.75');
    expect(team.providerRank).toMatchObject({ state: 'known', value: 2 });
    expect(team.providerSeed).toMatchObject({ state: 'known', value: 1 });
    expect(team.waiver).toMatchObject({ priority: { value: 7 }, budgetUsed: { value: -10 } });
    expect(normalizeTeams([...result.compatibility.sourceRosters], [])[0].pointsFor).toBe(123.46);
    expect(result.completeness).toBe('complete');
    expect(result.source.rawContentHash).toBe(source.normalized.contentHash);
    expect(result.source.provenance).toEqual(provenance);
    expect(result.mapping).toEqual(mapping);
  });

  it.each([
    [0, 0, '0'], [-0, 0, '0'], [0.1, 0.2, '0.102'], [-1.005, 0, '-1.005'],
    [1e-7, 1e-7, '0.000000101'], [1e21, 1, '1000000000000000000000.01'], [1, -100, '0'],
  ] as const)('uses exact parsed-decimal arithmetic for %s plus %s hundredths', (whole, fraction, expected) => {
    expect(withSettings({ ...settings, fpts: whole, fpts_decimal: fraction }).teams[0].pointsFor.value).toBe(expected);
  });

  it('retains missing records and PF/PA instead of compatibility zero defaults', () => {
    const result = available(input([{ roster_id: 7, players: [] }])); const team = result.teams[0];
    expect(team.record.wins).toEqual({ state: 'absent', value: null, sourcePath: 'settings.wins' });
    expect(team.pointsFor).toMatchObject({ state: 'absent', value: null, whole: { state: 'absent' }, fraction: { state: 'absent' } });
    expect(team.pointsAgainst.value).toBeNull();
    expect(team.providerRank).toMatchObject({ state: 'absent', value: null });
    expect(team.waiver.priority.value).toBeNull();
    expect(result.completeness).toBe('partial');
    expect(result.reasons).toEqual(['7:wins:absent', '7:losses:absent', '7:ties:absent', '7:pointsFor:absent', '7:pointsAgainst:absent']);
    expect(normalizeTeams([...result.compatibility.sourceRosters], [])[0].wins).toBe(0);
  });

  it('retains explicit null and invalid field states without rejecting unrelated valid facts', () => {
    const result = withSettings({ ...settings, wins: null, losses: -1, ties: 1.5, fpts_decimal: 'bad',
      rank: 0, seed: null, waiver_position: -2, waiver_budget_used: 0.1 }); const team = result.teams[0];
    expect(team.record).toMatchObject({ wins: { state: 'null', value: null }, losses: { state: 'invalid' }, ties: { state: 'invalid' } });
    expect(team.pointsFor).toMatchObject({ state: 'invalid', value: null, whole: { value: 123.456 } });
    expect(team.pointsAgainst.value).toBe('-19.75');
    expect(team.providerRank).toMatchObject({ state: 'invalid', value: null });
    expect(team.providerSeed).toMatchObject({ state: 'null' });
    expect(team.waiver).toMatchObject({ priority: { state: 'invalid' }, budgetUsed: { state: 'invalid' } });
    expect(team.display.name.value).toBe('Current name');
  });

  it.each([null, [], 'malformed'] as const)('isolates malformed settings %j to optional field coverage', value => {
    const result = withSettings(value); expect(result.completeness).toBe('partial');
    expect(result.teams[0].record.wins.state).toBe('invalid');
    expect(result.teams[0].display.name.value).toBe('Current name');
  });

  it('distinguishes an omitted optional fraction from explicit null and a missing whole', () => {
    expect(withSettings({ fpts: 120 }).teams[0].pointsFor).toMatchObject({ state: 'known', value: '120', fraction: { state: 'absent' } });
    expect(withSettings({ fpts: 120, fpts_decimal: null }).teams[0].pointsFor).toMatchObject({ state: 'null', value: null });
    expect(withSettings({ fpts_decimal: 25 }).teams[0].pointsFor).toMatchObject({ state: 'absent', value: null });
  });

  it('does not restamp a correction, mutate its input or refresh retained source age', () => {
    const original = input(); const before = JSON.stringify(original); const first = available(original);
    const corrected = available(input([{ ...roster, settings: { ...settings, fpts_decimal: 0.2, wins: 2, losses: 2 } }]));
    expect(corrected.source.rawContentHash).not.toBe(first.source.rawContentHash);
    expect(corrected.teams[0].pointsFor.value).toBe('123.458');
    expect(corrected.teams[0].record.wins.value).toBe(2);
    expect(corrected.source.provenance).toEqual(first.source.provenance);
    expect(available(JSON.parse(before))).toEqual(first);
    expect(JSON.stringify(original)).toBe(before);
    expect(first.freshness).toBe('unknown');
    expect(first.historicalApplicability).toBe('unverified');
    expect(first.compatibility.sourceRosters).not.toBe(original.normalized.envelope.payload);
    expect(Object.isFrozen(first.compatibility.sourceRosters[0])).toBe(true);
  });

  it.each(['mapping-revision', 'season', 'provider-league', 'receipt', 'population', 'team', 'duplicate-team',
    'hash', 'semantic-hash', 'normalized-value', 'partial', 'source-age', 'players-policy'] as const)(
    'rejects %s mismatches before exposing a joined source', mode => {
      const source = structuredClone(input()) as Mutable<SeasonOverviewSourceInput>;
      if (mode === 'mapping-revision') source.mapping.revisionId = id('a');
      if (mode === 'season') source.mapping.scope.season = 2025;
      if (mode === 'provider-league') source.mapping.scope.externalLeagueId = 'other';
      if (mode === 'receipt') source.accepted.observationIds[0] = id('a');
      if (mode === 'population') source.receipt.expectedTeamCount = 2;
      if (mode === 'team') source.seasonTeams[0].externalRosterId = '8';
      if (mode === 'duplicate-team') source.seasonTeams = [source.seasonTeams[0], source.seasonTeams[0]];
      if (mode === 'hash') source.normalized.contentHash = 'sha256:' + '0'.repeat(64);
      if (mode === 'semantic-hash') source.normalized.semanticHash = 'sha256:' + '0'.repeat(64);
      if (mode === 'normalized-value') source.normalized.value = { family: 'rosters', teams: [], memberships: [] };
      if (mode === 'partial') source.normalized.envelope.completeness = 'partial';
      if (mode === 'source-age') source.receipt.provenance.sourceObservedAt = '2026-09-29T12:00:01.000Z';
      if (mode === 'players-policy') source.accepted.canonicalNormalizerVersion = 'invented';
      expect(projectSeasonOverviewSource(source)).toEqual({ status: 'unavailable', reason: 'season_overview_source_invalid' });
    });
});

import { describe, expect, it, vi } from 'vitest';
import { readExactLineupApplicability, EXACT_LINEUP_APPLICABILITY_COLUMNS } from '../league-administration/neon/exact-lineup-applicability';
import { readAcceptedExactMatchupsRows } from '../league-administration/neon/exact-matchups';
import type { ExactPeriodMappingQualification } from './exact-matchups';
import { projectExactMatchupMetadata } from './exact-lineup-applicability';
import { lineupApplicabilityFixture } from './exact-lineup-applicability.fixtures';
import { b1CompatibilityFixture, b1Mapping, b1PlayerCatalog } from './b1-acceptance.fixtures';

vi.mock('server-only', () => ({}));

function fixture(week = 4) {
  const row = b1CompatibilityFixture(['1001', '1002']).accepted_rows[0];
  const evidence = lineupApplicabilityFixture(b1Mapping, row.configuration_payload, week);
  const period: ExactPeriodMappingQualification = { status: 'mapped', purpose: 'native-period-identity',
    evidenceRef: row.calendar_evidence.id, policyVersion: 'sleeper-native-week-to-nfl-regular-v1',
    scheduleRevision: 'schedule', evaluatedAt: '2026-09-29T12:00:00.000Z',
    retrievalStartedAt: '2026-09-29T12:00:00.000Z', retrievalCompletedAt: '2026-09-29T12:00:01.000Z',
    sourceObservedAt: null, season: 2026, seasonType: 'regular', week };
  return { row, evidence, period };
}

describe('exact historical roster configuration applicability', () => {
  it.each([1, 4, 18])('uses explicit Week %i applicability irrespective of current leg or capture proximity', week => {
    const { evidence, period } = fixture(week);
    const read = readExactLineupApplicability([evidence], b1Mapping, period);
    expect(read).toMatchObject({ status: 'available', activationRef: evidence.activation.id,
      period: { season: 2026, seasonType: 'regular', week }, startingSlots: ['QB', 'RB'],
      configurationVersionId: evidence.version.id, sourceMappingRevisionId: b1Mapping.revisionId,
      recordedAt: '2026-09-29T12:00:00.123456+00:00' });
  });

  it('keeps current leg, observed_current and numeric equality from proving applicability', () => {
    const { evidence, period } = fixture();
    expect(readExactLineupApplicability([], b1Mapping, period)).toEqual({ status: 'unavailable', reason: 'no_binding' });
    expect(readExactLineupApplicability([{ ...evidence, activation: { ...evidence.activation, applicability: 'observed_current' } }], b1Mapping, period))
      .toEqual({ status: 'unavailable', reason: 'no_binding' });
    expect(readExactLineupApplicability([evidence], b1Mapping, { status: 'unmapped', reason: 'calendar_evidence_missing' }))
      .toEqual({ status: 'unavailable', reason: 'period_mapping_unproved' });
  });

  it.each([
    ['league-season', (f: ReturnType<typeof fixture>) => ({ ...f.evidence, activation: { ...f.evidence.activation, league_season_id: 'foreign' } })],
    ['source mapping epoch', (f: ReturnType<typeof fixture>) => ({ ...f.evidence, source: { ...f.evidence.source,
      sourceMapping: { ...b1Mapping, generation: 3, revisionId: '11111111-2222-4333-8444-000000000009' } } })],
    ['external source', (f: ReturnType<typeof fixture>) => ({ ...f.evidence, source: { ...f.evidence.source, externalLeagueId: 'foreign' } })],
    ['component hash', (f: ReturnType<typeof fixture>) => ({ ...f.evidence, activation: { ...f.evidence.activation, component_hash: 'wrong' } })],
    ['configuration version', (f: ReturnType<typeof fixture>) => ({ ...f.evidence, source: { ...f.evidence.source, configurationVersionId: 'wrong' } })],
    ['version hash', (f: ReturnType<typeof fixture>) => ({ ...f.evidence, version: { ...f.evidence.version, semantic_hash: 'wrong' } })],
    ['missing mapping source', (f: ReturnType<typeof fixture>) => ({ ...f.evidence, source: null })],
    ['missing explicit evidence', (f: ReturnType<typeof fixture>) => ({ ...f.evidence, activation: { ...f.evidence.activation, evidence: '' } })],
    ['malformed timestamp', (f: ReturnType<typeof fixture>) => ({ ...f.evidence, activation: { ...f.evidence.activation, recorded_at: '2026-02-30T00:00:00Z' } })],
  ])('rejects %s while the accepted adapter leaves scores and starters available', (_label, mutate) => {
    const f = fixture();
    const read = readExactLineupApplicability([mutate(f)], b1Mapping, f.period);
    expect(read.status).toBe('unavailable');
    const accepted = readAcceptedExactMatchupsRows([{ ...f.row, lineup_applicability_evidence: [mutate(f)] }], b1Mapping, 4);
    if (accepted.status !== 'available') throw new Error('Optional applicability hid official facts.');
    expect(accepted.value.teams[0].officialTeamPoints.effective).toBe('0');
    expect(accepted.value.teams[0].starters?.map(slot => [slot.playerExternalId, slot.officialPoints])).toEqual([['1001', '8.25'], [null, null]]);
    expect(accepted.value.teams[0].starters?.[0].nativeSlot).toBeNull();
  });

  it('keeps different season types, ranges and rollover seasons separate', () => {
    const f = fixture();
    expect(readExactLineupApplicability([f.evidence], b1Mapping, { ...f.period, week: 3 }).status).toBe('unavailable');
    expect(readExactLineupApplicability([{ ...f.evidence, activation: { ...f.evidence.activation, season_type: 'post' } }], b1Mapping, f.period))
      .toEqual({ status: 'unavailable', reason: 'no_binding' });
    expect(readExactLineupApplicability([f.evidence], { ...b1Mapping, scope: { ...b1Mapping.scope, season: 2027 } }, f.period))
      .toEqual({ status: 'unavailable', reason: 'period_mapping_unproved' });
  });

  it('resolves explicit slot changes by component generation and refuses a forked generation', () => {
    const f = fixture();
    const later = lineupApplicabilityFixture(b1Mapping, { ...f.row.configuration_payload, roster_positions: ['QB', 'SUPER_FLEX', 'BN'] }, 4);
    later.activation.generation = 3;
    later.activation.id = '11111111-2222-4333-8444-000000000005';
    later.version.id = '11111111-2222-4333-8444-000000000006';
    later.activation.configuration_version_id = later.version.id; later.source.configurationVersionId = later.version.id;
    expect(readExactLineupApplicability([f.evidence, later], b1Mapping, f.period)).toMatchObject({ status: 'available', startingSlots: ['QB', 'SUPER_FLEX'] });
    expect(readExactLineupApplicability([f.evidence, f.evidence], b1Mapping, f.period))
      .toEqual({ status: 'unavailable', reason: 'inconsistent_binding' });
  });

  it('returns a missing slot definition independently of an evidenced component', () => {
    const f = fixture();
    const { roster_positions, ...withoutPositions } = f.row.configuration_payload;
    void roster_positions;
    expect(readExactLineupApplicability([lineupApplicabilityFixture(b1Mapping, withoutPositions, 4)], b1Mapping, f.period))
      .toEqual({ status: 'unavailable', reason: 'roster_positions_missing' });
  });

  it('allows a proven correction to supersede old unretained lineage without falling back from a new unproved correction', () => {
    const f = fixture();
    const older = { ...f.evidence, source: null, activation: { ...f.evidence.activation, generation: 1 } };
    expect(readExactLineupApplicability([older, f.evidence], b1Mapping, f.period)).toMatchObject({ status: 'available' });
    const newer = { ...older, activation: { ...older.activation, generation: 3 } };
    expect(readExactLineupApplicability([f.evidence, newer], b1Mapping, f.period))
      .toEqual({ status: 'unavailable', reason: 'invalid_applicability_evidence' });
  });

  it('queries the existing immutable activation/version and receipt lineage without reading configuration heads', () => {
    expect(EXACT_LINEUP_APPLICABILITY_COLUMNS).toContain("activation.applicability='evidenced_period'");
    expect(EXACT_LINEUP_APPLICABILITY_COLUMNS).toContain('source_receipt.configuration_content_id=configuration_source.id');
    expect(EXACT_LINEUP_APPLICABILITY_COLUMNS).not.toMatch(/league_configuration_heads|settings.*leg/);
  });
});

describe('dated display metadata on exact captured lineup identities', () => {
  it('keeps injury/date evidence current-display and includes starters absent from current held membership', () => {
    const f = fixture();
    const accepted = readAcceptedExactMatchupsRows([f.row], b1Mapping, 4);
    const result = projectExactMatchupMetadata(accepted, b1PlayerCatalog());
    expect(result.status).toBe('available');
    if (result.status !== 'available' || result.currentDisplay.status !== 'available') throw new Error('Missing metadata fixture.');
    expect(result.historicalPlayerState).toBe('unverified');
    expect(result.currentDisplay.temporalContext).toBe('current-display');
    expect(result.currentDisplay.players.map(player => player.sourceEntity.nativeId)).toEqual(['1001', '1002']);
    expect(result.currentDisplay.players[0]).toMatchObject({ injuryStatus: { value: 'Out' },
      sources: [{ observedAt: '2026-09-29T11:59:00.000Z' }], sourceEntity: { resourceKind: 'scoring-entity' } });
  });

  it('reports missing/partial catalog locally without replacing exact lineup facts or restamping mixed ages', () => {
    const f = fixture(); const accepted = readAcceptedExactMatchupsRows([f.row], b1Mapping, 4);
    expect(projectExactMatchupMetadata(accepted)).toMatchObject({ status: 'available', currentDisplay: { status: 'unavailable' } });
    const catalog = b1PlayerCatalog();
    const result = projectExactMatchupMetadata(accepted, { ...catalog, complete: false,
      catalog: { '1001': catalog.catalog['1001'] }, sourceSlices: [catalog.sourceSlices![0],
        { ...catalog.sourceSlices![0], scope: 'QB', observedAt: '2026-09-28T11:59:00.000Z', complete: false }] });
    if (result.status !== 'available' || result.currentDisplay.status !== 'available') throw new Error('Missing partial metadata.');
    expect(result.currentDisplay.players[0]).toMatchObject({ sourceAge: 'mixed', reasons: ['catalog_source_incomplete'] });
    expect(result.currentDisplay.players[1]).toMatchObject({ availability: 'missing', injuryStatus: { value: null, availability: 'missing' } });
    expect(projectExactMatchupMetadata({ status: 'missing' }, catalog)).toEqual({ status: 'unavailable', reason: 'official_matchup_unavailable' });
  });
});

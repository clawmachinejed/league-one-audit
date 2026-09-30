import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectRetainedMatchups } from './retained-matchups';
import { retainedMatchupFixture, retainedMatchupId, retainedMatchupSelection } from './retained-matchups.fixtures';
import type { RetainedMatchupEvidence, RetainedMatchupMappingCandidate } from '../league-administration/retained-matchups-contracts';
import type { JsonValue } from '../league-administration/contracts';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

const project = (evidence: RetainedMatchupEvidence) => projectRetainedMatchups(retainedMatchupSelection, evidence);
const capture = () => retainedMatchupFixture();
const changedContent = (patch: Partial<NonNullable<RetainedMatchupEvidence['content']>>) => {
  const evidence = capture(); return { ...evidence, content: { ...evidence.content!, ...patch } };
};
function mappingCandidate(kind: RetainedMatchupMappingCandidate['kind'] = 'matchup-receipt'): RetainedMatchupMappingCandidate {
  const evidence = retainedMatchupFixture({ capturedMapping: true });
  const revision = evidence.mapping!.revision!;
  return { kind, id: retainedMatchupId(kind === 'matchup-receipt' ? 40 : 41), observationId: evidence.observation.id,
    contentId: evidence.content!.id, family: 'matchups', nativePeriodId: 'sleeper:matchup-week:3', provenance: evidence.observation.provenance,
    revision, sourceMapping: { connectionId: revision.connectionId, leagueSeasonId: revision.leagueSeasonId,
      revisionId: revision.id, generation: revision.generation, scope: retainedMatchupSelection.scope } };
}
afterEach(() => vi.unstubAllGlobals());

describe('immutable retained matchup projection', () => {
  it('preserves identities, exact timestamp text, custom zero, ordered vacancies and all raw evidence without IO', () => {
    const fetch = vi.fn(() => { throw new Error('Provider request forbidden.'); });
    vi.stubGlobal('fetch', fetch);
    const evidence = capture(); const before = JSON.stringify(evidence);
    const result = project(evidence);
    expect(result).toMatchObject({ status: 'available', kind: 'legacy-retained-matchups',
      scope: { leagueSeasonId: retainedMatchupId(1), nativeWeek: 3 },
      lineage: { observationId: retainedMatchupId(2), contentId: retainedMatchupId(3), sourceMappingRevisionId: null },
      source: { checkedAt: '2026-09-29T12:00:02.000456Z', sourceObservedAt: '2026-09-29T12:00:01.000123Z',
        orderingAt: '2026-09-29T12:00:01.000123Z', recordedAt: '2026-09-29T12:00:03.000789Z', sourceUpdatedAt: null },
      value: { teams: [{ seasonTeamId: retainedMatchupId(100), nativeMatchupId: '8',
        officialTeamPoints: { raw: '10.75', custom: '0', effective: '0', adjustment: 'custom-override' },
        starters: [{ index: 0, playerExternalId: '001', officialPoints: '0', pointSource: 'starter-index', nativeSlot: null },
          { index: 1, playerExternalId: null, empty: true, officialPoints: null }], bench: null },
      { seasonTeamId: retainedMatchupId(101) }, { seasonTeamId: retainedMatchupId(102), players: [], starters: [], bench: [] }],
      groups: [{ format: 'paired', participantTeamIds: [retainedMatchupId(100), retainedMatchupId(101)] },
        { format: 'unpaired', participantTeamIds: [retainedMatchupId(102)] }] }, comparison: { status: 'equal' } });
    expect(result).not.toHaveProperty('accepted');
    expect(JSON.stringify(evidence)).toBe(before);
    expect(project(evidence)).toEqual(result);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('makes missing lineage, population, configuration, metadata, NFL mapping, finality and derived proof explicit', () => {
    const result = project(capture());
    expect(result).toMatchObject({ limitations: ['mapping_revision_not_captured', 'population_unproved',
      'configuration_applicability_unproved', 'player_metadata_unproved', 'nfl_period_mapping_unproved',
      'finality_unproved', 'derived_provenance_unproved', 'v2_acceptance_not_qualified'],
    value: { period: { nflWeekMappings: [] }, state: { provider: 'unknown', local: 'unknown' },
      lineupDefinitionRef: null, playerMetadataRef: null, gameStateRef: null, projectionRef: null } });
    const empty = project(retainedMatchupFixture({ payload: [] }));
    expect(empty).toMatchObject({ status: 'available', value: { teams: [], groups: [] },
      limitations: expect.arrayContaining(['population_unproved']) });
  });

  it('keeps null, missing and empty source fields separate without overlaying historical groups', () => {
    const evidence = retainedMatchupFixture({ payload: [
      { roster_id: 1, players: null, starters: null, points: null, players_points: null },
      { roster_id: 2, players: [], starters: [], points: 0, players_points: {} },
      { roster_id: 3, points: 1e-7 },
    ] });
    expect(project(evidence)).toMatchObject({ status: 'available', value: { teams: [
      { players: null, starters: null, officialPlayerPoints: null, officialTeamPoints: { raw: null, effective: null },
        reserveAndTaxi: { state: 'unknown' } },
      { players: [], starters: [], officialPlayerPoints: {}, officialTeamPoints: { raw: '0', effective: '0' } },
      { players: null, starters: null, officialTeamPoints: { raw: '0.0000001' } },
    ] } });
    expect(evidence.content!.payload).toEqual([
      { roster_id: 1, players: null, starters: null, points: null, players_points: null },
      { roster_id: 2, players: [], starters: [], points: 0, players_points: {} }, { roster_id: 3, points: 1e-7 },
    ]);
  });

  it('does not rewrite the original observation age after equal-content reacquisition or unknown cache age', () => {
    const original = capture();
    const later = { ...original, observation: { ...original.observation, id: retainedMatchupId(8), outcome: 'unchanged',
      orderingAt: '2026-09-29T13:00:01.000123Z', recordedAt: '2026-09-29T13:00:03.000789Z', provenance: {
        ...original.observation.provenance, requestStartedAt: '2026-09-29T13:00:00.000000Z',
        requestCompletedAt: '2026-09-29T13:00:01.000123Z', sourceObservedAt: '2026-09-29T13:00:01.000123Z',
        checkedAt: '2026-09-29T13:00:02.000456Z' } } };
    const a = project(original); const b = project(later);
    if (a.status !== 'available' || b.status !== 'available') throw new Error('Expected projections.');
    expect(a.value).toEqual(b.value);
    expect(a.lineage.contentId).toBe(b.lineage.contentId);
    expect(a.source.sourceObservedAt).toBe('2026-09-29T12:00:01.000123Z');
    expect(b.source.sourceObservedAt).toBe('2026-09-29T13:00:01.000123Z');
    expect(project(original)).toEqual(a);
    const cached = { ...original, observation: { ...original.observation,
      orderingAt: original.observation.provenance.checkedAt, provenance: { ...original.observation.provenance,
        origin: 'cache' as const, requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null } } };
    expect(project(cached)).toMatchObject({ status: 'available', source: { sourceObservedAt: null },
      limitations: expect.arrayContaining(['source_observation_age_unproved']) });
  });

  it('preserves score, participant-group and lineup corrections as separate content with stable team IDs', () => {
    const first = capture();
    const payload = (first.content!.payload as readonly Record<string, JsonValue>[])
      .map((row, index) => index === 0 ? { ...row, matchup_id: 9, custom_points: -3.75, starters: ['0', '001'], starters_points: [null, 8] } : row);
    const corrected = retainedMatchupFixture({ payload, observationNumber: 9, contentNumber: 10 });
    const a = project(first); const b = project(corrected);
    if (a.status !== 'available' || b.status !== 'available') throw new Error('Expected projections.');
    expect(b.value.teams[0]).toMatchObject({ seasonTeamId: a.value.teams[0].seasonTeamId, nativeMatchupId: '9',
      officialTeamPoints: { effective: '-3.75' }, starters: [{ empty: true }, { playerExternalId: '001', officialPoints: '8' }] });
    expect(a.lineage.rawContentHash).not.toBe(b.lineage.rawContentHash);
    expect(a.lineage.contentId).not.toBe(b.lineage.contentId);
    expect(a.value.groups[0].identity).not.toBe(b.value.groups[0].identity);
    expect(project(first)).toEqual(a);
  });

  it('retains the captured A-to-B-to-A revisions and never treats matching source text as current lineage', () => {
    const first = retainedMatchupFixture({ capturedMapping: true });
    const bSelection = { ...retainedMatchupSelection, scope: { ...retainedMatchupSelection.scope, externalLeagueId: 'source-B' } };
    const middle = retainedMatchupFixture({ selection: bSelection, capturedMapping: true, observationNumber: 11, contentNumber: 12 });
    const withRevision = (evidence: RetainedMatchupEvidence, number: number, generation: number): RetainedMatchupEvidence => ({
      ...evidence, mapping: { ...evidence.mapping!, revisionId: retainedMatchupId(number),
        revision: { ...evidence.mapping!.revision!, id: retainedMatchupId(number), generation } },
    });
    const secondA = withRevision(retainedMatchupFixture({ capturedMapping: true, observationNumber: 15 }), 16, 3);
    const a = project(first); const b = projectRetainedMatchups(bSelection, withRevision(middle, 14, 2)); const c = project(secondA);
    expect(a).toMatchObject({ status: 'available', lineage: { sourceMappingRevisionId: retainedMatchupId(4), mappingGeneration: 1 } });
    expect(b).toMatchObject({ status: 'available', lineage: { sourceMappingRevisionId: retainedMatchupId(14), mappingGeneration: 2 } });
    expect(c).toMatchObject({ status: 'available', lineage: { sourceMappingRevisionId: retainedMatchupId(16), mappingGeneration: 3 } });
    if (a.status !== 'available' || c.status !== 'available') throw new Error('Expected projections.');
    expect(a.value).toEqual(c.value); expect(a.lineage).not.toEqual(c.lineage); expect(project(first)).toEqual(a);
    expect(project(middle)).toEqual({ status: 'rejected', reason: 'retained_scope_mismatch' });
  });

  it.each([
    ['partial', { completeness: 'partial' }, 'complete_matchup_capture_required'],
    ['raw hash', { contentHash: 'f'.repeat(64) }, 'retained_raw_hash_mismatch'],
    ['semantic hash', { semanticHash: 'f'.repeat(64) }, 'retained_semantic_hash_mismatch'],
    ['normalized values', { normalizedValue: { family: 'matchups', matchups: [] } }, 'retained_legacy_value_mismatch'],
    ['unsupported normalizer', { normalizerVersion: 'future-version' }, 'retained_normalizer_unsupported'],
    ['rejected content', { accepted: false }, 'retained_observation_invalid'],
    ['wrong week', { week: 4 }, 'retained_scope_mismatch'],
    ['wrong season', { leagueSeasonId: retainedMatchupId(99) }, 'retained_scope_mismatch'],
    ['wrong provider', { provider: 'yahoo' }, 'retained_scope_mismatch'],
    ['wrong family', { family: 'rosters' }, 'retained_scope_mismatch'],
    ['wrong content', { id: retainedMatchupId(99) }, 'retained_content_link_invalid'],
  ])('rejects %s evidence with a stable reason', (_label, patch, reason) => {
    expect(project(changedContent(patch))).toEqual({ status: 'rejected', reason });
  });

  it('rejects corrupt raw evidence even after a hash is recomputed', () => {
    const payload = [{ roster_id: 1, players: ['a'], starters: ['a'], starters_points: [] }];
    expect(project(changedContent({ payload, contentHash: compatibleRevision(payload) })))
      .toEqual({ status: 'rejected', reason: 'retained_normalization_rejected' });
  });

  it.each(['duplicate-external', 'duplicate-internal', 'cross-season', 'wrong-source', 'wrong-provider',
    'wrong-content', 'wrong-team-id', 'missing-team', 'wrong-source-value', 'missing-link', 'extra-link'] as const)
  ('rejects %s team links', variant => {
    const evidence = capture(); const first = evidence.teamLinks[0];
    let teamLinks = [...evidence.teamLinks];
    if (variant === 'duplicate-external') teamLinks.push({ ...first, teamId: retainedMatchupId(120), team: { ...first.team!, id: retainedMatchupId(120) } });
    if (variant === 'duplicate-internal') teamLinks[1] = { ...teamLinks[1], teamId: first.teamId, team: { ...teamLinks[1].team!, id: first.teamId } };
    if (variant === 'cross-season') teamLinks[0] = { ...first, team: { ...first.team!, leagueSeasonId: retainedMatchupId(99) } };
    if (variant === 'wrong-source') teamLinks[0] = { ...first, team: { ...first.team!, externalLeagueId: 'wrong' } };
    if (variant === 'wrong-provider') teamLinks[0] = { ...first, team: { ...first.team!, provider: 'yahoo' } };
    if (variant === 'wrong-content') teamLinks[0] = { ...first, contentId: retainedMatchupId(99) };
    if (variant === 'wrong-team-id') teamLinks[0] = { ...first, teamId: retainedMatchupId(99) };
    if (variant === 'missing-team') teamLinks[0] = { ...first, team: null };
    if (variant === 'wrong-source-value') teamLinks[0] = { ...first, sourceValue: { ...first.sourceValue as object, customPoints: 1 } as JsonValue };
    if (variant === 'missing-link') teamLinks = teamLinks.slice(1);
    if (variant === 'extra-link') teamLinks.push({ ...first, teamId: retainedMatchupId(120),
      team: { ...first.team!, id: retainedMatchupId(120), externalRosterId: '4' } });
    const reason = variant.startsWith('duplicate') ? 'retained_team_link_conflict'
      : variant === 'wrong-source-value' ? 'retained_team_value_mismatch'
        : ['missing-link', 'extra-link'].includes(variant) ? 'retained_team_links_incomplete' : 'retained_team_link_invalid';
    expect(project({ ...evidence, teamLinks })).toEqual({ status: 'rejected', reason });
  });

  it.each(['missing-revision', 'wrong-observation', 'wrong-revision', 'wrong-connection', 'wrong-season',
    'wrong-source', 'wrong-provider', 'wrong-namespace', 'invalid-generation', 'cache-origin'] as const)
  ('rejects %s captured mapping and never downgrades it to unknown', variant => {
    const evidence = retainedMatchupFixture({ capturedMapping: true });
    let mapping = evidence.mapping!;
    if (variant === 'missing-revision') mapping = { ...mapping, revision: null };
    if (variant === 'wrong-observation') mapping = { ...mapping, observationId: retainedMatchupId(99) };
    if (variant === 'wrong-revision') mapping = { ...mapping, revisionId: retainedMatchupId(99) };
    const patch = variant === 'wrong-connection' ? { connectionId: 'bad' }
      : variant === 'wrong-season' ? { leagueSeasonId: retainedMatchupId(99) }
        : variant === 'wrong-source' ? { externalLeagueId: 'wrong' }
          : variant === 'wrong-provider' ? { provider: 'yahoo' }
            : variant === 'wrong-namespace' ? { sourceNamespace: 'nfl:2025' }
              : variant === 'invalid-generation' ? { generation: 0 } : {};
    if (mapping.revision) mapping = { ...mapping, revision: { ...mapping.revision, ...patch } };
    const observation = variant === 'cache-origin' ? { ...evidence.observation,
      provenance: { ...evidence.observation.provenance, origin: 'cache' as const } } : evidence.observation;
    expect(project({ ...evidence, observation, mapping })).toEqual({ status: 'rejected', reason: 'retained_mapping_lineage_invalid' });
  });

  it('rejects missing content and invalid original observation times, including microsecond ordering changes', () => {
    const evidence = capture();
    expect(project({ ...evidence, content: null })).toEqual({ status: 'rejected', reason: 'retained_content_missing' });
    for (const patch of [{ orderingAt: '2026-09-29T12:00:01.000124Z' }, { recordedAt: 'unknown' },
      { provenance: { ...evidence.observation.provenance, sourceObservedAt: null } }]) {
      expect(project({ ...evidence, observation: { ...evidence.observation, ...patch } }))
        .toEqual({ status: 'rejected', reason: 'retained_observation_time_invalid' });
    }
    expect(project({ ...evidence, observation: { ...evidence.observation, provenance: {
      ...evidence.observation.provenance, checkedAt: '2026-09-28T12:00:02.000000Z' } } }))
      .toEqual({ status: 'rejected', reason: 'retained_observation_time_invalid' });
    for (const patch of [{ requestStartedAt: '2026-09-29T12:00:01.000124Z' },
      { checkedAt: '2026-09-29T12:00:01.000122Z' }]) {
      expect(project({ ...evidence, observation: { ...evidence.observation, provenance: {
        ...evidence.observation.provenance, ...patch } } }))
        .toEqual({ status: 'rejected', reason: 'retained_observation_time_invalid' });
    }
  });

  it('makes link row order irrelevant while preserving provider lineup and group order', () => {
    const evidence = capture();
    expect(project({ ...evidence, teamLinks: [...evidence.teamLinks].reverse() })).toEqual(project(evidence));
  });

  it.each(['matchup-receipt', 'calculation-input'] as const)('uses %s mapping only with exact original observation provenance', kind => {
    const evidence = capture();
    const candidate = mappingCandidate(kind);
    expect(project({ ...evidence, mappingCandidates: [candidate] })).toMatchObject({ status: 'available',
      lineage: { sourceMappingRevisionId: retainedMatchupId(4), sourceConnectionId: retainedMatchupId(5), mappingGeneration: 1,
        mappingEvidence: [{ kind, id: candidate.id }] },
      limitations: expect.not.arrayContaining(['mapping_revision_not_captured']) });
    const datePrecision = { ...candidate, provenance: { ...candidate.provenance,
      requestStartedAt: '2026-09-29T12:00:00.000Z' } };
    expect(project({ ...evidence, mappingCandidates: [datePrecision] })).toEqual(project({ ...evidence, mappingCandidates: [candidate] }));
    const offset = { ...candidate, provenance: { ...candidate.provenance,
      requestStartedAt: '2026-09-29T08:00:00.000000-04:00', requestCompletedAt: '2026-09-29T08:00:01.000123-04:00',
      sourceObservedAt: '2026-09-29T08:00:01.000123-04:00', checkedAt: '2026-09-29T08:00:02.000456-04:00' } };
    expect(project({ ...evidence, mappingCandidates: [offset] })).toEqual(project({ ...evidence, mappingCandidates: [candidate] }));
    const laterReacquisition = { ...candidate, provenance: { ...candidate.provenance,
      sourceObservedAt: '2026-09-29T12:00:01.000124Z' } };
    expect(project({ ...evidence, mappingCandidates: [laterReacquisition] }))
      .toEqual({ status: 'rejected', reason: 'retained_mapping_lineage_invalid' });
    expect(project(evidence)).toMatchObject({ lineage: { sourceMappingRevisionId: null } });
  });

  it('compares all captured lineage candidates and rejects conflicts instead of selecting the newest A revision', () => {
    const evidence = capture();
    const candidates = [mappingCandidate(), mappingCandidate('calculation-input')];
    expect(project({ ...evidence, mappingCandidates: candidates }))
      .toEqual(project({ ...evidence, mappingCandidates: [...candidates].reverse() }));
    const returningA = { ...candidates[1], revision: { ...candidates[1].revision!, id: retainedMatchupId(16), generation: 3 },
      sourceMapping: { ...candidates[1].sourceMapping!, revisionId: retainedMatchupId(16), generation: 3 } };
    expect(project({ ...evidence, mappingCandidates: [candidates[0], returningA] }))
      .toEqual({ status: 'rejected', reason: 'retained_mapping_lineage_conflict' });
    expect(project({ ...retainedMatchupFixture({ capturedMapping: true }), mappingCandidates: [returningA] }))
      .toEqual({ status: 'rejected', reason: 'retained_mapping_lineage_conflict' });
  });

  it.each(['wrong-family', 'wrong-period', 'wrong-observation', 'wrong-content', 'missing-revision', 'missing-source-mapping',
    'wrong-mapping-revision', 'wrong-mapping-scope', 'wrong-mapping-generation', 'duplicate-candidate', 'over-limit'] as const)
  ('rejects %s immutable mapping candidates', variant => {
    const candidate = mappingCandidate();
    const modified = variant === 'wrong-family' ? { ...candidate, family: 'rosters' }
      : variant === 'wrong-period' ? { ...candidate, nativePeriodId: 'sleeper:matchup-week:4' }
      : variant === 'wrong-observation' ? { ...candidate, observationId: retainedMatchupId(99) }
        : variant === 'wrong-content' ? { ...candidate, contentId: retainedMatchupId(99) }
          : variant === 'missing-revision' ? { ...candidate, revision: null }
            : variant === 'missing-source-mapping' ? { ...candidate, sourceMapping: null }
              : variant === 'wrong-mapping-revision' ? { ...candidate, sourceMapping: { ...candidate.sourceMapping!, revisionId: retainedMatchupId(99) } }
                : variant === 'wrong-mapping-scope' ? { ...candidate, sourceMapping: { ...candidate.sourceMapping!, scope: {
                  ...candidate.sourceMapping!.scope, season: 2025 } } }
                  : variant === 'wrong-mapping-generation' ? { ...candidate, sourceMapping: { ...candidate.sourceMapping!, generation: 3 } } : candidate;
    const mappingCandidates = variant === 'duplicate-candidate' ? [candidate, candidate]
      : variant === 'over-limit' ? Array.from({ length: 101 }, (_, index) => ({ ...candidate, id: retainedMatchupId(1_000 + index) })) : [modified];
    expect(project({ ...capture(), mappingCandidates })).toEqual({ status: 'rejected', reason: 'retained_mapping_lineage_invalid' });
  });
});

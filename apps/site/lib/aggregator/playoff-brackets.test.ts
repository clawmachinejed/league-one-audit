import { describe, expect, it } from 'vitest';
import type { AdministrationEnvelope, JsonValue, NormalizedAdministrationObservation } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import liveSource from '../../test-support/fixtures/cp13-live-source-2026/source.json';
import { BRACKET_MATCH_LIMIT, BRACKET_PAYLOAD_BYTE_LIMIT, BRACKET_POLICY, bracketScope, projectPlayoffBracket,
  type BracketFamily } from './playoff-brackets';

const mapping: AdministrationSourceMapping = {
  connectionId: '00000000-0000-4000-8000-000000000001', leagueSeasonId: '00000000-0000-4000-8000-000000000002',
  revisionId: '00000000-0000-4000-8000-000000000003', generation: 1,
  scope: { leagueKey: 'unrelated-2026', provider: 'sleeper', externalLeagueId: '987654321098765432', season: 2026 },
};
function normalize(payload: JsonValue, family: BracketFamily = 'winners_bracket', overrides: Partial<AdministrationEnvelope> = {}) {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family, week: null, completeness: 'complete', payload,
    provenance: { origin: 'network', requestStartedAt: '2026-10-10T12:00:00.000Z', requestCompletedAt: '2026-10-10T12:00:01.000Z',
      sourceObservedAt: '2026-10-10T12:00:01.000Z', checkedAt: '2026-10-10T12:00:02.000Z' }, ...overrides });
}
function value(payload: JsonValue, family: BracketFamily = 'winners_bracket') {
  const result = projectPlayoffBracket(normalize(payload, family));
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('accepted');
  if (result.status !== 'accepted') throw new Error('Expected accepted bracket.');
  return result.value;
}
const source: JsonValue[] = [
  { r: 2, m: 3, t1: { w: 1 }, t1_from: { w: 1 }, t2: '2', t2_from: { l: 2 }, w: null, p: 1, extension: { retained: true } },
  { r: 1, m: 2, t1: 3, t2: 2, w: 3, l: 2 },
  { r: 1, m: 1, t1: 1, t2: 4, w: 1, l: 4 },
];

describe('typed native playoff bracket projection', () => {
  it.each(['winners_bracket', 'losers_bracket'] as const)('scopes %s locally without equating match or round IDs with a week', family => {
    expect(bracketScope(mapping, family)).toEqual({ kind: 'enrolled-resource', connectionId: mapping.connectionId,
      leagueSeasonId: mapping.leagueSeasonId, family: 'playoff-brackets', entityId: family, scoringPeriodId: null,
      audienceId: 'public', coverageSpecId: BRACKET_POLICY.coverageSpecId });
    const other = { ...mapping, connectionId: '00000000-0000-4000-8000-000000000004',
      leagueSeasonId: '00000000-0000-4000-8000-000000000005' };
    expect(bracketScope(other, family)).not.toEqual(bracketScope(mapping, family));
    expect(value(source, family).family).toBe(family);
  });

  it('rejects other seasons, unknown families and unverified mappings', () => {
    expect(() => bracketScope({ ...mapping, scope: { ...mapping.scope, season: 2025 } }, 'winners_bracket')).toThrow();
    expect(() => bracketScope(mapping, 'other' as BracketFamily)).toThrow();
    expect(() => bracketScope({ ...mapping, generation: 0 }, 'winners_bracket')).toThrow();
    expect(projectPlayoffBracket(normalize([], 'winners_bracket', { scope: { ...mapping.scope, season: 2025 } })))
      .toMatchObject({ status: 'rejected', diagnostics: [{ code: 'invalid_bracket_scope' }] });
  });

  it('preserves native ordering, field presence, raw roster representation, rounds and advancement origins', () => {
    const projected = value(source);
    expect(projected.rounds).toEqual([{ round: 1, externalMatchupIds: ['2', '1'] }, { round: 2, externalMatchupIds: ['3'] }]);
    expect(projected.matches.map(match => [match.externalMatchupId, match.sourceOrdinal])).toEqual([['3', 0], ['2', 1], ['1', 2]]);
    expect(projected.matches[0]).toEqual({ externalMatchupId: '3', sourceOrdinal: 0, round: 2,
      entrants: [{ slot: 1, native: { state: 'supplied', raw: { w: 1 }, value: { kind: 'advancement', outcome: 'winner', externalMatchupId: '1' } },
        from: { state: 'supplied', raw: { w: 1 }, value: { outcome: 'winner', externalMatchupId: '1' } } },
      { slot: 2, native: { state: 'supplied', raw: '2', value: { kind: 'roster', externalRosterId: '2' } },
        from: { state: 'supplied', raw: { l: 2 }, value: { outcome: 'loser', externalMatchupId: '2' } } }],
      winner: { state: 'null', raw: null, value: null }, loser: { state: 'missing', raw: null, value: null },
      nativePosition: { state: 'supplied', raw: 1, value: 1 }, extensions: { extension: { retained: true } } });
    expect(projected.matches[2].winner).toEqual({ state: 'supplied', raw: 1, value: '1' });
    expect(projected.edges).toEqual([
      { targetMatchupId: '3', slot: 1, sourceMatchupId: '1', outcome: 'winner', origin: 'both', sourceMatchPresent: true },
      { targetMatchupId: '3', slot: 2, sourceMatchupId: '2', outcome: 'loser', origin: 'explicit', sourceMatchPresent: true },
    ]);
    expect(projected.limitations).toEqual([]);
  });

  it('distinguishes unpublished null from a published empty bracket and leaves legacy values and hashes intact', () => {
    const unpublished = normalize(null), empty = normalize([]);
    const before = structuredClone(unpublished);
    expect(value(null)).toEqual({ family: 'winners_bracket', season: 2026, publication: 'unpublished',
      rounds: [], matches: [], edges: [], limitations: [] });
    expect(value([])).toMatchObject({ publication: 'published', rounds: [], matches: [] });
    expect(unpublished.value).toEqual(empty.value);
    expect(unpublished.semanticHash).not.toBe(empty.semanticHash);
    projectPlayoffBracket(unpublished);
    expect(unpublished).toEqual(before);
  });

  it('retains unresolved references, unsupported native objects, missing and null independently', () => {
    const projected = value([{ m: 1, r: 1, t1: null, t1_from: { w: 9, future: 2 },
      t2: { future_seed: 4 }, t2_from: null, w: null, p: 0 }, { m: 2, r: 2, t1: { w: 8 }, t2_from: {} }]);
    expect(projected.matches[0].entrants).toEqual([
      { slot: 1, native: { state: 'null', raw: null, value: null }, from: { state: 'supplied', raw: { w: 9, future: 2 },
        value: { outcome: 'winner', externalMatchupId: '9' } } },
      { slot: 2, native: { state: 'unsupported', raw: { future_seed: 4 }, value: null }, from: { state: 'null', raw: null, value: null } },
    ]);
    expect(projected.matches[1].entrants[1]).toEqual({ slot: 2, native: { state: 'missing', raw: null, value: null },
      from: { state: 'unsupported', raw: {}, value: null } });
    expect(projected.edges.map(edge => [edge.origin, edge.sourceMatchPresent])).toEqual([['explicit', false], ['embedded', false]]);
    expect(projected.limitations).toEqual(['unresolved_advancement_source', 'unsupported_entrant_reference']);
    expect(projected.matches[0].nativePosition).toEqual({ state: 'supplied', raw: 0, value: 0 });
  });

  it('retains opaque p and unknown extension values without inventing rank, seed or results', () => {
    const raw = JSON.parse('{"m":1,"r":1,"p":{"future":0},"__proto__":{"safe":true},"scores":[0,0]}') as JsonValue;
    const projected = value([raw]);
    expect(projected.matches[0].nativePosition).toEqual({ state: 'supplied', raw: { future: 0 }, value: { future: 0 } });
    expect(Object.hasOwn(projected.matches[0].extensions, '__proto__')).toBe(true);
    expect(projected.matches[0].extensions.scores).toEqual([0, 0]);
    expect(projected.matches[0].winner.state).toBe('missing');
    expect(projected).not.toHaveProperty('finality');
    expect(projected.matches[0]).not.toHaveProperty('seed');
  });

  it.each([
    [{ m: 1, r: 1, t1: 1, t2: 1 }, 'duplicate_bracket_entrant'],
    [{ m: 1, r: 1, w: 3, l: 3 }, 'conflicting_bracket_results'],
    [{ m: 1, r: 1, t1: 1, t2: 2, w: 3 }, 'bracket_result_outside_entrants'],
    [{ m: 1, r: 1, t1: 1, t2: 2, l: 3 }, 'bracket_result_outside_entrants'],
  ] as const)('withholds contradictory typed facts but preserves legacy acceptance: %j', (row, code) => {
    const normalized = normalize([row]);
    expect(normalized.status).toBe('accepted');
    expect(projectPlayoffBracket(normalized)).toMatchObject({ status: 'rejected', diagnostics: [{ code }] });
    expect(normalized.envelope.payload).toEqual([row]);
  });

  it('rejects a supplied advancement outcome that contradicts a resolved entrant', () => {
    const payload: JsonValue = [{ m: 1, r: 1, t1: 1, t2: 2, w: 1 }, { m: 2, r: 2, t1: 2, t1_from: { w: 1 } }];
    expect(normalize(payload).status).toBe('accepted');
    expect(projectPlayoffBracket(normalize(payload))).toMatchObject({ status: 'rejected',
      diagnostics: [{ code: 'conflicting_bracket_advancement', path: 'payload[1].t1' }] });
  });

  it('rejects cycles while allowing an unresolved reference or nonmonotonic native round relationship', () => {
    const cycle: JsonValue = [{ m: 1, r: 1, t1: { w: 2 } }, { m: 2, r: 2, t1: { l: 1 } }];
    expect(normalize(cycle).status).toBe('accepted');
    expect(projectPlayoffBracket(normalize(cycle))).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'cyclic_bracket_advancement' }] });
    expect(value([{ m: 1, r: 3 }, { m: 2, r: 1, t1: { w: 1 }, t2: { l: 1 } }]).edges).toHaveLength(2);
  });

  it('does not fill an entrant from a supplied upstream result or invent completion from partial result facts', () => {
    const projected = value([{ m: 1, r: 1, t1: 1, t2: null, w: 1 }, { m: 2, r: 2, t1: null, t1_from: { w: 1 }, w: 4 }]);
    expect(projected.matches[1].entrants[0].native).toEqual({ state: 'null', raw: null, value: null });
    expect(projected.matches[1].winner).toEqual({ state: 'supplied', raw: 4, value: '4' });
    expect(projected.matches[0].loser.state).toBe('missing');
  });

  it.each([{}, false, 0, 'null', [{ m: 1, r: 0 }], [{ m: 1, r: 1, t1: [] }],
    [{ m: 1, r: 1, t1: { w: 1 } }], [{ m: 1, r: 1, t1: { w: 2 }, t1_from: { l: 2 } }],
    [{ m: 1, r: 1 }, { m: 1, r: 2 }], [{ m: 1, r: 1, w: 0 }]] as JsonValue[])
  ('keeps existing malformed-source rejection: %j', payload => {
    expect(normalize(payload).status).toBe('rejected');
    expect(projectPlayoffBracket(normalize(payload)).status).toBe('rejected');
  });

  it('rejects partial null and forged normalized values and content identities', () => {
    expect(projectPlayoffBracket(normalize(null, 'winners_bracket', { completeness: 'partial' })).status).toBe('rejected');
    const partial = normalize(source, 'winners_bracket', { completeness: 'partial' });
    expect(partial.status).toBe('accepted');
    expect(projectPlayoffBracket(partial)).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'incomplete_bracket_capture' }] });
    const normalized = normalize(source);
    for (const changed of [{ ...normalized, contentHash: 'f'.repeat(64) }, { ...normalized, semanticHash: 'f'.repeat(64) },
      { ...normalized, value: { family: 'winners_bracket', matches: [] } }]) {
      expect(projectPlayoffBracket(changed as NormalizedAdministrationObservation)).toMatchObject({ status: 'rejected',
        diagnostics: [{ code: 'bracket_native_normalized_mismatch' }] });
    }
  });

  it('has an explicit bounded inventory and raw byte limit without claiming provider capacity', () => {
    const rows = Array.from({ length: BRACKET_MATCH_LIMIT }, (_, index) => ({ m: index + 1, r: Number.MAX_SAFE_INTEGER }));
    expect(value(rows).matches).toHaveLength(BRACKET_MATCH_LIMIT);
    expect(projectPlayoffBracket(normalize([...rows, { m: BRACKET_MATCH_LIMIT + 1, r: 1 }]))).toMatchObject({ status: 'rejected',
      diagnostics: [{ code: 'bracket_capture_limit' }] });
    const large = normalize([{ m: 1, r: 1, future: 'x'.repeat(BRACKET_PAYLOAD_BYTE_LIMIT) }]);
    expect(projectPlayoffBracket(large)).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'bracket_capture_limit' }] });
  });

  it('retains source ordering separately from unchanged v1 semantic identity', () => {
    const first = normalize(source), reordered = normalize([...source].reverse());
    expect(first.semanticHash).toBe(reordered.semanticHash);
    expect(first.contentHash).not.toBe(reordered.contentHash);
    expect(value(source).matches.map(match => match.externalMatchupId)).toEqual(['3', '2', '1']);
    expect(value([...source].reverse()).matches.map(match => match.externalMatchupId)).toEqual(['1', '2', '3']);
  });
});

describe('retained October 12 public playoff bracket observations', () => {
  type NativeMatch = { m: number; r: number; t1: number | null; t2: number | null; w: null; l: null; p?: number;
    t1_from?: { w?: number; l?: number }; t2_from?: { w?: number; l?: number } };
  const expected: Record<string, { matches: number; edges: number; winners: readonly number[]; losers: readonly number[] }> = {
    league1: { matches: 0, edges: 0, winners: [], losers: [] },
    league2: { matches: 0, edges: 0, winners: [], losers: [] },
    dynasty: { matches: 4, edges: 4, winners: [8, 4, 9, 1], losers: [7, 6, 3, 2] },
    'keeper-sample': { matches: 7, edges: 8, winners: [10, 3, 5, 12, 11, 7], losers: [6, 8, 9, 1, 4, 2] },
    'redraft-sample': { matches: 7, edges: 8, winners: [2, 12, 7, 5, 10, 4], losers: [8, 11, 3, 6, 9, 1] },
  };

  it.each(liveSource.samples.flatMap(sample => (['winners_bracket', 'losers_bracket'] as const).map(family => ({ sample, family }))))
  ('preserves $sample.key $family publication, entrants and advancement without an outcome', ({ sample, family }) => {
    const { document } = sample.resources[family];
    // JSON imports infer optional undefined members for heterogeneous rows; retained JSON contains no undefined values.
    const normalized = normalize(document.payload as JsonValue, family, {
      scope: { provider: 'sleeper', leagueKey: sample.key, externalLeagueId: sample.externalLeagueId, season: 2026 },
      provenance: { origin: 'network', requestStartedAt: document.requestStartedAt,
        requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt,
        checkedAt: document.requestCompletedAt },
    });
    const result = projectPlayoffBracket(normalized);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw new Error('Expected retained native bracket to be representable.');
    const bracket = result.value;
    const inventory = expected[sample.key];
    expect(bracket.family).toBe(family);
    expect(bracket.season).toBe(2026);
    expect(bracket.matches).toHaveLength(inventory.matches);
    expect(bracket.edges).toHaveLength(inventory.edges);
    expect(bracket.limitations).toEqual([]);
    expect(bracket).not.toHaveProperty('finality');
    expect(bracket).not.toHaveProperty('scoringPeriodId');
    const rows = document.payload as readonly NativeMatch[] | null;
    if (rows === null) {
      expect(bracket).toEqual({ family, season: 2026, publication: 'unpublished', rounds: [], matches: [], edges: [], limitations: [] });
      return;
    }
    expect(bracket.publication).toBe('published');
    expect(bracket.matches.flatMap(match => match.entrants.flatMap(entrant => entrant.native.value?.kind === 'roster'
      ? [Number(entrant.native.value.externalRosterId)] : []))).toEqual(family === 'winners_bracket' ? inventory.winners : inventory.losers);
    for (const [index, row] of rows.entries()) {
      const match = bracket.matches[index];
      expect(match.externalMatchupId).toBe(String(row.m));
      expect(match.sourceOrdinal).toBe(index);
      expect(match.round).toBe(row.r);
      expect(match.winner).toEqual({ state: 'null', raw: null, value: null });
      expect(match.loser).toEqual({ state: 'null', raw: null, value: null });
      expect(row.w).toBeNull();
      expect(row.l).toBeNull();
      expect(match.nativePosition).toEqual(Object.hasOwn(row, 'p')
        ? { state: 'supplied', raw: row.p, value: row.p } : { state: 'missing', raw: null, value: null });
      expect(match).not.toHaveProperty('seed');
      expect(match).not.toHaveProperty('bye');
      for (const slot of [1, 2] as const) {
        const native = row[slot === 1 ? 't1' : 't2'];
        const from = row[slot === 1 ? 't1_from' : 't2_from'];
        expect(match.entrants[slot - 1].native).toEqual(native === null
          ? { state: 'null', raw: null, value: null }
          : { state: 'supplied', raw: native, value: { kind: 'roster', externalRosterId: String(native) } });
        expect(match.entrants[slot - 1].from).toEqual(from === undefined
          ? { state: 'missing', raw: null, value: null }
          : { state: 'supplied', raw: from, value: { outcome: from.w === undefined ? 'loser' : 'winner',
            externalMatchupId: String(from.w ?? from.l) } });
      }
    }
    expect(bracket.edges).toEqual(rows.flatMap(row => ([1, 2] as const).flatMap(slot => {
      const from = row[slot === 1 ? 't1_from' : 't2_from'];
      return from === undefined ? [] : [{ targetMatchupId: String(row.m), slot,
        sourceMatchupId: String(from.w ?? from.l), outcome: from.w === undefined ? 'loser' : 'winner',
        origin: 'explicit', sourceMatchPresent: true }];
    })));
    expect(normalized.envelope.payload).toEqual(document.payload);
  });
});

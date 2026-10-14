import { describe, expect, it } from 'vitest';
import { TRADED_PICKS_VERSION, projectTradedPicks, tradedPicksScope, tradedPickInstantMicros } from './traded-picks';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { JsonObject, JsonValue } from '../league-administration/contracts';
const at = '2026-10-14T12:00:00.000001Z';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp18-unit', provider: 'sleeper' as const, externalLeagueId: '123456789', season: 2026 } };
const pick = (changes: JsonObject = {}) => ({ season: '2027', round: 2, roster_id: 1, owner_id: '2', previous_owner_id: 1, ...changes });
const invalidIdentityChanges: JsonObject[] = [{ season: 2027 }, { round: 0 }, { roster_id: 0 }, { league_id: 'foreign' }, { sport: 'nba' }];
function normalized(payload: JsonValue, completeness: 'complete' | 'partial' = 'complete') {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: mapping.scope, family: 'drafts', week: null, completeness, payload, provenance: { origin: 'network', requestStartedAt: at,
      requestCompletedAt: at, sourceObservedAt: completeness === 'complete' ? at : null, checkedAt: at } });
}
const project = (tradedPicks: JsonValue, completeness: 'complete' | 'partial' = 'complete') => projectTradedPicks(normalized({ tradedPicksVersion: TRADED_PICKS_VERSION, kind: 'league', tradedPicks }, completeness));
describe('native traded ownership evidence', () => {
  it('keeps future references native and endpoint scoped without draft inference', () => {
    expect(project([pick({ future: { zero: 0, flag: false } })])).toMatchObject({ value: { kind: 'league', season: 2026, externalDraftId: null,
      complete: true, entries: [{ pickSeason: { raw: '2027', value: '2027' }, currentOwnerId: '2', extensions: { future: { zero: 0, flag: false } } }] } });
    expect(tradedPicksScope(mapping, { kind: 'league' }).entityId).toBe('league');
    expect(tradedPicksScope(mapping, { kind: 'draft', externalDraftId: 'd1' }).entityId).toBe('draft:d1:traded-picks');
    expect(() => tradedPicksScope({ ...mapping, scope: { ...mapping.scope, season: 2027 } }, { kind: 'league' })).toThrow();
  });
  it('keeps source order duplicates and contradictory current owners without choosing a chain', () => {
    const a = pick(), b = pick({ owner_id: 3, previous_owner_id: 2 });
    for (const input of [[a, b], [b, a]]) expect(project(input)).toMatchObject({ value: { complete: true, entries: input.map((raw, sourceOrdinal) => ({
      sourceOrdinal, raw, identityState: 'valid', ownershipState: 'conflict', currentOwnerId: null, previousOwnerState: 'conflict', evidencedPreviousOwnerId: null })) } });
    expect(project([a, a])).toMatchObject({ value: { complete: true, entries: [{ ownershipState: 'resolved', currentOwnerId: '2' }, { ownershipState: 'resolved', currentOwnerId: '2' }] } });
  });
  it('separates previous owner conflicts from agreed current ownership', () => {
    expect(project([pick(), pick({ previous_owner_id: 3 })])).toMatchObject({ value: { complete: true, entries: [
      { ownershipState: 'resolved', currentOwnerId: '2', previousOwnerState: 'conflict' }, { ownershipState: 'resolved', currentOwnerId: '2', previousOwnerState: 'conflict' }] } });
  });
  it.each([null, 0, '', false, [], {}])('retains supplied unknown owner %j without inferring original roster', owner => {
    expect(project([pick({ owner_id: owner })])).toMatchObject({ value: { complete: true, entries: [
      { ownerId: { raw: owner, state: owner === null ? 'null' : 'invalid' }, ownershipState: 'unknown', currentOwnerId: null }] } });
  });
  it('requires all repeated owner evidence to resolve and distinguishes missing from null', () => {
    const missing = { season: '2027', round: 2, roster_id: 1 };
    expect(project([pick(), missing])).toMatchObject({ value: { complete: true, entries: [{ ownershipState: 'unknown', currentOwnerId: null },
      { ownerId: { state: 'missing' }, previousOwnerId: { state: 'missing' }, ownershipState: 'unknown' }] } });
  });
  it.each(['owner_id', 'round', ['owner_id'], ['round'], null, 0, false])('retains malformed row %j with missing fields', raw => {
    expect(project([raw])).toMatchObject({ value: { complete: false, entries: [{ identityState: 'invalid', raw,
      ownerId: { state: 'missing' }, round: { state: 'missing' }, currentOwnerId: null }] } });
  });
  it.each(invalidIdentityChanges)('withholds complete coverage for invalid native identity %j', changes => {
    expect(project([pick(changes)])).toMatchObject({ value: { complete: false } });
  });
  it('distinguishes complete empty partial empty missing null and invalid endpoint bodies', () => {
    expect(project([])).toMatchObject({ value: { complete: true, tradesState: 'empty', entries: [] } });
    expect(project([], 'partial')).toMatchObject({ value: { complete: false, tradesState: 'empty' } });
    expect(project(null)).toMatchObject({ value: { complete: false, tradesState: 'null' } });
    expect(project({})).toMatchObject({ value: { complete: false, tradesState: 'invalid' } });
    expect(projectTradedPicks(normalized({ tradedPicksVersion: TRADED_PICKS_VERSION, kind: 'league' }))).toMatchObject({ value: { complete: false, tradesState: 'missing' } });
  });
  it('rejects row structure and byte overflow before typed projection', () => {
    expect(project(Array.from({ length: 10_001 }, () => pick())).status).toBe('rejected');
    let nested: JsonValue = 1; for (let i = 0; i < 65; i++) nested = [nested];
    expect(project([pick({ nested })]).status).toBe('rejected');
    expect(project([pick({ extra: 'x'.repeat(8 * 1024 * 1024 + 64 * 1024) })]).status).toBe('rejected');
  });
  it('retains PostgreSQL microseconds and equivalent offset notation', () => {
    expect(tradedPickInstantMicros(at) - tradedPickInstantMicros('2026-10-14T12:00:00.000000Z')).toBe(1n);
    expect(tradedPickInstantMicros('2026-10-14T12:00:00.000001Z')).toBe(tradedPickInstantMicros('2026-10-14T07:00:00.000001-05:00'));
    const input = normalized({ tradedPicksVersion: TRADED_PICKS_VERSION, kind: 'league', tradedPicks: [pick()] });
    expect(projectTradedPicks({ ...input, envelope: { ...input.envelope, provenance: { ...input.envelope.provenance, requestCompletedAt: '2026-10-14T12:00:00.000000Z' } } }).status).toBe('rejected');
  });
  it.each(['2026-10-14T24:00:00Z', '2026-10-14T12:00:00+16:00', '2026-10-14T12:00:00+23:59', '2026-02-30T12:00:00Z', '2026-10-14 12:00:00Z', '2026-10-14T12:00:00.0000001Z'])('rejects unsupported clock %s', at => {
    expect(() => tradedPickInstantMicros(at)).toThrow();
  });
});

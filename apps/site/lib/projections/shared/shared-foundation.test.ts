import { describe, expect, it } from 'vitest';
import {
  externalGameRef,
  externalLeagueRef,
  externalPlayerRef,
  externalReferenceKey,
  externalRosterRef,
  externalTeamDefenseRef,
  providerKey,
  sameExternalReference,
} from './provider-identity';
import {
  compatibleDeterministicUuid,
  compatibleRevision,
  compatibleScoringRulesHash,
} from './revision-compatibility';
import { stableJson } from './stable-json';

describe('provider-neutral external references', () => {
  it('normalizes providers while keeping IDs opaque and resources distinct', () => {
    const league = externalLeagueRef(' Sleeper ', ' 001 ');
    const roster = externalRosterRef(league, '1');
    const player = externalPlayerRef('SLEEPER', '1');
    const defense = externalTeamDefenseRef('sleeper', '1');
    const game = externalGameRef('sleeper', '1');

    expect(league).toMatchObject({ provider: 'sleeper', externalId: '001' });
    expect(new Set([league, roster, player, defense, game].map(externalReferenceKey)).size).toBe(5);
    expect(sameExternalReference(player, externalPlayerRef(providerKey('sleeper'), '1'))).toBe(true);
    expect(sameExternalReference(player, defense)).toBe(false);
  });

  it('scopes repeated roster IDs to their league', () => {
    const first = externalRosterRef(externalLeagueRef('sleeper', 'league-1'), '1');
    const second = externalRosterRef(externalLeagueRef('sleeper', 'league-2'), '1');
    expect(sameExternalReference(first, second)).toBe(false);
  });

  it.each([
    () => providerKey('  '),
    () => externalLeagueRef('sleeper', ''),
    () => externalGameRef('', 'game-1'),
  ])('rejects blank provider or external IDs', (build) => {
    expect(build).toThrow(/must not be blank/u);
  });
});

describe('stable JSON and compatibility identifiers', () => {
  it('sorts object keys recursively, preserves array order, and omits undefined object values', () => {
    expect(stableJson({ z: [{ b: 2, a: 1 }, undefined], a: true, omitted: undefined }))
      .toBe('{"a":true,"z":[{"a":1,"b":2},null]}');
  });

  it('rejects non-finite database JSON while preserving legacy revision JSON semantics', () => {
    expect(() => stableJson({ value: Number.NaN })).toThrow(/non-finite/u);
    expect(compatibleRevision({ value: Number.NaN }))
      .toBe(compatibleRevision({ value: null }));
  });

  it('preserves known pre-canonical hashes and deterministic UUIDs', () => {
    expect(compatibleRevision({ week: 1, season: '2026', nested: { z: 2, a: 1 } }))
      .toBe('c374ba5bbcce96b0f489e898982d71fe41985e0f9c12e85bc8647ab7d3684444');
    expect(compatibleScoringRulesHash({ rush_yd: 0.1, pass_td: 6 }))
      .toBe('1dfa432a188d774e5695907388dfb29143009e51406e562de4f95b338c849e68');
    expect(compatibleDeterministicUuid('league', 'sleeper:123'))
      .toBe('0df3e8cd-b283-5dc0-a2c3-cf9d6d3d0461');
  });
});

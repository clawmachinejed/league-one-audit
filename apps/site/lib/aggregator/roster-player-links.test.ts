import { describe, expect, it } from 'vitest';
import { rosterCategoryEvidence, rosterPlayerKind } from './roster-player-links';

describe('immutable roster player link evidence', () => {
  it.each(['QB', 'LB', 'EDGE', 'UNFAMILIAR'])('keeps %s as player kind without projection eligibility filtering', position => {
    expect(rosterPlayerKind({ position, fantasyPositions: null, positionState: 'supplied', fantasyPositionsState: 'missing' }))
      .toEqual({ entityKind: 'player', reason: null });
  });
  it('uses all native kind clues, preserves raw spelling and detects defense contradictions', () => {
    const evidence = { position: ' def ', fantasyPositions: ['DEF'], positionState: 'supplied', fantasyPositionsState: 'supplied' } as const;
    expect(rosterPlayerKind(evidence)).toEqual({ entityKind: 'team_defense', reason: null });
    expect(evidence.position).toBe(' def ');
    expect(rosterPlayerKind({ ...evidence, fantasyPositions: ['WR'] })).toEqual({ entityKind: null, reason: 'kind_conflict' });
    expect(rosterPlayerKind({ ...evidence, position: ' ', fantasyPositions: [] })).toEqual({ entityKind: null, reason: 'kind_unavailable' });
  });
  it.each(['\tDEF\n', '\u00a0DEF\ufeff', '\u2003def\u2029'])('classifies wrapped defense %j using the shared whitespace policy', position => {
    expect(rosterPlayerKind({ position, fantasyPositions: [' \t\n\u00a0\ufeff '], positionState: 'supplied', fantasyPositionsState: 'supplied' }))
      .toEqual({ entityKind: 'team_defense', reason: null });
    expect(rosterPlayerKind({ position: '\t\n\u00a0\ufeff', fantasyPositions: [], positionState: 'supplied', fantasyPositionsState: 'supplied' }))
      .toEqual({ entityKind: null, reason: 'kind_unavailable' });
  });
  it('distinguishes missing, null, empty, supplied and invalid category fields without inventing membership', () => {
    expect(rosterCategoryEvidence({}, 'reserve')).toEqual({ state: 'missing', raw: null, nativePlayerIds: null });
    expect(rosterCategoryEvidence({ reserve: null }, 'reserve')).toEqual({ state: 'null', raw: null, nativePlayerIds: null });
    expect(rosterCategoryEvidence({ reserve: [] }, 'reserve')).toEqual({ state: 'empty', raw: [], nativePlayerIds: [] });
    expect(rosterCategoryEvidence({ taxi: ['001', 'CASE'] }, 'taxi')).toEqual({ state: 'supplied', raw: ['001', 'CASE'], nativePlayerIds: ['001', 'CASE'] });
    expect(rosterCategoryEvidence({ taxi: ['001', '001'] }, 'taxi')).toMatchObject({ state: 'invalid', raw: ['001', '001'], nativePlayerIds: null });
    expect(rosterCategoryEvidence({ reserve: 0 }, 'reserve')).toEqual({ state: 'invalid', raw: 0, nativePlayerIds: null });
  });
  it('retains repeated starter vacancy markers without treating them as player identities', () => {
    expect(rosterCategoryEvidence({ starters: ['0', '001', '0'] }, 'starters')).toEqual({ state: 'supplied', raw: ['0', '001', '0'], nativePlayerIds: ['0', '001', '0'] });
  });
});

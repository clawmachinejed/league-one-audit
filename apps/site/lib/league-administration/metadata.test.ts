import { describe, expect, it } from 'vitest';
import type { AdministrationEnvelope, AdministrationFamily, JsonValue } from './contracts';
import { normalizeAdministrationObservation } from './normalize';

const catalog = { draft_id: 'draft-1', league_id: 'league-source', season: '2026', type: 'auction', vendor: { future: 4 } };
const pick = { season: '2027', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2, future_pick_field: true };
function normalize(family: AdministrationFamily, payload: JsonValue, overrides: Partial<AdministrationEnvelope> = {}) {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'league-source', season: 2026 },
    family, week: null, completeness: 'complete', payload,
    provenance: { origin: 'network', requestStartedAt: '2026-09-16T16:00:00Z', requestCompletedAt: '2026-09-16T16:00:04Z',
      sourceObservedAt: '2026-09-16T16:00:04Z', checkedAt: '2026-09-16T16:00:05Z' }, ...overrides });
}
const bundle = { catalog, draft: catalog, picks: [{ draft_id: 'draft-1', player_id: 'player-1', pick_no: 1 }], traded_picks: [pick] };

describe('observed draft, pick and playoff metadata', () => {
  it.each(['drafts', 'traded_picks', 'winners_bracket', 'losers_bracket'] as const)('accepts verified empty %s without inventing rules', family => {
    expect(normalize(family, []).status).toBe('accepted');
    expect(normalize(family, [], { week: 1 }).status).toBe('rejected');
  });

  it.each(['winners_bracket', 'losers_bracket'] as const)('retains a complete unpublished %s distinctly from an empty bracket', family => {
    const result = normalize(family, null);
    const empty = normalize(family, []);
    expect(result.status).toBe('accepted');
    expect(result.envelope.payload).toBeNull();
    expect(result.value).toEqual({ family, matches: [] });
    expect(result.contentHash).not.toBe(empty.contentHash);
    expect(result.semanticHash).not.toBe(empty.semanticHash);
    expect(result.semanticHash).toBe(normalize(family, null).semanticHash);
  });

  it.each(['winners_bracket', 'losers_bracket'] as const)('rejects incomplete null and malformed %s evidence', family => {
    const failed = normalize(family, null, { completeness: 'partial' });
    expect(failed.status).toBe('rejected');
    expect(failed.envelope.payload).toBeNull();
    expect(failed.semanticHash).toBeNull();
    for (const payload of [{}, 'null', false, 0] as JsonValue[]) {
      expect(normalize(family, payload).status).toBe('rejected');
    }
  });

  it.each(['league', 'rosters', 'users', 'matchups', 'transactions', 'drafts', 'traded_picks'] as const)('does not accept null for %s', family => {
    expect(normalize(family, null, { week: family === 'matchups' ? 1 : family === 'transactions' ? 0 : null }).status).toBe('rejected');
  });

  it('retains every draft body and unknown field while exposing only verified cross references', () => {
    const result = normalize('drafts', [bundle]);
    expect(result.status).toBe('accepted');
    expect(result.envelope.payload).toEqual([bundle]);
    expect(result.value).toMatchObject({ family: 'drafts', drafts: [{ externalDraftId: 'draft-1',
      pickedPlayerExternalIds: ['player-1'], pickNumbers: [1], tradedPicks: [{ season: 2027, ownerExternalRosterId: '2' }] }] });
    expect(result.value).not.toHaveProperty('components');
  });

  it.each(['league', 'season', 'draft', 'pick-draft', 'duplicate-pick', 'missing-picks', 'missing-trades'] as const)('rejects %s inconsistency and retains raw evidence', mismatch => {
    const bad = { ...bundle, ...(mismatch === 'league' ? { draft: { ...catalog, league_id: 'other' } }
      : mismatch === 'season' ? { catalog: { ...catalog, season: '2025' } }
        : mismatch === 'draft' ? { draft: { ...catalog, draft_id: 'other' } }
          : mismatch === 'pick-draft' ? { picks: [{ ...bundle.picks[0], draft_id: 'other' }] }
            : mismatch === 'duplicate-pick' ? { picks: [bundle.picks[0], bundle.picks[0]] }
              : mismatch === 'missing-picks' ? { picks: null } : { traded_picks: null }) };
    const result = normalize('drafts', [bad]);
    expect(result.status).toBe('rejected');
    expect(result.envelope.payload).toEqual([bad]);
  });

  it('keeps future traded-pick seasons explicit without rebinding the current league season', () => {
    const result = normalize('traded_picks', [pick]);
    expect(result.status).toBe('accepted');
    expect(result.value).toMatchObject({ family: 'traded_picks', picks: [{ season: 2027, round: 1,
      originalExternalRosterId: '1', previousOwnerExternalRosterId: '1', ownerExternalRosterId: '2' }] });
    expect(result.envelope.scope.season).toBe(2026);
  });

  it('keeps unresolved bracket entrants and future source extensions without inferring placement policy', () => {
    const bracket = [{ r: 1, m: 1, t1: 1, t2: null, w: null, l: null, t2_from: { w: 9 }, future: 'raw' }];
    const result = normalize('winners_bracket', bracket);
    expect(result.status).toBe('accepted');
    expect(result.envelope.payload).toEqual(bracket);
    expect(result.value).toEqual({ family: 'winners_bracket', matches: [{ round: 1, externalMatchupId: '1',
      teamOneExternalRosterId: '1', teamTwoExternalRosterId: null, winnerExternalRosterId: null, loserExternalRosterId: null,
      teamOneFrom: null, teamTwoFrom: { outcome: 'winner', externalMatchupId: '9' } }] });
    expect(normalize('winners_bracket', [...bracket, ...bracket]).status).toBe('rejected');
  });

  it('normalizes documented embedded advancement references and resolved entrants with matching provenance', () => {
    const result = normalize('losers_bracket', [{ m: 3, r: 2, t1: { w: 1 }, t1_from: { w: 1 }, t2: 4, t2_from: { l: 2 } }]);
    expect(result.status).toBe('accepted');
    expect(result.value).toMatchObject({ matches: [{ teamOneExternalRosterId: null,
      teamOneFrom: { outcome: 'winner', externalMatchupId: '1' }, teamTwoExternalRosterId: '4',
      teamTwoFrom: { outcome: 'loser', externalMatchupId: '2' } }] });
    expect(normalize('losers_bracket', [{ m: 3, r: 2, t1: { future_seed: 9 } }]).status).toBe('accepted');
  });

  it.each([
    { m: 3, r: 2, t1: { w: 1 }, t1_from: { l: 1 } },
    { m: 3, r: 2, t1: { w: 3 } },
    { m: 3, r: 2, t2_from: { l: 3 } },
    { m: 3, r: 2, t1: { w: 1, l: 2 } },
  ] as JsonValue[])('rejects a contradictory or self-referencing entrant: %j', match => {
    expect(normalize('winners_bracket', [match]).status).toBe('rejected');
  });

  it.each([1, '1'])('keeps typed pick relationships for source roster ID %j without inventing absent values', rosterId => {
    const result = normalize('drafts', [{ ...bundle, picks: [{ ...bundle.picks[0], roster_id: rosterId,
      round: 2, draft_slot: 3, picked_by: 'source-user', is_keeper: false }] }]);
    expect(result.status).toBe('accepted');
    expect(result.value).toMatchObject({ drafts: [{ selections: [{ pickNumber: 1, round: 2, draftSlot: 3,
      rosterId: '1', pickedBy: 'source-user', playerId: 'player-1', keeper: false }] }] });
    expect(normalize('drafts', [bundle]).value).toMatchObject({ drafts: [{ selections: [{ round: null,
      draftSlot: null, rosterId: null, pickedBy: null, keeper: null }] }] });
  });

  it('deduplicates identical traded-pick facts while retaining raw evidence and rejects conflicting ownership', () => {
    const duplicate = normalize('traded_picks', [pick, pick]);
    expect(duplicate.status).toBe('accepted');
    expect(duplicate.value).toMatchObject({ picks: [expect.objectContaining({ ownerExternalRosterId: '2' })] });
    expect(duplicate.envelope.payload).toEqual([pick, pick]);
    expect(duplicate.semanticHash).toBe(normalize('traded_picks', [pick]).semanticHash);
    expect(normalize('traded_picks', [pick, { ...pick, owner_id: 3 }]).status).toBe('rejected');
  });

  it('treats unknown metadata changes as material and ignores collection order alone', () => {
    const first = { r: 1, m: 1, t1: 1, t2: 2 };
    const second = { r: 1, m: 2, t1: 3, t2: 4 };
    expect(normalize('losers_bracket', [first, second]).semanticHash).toBe(normalize('losers_bracket', [second, first]).semanticHash);
    expect(normalize('drafts', [bundle]).semanticHash).not.toBe(normalize('drafts', [{ ...bundle, draft: { ...catalog, future: true } }]).semanticHash);
  });
});

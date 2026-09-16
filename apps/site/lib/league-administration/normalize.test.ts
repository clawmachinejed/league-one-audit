import { describe, expect, it } from 'vitest';
import { compatibleScoringRulesHash } from '../projections/shared/revision-compatibility';
import { classifyAdministrationChange } from './applicability';
import {
  ADMINISTRATION_DIALECT,
  ADMINISTRATION_NORMALIZER_VERSION,
  ADMINISTRATION_SCHEMA_VERSION,
  type AdministrationEnvelope,
  type AdministrationFamily,
  type JsonValue,
  type NormalizedLeagueConfiguration,
} from './contracts';
import { normalizeAdministrationObservation } from './normalize';

const league = {
  league_id: '1378850182409490432', season: '2026', sport: 'nfl', name: 'League One', status: 'in_season', total_rosters: 2,
  previous_league_id: 'previous-season',
  scoring_settings: { rec: 0.5, pass_int: -2, bonus_new: 0 },
  roster_positions: ['QB', 'RB', 'RB', 'FLEX', 'BN'],
  settings: { waiver_budget: 100, unknown_flag: 0, leg: 1, last_scored_leg: 0, daily_waivers_last_ran: 12, last_report: 1 },
};

function envelope(payload: JsonValue = league, family: AdministrationFamily = 'league'): AdministrationEnvelope {
  return {
    schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
    normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION,
    dialect: ADMINISTRATION_DIALECT,
    scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: league.league_id, season: 2026 },
    family, week: family === 'matchups' ? 1 : family === 'transactions' ? 0 : null,
    completeness: 'complete',
    provenance: {
      origin: 'network', requestStartedAt: '2026-09-12T16:29:59.000Z', requestCompletedAt: '2026-09-12T16:30:00.000Z',
      sourceObservedAt: '2026-09-12T16:30:00.000Z', checkedAt: '2026-09-12T16:30:01.000Z',
    },
    payload,
  };
}

function configuration(payload: JsonValue = league) {
  const result = normalizeAdministrationObservation(envelope(payload));
  expect(result.status).toBe('accepted');
  return result.value as NormalizedLeagueConfiguration;
}

describe('source league configuration content', () => {
  it('preserves exact finite source rules and reuses the existing scoring profile hash', () => {
    const value = configuration();
    expect(value.rawScoringRulesHash).toBe(compatibleScoringRulesHash(league.scoring_settings));
    expect(value.components.find((component) => component.name === 'scoring')?.value).toEqual({ scoring_settings: league.scoring_settings });
  });

  it('keeps absent, null, zero, negative and unfamiliar numeric source fields distinct', () => {
    const rules: Record<string, number>[] = [
      { rec: 1 }, { rec: 1, unfamiliar: 0 }, { rec: 1, unfamiliar: -2 }, { rec: 1, unfamiliar: 9 },
    ];
    const observations = rules.map((scoring_settings) => normalizeAdministrationObservation(envelope({ ...league, scoring_settings })));
    expect(observations.every((value) => value.status === 'accepted')).toBe(true);
    expect(new Set(observations.map((value) => value.semanticHash)).size).toBe(4);
    const { scoring_settings: removed, ...missing } = league;
    expect(removed).toEqual(league.scoring_settings);
    expect(configuration(missing).rawScoringRulesHash).toBeNull();
    expect(normalizeAdministrationObservation(envelope(missing)).semanticHash)
      .not.toBe(normalizeAdministrationObservation(envelope({ ...league, scoring_settings: null })).semanticHash);
  });

  it('retains ordered, repeated and unknown slot codes in immutable copies', () => {
    const slots = ['QB', 'RB', 'RB', 'UNRECOGNIZED_SLOT', 'BN'];
    const source = envelope({ ...league, roster_positions: slots });
    const result = normalizeAdministrationObservation(source);
    slots[0] = 'WR';
    expect((result.value as NormalizedLeagueConfiguration).components.find((component) => component.name === 'roster')?.value)
      .toEqual({ roster_positions: ['QB', 'RB', 'RB', 'UNRECOGNIZED_SLOT', 'BN'] });
    expect(Object.isFrozen(result.envelope.payload)).toBe(true);
    const reordered = normalizeAdministrationObservation(envelope({ ...league, roster_positions: ['RB', 'QB', 'RB', 'FLEX', 'BN'] }));
    expect(reordered.semanticHash).not.toBe(normalizeAdministrationObservation(envelope()).semanticHash);
  });

  it('retains operational source evidence without treating a counter change as a settings change', () => {
    const original = normalizeAdministrationObservation(envelope());
    const next = normalizeAdministrationObservation(envelope({ ...league, status: 'complete', settings: { ...league.settings, leg: 2, last_scored_leg: 1, daily_waivers_last_ran: 19, last_report: 8 } }));
    expect(next.contentHash).not.toBe(original.contentHash);
    expect(next.semanticHash).toBe(original.semanticHash);
    expect(classifyAdministrationChange(original, next)).toBe('unchanged');
    expect(next.envelope.payload).toMatchObject({ settings: { leg: 2, last_report: 8 } });
  });

  it('preserves unknown settings and extension fields as material data', () => {
    const original = normalizeAdministrationObservation(envelope());
    const changed = normalizeAdministrationObservation(envelope({ ...league, new_provider_rule: { enabled: true }, settings: { ...league.settings, unknown_flag: 1 } }));
    expect(changed.semanticHash).not.toBe(original.semanticHash);
    const config = changed.value as NormalizedLeagueConfiguration;
    expect(config.components.find((component) => component.name === 'extensions')?.value).toMatchObject({ new_provider_rule: { enabled: true } });
    expect(config.components.find((component) => component.name === 'competition')?.value).toMatchObject({ settings: { unknown_flag: 1 } });
  });

  it('isolates display hashes from scoring, roster and competition hashes', () => {
    const first = configuration();
    const renamed = configuration({ ...league, name: 'New title', avatar: 'new-avatar' });
    for (const name of ['scoring', 'roster', 'competition'] as const) {
      expect(renamed.components.find((entry) => entry.name === name)?.hash).toBe(first.components.find((entry) => entry.name === name)?.hash);
    }
    expect(renamed.components.find((entry) => entry.name === 'display')?.hash).not.toBe(first.components.find((entry) => entry.name === 'display')?.hash);
  });

  it('treats A to B to A as two changes while reusing A content identity', () => {
    const a = normalizeAdministrationObservation(envelope());
    const b = normalizeAdministrationObservation(envelope({ ...league, scoring_settings: { rec: 1 } }));
    const again = normalizeAdministrationObservation({ ...envelope(), provenance: { ...envelope().provenance, checkedAt: '2026-09-12T17:00:00.000Z' } });
    expect(again.contentHash).toBe(a.contentHash);
    expect(again.semanticHash).toBe(a.semanticHash);
    expect(classifyAdministrationChange(a, b)).toBe('changed');
    expect(classifyAdministrationChange(b, again)).toBe('changed');
    expect(classifyAdministrationChange(again, again)).toBe('unchanged');
  });

  it.each([
    [{ ...league, league_id: 'another-source' }, 'source_identity_mismatch'],
    [{ ...league, season: '2025' }, 'source_identity_mismatch'],
    [{ ...league, season: 2026 }, 'invalid_season'],
    [{ ...league, league_id: 1378850182409490432 }, 'invalid_identifier'],
    [{ ...league, scoring_settings: { rec: '0.5' } }, 'invalid_scoring_weight'],
    [{ ...league, roster_positions: ['QB', 2] }, 'invalid_identifier'],
    [{ ...league, sport: 'nba' }, 'unsupported_sport'],
    [{ ...league, previous_league_id: league.league_id }, 'invalid_predecessor'],
  ])('rejects malformed or mis-scoped league evidence %#', (payload, code) => {
    const result = normalizeAdministrationObservation(envelope(payload));
    expect(result.status).toBe('rejected');
    expect(result.diagnostics[0].code).toBe(code);
    expect(result.semanticHash).toBeNull();
    expect(result.envelope.payload).toEqual(payload);
  });
});

describe('source roster, manager and lineup identities', () => {
  const rosters: JsonValue = [
    { roster_id: 1, owner_id: 'manager-1', co_owners: ['co-owner'], players: ['100', 'JAC'], starters: ['100', '0', '0'], reserve: null, taxi: [] },
    { roster_id: 2, owner_id: null, co_owners: null, players: [], starters: ['0', '0'] },
  ];

  it('keeps co-owners and vacant teams without inferring app accounts or franchises', () => {
    const result = normalizeAdministrationObservation(envelope(rosters, 'rosters'), { expectedRosterCount: 2 });
    expect(result.status).toBe('accepted');
    expect(result.value).toMatchObject({
      family: 'rosters', teams: [{ externalRosterId: '1', primaryOwnerExternalId: 'manager-1', coOwnerExternalIds: ['co-owner'], playerExternalIds: ['100', 'JAC'], starterExternalIds: ['100', '0', '0'] }, { externalRosterId: '2', primaryOwnerExternalId: null }],
      memberships: [{ externalRosterId: '1', externalManagerId: 'manager-1', role: 'owner' }, { externalRosterId: '1', externalManagerId: 'co-owner', role: 'co_owner' }],
    });
  });

  it('retains missing lineup lists as unknown rather than inventing empty lineups', () => {
    const result = normalizeAdministrationObservation(envelope([{ roster_id: 1, owner_id: null }], 'rosters'));
    expect(result.value).toMatchObject({ teams: [{ playerExternalIds: null, starterExternalIds: null }] });
  });

  it('does not collapse source managers because their names match', () => {
    const result = normalizeAdministrationObservation(envelope([
      { user_id: '10000000000000000001', display_name: 'Shared name', metadata: { team_name: 'Team' } },
      { user_id: '10000000000000000002', display_name: 'Shared name' },
    ], 'users'));
    expect(result.status).toBe('accepted');
    expect(result.value).toMatchObject({ managers: [{ externalManagerId: '10000000000000000001' }, { externalManagerId: '10000000000000000002' }] });
    expect(result.envelope.payload).toMatchObject([{ metadata: { team_name: 'Team' } }, {}]);
  });

  it('retains raw collection order without creating a material revision for row reordering', () => {
    const users = [{ user_id: 'manager-1', display_name: 'One' }, { user_id: 'manager-2', display_name: 'Two' }];
    const first = normalizeAdministrationObservation(envelope(users, 'users'));
    const reordered = normalizeAdministrationObservation(envelope([...users].reverse(), 'users'));
    expect(reordered.contentHash).not.toBe(first.contentHash);
    expect(reordered.semanticHash).toBe(first.semanticHash);
    expect(classifyAdministrationChange(first, reordered)).toBe('unchanged');
  });

  it.each([
    [[{ roster_id: 1 }, { roster_id: 1 }], 'duplicate_identifier'],
    [[{ roster_id: '1' }], 'invalid_integer'],
    [[{ roster_id: Number.MAX_SAFE_INTEGER + 1 }], 'invalid_integer'],
    [[{ roster_id: 1, owner_id: 123 }], 'invalid_identifier'],
    [[{ roster_id: 1, co_owners: ['same', 'same'] }], 'duplicate_identifier'],
    [[{ roster_id: 1, owner_id: 'same', co_owners: ['same'] }], 'duplicate_membership'],
    [[{ roster_id: 1, players: ['123', '123'] }], 'duplicate_identifier'],
  ])('rejects malformed or ambiguous roster identities %#', (payload, code) => {
    expect(normalizeAdministrationObservation(envelope(payload, 'rosters')).diagnostics[0].code).toBe(code);
  });

  it('rejects duplicate manager IDs and incomplete asserted roster sets', () => {
    expect(normalizeAdministrationObservation(envelope([{ user_id: 'same' }, { user_id: 'same' }], 'users')).status).toBe('rejected');
    expect(normalizeAdministrationObservation(envelope(rosters, 'rosters'), { expectedRosterCount: 3 }).diagnostics[0].code).toBe('incomplete_roster_set');
  });

  it('preserves explicit zero and negative official matchup totals and custom overrides', () => {
    const payload = [{ roster_id: 1, matchup_id: null, players: ['JAC'], starters: ['JAC'], starters_points: [-2], players_points: { JAC: -2 }, points: -2, custom_points: 0 }];
    const result = normalizeAdministrationObservation(envelope(payload, 'matchups'));
    expect(result.status).toBe('accepted');
    expect(result.value).toMatchObject({ matchups: [{ externalRosterId: '1', externalMatchupId: null, points: -2, customPoints: 0 }] });
    expect(result.envelope.payload).toEqual(payload);
  });

  it('rejects duplicate matchup roster rows and misaligned starter point lists', () => {
    expect(normalizeAdministrationObservation(envelope([{ roster_id: 1 }, { roster_id: 1 }], 'matchups')).diagnostics[0].code).toBe('duplicate_identifier');
    expect(normalizeAdministrationObservation(envelope([{ roster_id: 1, starters: ['123'], starters_points: [] }], 'matchups')).diagnostics[0].code).toBe('mismatched_lineup_points');
  });
});

describe('source transaction observations', () => {
  const transaction = {
    transaction_id: '1378850182409490435', type: 'trade', status: 'pending', created: 1757683200000,
    roster_ids: [1, 2], consenter_ids: [1], adds: { '123': 2, JAC: 1 }, drops: { '123': 1, JAC: 2 },
    draft_picks: [{ season: '2027', round: 1, roster_id: 2, previous_owner_id: 1, owner_id: 2 }],
    waiver_budget: [{ sender: 1, receiver: 2, amount: 0 }], metadata: { note: 'exact retained data' },
  };

  it('extracts scoped movements without guessing a player, franchise, or a completed transfer', () => {
    const result = normalizeAdministrationObservation(envelope([transaction], 'transactions'));
    expect(result.status).toBe('accepted');
    expect(result.value).toMatchObject({ transactions: [{
      externalTransactionId: transaction.transaction_id, status: 'pending', externalRosterIds: ['1', '2'],
      playerMovements: [{ externalPlayerId: '123', externalRosterId: '2', direction: 'add' }, { externalPlayerId: 'JAC', externalRosterId: '1', direction: 'add' }, { externalPlayerId: '123', externalRosterId: '1', direction: 'drop' }, { externalPlayerId: 'JAC', externalRosterId: '2', direction: 'drop' }],
      draftPickMovements: [{ season: 2027, round: 1, originalExternalRosterId: '2', previousOwnerExternalRosterId: '1', ownerExternalRosterId: '2' }],
      budgetMovements: [{ senderExternalRosterId: '1', receiverExternalRosterId: '2', amount: 0 }],
    }] });
    expect(result.envelope.payload).toEqual([transaction]);
  });

  it('retains unknown transaction types and fields and does not equate absence with zero', () => {
    const first = normalizeAdministrationObservation(envelope([{ transaction_id: 'id', type: 'new-type', future_source_field: false }], 'transactions'));
    const next = normalizeAdministrationObservation(envelope([{ transaction_id: 'id', type: 'new-type', future_source_field: false, waiver_bid: 0 }], 'transactions'));
    expect(first.status).toBe('accepted');
    expect(next.semanticHash).not.toBe(first.semanticHash);
  });

  it.each([
    [[transaction, transaction], 'duplicate_identifier'],
    [[{ ...transaction, adds: { '123': '2' } }], 'invalid_integer'],
    [[{ ...transaction, roster_ids: [1, 1] }], 'duplicate_identifier'],
    [[{ ...transaction, draft_picks: [transaction.draft_picks[0], transaction.draft_picks[0]] }], 'duplicate_identifier'],
    [[{ ...transaction, waiver_budget: [{ sender: 1, receiver: 2, amount: -2 }] }], 'invalid_budget_movement'],
  ])('rejects ambiguous or malformed transaction evidence %#', (payload, code) => {
    expect(normalizeAdministrationObservation(envelope(payload, 'transactions')).diagnostics[0].code).toBe(code);
  });
});

describe('evidence provenance and failure isolation', () => {
  it('keeps an unproved cache observation time null regardless of check time', () => {
    const input = envelope();
    const result = normalizeAdministrationObservation({ ...input, provenance: { ...input.provenance, origin: 'cache', sourceObservedAt: null } });
    expect(result.status).toBe('accepted');
    expect(result.envelope.provenance.sourceObservedAt).toBeNull();
    expect(result.semanticHash).toBe(normalizeAdministrationObservation(input).semanticHash);
  });

  it('does not promote partial documents or cross-league comparisons as current changes', () => {
    const input = envelope();
    const current = normalizeAdministrationObservation(input);
    const partial = normalizeAdministrationObservation({ ...input, completeness: 'partial' });
    expect(classifyAdministrationChange(current, partial)).toBe('partial');
    const other = normalizeAdministrationObservation({ ...input, scope: { ...input.scope, leagueKey: 'league2' } });
    expect(classifyAdministrationChange(current, other)).toBe('scope_mismatch');
  });

  it.each([
    { ...envelope(), week: 1 },
    { ...envelope([], 'matchups'), week: 0 },
    { ...envelope(), provenance: { ...envelope().provenance, checkedAt: 'yesterday' } },
    { ...envelope(), provenance: { ...envelope().provenance, sourceObservedAt: '2026-09-13T00:00:00.000Z' } },
    { ...envelope(), provenance: { ...envelope().provenance, requestStartedAt: null } },
  ])('rejects contradictory scope or source evidence time %#', (input) => {
    expect(normalizeAdministrationObservation(input).status).toBe('rejected');
  });

  it('rejects transport values JSON would silently coerce before any persistence call', () => {
    expect(() => normalizeAdministrationObservation(envelope({ ...league, scoring_settings: { rec: Number.NaN } }))).toThrow('finite JSON');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('server-only', () => ({}));
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../adapters/sleeper/scoring-profile';
import { allPlayerScoreSemanticHash } from '../adapters/neon/all-player-statistics';
import {
  buildAllPlayerScoreSets,
  type AllPlayerStatObservation,
} from './all-player-statistics';

const officialObservationIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];

// Exact scoring_settings shared by League One and League Two in Sleeper for
// 2024, 2025, and 2026. Zero-value legacy keys are retained to prove the full
// provider document remains accepted while only supported active rules score.
const leagueOneTwo2024To2026Rules = {
  sack: 1, fgm_40_49: 0, fgm_yds: 0, bonus_rec_yd_100: 0,
  bonus_rush_yd_100: 0, pass_int: -2, pts_allow_0: 10,
  bonus_pass_yd_400: 0, pass_2pt: 2, st_td: 6, fgm_yds_over_30: 0.1,
  rec_td: 6, fgm_30_39: 0, xpmiss: 0, rush_td: 6, def_4_and_stop: 1,
  pass_td_40p: 1, fgm: 3, rec_2pt: 2, st_fum_rec: 0, fgmiss: 0, ff: 0,
  rec: 0.5, pts_allow_14_20: 1, def_2pt: 2, fgm_0_19: 0, int: 2,
  def_st_fum_rec: 2, fum_lost: -2, pts_allow_1_6: 7, fgm_20_29: 0,
  pts_allow_21_27: 0, xpm: 1, def_3_and_out: 0.5, rush_2pt: 2,
  fum_rec: 2, bonus_rec_yd_200: 0, def_st_td: 6, fgm_50p: 0, def_td: 6,
  rec_td_40p: 1, bonus_rush_yd_200: 0, safe: 2, pass_yd: 0.04,
  blk_kick: 2, pass_td: 6, rush_yd: 0.1, fum: 0, pts_allow_28_34: -1,
  pts_allow_35p: -4, fum_rec_td: 6, rec_yd: 0.1, rush_td_40p: 1,
  def_st_ff: 0, pts_allow_7_13: 4, st_ff: 0,
} as const;

function officialBatch(
  points: readonly Readonly<{ providerExternalId: string; points: number }>[],
  observationId = officialObservationIds[0],
) {
  const normalized = [...points].sort((left, right) => (
    left.providerExternalId.localeCompare(right.providerExternalId)
  ));
  return {
    observationId, rosterCount: 1, rosterIds: ['roster-1'], entityCount: normalized.length,
    fingerprint: `sha256:${createHash('sha256').update(normalized
      .map((point) => `${point.providerExternalId}\u001f${String(point.points)}`).join('\n')).digest('hex')}`,
    points: normalized,
  };
}

function observation(overrides: Partial<AllPlayerStatObservation> = {}): AllPlayerStatObservation {
  return {
    provider: 'sleeper', season: 2026, seasonType: 'reg', week: 1,
    normalizerVersion: 'sleeper-weekly-stats-v1', sourceRevision: 'etag:one',
    requestStartedAt: '2026-09-15T00:00:00.000Z',
    requestCompletedAt: '2026-09-15T00:00:01.000Z',
    observedAt: '2026-09-15T00:00:01.000Z', quality: 'complete',
    coverage: { complete: true }, warnings: [],
    entries: [
      {
        entityKind: 'player', providerExternalId: 'p1',
        nflGameId: '11111111-1111-4111-8111-111111111111', nflTeam: 'NE', position: 'QB',
        stats: { gms_active: 1, gp: 1, pass_yd: 250, pass_td: 2 },
        eligibilityEvidence: {
          kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: 1,
        },
        eligibleGameCount: 1, appearanceGameCount: 1, gamePhase: 'final',
      },
      {
        entityKind: 'player', providerExternalId: 'p2',
        nflGameId: '22222222-2222-4222-8222-222222222222', nflTeam: 'ATL', position: 'RB',
        stats: { gms_active: 1 },
        eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 },
        eligibleGameCount: 1, appearanceGameCount: 0,
        gamePhase: 'final',
      },
      {
        entityKind: 'player', providerExternalId: 'inactive', nflGameId: null,
        nflTeam: 'NE', position: 'WR', stats: { gms_active: 0, gp: 0 },
        eligibilityEvidence: {
          kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 0, appearances: 0,
        },
        eligibleGameCount: 0, appearanceGameCount: 0, gamePhase: 'final',
      },
      {
        entityKind: 'team_defense', providerExternalId: 'NE',
        nflGameId: '11111111-1111-4111-8111-111111111111', nflTeam: 'NE', position: 'DEF',
        stats: { gms_active: 1, gp: 1, sack: 3 },
        eligibilityEvidence: {
          kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: 1,
        },
        eligibleGameCount: 1, appearanceGameCount: 1, gamePhase: 'final',
      },
    ],
    ...overrides,
  };
}

const identity = (entry: { providerExternalId: string }) => ({
  scoringEntityId: `00000000-0000-4000-8000-${entry.providerExternalId.padEnd(12, '0').slice(0, 12)}`,
  conflict: false,
});

describe('all-player score-set construction', () => {
  it('shares raw content while scoring each unique league profile independently', async () => {
    const result = await buildAllPlayerScoreSets({
      observation: observation(), scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [
        {
          scoringProfileId: '11111111-1111-4111-8111-111111111111',
          rawRules: { pass_yd: 0.04, pass_td: 6, sack: 1 },
          officialBatches: [officialBatch([
            { providerExternalId: 'p1', points: 22 },
            { providerExternalId: 'p2', points: 0 },
            { providerExternalId: 'inactive', points: 0 },
            { providerExternalId: 'NE', points: 3 },
          ])],
        },
        {
          scoringProfileId: '22222222-2222-4222-8222-222222222222',
          rawRules: { pass_yd: 0.04, pass_td: 4, sack: 2 },
          officialBatches: [officialBatch([
            { providerExternalId: 'p1', points: 18 },
            { providerExternalId: 'p2', points: 0 },
            { providerExternalId: 'inactive', points: 0 },
            { providerExternalId: 'NE', points: 6 },
          ])],
        },
      ],
    });
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Expected score sets.');
    expect(result.scoreSets).toHaveLength(2);
    expect(result.scoreSets[0].semanticHash).not.toBe(result.scoreSets[1].semanticHash);
    expect(result.scoreSets[0].semanticHash).toBe(allPlayerScoreSemanticHash(
      result.scoreSets[0], result.scoreSets[0].scores,
    ));
    expect(result.scoreSets[0]).toMatchObject({
      scoredEntityCount: 4, eligibleGameCount: 3,
      parityComparisonCount: 4, parityMismatchCount: 0,
      coverage: { complete: true, identity_complete: true, scoring_rules_complete: true },
    });
    expect(result.scoreSets[0].scores.find((score) => score.providerExternalId === 'p2'))
      .toMatchObject({ fantasyPoints: 0, eligibleGameCount: 1, appearanceGameCount: 0 });
  });

  it('deduplicates matching rostered evidence when both leagues share one profile', async () => {
    const result = await buildAllPlayerScoreSets({
      observation: observation(), scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['11111111-1111-4111-8111-111111111111'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [{
        scoringProfileId: '11111111-1111-4111-8111-111111111111',
        rawRules: { pass_yd: 0.04, pass_td: 6, sack: 1 },
        officialBatches: [
          officialBatch([
            { providerExternalId: 'p1', points: 22 },
            { providerExternalId: 'p2', points: 0 },
            { providerExternalId: 'inactive', points: 0 },
            { providerExternalId: 'NE', points: 3 },
          ]),
          officialBatch([
            { providerExternalId: 'p1', points: 22 },
            { providerExternalId: 'p2', points: 0 },
            { providerExternalId: 'inactive', points: 0 },
            { providerExternalId: 'NE', points: 3 },
          ], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        ],
      }],
    });
    expect(result).toMatchObject({
      status: 'available',
      scoreSets: [{
        parityComparisonCount: 4,
        coverage: { parity_observation_ids: [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ] },
      }],
    });
  });

  it('rejects a batch that omits an expected league scoring profile', async () => {
    expect(await buildAllPlayerScoreSets({
      observation: observation(), scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['profile-one', 'profile-two'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [{
        scoringProfileId: 'profile-one', rawRules: { pass_td: 6 },
        officialBatches: [officialBatch([{ providerExternalId: 'p1', points: 12 }])],
      }],
    })).toEqual({
      status: 'unavailable', reason: 'incomplete-coverage',
      details: ['scoring profile inventory is incomplete'],
    });
  });

  it('leaves incomplete eligibility unavailable instead of converting it to zero', async () => {
    const incomplete = observation({
      entries: [{
        ...observation().entries[0], eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: {
          kind: 'missing-provider-row', inventoryFingerprint: `sha256:${'a'.repeat(64)}`,
        },
      }],
    });
    expect(await buildAllPlayerScoreSets({
      observation: incomplete, scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['p'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [{
        scoringProfileId: 'p', rawRules: { pass_td: 6 },
        officialBatches: [officialBatch([{ providerExternalId: 'p1', points: 0 }])],
      }],
    })).toEqual({ status: 'unavailable', reason: 'eligibility-unavailable', details: ['p1'] });
  });

  it.each([
    ['unsupported-scoring', { future_rule: 1 }, identity],
    ['identity-unavailable', { pass_td: 6 }, () => ({ scoringEntityId: null, conflict: true })],
  ] as const)('rejects %s before any profile can be published', async (reason, rawRules, resolveIdentity) => {
    expect(await buildAllPlayerScoreSets({
      observation: observation(), scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['profile'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity,
      profiles: [{ scoringProfileId: 'profile', rawRules, officialBatches: [officialBatch([
        { providerExternalId: 'p1', points: 0 },
      ])] }],
    })).toMatchObject({ status: 'unavailable', reason });
  });

  it('rejects a Sleeper official-points mismatch for the whole observation', async () => {
    expect(await buildAllPlayerScoreSets({
      observation: observation(), scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['profile'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [{
        scoringProfileId: 'profile', rawRules: { pass_td: 6 },
        officialBatches: [officialBatch([{ providerExternalId: 'p1', points: 11 }])],
      }],
    })).toEqual({ status: 'unavailable', reason: 'scoring-mismatch', details: ['p1'] });
  });

  it('rejects missing rostered parity rows even when Sleeper reports zero points', async () => {
    expect(await buildAllPlayerScoreSets({
      observation: observation(), scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['profile'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [{
        scoringProfileId: 'profile', rawRules: { pass_td: 6 },
        officialBatches: [officialBatch([
          { providerExternalId: 'missing-rostered-player', points: 0 },
        ])],
      }],
    })).toEqual({
      status: 'unavailable', reason: 'scoring-mismatch', details: ['missing-rostered-player'],
    });
  });

  it('requires official rostered parity evidence for every scoring profile', async () => {
    expect(await buildAllPlayerScoreSets({
      observation: observation(), scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['profile'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [{
        scoringProfileId: 'profile', rawRules: { pass_td: 6 }, officialBatches: [],
      }],
    })).toEqual({
      status: 'unavailable', reason: 'invalid-input',
      details: ['missing-official-points:profile'],
    });
  });

  it('rejects a scoring profile with no active rules', async () => {
    expect(await buildAllPlayerScoreSets({
      observation: observation(), scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['profile'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [{
        scoringProfileId: 'profile', rawRules: { pass_td: 0 },
        officialBatches: [officialBatch([{ providerExternalId: 'p1', points: 0 }])],
      }],
    })).toEqual({
      status: 'unavailable', reason: 'invalid-input',
      details: ['missing-active-scoring-rules:profile'],
    });
  });

  it('rejects nonzero scoring evidence for an active player with no appearance', async () => {
    const inconsistent = observation({
      entries: observation().entries.map((entry) => entry.providerExternalId === 'p2'
        ? { ...entry, stats: { gms_active: 1, pass_td: 1 } }
        : entry),
    });
    expect(await buildAllPlayerScoreSets({
      observation: inconsistent, scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['profile'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [{
        scoringProfileId: 'profile', rawRules: { pass_td: 6 },
        officialBatches: [officialBatch([{ providerExternalId: 'p2', points: 0 }])],
      }],
    })).toEqual({
      status: 'unavailable', reason: 'unsupported-scoring',
      details: ['non-appearing-nonzero:p2'],
    });
  });

  it('reproduces the real League One/Two 2024-2026 profile against official totals', async () => {
    const original = observation();
    const appearing = (providerExternalId: string, position: 'WR' | 'K', stats: Record<string, number>) => ({
      ...original.entries[0], providerExternalId, position, stats: { ...stats, gms_active: 1, gp: 1 },
    });
    const parityObservation = observation({ entries: [
      {
        ...original.entries[0],
        stats: {
          gms_active: 1, gp: 1, pass_yd: 312, pass_td: 3, pass_int: 1,
          pass_2pt: 1, pass_td_40p: 1, rush_yd: 18, rush_td: 1, fum_lost: 1,
        },
      },
      appearing('skill', 'WR', {
        rec: 5, rec_yd: 63, rec_td: 1, rec_2pt: 1, rec_td_40p: 1,
        rush_yd: 87, rush_td: 1, rush_td_40p: 1, fum_rec: 1, fum_rec_td: 1,
        st_td: 1,
      }),
      appearing('kicker', 'K', { fgm: 2, fgm_yds_over_30: 35, xpm: 3 }),
      original.entries[1], original.entries[2],
      {
        ...original.entries[3],
        stats: {
          gms_active: 1, gp: 1, sack: 4, int: 2, def_st_fum_rec: 1,
          def_td: 1, def_st_td: 1, safe: 1, blk_kick: 1, pts_allow_7_13: 1,
          def_2pt: 1, def_3_and_out: 3, def_4_and_stop: 2, fum_rec: 1,
          fum_rec_td: 1, st_td: 1,
        },
      },
    ] });
    const officialPoints = [
      { providerExternalId: 'p1', points: 37.28 },
      { providerExternalId: 'skill', points: 47.5 },
      { providerExternalId: 'kicker', points: 12.5 },
      { providerExternalId: 'p2', points: 0 },
      { providerExternalId: 'inactive', points: 0 },
      { providerExternalId: 'NE', points: 49.5 },
    ];
    const result = await buildAllPlayerScoreSets({
      observation: parityObservation, scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: ['league-one-two-2024-2026'],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: identity,
      profiles: [{
        scoringProfileId: 'league-one-two-2024-2026',
        rawRules: leagueOneTwo2024To2026Rules,
        officialBatches: [
          officialBatch(officialPoints),
          officialBatch(officialPoints, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        ],
      }],
    });
    expect(result).toMatchObject({ status: 'available', scoreSets: [{
      parityComparisonCount: 6, parityMismatchCount: 0,
      coverage: { parity_observation_ids: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ] },
    }] });
    expect(Object.entries(leagueOneTwo2024To2026Rules)
      .filter(([, weight]) => weight !== 0)
      .every(([key]) => SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS.has(key))).toBe(true);
  });
});

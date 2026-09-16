import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fixture from '../../test-support/fixtures/dynasty-league-settings.json';
import { normalizeSleeperScoringProfile, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from './adapters/sleeper/scoring-profile';
import { buildAllPlayerScoreSets, type AllPlayerScoringProfile, type AllPlayerStatObservation } from './domain/all-player-statistics';
import type { ProjectionObservation, ProjectionSlate } from './domain/contracts';
import { scoreSparseStatistics } from './domain/scoring';
import { createProductionSharedServices } from './runtime/shared-services';
import { externalPlayerRef, providerKey } from './shared/provider-identity';
import { compatibleScoringRulesHash } from './shared/revision-compatibility';
import { assessLineupWatchCapacity } from './worker/lineup-watch-policy';
import { createProviderGroupScoringCache } from './worker/scoring-cache';

const officialProvider = providerKey('sleeper');
const projectionProvider = providerKey('tank01');
const rules = fixture.leagues;
const sharedProfileId = '11111111-1111-4111-8111-111111111111';
const dynastyProfileId = '22222222-2222-4222-8222-222222222222';
const observationIds = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
];

function actualScore(stats: Readonly<Record<string, number>>, league: keyof typeof rules) {
  return scoreSparseStatistics(stats, rules[league].scoring_settings, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
}

// Statistics and official points below are synthetic arithmetic cases. The
// fixture supplies real scoring settings, not evidence of production parity.
const quarterbackStats = { gms_active: 1, gp: 1, pass_yd: 250, pass_td: 2, pass_int: 1, rush_yd: 20, pass_td_40p: 1 };
const defenseStats = { gms_active: 1, gp: 1, sack: 3, int: 2, pts_allow_7_13: 1 };

function officialBatch(index: number, dynasty = false, quarterbackPoints = 23) {
  const points = [
    { providerExternalId: 'qb-fixture', points: quarterbackPoints },
    { providerExternalId: 'unused-fixture', points: 0 },
    ...(!dynasty ? [{ providerExternalId: 'BUF', points: 11 }] : []),
  ].sort((a, b) => a.providerExternalId.localeCompare(b.providerExternalId));
  return {
    observationId: observationIds[index], rosterCount: 1, rosterIds: ['1'], entityCount: points.length,
    fingerprint: `sha256:${createHash('sha256').update(points.map((point) => `${point.providerExternalId}\u001f${point.points}`).join('\n')).digest('hex')}`,
    points,
  };
}

function profileGroup(dynastyQuarterbackPoints = 23): AllPlayerScoringProfile[] {
  return [{
    scoringProfileId: sharedProfileId, rawRules: rules.league1.scoring_settings,
    officialBatches: [officialBatch(0), officialBatch(1)],
  }, {
    scoringProfileId: dynastyProfileId, rawRules: rules.dynasty.scoring_settings,
    officialBatches: [officialBatch(2, true, dynastyQuarterbackPoints)],
  }];
}

const observation: AllPlayerStatObservation = {
  provider: 'sleeper', season: 2026, seasonType: 'reg', week: 1,
  normalizerVersion: 'sleeper-weekly-stats-v1', sourceRevision: 'synthetic-dynasty-arithmetic',
  requestStartedAt: '2026-09-15T00:00:00.000Z', requestCompletedAt: '2026-09-15T00:00:01.000Z',
  observedAt: '2026-09-15T00:00:01.000Z', quality: 'complete', coverage: { complete: true }, warnings: [],
  entries: [
    { entityKind: 'player', providerExternalId: 'qb-fixture', position: 'QB', stats: quarterbackStats, appearances: 1 },
    { entityKind: 'player', providerExternalId: 'unused-fixture', position: 'RB', stats: { gms_active: 1, gp: 0 }, appearances: 0 },
    { entityKind: 'team_defense', providerExternalId: 'BUF', position: 'DEF', stats: defenseStats, appearances: 1 },
  ].map((entry) => ({
    entityKind: entry.entityKind as 'player' | 'team_defense', providerExternalId: entry.providerExternalId,
    position: entry.position as 'QB' | 'RB' | 'DEF', stats: entry.stats,
    nflGameId: '33333333-3333-4333-8333-333333333333', nflTeam: 'BUF', gamePhase: 'final',
    eligibleGameCount: 1, appearanceGameCount: entry.appearances as 0 | 1,
    eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: entry.appearances as 0 | 1 },
  })),
};

const build = (profiles: readonly AllPlayerScoringProfile[]) => buildAllPlayerScoreSets({
  observation, profiles, expectedScoringProfileIds: [sharedProfileId, dynastyProfileId],
  scorerVersion: 'sleeper-actual-v1', supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
  resolveIdentity: (entry) => ({ scoringEntityId: `fixture-entity:${entry.providerExternalId}`, conflict: false }),
});

describe('captured Dynasty scoring and three-league operation', () => {
  it('accepts every active rule from all three observed league profiles', () => {
    for (const league of ['league1', 'league2', 'dynasty'] as const) {
      expect(actualScore(quarterbackStats, league)).toMatchObject({ available: true, points: 23, unsupportedRuleKeys: [] });
    }
    expect(rules.dynasty.roster_positions.filter((slot) => slot !== 'BN')).toEqual([
      'QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX',
    ]);
  });

  it('uses Sleeper native long-touchdown and recovery keys for actual bonus scoring', () => {
    expect(actualScore({ pass_td: 1, pass_td_40p: 1 }, 'dynasty').points).toBe(7);
    expect(actualScore({ rush_td: 1, rush_td_40p: 1 }, 'dynasty').points).toBe(7);
    expect(actualScore({ rec: 1, rec_td: 1, rec_td_40p: 1 }, 'dynasty').points).toBe(7.5);
    expect(actualScore({ st_td: 1, fum_rec_td: 1 }, 'dynasty').points).toBe(12);
  });

  it('keeps Dynasty defense and kicker scoring distinct from League One and Two', () => {
    const kickerStats = { fgm: 2, xpm: 1, fgm_yds_over_30: 20 };
    for (const league of ['league1', 'league2'] as const) {
      expect(actualScore(defenseStats, league).points).toBe(11);
      expect(actualScore(kickerStats, league).points).toBe(9);
    }
    expect(actualScore(defenseStats, 'dynasty').points).toBe(0);
    expect(actualScore(kickerStats, 'dynasty').points).toBe(0);
    expect(compatibleScoringRulesHash(rules.league1.scoring_settings)).toBe(compatibleScoringRulesHash(rules.league2.scoring_settings));
    expect(compatibleScoringRulesHash(rules.dynasty.scoring_settings)).not.toBe(compatibleScoringRulesHash(rules.league1.scoring_settings));
  });

  it('retains honest projection bonus coverage without inventing Tank01 statistics', () => {
    const normalized = normalizeSleeperScoringProfile({ provider: officialProvider, rawRules: rules.dynasty.scoring_settings });
    if (normalized.status !== 'available') throw new Error('Captured Dynasty rules must normalize.');
    expect(normalized.profile.provenance.rawRules).toBe(rules.dynasty.scoring_settings);
    expect(normalized.profile.provenance.unsupportedSourceKeys).toEqual([
      'fum_rec_td', 'pass_td_40p', 'rec_td_40p', 'rush_td_40p', 'st_td',
    ]);
    expect(normalized.profile.provenance.aggregateTwoPointConversionSupported).toBe(true);
    expect(normalized.profile.provenance.usesPointsAllowedBucketProxy).toBe(false);
  });

  it('shares a provider slate and equal-profile scores while keeping Dynasty scores separately keyed', () => {
    const projection: ProjectionObservation = {
      identity: { primary: externalPlayerRef(projectionProvider, 'fixture-player'), aliases: [] },
      nflTeam: 'BUF', position: 'QB', stats: {}, missingFields: [],
      scoringStats: { kind: 'offense', passingYards: 250, passingTouchdowns: 2, passingInterceptions: 1,
        rushingYards: 20, rushingTouchdowns: 0, receptions: 0, receivingYards: 0, receivingTouchdowns: 0,
        fumblesLost: 0, twoPointConversions: 0 },
    };
    const slate: ProjectionSlate = {
      source: projectionProvider, period: { season: 2026, seasonType: 'regular', week: 2 }, quality: 'complete',
      requestStartedAt: '2026-09-16T00:00:00.000Z', requestCompletedAt: '2026-09-16T00:00:01.000Z',
      observedAt: '2026-09-16T00:00:01.000Z', sourceRevision: 'synthetic-slate', projections: [projection],
      coverage: { crosswalkRows: 1, crosswalkEntries: 1, malformedCrosswalkRows: 0, ambiguousCrosswalkRows: 0,
        playerRows: 1, matchedPlayers: 1, unmatchedPlayers: 0, malformedPlayers: 0, incompletePlayers: 0,
        defenseRows: 0, usableDefenses: 0, malformedDefenses: 0, incompleteDefenses: 0 }, warnings: [],
    };
    const cache = createProviderGroupScoringCache(slate, normalizeSleeperScoringProfile);
    const scores = (['league1', 'league2', 'dynasty'] as const).map((league) => cache.resolve({
      provider: officialProvider, rawRules: rules[league].scoring_settings,
    }));
    if (scores.some((result) => result.status !== 'available')) throw new Error('Captured profiles must normalize.');
    const [one, two, dynasty] = scores.filter((result) => result.status === 'available');
    expect(one.scores).toBe(two.scores);
    expect(dynasty.scores).not.toBe(one.scores);
    expect(dynasty.profileHash).not.toBe(one.profileHash);
    expect(dynasty.scores.get(projection)).toEqual({ available: true, points: 22 });
  });

  it('builds two coordinated profiles with all three leagues’ parity lineage', async () => {
    const result = await build(profileGroup());
    if (result.status !== 'available') throw new Error(JSON.stringify(result));
    expect(result.scoreSets).toHaveLength(2);
    expect(result.scoreSets[0]).toMatchObject({ scoringProfileId: sharedProfileId, parityMismatchCount: 0,
      parityComparisonCount: 3, coverage: { parity_observation_ids: observationIds.slice(0, 2) } });
    expect(result.scoreSets[1]).toMatchObject({ scoringProfileId: dynastyProfileId, parityMismatchCount: 0,
      parityComparisonCount: 2, coverage: { parity_observation_ids: observationIds.slice(2) } });
    expect(result.scoreSets[0].scores.find((score) => score.providerExternalId === 'BUF')?.fantasyPoints).toBe(11);
    expect(result.scoreSets[1].scores.find((score) => score.providerExternalId === 'BUF')?.fantasyPoints).toBe(0);
  });

  it('rejects the complete group when Dynasty official parity fails or its profile is omitted', async () => {
    expect(await build(profileGroup(22))).toMatchObject({ status: 'unavailable', reason: 'scoring-mismatch' });
    expect(await build(profileGroup().slice(0, 1))).toMatchObject({ status: 'unavailable', reason: 'incomplete-coverage' });
  });

  it('uses the shared three-league registry within the existing observer request cap', () => {
    const leagues = createProductionSharedServices('dynasty-test').leagueRegistry.listActiveLeagues();
    expect(leagues.map((league) => String(league.leagueRef.externalId)).sort())
      .toEqual(Object.values(rules).map((league) => league.league_id).sort());
    expect(assessLineupWatchCapacity(leagues.length, leagues.length * 17)).toMatchObject({
      status: 'supported', currentTargets: 3, futureTargets: 51, requiredMatchupRequestsPerMinute: 20, maximumTotalChecks: 20,
    });
    expect(assessLineupWatchCapacity(leagues.length, leagues.length * 16)).toMatchObject({
      status: 'supported', requiredMatchupRequestsPerMinute: 19,
    });
  });
});

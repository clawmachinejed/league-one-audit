import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { NFL_TEAM_CODES } from '../../domain/contracts';
import { deterministicUuid } from './database-values';
import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import type { AllPlayerScoreSet, AllPlayerStatObservation } from '../../domain/all-player-statistics';
import {
  allPlayerScoreSemanticHash,
  allPlayerStatSemanticHash,
  createAllPlayerStatisticMethods,
  prepareAllPlayerBatch,
} from './all-player-statistics';

const fence = { jobKey: 'all-player-ingestion:sleeper', workerId: 'fixture-worker', generation: 1,
  leaseUntil: '2026-09-15T00:05:00.000Z', deadlineAt: '2026-09-15T00:04:00.000Z' };

const profileId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const gameId = '33333333-3333-4333-8333-333333333333';
const scoringRulesHash = createHash('sha256').update('{"pass_td":6}').digest('hex');
const officialObservationId = '44444444-4444-4444-8444-444444444444';

const observation: AllPlayerStatObservation = {
  provider: 'Sleeper', season: 2026, seasonType: 'reg', week: 1,
  normalizerVersion: 'sleeper-weekly-stats-v1', sourceRevision: 'etag:one',
  requestStartedAt: '2026-09-15T00:00:00.000Z',
  requestCompletedAt: '2026-09-15T00:00:01.000Z',
  observedAt: '2026-09-15T00:00:01.000Z', quality: 'complete',
  coverage: { complete: true, periodInventoryComplete: true,
    periodInventoryEvidence: { source: 'manual-review', sourceRevision: 'synthetic-period',
      observedAt: '2026-09-01T00:00:00.000Z', effectivePeriod: { season: 2026, seasonType: 'reg', week: 1 },
      excludedPlayerReasons: {}, teamsByPlayerId: { p1: 'NE' } },
    mode: 'completed-backfill', scheduledGameCount: 1, nonFinalScheduledGameCount: 0,
    scheduleFinalityComplete: true, nonFinalEligibleCount: 0,
    expectedInventoryFingerprint: `sha256:${'a'.repeat(64)}`,
    rosterInventoryFingerprint: `sha256:${'b'.repeat(64)}`,
    projectionInventoryFingerprint: `sha256:${'c'.repeat(64)}`,
    byeInventoryFingerprint: `sha256:${'d'.repeat(64)}`,
    catalogRevision: 'synthetic-catalog', scheduleRevision: 'synthetic-schedule',
    expectedEntityCount: 33, fantasyEntityCount: 33, expectedPlayerCount: 1,
    expectedTeamDefenseCount: 32, providerPresentEntityCount: 3, providerMissingEntityCount: 30,
    unknownEligibilityCount: 0, unmappedGameCount: 0, unexpectedResponseEntityCount: 0,
  }, warnings: [],
  entries: [{
    entityKind: 'player', providerExternalId: 'p1', nflGameId: gameId,
    nflTeam: 'NE', position: 'QB', stats: { gms_active: 1, gp: 0 },
    eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: 0 },
    eligibleGameCount: 1, appearanceGameCount: 0, gamePhase: 'final',
  }, ...NFL_TEAM_CODES.map((team) => {
    const playing = team === 'NE' || team === 'ATL';
    return { entityKind: 'team_defense' as const, providerExternalId: team, nflGameId: playing ? gameId : null,
      nflTeam: team, position: 'DEF' as const, stats: (playing ? { gms_active: 1, gp: 1 } : {}) as Readonly<Record<string,number>>,
      eligibilityEvidence: playing
        ? { kind: 'weekly-stat' as const, source: 'weekly-stat-provider' as const,
          gmsActive: 1 as const, appearances: 1 as const }
        : { kind: 'explicit-ineligible' as const, reason: 'bye' as const, source: 'schedule' as const,
          sourceRevision: 'synthetic-schedule', observedAt: '2026-09-01T00:00:00.000Z',
          effectivePeriod: { season: 2026, seasonType: 'reg' as const, week: 1 } },
      eligibleGameCount: playing ? 1 as const : 0 as const, appearanceGameCount: playing ? 1 as const : 0 as const,
      gamePhase: playing ? 'final' as const : 'unknown' as const };
  })],
};
const scores = [{
  scoringEntityId: entityId, entityKind: 'player' as const, providerExternalId: 'p1',
  nflGameId: gameId, nflTeam: 'NE', position: 'QB' as const, fantasyPoints: 0,
  eligibleGameCount: 1 as const, appearanceGameCount: 0 as const, gamePhase: 'final' as const,
  scoringBreakdown: { pass_td: { stat: 0, weight: 6, points: 0 } },
}, ...observation.entries.filter((entry) => entry.entityKind === 'team_defense').map((entry) => ({
  scoringEntityId: deterministicUuid('test-defense',entry.providerExternalId),
  entityKind: 'team_defense' as const, providerExternalId: entry.providerExternalId,
  nflGameId: entry.nflGameId, nflTeam: entry.nflTeam, position: 'DEF' as const,
  fantasyPoints: 0, eligibleGameCount: entry.eligibleGameCount as 0 | 1,
  appearanceGameCount: entry.appearanceGameCount as 0 | 1, gamePhase: entry.gamePhase,
  scoringBreakdown: { pass_td: { stat: 0, weight: 6, points: 0 } },
}))].sort((left,right) => `${left.entityKind}\0${left.providerExternalId}`
  .localeCompare(`${right.entityKind}\0${right.providerExternalId}`));
const scoreCoverage = {
  complete: true, identity_complete: true, scoring_rules_complete: true,
  scoring_rules_hash: scoringRulesHash,
  expected_scoring_profile_ids: [profileId],
  score_batch_fingerprint: `sha256:${'b'.repeat(64)}`,
  parity_observation_ids: [officialObservationId], parity_expected_entity_count: 1,
  parity_observation_evidence: {
    [officialObservationId]: {
      version: 'players-points-v1', expectedEntityCount: 1, expectedRosterCount: 1,
      expectedRosterIds: ['roster-1'],
      fingerprint: `sha256:${'c'.repeat(64)}`,
    },
  },
  parity_fingerprint: `sha256:${'a'.repeat(64)}`,
};
const scoreSet: AllPlayerScoreSet = {
  scoringProfileId: profileId, scoringRulesHash, scorerVersion: 'sleeper-actual-v1',
  semanticHash: allPlayerScoreSemanticHash({
    scoringProfileId: profileId, scoringRulesHash, scorerVersion: 'sleeper-actual-v1',
    coverage: scoreCoverage, warnings: [],
  }, scores),
  quality: 'complete', scoredEntityCount: 33, eligibleGameCount: 3,
  parityComparisonCount: 1, parityMismatchCount: 0,
  coverage: scoreCoverage,
  warnings: [], scores,
};

describe('all-player Neon persistence', () => {
  it('shares pure shadow/writer preflight and rejects canonical collapse before any SQL', () => {
    const source = { ...observation, entries: [observation.entries[0], {
      ...observation.entries[0], providerExternalId: 'p2',
    }] };
    const duplicated = { ...scoreSet, scores: [scores[0], {
      ...scores[0], providerExternalId: 'p2',
    }] };
    expect(() => prepareAllPlayerBatch({ observation: source, scoreSets: [duplicated],
      verifiedAt: source.observedAt })).toThrow('duplicate canonical identity');
  });

  it('preserves null eligibility for contradictory raw observations', () => {
    const source: AllPlayerStatObservation = { ...observation, quality: 'partial',
      coverage: { complete: false }, entries: [{ ...observation.entries[0],
        stats: { gms_active: 0, gp: 1 }, eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider',
          gmsActive: 0, appearances: 1 },
      }] };
    const prepared = prepareAllPlayerBatch({ observation: source, scoreSets: [],
      verifiedAt: source.observedAt });
    expect(prepared.entries[0]).toMatchObject({ eligibleGameCount: null, appearanceGameCount: null });
    expect(prepared.scoreRows).toEqual([]);
    expect(() => prepareAllPlayerBatch({ observation: source, scoreSets: [scoreSet],
      verifiedAt: source.observedAt })).toThrow();
  });

  it('reuses unchanged material scores while preserving fresh verification coverage', () => {
    const otherId = '55555555-5555-4555-8555-555555555555';
    const nextCoverage = { ...scoreCoverage, parity_observation_ids: [otherId],
      parity_observation_evidence: { [otherId]: scoreCoverage.parity_observation_evidence[officialObservationId] },
      parity_fingerprint: `sha256:${'d'.repeat(64)}`, score_batch_fingerprint: `sha256:${'e'.repeat(64)}` };
    const next = { ...scoreSet, coverage: nextCoverage };
    expect(allPlayerScoreSemanticHash(next, scores)).toBe(scoreSet.semanticHash);
    const input = { observation, scoreSets: [next], verifiedAt: observation.observedAt };
    const prepared = prepareAllPlayerBatch(input);
    expect(prepared.scoreSets[0].coverage.parity_observation_ids).toEqual([otherId]);
    expect(prepared.scoreSets[0].scoreSetId).toBe(prepareAllPlayerBatch({
      ...input, scoreSets: [scoreSet],
    }).scoreSets[0].scoreSetId);
  });

  it('rejects missing write ownership while pure shadow preflight stays read-only', async () => {
    const fake = createFakeProjectionDatabase();
    const input = { observation, scoreSets: [scoreSet], verifiedAt: observation.observedAt };
    expect(prepareAllPlayerBatch(input).scoreSets).toHaveLength(1);
    await expect(createAllPlayerStatisticMethods(fake.database).recordAllPlayerBatch(input))
      .rejects.toThrow('live job fence');
    expect(fake.calls).toHaveLength(0);
  });

  it('hashes immutable content independently of observation timing and input order', () => {
    const hash = allPlayerStatSemanticHash(observation);
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(allPlayerStatSemanticHash({
      ...observation,
      sourceRevision: 'etag:two',
      requestStartedAt: '2026-09-16T00:00:00.000Z',
      requestCompletedAt: '2026-09-16T00:00:01.000Z',
      observedAt: '2026-09-16T00:00:01.000Z',
    })).toBe(hash);
    expect(allPlayerStatSemanticHash({
      ...observation,
      entries: [{ ...observation.entries[0], stats: { gms_active: 1, pass_td: 1 } }],
    })).not.toBe(hash);
    expect(allPlayerStatSemanticHash({
      ...observation,
      entries: [{ ...observation.entries[0], gamePhase: 'live' }],
    })).not.toBe(hash);
  });

  it('writes content, observation, every profile, scores, and pointers in one guarded statement', async () => {
    const fake = createFakeProjectionDatabase(({ parameters }) => [{
      observation_id: parameters[12], content_id: parameters[0], semantic_hash: parameters[6],
      entries_stored: 33, entry_count: 33,
      pointers: [{
        scoreSetId: JSON.parse(String(parameters[17]))[0].id,
        scoringProfileId: profileId,
        pointerOutcome: 'advanced',
      }],
    }]);
    const result = await createAllPlayerStatisticMethods(fake.database).recordAllPlayerBatch({
      fence,
      observation, scoreSets: [scoreSet], verifiedAt: '2026-09-15T00:00:02.000Z',
    });
    expect(result).toMatchObject({
      kind: 'stored',
      value: {
        entriesStored: 33, entryCount: 33,
        scoreSets: [{ scoringProfileId: profileId, pointerOutcome: 'advanced' }],
      },
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].statement).toContain('record-all-player-batch');
    expect(fake.calls[0].statement).toContain('advance_current_all_player_score_set');
    expect(fake.calls[0].parameters).toHaveLength(21);
  });

  it('retains a partial observation without attempting to move a score pointer', async () => {
    const partial = {
      ...observation, quality: 'partial' as const, coverage: { complete: false },
      sourceRevision: 'etag:partial',
    };
    const fake = createFakeProjectionDatabase(({ parameters }) => [{
      observation_id: parameters[12], content_id: parameters[0], semantic_hash: parameters[6],
      entries_stored: 33, entry_count: 33, pointers: [],
    }]);
    await expect(createAllPlayerStatisticMethods(fake.database).recordAllPlayerBatch({
      fence,
      observation: partial, scoreSets: [], verifiedAt: partial.observedAt,
    })).resolves.toMatchObject({ kind: 'stored', value: { scoreSets: [] } });
  });

  it('rejects active-zero corruption before issuing SQL', async () => {
    const fake = createFakeProjectionDatabase();
    const corruptScores = [{ ...scores[0], fantasyPoints: 1 }];
    const corruptSet = {
      ...scoreSet,
      semanticHash: allPlayerScoreSemanticHash({
        scoringProfileId: profileId, scoringRulesHash, scorerVersion: scoreSet.scorerVersion,
        coverage: scoreSet.coverage, warnings: scoreSet.warnings,
      }, corruptScores),
      scores: corruptScores,
    };
    await expect(createAllPlayerStatisticMethods(fake.database).recordAllPlayerBatch({
      fence,
      observation, scoreSets: [corruptSet], verifiedAt: observation.observedAt,
    })).rejects.toThrow('non-appearing or ineligible entity must have zero points');
    expect(fake.calls).toHaveLength(0);
  });

  it('defines exactly six all-player tables with immutable history and least-privilege pointer ACL', () => {
    const migration = readFileSync(join(process.cwd(), 'migrations', '010_all_player_statistics.sql'), 'utf8');
    expect(migration.match(/CREATE TABLE IF NOT EXISTS public\.(?:all_player_|current_all_player_)/gu))
      .toHaveLength(6);
    for (const table of [
      'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations',
      'all_player_score_sets', 'all_player_scores', 'current_all_player_score_sets',
    ]) expect(migration).toContain(table);
    expect(migration).not.toMatch(/all_player_(?:rank|ranking|cumulative|ppg)/iu);
    expect(migration.match(/prevent_all_player_history_change/gu)?.length).toBeGreaterThan(5);
    expect(migration).toContain('advance_current_all_player_score_set');
    expect(migration).toContain('parity_mismatch_count <> 0');
    expect(migration).toContain('candidate.scored_entity_count <> candidate.entry_count');
    expect(migration).toContain("profile.rules_hash AS scoring_rules_hash");
    expect(migration).toContain("parity_observation_ids");
    expect(migration).toContain('appearance_game_count IS DISTINCT FROM 0 OR fantasy_points = 0');
    expect(migration).toContain('CHECK (verified_at >= observed_at)');
    expect(migration).toContain('GRANT SELECT ON TABLE public.current_all_player_score_sets');
    expect(migration).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE)[^;]+current_all_player_score_sets/isu);
  });
});

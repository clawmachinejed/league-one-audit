import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import type { AllPlayerScoreSet, AllPlayerStatObservation } from '../../domain/all-player-statistics';
import {
  allPlayerScoreSemanticHash,
  allPlayerStatSemanticHash,
  createAllPlayerStatisticMethods,
} from './all-player-statistics';

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
  coverage: { complete: true }, warnings: [],
  entries: [{
    entityKind: 'player', providerExternalId: 'p1', nflGameId: gameId,
    nflTeam: 'NE', position: 'QB', stats: { gms_active: 1 },
    eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 },
    eligibleGameCount: 1, appearanceGameCount: 0, gamePhase: 'final',
  }],
};
const scores = [{
  scoringEntityId: entityId, entityKind: 'player' as const, providerExternalId: 'p1',
  nflGameId: gameId, nflTeam: 'NE', position: 'QB' as const, fantasyPoints: 0,
  eligibleGameCount: 1 as const, appearanceGameCount: 0 as const, gamePhase: 'final' as const,
  scoringBreakdown: { pass_td: { stat: 0, weight: 6, points: 0 } },
}];
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
  quality: 'complete', scoredEntityCount: 1, eligibleGameCount: 1,
  parityComparisonCount: 1, parityMismatchCount: 0,
  coverage: scoreCoverage,
  warnings: [], scores,
};

describe('all-player Neon persistence', () => {
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
      entries_stored: 1, entry_count: 1,
      pointers: [{
        scoreSetId: JSON.parse(String(parameters[17]))[0].id,
        scoringProfileId: profileId,
        pointerOutcome: 'advanced',
      }],
    }]);
    const result = await createAllPlayerStatisticMethods(fake.database).recordAllPlayerBatch({
      observation, scoreSets: [scoreSet], verifiedAt: '2026-09-15T00:00:02.000Z',
    });
    expect(result).toMatchObject({
      kind: 'stored',
      value: {
        entriesStored: 1, entryCount: 1,
        scoreSets: [{ scoringProfileId: profileId, pointerOutcome: 'advanced' }],
      },
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].statement).toContain('record-all-player-batch');
    expect(fake.calls[0].statement).toContain('advance_current_all_player_score_set');
    expect(fake.calls[0].parameters).toHaveLength(20);
  });

  it('retains a partial observation without attempting to move a score pointer', async () => {
    const partial = {
      ...observation, quality: 'partial' as const, coverage: { complete: false },
      sourceRevision: 'etag:partial',
    };
    const fake = createFakeProjectionDatabase(({ parameters }) => [{
      observation_id: parameters[12], content_id: parameters[0], semantic_hash: parameters[6],
      entries_stored: 1, entry_count: 1, pointers: [],
    }]);
    await expect(createAllPlayerStatisticMethods(fake.database).recordAllPlayerBatch({
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

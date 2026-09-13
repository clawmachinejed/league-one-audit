import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { createAllPlayerMetricMethods } from './all-player-metrics';

const profileId = '11111111-1111-4111-8111-111111111111';

describe('all-player player metrics', () => {
  it('uses appearances as the PPG denominator and returns no numeric value for zero appearances', async () => {
    const fake = createFakeProjectionDatabase(() => [{
      scoring_profile_id: profileId,
      scoring_entity_id: '22222222-2222-4222-8222-222222222222',
      provider_external_id: '7527', total_fantasy_points: '0.0000',
      appearance_game_count: 0, published_week_count: 1,
      points_per_game: null, denominator_complete: true,
    }, {
      scoring_profile_id: profileId,
      scoring_entity_id: '33333333-3333-4333-8333-333333333333',
      provider_external_id: '12529', total_fantasy_points: '0.0000',
      appearance_game_count: 0, published_week_count: 1,
      points_per_game: null, denominator_complete: true,
    }, {
      scoring_profile_id: profileId,
      scoring_entity_id: '44444444-4444-4444-8444-444444444444',
      provider_external_id: '5859', total_fantasy_points: '4.1000',
      appearance_game_count: 1, published_week_count: 1,
      points_per_game: '4.1000000000000000', denominator_complete: true,
    }, {
      scoring_profile_id: profileId,
      scoring_entity_id: '55555555-5555-4555-8555-555555555555',
      provider_external_id: 'multi-week-player', total_fantasy_points: '18.3000',
      appearance_game_count: 2, published_week_count: 3,
      points_per_game: '9.1500000000000000', denominator_complete: true,
    }]);
    await expect(createAllPlayerMetricMethods(fake.database).readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: ' Sleeper ', season: 2026,
      seasonType: 'reg', throughWeek: 3, scorerVersion: 'sleeper-actual-v1',
    })).resolves.toEqual([{
      scoringProfileId: profileId,
      scoringEntityId: '22222222-2222-4222-8222-222222222222',
      providerExternalId: '7527', totalFantasyPoints: 0,
      appearanceGameCount: 0, publishedWeekCount: 1, pointsPerGame: null,
    }, {
      scoringProfileId: profileId,
      scoringEntityId: '33333333-3333-4333-8333-333333333333',
      providerExternalId: '12529', totalFantasyPoints: 0,
      appearanceGameCount: 0, publishedWeekCount: 1, pointsPerGame: null,
    }, {
      scoringProfileId: profileId,
      scoringEntityId: '44444444-4444-4444-8444-444444444444',
      providerExternalId: '5859', totalFantasyPoints: 4.1,
      appearanceGameCount: 1, publishedWeekCount: 1, pointsPerGame: 4.1,
    }, {
      scoringProfileId: profileId,
      scoringEntityId: '55555555-5555-4555-8555-555555555555',
      providerExternalId: 'multi-week-player', totalFantasyPoints: 18.3,
      appearanceGameCount: 2, publishedWeekCount: 3, pointsPerGame: 9.15,
    }]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toEqual([
      'league1', 'sleeper', 2026, 'reg', 3, 'sleeper-actual-v1',
    ]);
    expect(fake.calls[0].statement).toContain('JOIN current_all_player_score_sets pointer');
    expect(fake.calls[0].statement).toContain("score.entity_kind = 'player'");
    expect(fake.calls[0].statement).toContain('sum(score.appearance_game_count)');
  });

  it('rejects a numeric PPG when the appearance denominator is zero', async () => {
    const fake = createFakeProjectionDatabase(() => [{
      scoring_profile_id: profileId,
      scoring_entity_id: '22222222-2222-4222-8222-222222222222',
      provider_external_id: '7527', total_fantasy_points: '0',
      appearance_game_count: 0, published_week_count: 1,
      points_per_game: '0', denominator_complete: true,
    }]);
    await expect(createAllPlayerMetricMethods(fake.database).readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: 'sleeper', season: 2026,
      seasonType: 'reg', throughWeek: 1, scorerVersion: 'sleeper-actual-v1',
    })).rejects.toThrow('denominator and value disagree');
  });

  it('rejects a partial denominator and invalid query bounds', async () => {
    const partial = createFakeProjectionDatabase(() => [{
      scoring_profile_id: profileId,
      scoring_entity_id: '22222222-2222-4222-8222-222222222222',
      provider_external_id: '7527', total_fantasy_points: '0',
      appearance_game_count: 0, published_week_count: 1,
      points_per_game: null, denominator_complete: false,
    }]);
    const reader = createAllPlayerMetricMethods(partial.database);
    await expect(reader.readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: 'sleeper', season: 2026,
      seasonType: 'reg', throughWeek: 1, scorerVersion: 'sleeper-actual-v1',
    })).rejects.toThrow('denominator is incomplete');
    await expect(reader.readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: 'sleeper', season: 2026,
      seasonType: 'reg', throughWeek: 0, scorerVersion: 'sleeper-actual-v1',
    })).rejects.toThrow('through week is invalid');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fixture from '../../../../test-support/fixtures/sleeper-scoring-event-coverage.json';
import previousProfiles from '../../../../test-support/fixtures/dynasty-league-settings.json';
import { scoreSparseStatistics } from '../../domain/scoring';
import { compatibleScoringRulesHash } from '../../shared/revision-compatibility';
import { providerKey } from '../../shared/provider-identity';
import { normalizeSleeperScoringProfile, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from './scoring-profile';
import { validateSleeperWeeklyStatsResponse } from './weekly-stat-source';

const addedKeys = [
  'pass_int_td', 'st_fum_rec', 'ff', 'def_st_ff', 'st_ff',
  'fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50_59', 'fgm_60p',
] as const;
const oldKeys = new Set([...SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS].filter((key) => (
  !(addedKeys as readonly string[]).includes(key)
)));
const weekly = fixture.weeklyStats as Readonly<Record<string, Readonly<Record<string, number>>>>;

function sqlAllowlist(migration: string): string[] {
  const block = migration.match(/rule\.key <> ALL \(ARRAY\[([\s\S]*?)\]::text\[\]\)/u)?.[1];
  if (!block) throw new Error('Missing SQL scorer allowlist.');
  return [...block.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

describe('qualified native Sleeper actual-scoring events', () => {
  it.each(addedKeys)('has a nonzero public native counter for %s without deriving or aliasing it', (key) => {
    const evidence = fixture.nativeEventProofs.find((item) => item.ruleKey === key)!;
    expect(evidence).toBeDefined();
    expect(evidence.source.status).toBe(200);
    expect(evidence.source.url).toMatch(/^https:\/\/api\.sleeper\.app\/v1\/stats\/nfl\/regular\/20\d{2}\/\d+$/u);
    expect(evidence.source.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const validated = validateSleeperWeeklyStatsResponse({ [evidence.providerExternalId]: evidence.stats });
    expect(validated).not.toBeNull();
    const stats = validated![evidence.providerExternalId].stats;
    expect(stats[key]).toBeGreaterThan(0);
    const weight = key === 'pass_int_td' ? -2 : 1.5;
    const score = scoreSparseStatistics(stats, { [key]: weight }, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
    expect(score).toMatchObject({ available: true, points: stats[key] * weight,
      breakdown: { [key]: { stat: stats[key], weight, points: stats[key] * weight } } });
  });

  it.each(fixture.leagues)('matches every captured $name official Week 2 player score at existing precision', (league) => {
    const errors = Object.entries(league.officialPoints).map(([id, official]) => {
      // The fixture retains the provider's sparse rows and the independent
      // official score. Missing rows are used here only for parity arithmetic;
      // ingestion's existing participation/identity gates remain unchanged.
      const score = scoreSparseStatistics(weekly[id] ?? {}, league.rules, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
      expect(score.available).toBe(true);
      return Math.abs(score.points! - official);
    });
    expect(errors).toHaveLength(league.name === 'Myers' ? 183 : 181);
    expect(Math.max(...errors)).toBeLessThan(0.0001);
    expect(league.maximumAbsoluteDelta).toBeLessThan(0.0001);
  });

  it('keeps all six made-field-goal bins distinct and additive to a configured base award', () => {
    const keys = addedKeys.filter((key) => key.startsWith('fgm_'));
    for (const evidence of fixture.nativeEventProofs.filter((item) => item.ruleKey.startsWith('fgm_'))) {
      const stats = validateSleeperWeeklyStatsResponse({ [evidence.providerExternalId]: evidence.stats })![evidence.providerExternalId].stats;
      expect(keys.reduce((sum, key) => sum + (stats[key] ?? 0), 0)).toBe(stats.fgm);
      const rules = { fgm: 1, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3,
        fgm_40_49: 4, fgm_50_59: 5, fgm_60p: 6 };
      const score = scoreSparseStatistics(stats, rules, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
      expect(score.points).toBe(Object.entries(rules).reduce((sum, [key, weight]) => sum + (stats[key] ?? 0) * weight, 0));
      expect(score.breakdown[evidence.ruleKey].stat).toBeGreaterThan(0);
    }
  });

  it('preserves previously accepted profiles, hashes and score breakdowns', () => {
    for (const league of Object.values(previousProfiles.leagues)) {
      const before = compatibleScoringRulesHash(league.scoring_settings);
      for (const stats of Object.values(weekly)) {
        expect(scoreSparseStatistics(stats, league.scoring_settings, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS))
          .toEqual(scoreSparseStatistics(stats, league.scoring_settings, oldKeys));
      }
      expect(compatibleScoringRulesHash(league.scoring_settings)).toBe(before);
    }
  });

  it('does not turn actual-event evidence into unsupported Tank01 projections', () => {
    const rawRules = Object.fromEntries(addedKeys.map((key) => [key, 1]));
    const result = normalizeSleeperScoringProfile({ provider: providerKey('sleeper'), rawRules });
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Expected valid raw rules.');
    expect(result.profile.rules).toEqual({});
    expect(result.profile.provenance.supportedSourceKeys).toEqual([]);
    expect(result.profile.provenance.unsupportedSourceKeys).toEqual([...addedKeys].sort());
    expect(result.profile.provenance.rawRules).toBe(rawRules);
  });

  it('keeps unknown active rules blocked and unknown zero rules inert', () => {
    expect(scoreSparseStatistics({}, { pass_int_td: -2, unknown: 0 }, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS))
      .toMatchObject({ available: true, points: 0 });
    expect(scoreSparseStatistics({}, { unknown: 1 }, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS))
      .toMatchObject({ available: false, points: null, unsupportedRuleKeys: ['unknown'] });
  });

  it('keeps the database contract exactly aligned while retaining the old v1 allowlist', () => {
    const original = readFileSync(join(process.cwd(), 'migrations/010_all_player_statistics.sql'), 'utf8');
    const expanded = readFileSync(join(process.cwd(), 'migrations/022_sleeper_actual_scoring_events.sql'), 'utf8');
    expect(sqlAllowlist(original).sort()).toEqual([...oldKeys].sort());
    expect(sqlAllowlist(expanded).sort()).toEqual([...SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS].sort());
    expect(expanded).toContain("p_provider = 'sleeper'");
    expect(expanded).toContain("p_scorer_version = 'sleeper-actual-v1'");
    expect(expanded).not.toMatch(/\b(?:CREATE TABLE|UPDATE|DELETE|INSERT|GRANT)\b/u);
  });
});

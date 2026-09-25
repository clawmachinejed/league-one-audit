import { describe, expect, it } from 'vitest';
import calibration from './supplemental-projection-calibration.json';
import evidence from '../../../../test-support/fixtures/supplemental-projection-calibration.json';
import leagues from '../../../../test-support/fixtures/sleeper-capability-settings.json';
import previousProfiles from '../../../../test-support/fixtures/dynasty-league-settings.json';
import { normalizeSleeperScoringProfile } from './scoring-profile';
import { scoreProjection } from '../../domain/scoring';
import { providerKey } from '../../shared/provider-identity';
import { SUPPLEMENTAL_PROJECTION_RULES } from './supplemental-projection-rules';

function profile(rawRules: Readonly<Record<string, unknown>>) {
  const result = normalizeSleeperScoringProfile({ provider: providerKey('sleeper'), rawRules });
  if (result.status !== 'available') throw new Error('Expected valid rules');
  return result.profile;
}

describe('league-specific projections for imported scoring settings', () => {
  it('reproduces calibration totals from retained native prior-season evidence', () => {
    for (const group of ['offense', 'defense', 'kickers'] as const) {
      for (const [key, total] of Object.entries(calibration[group].totals)) {
        expect(evidence.filter(row => row.group === group).reduce((sum, row) =>
          sum + ((row.stats as Readonly<Record<string, number | undefined>>)[key] ?? 0), 0)).toBe(total);
      }
    }
    expect(calibration.defense.rows).toBe(32);
    expect(SUPPLEMENTAL_PROJECTION_RULES.every(([, , rate]) => Number.isFinite(rate) && rate > 0)).toBe(true);
  });
  it('scores all six Myers distance ranges and XP/miss penalties without inventing a zero kicker', () => {
    const raw = leagues.leagues.find(league => league.name === 'Myers')!.scoring_settings;
    const normalized = profile(raw);
    const score = scoreProjection({ kind: 'kicker', fieldGoalsMade: 2, fieldGoalsMissed: 0.3,
      extraPointsMade: 2.8, extraPointsMissed: 0.1 }, normalized.rules);
    expect(score.available).toBe(true);
    expect(score.points).toBeCloseTo(2 * (4 * 3 + 202 * 3 + 278 * 3 + 264 * 4 + 171 * 5 + 12 * 6) / 931 + 2.8 - 0.3 - 0.1, 12);
    expect(normalized.provenance.rawRules).toBe(raw);
    expect(normalized.provenance.supplementalEstimate?.sourceKeys).toContain('fgm_60p');
  });
  it('keeps configured FG base and each distance bonus additive, even with negative or zero weights', () => {
    const rules = profile({ fgm: 3, fgm_40_49: 2, fgm_60p: -1, fgm_20_29: 0 }).rules;
    expect(scoreProjection({ kind: 'kicker', fieldGoalsMade: 2 }, rules).points)
      .toBeCloseTo(2 * (3 + 2 * 264 / 931 - 12 / 931), 12);
    expect(scoreProjection({ kind: 'kicker' }, rules)).toMatchObject({ available: false, points: null });
  });
  it('adds the configured GridIron interception-return penalty and distinct fumble bonuses', () => {
    const raw = leagues.leagues.find(league => league.name === 'The GridIron II')!.scoring_settings;
    const value = profile(raw);
    expect(value.rules.passingInterceptions).toBeCloseTo(-2 - 2 * 28 / 380, 12);
    expect(value.rules.fumbleRecoveries).toBeCloseTo(1 + 332 / 218 + 32 / 218, 12);
    expect(value.rules.receptions).toBeCloseTo(1 + 5 / 11124 + 4 / 11124, 12);
    expect(value.provenance.supplementalEstimate?.sourceKeys).toEqual(['def_st_ff', 'ff', 'pass_int_td', 'st_ff', 'st_fum_rec']);
  });
  it('leaves the previously qualified League One, League Two and Dynasty projections unchanged', () => {
    const keys = new Set<string>(SUPPLEMENTAL_PROJECTION_RULES.map(([key]) => key));
    for (const league of Object.values(previousProfiles.leagues)) {
      const original = league.scoring_settings;
      const withoutNew = Object.fromEntries(Object.entries(original).filter(([key]) => !keys.has(key)));
      expect(profile(original).rules).toEqual(profile(withoutNew).rules);
      expect(profile(original).provenance).not.toHaveProperty('supplementalEstimate');
    }
  });
  it('produces the same compiled profile regardless of the source object key order', () => {
    const raw = leagues.leagues.find(league => league.name === 'Myers')!.scoring_settings;
    expect(profile(raw).rules).toEqual(profile(Object.fromEntries(Object.entries(raw).reverse())).rules);
  });
});

import { describe, expect, it } from 'vitest';
import fixture from '../test-support/fixtures/sleeper-capability-settings.json';
import { assessSleeperLeagueCapabilities } from './league-capabilities';
import type { LeagueCapabilityFeature } from './league-capability-contracts';

const checkedAt = '2026-09-23T20:00:00.000Z';
const simple = { sport: 'nfl', season: '2026', season_type: 'regular', total_rosters: 12,
  roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'], scoring_settings: { pass_yd: 0.04, rec: 0.5 },
  settings: { type: 0, num_teams: 12, start_week: 1, best_ball: 0, league_average_match: 0, playoff_week_start: 15, max_subs: 0 } };
function report(source: unknown = simple) { return assessSleeperLeagueCapabilities(source, checkedAt); }
function feature(source: unknown, id: LeagueCapabilityFeature['id']) { return report(source).features.find(item => item.id === id)!; }

describe('automatic settings capabilities', () => {
  it('separates feature support from the existing schedule limitation and enrollment', () => {
    expect(report()).toMatchObject({ version: 'league-capabilities-v1', status: 'limited', assessedAt: checkedAt,
      configurationRevision: expect.stringMatching(/^[a-f0-9]{64}$/u), scoringRulesHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(report().features.map(item => [item.id, item.status])).toEqual([
      ['roster', 'supported'], ['actual_scoring', 'supported'], ['projections', 'supported'],
      ['standings', 'supported'], ['schedule_history', 'limited'], ['substitutions', 'supported'],
    ]);
    expect(report()).not.toHaveProperty('enrolled');
  });
  it('qualifies the captured actual events but keeps projection and substitution limitations distinct', () => {
    for (const league of fixture.leagues) expect(feature(league, 'actual_scoring').status).toBe('supported');
    for (const name of ['League One', 'Dynasty League']) {
      expect(feature(fixture.leagues.find(league => league.name === name), 'projections').status).toBe('limited');
    }
    for (const name of ['The GridIron II', 'Myers']) {
      expect(feature(fixture.leagues.find(league => league.name === name), 'projections').status).toBe('limited');
      expect(report(fixture.leagues.find(league => league.name === name)).status).toBe('limited');
    }
    expect(feature(fixture.leagues.find(league => league.name === 'Myers'), 'substitutions').status).toBe('supported');
  });
  it('uses supported rule vocabulary regardless of league name, identity or scoring weight', () => {
    const a = report({ ...simple, league_id: '1', name: 'Unrelated', scoring_settings: { pass_yd: 0.05, rec: 1 } });
    expect(a.features.find(item => item.id === 'actual_scoring')?.status).toBe('supported');
    expect(a.configurationRevision).toBe(report({ ...simple, league_id: '2', name: 'Renamed',
      scoring_settings: { rec: 1, pass_yd: 0.05 } }).configurationRevision);
    expect(a.scoringRulesHash).not.toBe(report().scoringRulesHash);
  });
  it('estimates distance-based field goals explicitly instead of omitting the configured award', () => {
    const source = { ...simple, scoring_settings: { ...simple.scoring_settings, fgmiss: -1, fgm_60p: 6 } };
    expect(feature(source, 'actual_scoring').status).toBe('supported');
    expect(feature(source, 'projections').status).toBe('limited');
    expect(feature(source, 'projections').reasons.join(' ')).toContain('historical NFL rates');
  });
  it('ignores zero-valued unknown scoring keys but refuses active unfamiliar rules', () => {
    expect(feature({ ...simple, scoring_settings: { ...simple.scoring_settings, future_rule: 0 } }, 'actual_scoring').status).toBe('supported');
    for (const weight of [1, -1]) expect(feature({ ...simple, scoring_settings: { future_rule: weight } }, 'actual_scoring'))
      .toMatchObject({ status: 'unsupported', ruleKeys: ['future_rule'] });
  });
  it.each([undefined, null, {}, { rec: '1' }, { rec: Number.NaN }, { rec: Infinity }, []])(
    'keeps invalid or missing scoring evidence unverified: %j', scoring => {
      const value = report({ ...simple, scoring_settings: scoring });
      expect(value.configurationRevision).toBeNull();
      expect(value.scoringRulesHash).toBeNull();
      expect(feature({ ...simple, scoring_settings: scoring }, 'actual_scoring').status).toBe('unverified');
    });
  it('matches publication restrictions on an all-zero profile and an older season', () => {
    expect(feature({ ...simple, scoring_settings: { rec: 0 } }, 'actual_scoring').status).toBe('unsupported');
    expect(feature({ ...simple, season: '2025' }, 'actual_scoring').status).toBe('unsupported');
  });
  it('does not claim support for IDP merely because raw slot strings can be displayed', () => {
    const source = { ...simple, roster_positions: ['QB', 'DL', 'LB', 'BN'] };
    expect(feature(source, 'roster')).toMatchObject({ status: 'unsupported', ruleKeys: ['DL', 'LB'] });
    expect(feature(source, 'projections').status).toBe('unsupported');
  });
  it.each([[], null, ['QB', 1]])('does not invent missing or malformed roster slots: %j', slots => {
    expect(feature({ ...simple, roster_positions: slots }, 'roster').status).toBe('unverified');
  });
  it.each([{ league_average_match: 1 }, { best_ball: 1 }, { start_week: 3 }, { divisions: 2 }])(
    'exposes projected-standings restrictions for %j', change => {
      expect(feature({ ...simple, settings: { ...simple.settings, ...change } }, 'standings').status).toBe('unsupported');
    });
  it('keeps missing settings and newly introduced provider format fields unverified', () => {
    expect(feature({ ...simple, settings: null }, 'standings').status).toBe('unverified');
    expect(feature({ ...simple, settings: { ...simple.settings, future_format: 1 } }, 'standings').status).toBe('unverified');
    expect(feature({ ...simple, settings: { ...simple.settings, max_subs: 2 } }, 'substitutions').status).toBe('supported');
  });
  it('records configured and scoring changes while ignoring runtime counters and JSON key order', () => {
    const baseline = report();
    expect(report({ ...simple, settings: { ...simple.settings, leg: 3, last_scored_leg: 2, last_report: 500 } }).configurationRevision)
      .toBe(baseline.configurationRevision);
    expect(report({ ...simple, settings: Object.fromEntries(Object.entries(simple.settings).reverse()) }).configurationRevision)
      .toBe(baseline.configurationRevision);
    expect(report({ ...simple, settings: { ...simple.settings, max_subs: 2 } }).configurationRevision).not.toBe(baseline.configurationRevision);
    expect(report({ ...simple, roster_positions: [...simple.roster_positions].reverse() }).configurationRevision).not.toBe(baseline.configurationRevision);
  });
  it.each([-1, 1.5, 4, undefined])('does not qualify an unknown AutoSub count %s', max_subs => {
    expect(feature({ ...simple, settings: { ...simple.settings, max_subs } }, 'substitutions').status).toBe('unverified');
  });
  it.each([0, 1])('follows official swaps for AutoSub start-time policy %s', sub_start_time_eligibility => {
    expect(feature({ ...simple, settings: { ...simple.settings, max_subs: 2,
      sub_start_time_eligibility, sub_lock_if_starter_active: 0 } }, 'substitutions').status).toBe('supported');
    expect(feature({ ...simple, settings: { ...simple.settings, max_subs: 2,
      sub_start_time_eligibility: 2 } }, 'substitutions').status).toBe('unverified');
  });
  it('does not hash unchecked team-count objects or claim an odd-team projected table is supported', () => {
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(report({ ...simple, total_rosters: circular }).configurationRevision).toBeNull();
    expect(feature({ ...simple, total_rosters: 11, settings: { ...simple.settings, num_teams: 11 } }, 'standings').status).toBe('unsupported');
  });
  it('distinguishes absent competition evidence from a known unsupported format', () => {
    const settings: Record<string, number> = { ...simple.settings }; delete settings.best_ball;
    expect(feature({ ...simple, settings }, 'standings').status).toBe('unverified');
    expect(feature({ ...simple, settings }, 'schedule_history').status).toBe('unverified');
  });
  it.each([null, {}, { ...simple, sport: 'nba' }, { ...simple, season_type: 'post' }])(
    'never interprets incomplete or wrong-scope source settings as a pass: %j', source => {
      expect(report(source)).toMatchObject({ status: 'unverified', configurationRevision: null });
      expect(report(source).features.every(item => item.status === 'unverified')).toBe(true);
    });
  it('does not treat unequal two-point weights as supported aggregate projection data', () => {
    expect(feature({ ...simple, scoring_settings: { pass_2pt: 1, rec_2pt: 2, rush_2pt: 2 } }, 'projections').status).toBe('unsupported');
  });
});

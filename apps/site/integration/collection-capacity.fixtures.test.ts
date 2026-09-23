import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { capacityCatalog, capacityStats, capacityRules, capacitySchedule, capacityLeagueFixture,
  CAPACITY_INVENTORY_SIZE, CAPACITY_STARTERS } from './collection-capacity.fixtures';
import { sleeperOfficialRosteredPoints } from '../lib/projections/adapters/sleeper/all-player-stats';
import { externalLeagueRef } from '../lib/projections/shared/provider-identity';
import { scoreSparseStatistics } from '../lib/projections/domain/scoring';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../lib/projections/adapters/sleeper/scoring-profile';

describe('collection capacity fixture integrity', () => {
  it('uses the retained full scoring dictionary with nonzero defenses and4,385 identities', () => {
    const stats = capacityStats(0); const rules = capacityRules(0, false);
    expect(Object.keys(stats)).toHaveLength(CAPACITY_INVENTORY_SIZE);
    expect(Object.keys(capacityCatalog)).toHaveLength(CAPACITY_INVENTORY_SIZE - 32);
    expect(Object.keys(rules).length).toBeGreaterThan(35);
    const defense = scoreSparseStatistics(stats.NE, rules, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
    expect(defense.available).toBe(true); expect(defense.points).toBeGreaterThan(0);
    expect(capacityRules(1, false)).toEqual(rules);
    expect(capacityRules(1, true)).not.toEqual(rules);
  });
  it('keeps representative numeric player and uppercase defense IDs in the same parity order', () => {
    const ids = Object.keys(capacityStats(0));
    expect(Object.keys(capacityCatalog).every(id => /^\d+$/u.test(id))).toBe(true);
    expect(ids.toSorted((left, right) => left.localeCompare(right))).toEqual(ids.toSorted());
  });
  for (const dynasty of [false, true]) it(`covers all starters and bench in${dynasty ? '10x20' : '12x14'} rosters`, () => {
    const configuration = { key: 'capacity-shared-001', displayName: 'Synthetic',
      leagueRef: externalLeagueRef('sleeper', 'synthetic'), matchupWeekRange: { firstWeek: 1, lastWeek: 18 } };
    const input = { configuration, period: { season: 2188, seasonType: 'regular' as const, week: 1 },
      schedule: capacitySchedule('2026-09-01T17:00:00.000Z'), rules: capacityRules(0, false), stats: capacityStats(0),
      observedAt: '2026-09-02T00:00:00.000Z', dynasty };
    const fixture = capacityLeagueFixture(input);
    const rosterCount = dynasty ? 10 : 12; const rosterSize = dynasty ? 20 : 14;
    expect(fixture.rawMatchups).toHaveLength(rosterCount);
    expect(fixture.state.rosteredEntities).toHaveLength(rosterCount * rosterSize);
    expect(new Set(fixture.state.rosteredEntities.map(entity => entity.externalRef.externalId)).size).toBe(rosterCount * rosterSize);
    const official = sleeperOfficialRosteredPoints(fixture.rawMatchups, fixture.expectedRosterIds);
    expect(official).toMatchObject({ status: 'available', entityCount: rosterCount * rosterSize });
    for (const row of fixture.rawMatchups) {
      expect(row.starters).toHaveLength(CAPACITY_STARTERS.length);
      expect(row.players).toHaveLength(rosterSize);
      expect(row.points).toBeCloseTo(row.starters!.reduce((sum, id) => sum + row.players_points![id]!, 0), 8);
    }
    const alternate = capacityLeagueFixture({ ...input, configuration: { ...configuration, key: 'capacity-shared-002' } });
    expect(alternate.rawMatchups[0].players).not.toEqual(fixture.rawMatchups[0].players);
    const bad = capacityLeagueFixture({ ...input, parityFailure: true });
    expect(bad.rawMatchups[0].points).toBe(fixture.rawMatchups[0].points);
    expect(bad.rawMatchups[0].players_points![bad.rawMatchups[0].players!.at(-1)!])
      .toBe(fixture.rawMatchups[0].players_points![fixture.rawMatchups[0].players!.at(-1)!]! + 1);
  });
});

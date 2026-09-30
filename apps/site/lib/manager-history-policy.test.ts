import { describe, expect, it } from 'vitest';
import { assertManagerHistoryPreviousSeasonIdentity, managerHistoryFirstSeason, managerHistoryPreviousLeagueId,
  managerHistoryRegularEnd, managerHistoryUnsupported } from './manager-history-policy';

describe('shared manager history policy', () => {
  it('keeps curated history scope keyed by permanent league and excludes postseason', () => {
    expect(['league1', 'league2', 'dynasty', 'sleeper-123'].map(managerHistoryFirstSeason))
      .toEqual([2024, 2025, 2025, 2025]);
    expect(managerHistoryRegularEnd({ settings: { playoff_week_start: 14 } })).toBe(13);
    expect(managerHistoryRegularEnd({ settings: { playoff_week_start: 1 } })).toBe(0);
    expect(managerHistoryRegularEnd({ settings: { playoff_week_start: 18 } })).toBe(14);
    for (const start of [undefined, null, 0, -1, 14.5, '14']) {
      expect(managerHistoryRegularEnd({ settings: { playoff_week_start: start } })).toBe(14);
    }
    expect(managerHistoryRegularEnd({})).toBe(14);
  });

  it('keeps unsupported competition explicit without treating missing defaults as unsupported', () => {
    expect(managerHistoryUnsupported({})).toBe(false);
    expect(managerHistoryUnsupported({ settings: { league_average_match: 0, best_ball: '0', start_week: '1' } })).toBe(false);
    for (const settings of [{ league_average_match: 1 }, { best_ball: 1 }, { start_week: 2 }, { start_week: 'unknown' }]) {
      expect(managerHistoryUnsupported({ settings })).toBe(true);
    }
  });

  it('keeps opaque numeric predecessor keys exact and rejects cyclic, missing or unbounded discovery', () => {
    const seen = new Set(['1378850182409490432']);
    const original = [...seen];
    expect(managerHistoryPreviousLeagueId('1188632688331706368', seen)).toBe('1188632688331706368');
    expect([...seen]).toEqual(original);
    for (const key of [null, undefined, '', 1188632688331706368, 'league name', ' 1188632688331706368 ', ...seen]) {
      expect(() => managerHistoryPreviousLeagueId(key, seen)).toThrow('The prior-season league connection is missing or invalid.');
    }
    expect(managerHistoryPreviousLeagueId('21', new Set(Array.from({ length: 19 }, (_, index) => String(index)))))
      .toBe('21');
    expect(() => managerHistoryPreviousLeagueId('21', new Set(Array.from({ length: 20 }, (_, index) => String(index)))))
      .toThrow('The prior-season league connection is missing or invalid.');
  });

  it('accepts only the exact expected annual source, prior year and completed status', () => {
    const league = { league_id: '1188632688331706368', season: '2025', status: 'complete' };
    expect(() => assertManagerHistoryPreviousSeasonIdentity(league, league.league_id, 2025)).not.toThrow();
    for (const invalid of [null, [], {}, { ...league, league_id: '1118614856996909056' },
      { ...league, season: '2024' }, { ...league, season: 2025 }, { ...league, status: 'in_season' }]) {
      expect(() => assertManagerHistoryPreviousSeasonIdentity(invalid, league.league_id, 2025))
        .toThrow('The prior-season league identity or completed status could not be verified.');
    }
  });
});

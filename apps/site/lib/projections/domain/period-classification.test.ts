import { describe, expect, it } from 'vitest';
import type { LeaguePeriodAuthority } from './contracts';
import { externalLeagueRef } from '../shared/provider-identity';
import { classifyLineupWatchPeriod } from './period-classification';

const now = new Date('2026-09-03T12:00:00.000Z');
const leagueRef = externalLeagueRef('official-test-provider', 'league-A');
const period = { season: 2026, seasonType: 'regular' as const, week: 5 };
const options = { now, expectedLeagueRef: leagueRef, range: { firstWeek: 1, lastWeek: 18 } };
function authority(overrides: Partial<LeaguePeriodAuthority> = {}): LeaguePeriodAuthority {
  return {
    configuration: { key: 'league-A', displayName: 'A', leagueRef, matchupWeekRange: options.range },
    defaultDisplayPeriod: period, activeScoringPeriod: period,
    lifecycle: 'active', nflPhase: 'regular', source: leagueRef.provider,
    sourceRevision: 'test-source', observedAt: now.toISOString(), verifiedAt: now.toISOString(),
    ...overrides,
  };
}

describe('lineup-watch period ownership', () => {
  it('keeps the preseason default watcher-current but materializer-future', () => {
    expect(classifyLineupWatchPeriod(authority({ lifecycle: 'preseason', activeScoringPeriod: null, nflPhase: 'preseason' }), period, options))
      .toEqual({ kind: 'classified', watchClass: 'current', materializationLane: 'future' });
  });
  it('classifies later preseason periods as future', () => {
    expect(classifyLineupWatchPeriod(authority({ lifecycle: 'preseason', activeScoringPeriod: null }), { ...period, week: 6 }, options))
      .toEqual({ kind: 'classified', watchClass: 'future', materializationLane: 'future' });
  });
  it('keeps the active scoring week current when display has advanced', () => {
    const source = authority({ defaultDisplayPeriod: { ...period, week: 6 } });
    expect(classifyLineupWatchPeriod(source, period, options)).toEqual({ kind: 'classified', watchClass: 'current', materializationLane: 'current' });
    expect(classifyLineupWatchPeriod(source, { ...period, week: 6 }, options)).toEqual({ kind: 'classified', watchClass: 'future', materializationLane: 'future' });
  });
  it('retires earlier periods only after authority advances', () => {
    expect(classifyLineupWatchPeriod(authority(), { ...period, week: 4 }, options)).toEqual({ kind: 'classified', watchClass: 'completed', materializationLane: null });
    expect(classifyLineupWatchPeriod(authority(), period, options)).toEqual({ kind: 'classified', watchClass: 'current', materializationLane: 'current' });
  });
  it('retires all periods after the league completes', () => {
    for (const week of [1, 5, 18]) {
      expect(classifyLineupWatchPeriod(authority({ lifecycle: 'complete', activeScoringPeriod: null }), { ...period, week }, options))
        .toEqual({ kind: 'classified', watchClass: 'completed', materializationLane: null });
    }
  });
  it('fails closed for absent, stale, and future-dated authority', () => {
    expect(classifyLineupWatchPeriod(null, period, options)).toEqual({ kind: 'unavailable', reason: 'missing' });
    expect(classifyLineupWatchPeriod(authority({ observedAt: '2026-09-03T11:49:59.999Z' }), period, options)).toEqual({ kind: 'unavailable', reason: 'stale' });
    expect(classifyLineupWatchPeriod(authority({ observedAt: '2026-09-03T12:00:01Z', verifiedAt: '2026-09-03T12:00:01Z' }), period, options)).toEqual({ kind: 'unavailable', reason: 'malformed' });
  });
  it('accepts the exact ten-minute age boundary but not a stale source with fresh verification', () => {
    expect(classifyLineupWatchPeriod(authority({ observedAt: '2026-09-03T11:50:00Z' }), period, options).kind).toBe('classified');
    expect(classifyLineupWatchPeriod(authority({ observedAt: '2026-09-03T11:49:00Z' }), period, options)).toEqual({ kind: 'unavailable', reason: 'stale' });
  });
  it('rejects a changed external league identity even when provider is unchanged', () => {
    const changed = externalLeagueRef(leagueRef.provider, 'replaced-league');
    expect(classifyLineupWatchPeriod(authority(), period, { ...options, expectedLeagueRef: changed })).toEqual({ kind: 'unavailable', reason: 'provider-mismatch' });
  });
  it('rejects contradictory lifecycle and active period', () => {
    expect(classifyLineupWatchPeriod(authority({ activeScoringPeriod: null }), period, options)).toEqual({ kind: 'unavailable', reason: 'malformed' });
    expect(classifyLineupWatchPeriod(authority({ lifecycle: 'preseason' }), period, options)).toEqual({ kind: 'unavailable', reason: 'malformed' });
    expect(classifyLineupWatchPeriod(authority({ activeScoringPeriod: { ...period, week: 6 } }), period, options)).toEqual({ kind: 'unavailable', reason: 'malformed' });
  });
  it('rejects regressing week or lifecycle but permits a new season', () => {
    expect(classifyLineupWatchPeriod(authority({ defaultDisplayPeriod: { ...period, week: 4 }, activeScoringPeriod: { ...period, week: 4 } }), period, { ...options, previousAuthority: authority() }))
      .toEqual({ kind: 'unavailable', reason: 'regressing' });
    expect(classifyLineupWatchPeriod(authority({ lifecycle: 'preseason', activeScoringPeriod: null }), period, { ...options, previousAuthority: authority() }))
      .toEqual({ kind: 'unavailable', reason: 'regressing' });
    const newPeriod = { ...period, season: 2027, week: 1 };
    expect(classifyLineupWatchPeriod(authority({ defaultDisplayPeriod: newPeriod, lifecycle: 'preseason', activeScoringPeriod: null }), newPeriod, { ...options, previousAuthority: authority({ lifecycle: 'complete', activeScoringPeriod: null }) }).kind).toBe('classified');
  });
  it('rejects out-of-horizon weeks without changing another league range', () => {
    expect(classifyLineupWatchPeriod(authority(), { ...period, week: 18 }, { ...options, range: { firstWeek: 1, lastWeek: 17 } })).toEqual({ kind: 'unavailable', reason: 'out-of-horizon' });
    expect(classifyLineupWatchPeriod(authority(), { ...period, week: 18 }, options).kind).toBe('classified');
  });
});

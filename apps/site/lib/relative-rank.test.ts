import { describe, expect, it } from 'vitest';
import { relativeRankBand } from './relative-rank';

describe('relative league rank bands', () => {
  it('colors each endpoint by its own position rather than the direction of movement', () => {
    expect([9, 6].map(rank => relativeRankBand(rank, 12))).toEqual(['lower', 'middle']);
    expect([8, 9].map(rank => relativeRankBand(rank, 12))).toEqual(['middle', 'lower']);
    expect([10, 10].map(rank => relativeRankBand(rank, 12))).toEqual(['lower', 'lower']);
    expect([4, 4].map(rank => relativeRankBand(rank, 12))).toEqual(['upper', 'upper']);
  });

  it.each([
    [12, 4, 8], [10, 4, 7], [8, 3, 6], [14, 5, 10], [16, 6, 11],
  ])('uses ceiling-third boundaries for %i teams', (leagueSize, upperEnd, middleEnd) => {
    expect(relativeRankBand(upperEnd, leagueSize)).toBe('upper');
    expect(relativeRankBand(upperEnd + 1, leagueSize)).toBe('middle');
    expect(relativeRankBand(middleEnd, leagueSize)).toBe('middle');
    expect(relativeRankBand(middleEnd + 1, leagueSize)).toBe('lower');
    expect(relativeRankBand(leagueSize, leagueSize)).toBe('lower');
  });

  it.each([null, 0, -1, 13, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('keeps invalid or missing rank %s neutral', rank => {
    expect(relativeRankBand(rank, 12)).toBe('unknown');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('keeps unavailable league size %s neutral', leagueSize => {
    expect(relativeRankBand(1, leagueSize)).toBe('unknown');
  });
});

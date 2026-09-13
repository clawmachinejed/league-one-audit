import { describe, expect, it } from 'vitest';
import {
  getAllPlayerRefreshSlot, isAllPlayerRefreshOpportunity, nextAllPlayerRefreshAt,
} from './all-player-refresh-schedule';

describe('hourly Eastern all-player refresh schedule', () => {
  it.each([
    ['2026-09-13T15:59:59Z', false], ['2026-09-13T16:00:00Z', true],
    ['2026-09-13T16:00:59Z', true], ['2026-09-13T16:01:00Z', true],
    ['2026-09-13T16:01:59Z', true], ['2026-09-13T16:02:00Z', false],
    ['2026-09-14T03:00:00Z', true], ['2026-09-14T04:00:00Z', true],
    ['2026-09-14T05:00:00Z', false], ['2026-12-13T16:00:00Z', false],
    ['2026-12-13T17:00:00Z', true], ['2026-12-14T05:00:00Z', true],
    ['2026-12-14T06:00:00Z', false],
  ])('gates %s at the existing minute cron boundary', (timestamp, expected) => {
    expect(isAllPlayerRefreshOpportunity(new Date(timestamp))).toBe(expected);
  });

  it('has thirteen scheduled slots, each with at most two cheap checks per service day', () => {
    const noon = Date.parse('2026-09-13T16:00:00Z');
    const allowed = Array.from({ length: 24 * 60 }, (_, minute) => new Date(noon + minute * 60_000))
      .filter(isAllPlayerRefreshOpportunity);
    expect(allowed).toHaveLength(26);
    expect(new Set(allowed.map(getAllPlayerRefreshSlot)).size).toBe(13);
    expect(allowed[0].toISOString()).toBe('2026-09-13T16:00:00.000Z');
    expect(allowed.at(-1)?.toISOString()).toBe('2026-09-14T04:01:00.000Z');
  });

  it.each([
    ['2026-09-13T15:59:59Z', '2026-09-13T16:00:00.000Z'],
    ['2026-09-13T16:00:00Z', '2026-09-13T17:00:00.000Z'],
    ['2026-09-14T03:59:59Z', '2026-09-14T04:00:00.000Z'],
    ['2026-09-14T04:00:00Z', '2026-09-14T16:00:00.000Z'],
    ['2026-03-08T05:00:00Z', '2026-03-08T16:00:00.000Z'],
    ['2026-11-01T04:00:00Z', '2026-11-01T17:00:00.000Z'],
  ])('finds the next hour after %s across midnight and DST', (timestamp, expected) => {
    expect(nextAllPlayerRefreshAt(new Date(timestamp)).toISOString()).toBe(expected);
  });

  it('uses the same UTC slot throughout an allowed Eastern hour and rejects invalid dates', () => {
    expect(getAllPlayerRefreshSlot(new Date('2026-09-13T16:59:59Z'))).toBe('2026-09-13T16:00:00.000Z');
    expect(getAllPlayerRefreshSlot(new Date('2026-09-13T05:00:00Z'))).toBeNull();
    expect(getAllPlayerRefreshSlot(new Date(NaN))).toBeNull();
    expect(isAllPlayerRefreshOpportunity(new Date(NaN))).toBe(false);
    expect(() => nextAllPlayerRefreshAt(new Date(NaN))).toThrow('refresh time is invalid');
  });
});

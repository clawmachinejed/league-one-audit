import { types } from '@neondatabase/serverless';
import { describe, expect, it } from 'vitest';
import { assertInstant } from '../lib/aggregator/validation';
import { exactMatchupClockInstant } from './exact-matchup-clock';

describe('exact matchup fixture clock', () => {
  it('preserves the driver Date milliseconds as a valid accepted-resource instant', () => {
    const driverDate = types.getTypeParser(1184)('2026-09-29 16:00:38.527890+00');
    expect(driverDate).toBeInstanceOf(Date);
    expect(new Date(String(driverDate)).toISOString()).toBe('2026-09-29T16:00:38.000Z');
    const instant = exactMatchupClockInstant(driverDate);
    expect(instant).toBe('2026-09-29T16:00:38.527Z');
    expect(() => assertInstant(instant)).not.toThrow();
    expect(() => assertInstant('2026-09-29T16:00:38.527890Z')).toThrow(/instant/);
  });
});

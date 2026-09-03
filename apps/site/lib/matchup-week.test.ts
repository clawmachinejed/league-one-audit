import { describe, expect, it } from 'vitest';
import { parseMatchupWeek } from './matchup-week';

const validWeeks: ReadonlyArray<readonly [string, number]> = [
  ['1', 1],
  ['01', 1],
  ['18', 18],
];
const invalidWeeks: readonly (string | null | undefined)[] = [
  undefined, null, '', '0', '19', '99', '-1', '1.5', 'week-1', ' 1 ',
];

describe('matchup week parsing', () => {
  it.each(validWeeks)('accepts NFL regular-season week %s', (value, expected) => {
    expect(parseMatchupWeek(value)).toBe(expected);
  });

  it.each(invalidWeeks)(
    'rejects an absent or out-of-range value: %s',
    (value) => {
      expect(parseMatchupWeek(value)).toBeNull();
    },
  );
});

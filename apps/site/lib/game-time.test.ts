import { describe, expect, it } from 'vitest';
import {
  calculateRemainingFraction,
  normalizeGamePhase,
  parseGameClockSeconds,
  resolveGameTime,
  type NflGamePhase,
} from './game-time';

describe('game clock parsing', () => {
  it.each([
    ['15:00', 900],
    ['12:34', 754],
    ['0:09', 9],
    [' 0:00 ', 0],
  ])('parses %s as %d seconds', (clock, seconds) => {
    expect(parseGameClockSeconds(clock)).toBe(seconds);
  });

  it.each(['15:01', '12:60', '-1:00', '1:2', '1.00', 'END', '', '  '])(
    'rejects the undocumented or invalid clock %j',
    (clock) => expect(parseGameClockSeconds(clock)).toBeNull(),
  );

  it('does not reinterpret numeric values as seconds', () => {
    expect(parseGameClockSeconds(900)).toBeNull();
  });
});

describe('game phase normalization', () => {
  it.each([
    [0, 'Q4', null, 'pregame'],
    [1, '1st Quarter', null, 'q1'],
    [1, 'Q2', null, 'q2'],
    [1, null, 'Halftime', 'halftime'],
    [1, '3', null, 'q3'],
    [1, 'Fourth Quarter', null, 'q4'],
    [1, 'OT2', null, 'overtime'],
    [2, 'Final/OT', null, 'final'],
    [3, null, null, 'postponed'],
    [4, null, null, 'suspended'],
    [1, 'weather delay', null, 'unknown'],
  ] as const)('normalizes status %s period %s to %s', (statusCode, period, statusText, expected) => {
    expect(normalizeGamePhase(statusCode, period, statusText)).toBe(expected);
  });
});

describe('clock-v1 remaining fraction', () => {
  it.each([
    ['q1', 15 * 60, 1],
    ['q1', 0, 0.75],
    ['q2', 15 * 60, 0.75],
    ['q2', 0, 0.5],
    ['q3', 15 * 60, 0.5],
    ['q3', 0, 0.25],
    ['q4', 15 * 60, 0.25],
    ['q4', 0, 0],
    ['overtime', 10 * 60, 0],
    ['overtime', 0, 0],
  ] as const)('calculates %s with %d seconds remaining', (phase, seconds, expected) => {
    expect(calculateRemainingFraction(1, phase, seconds)).toBeCloseTo(expected, 10);
  });

  it('uses status-code rules for non-live states', () => {
    expect(calculateRemainingFraction(0, 'pregame', null)).toBe(1);
    expect(calculateRemainingFraction(2, 'final', null)).toBe(0);
    expect(calculateRemainingFraction(3, 'postponed', null)).toBe(1);
    expect(calculateRemainingFraction(4, 'suspended', 300)).toBeNull();
  });

  it.each([
    ['unknown', 300],
    ['q2', null],
    ['q3', -1],
    ['q4', 901],
    ['q1', 1.5],
  ] as ReadonlyArray<readonly [NflGamePhase, number | null]>)('fails closed for %s and clock %s', (phase, seconds) => {
    expect(calculateRemainingFraction(1, phase, seconds)).toBeNull();
  });

  it('does not require a clock at halftime', () => {
    expect(resolveGameTime({ statusCode: 1, period: 'Halftime', clock: '' })).toEqual({
      phase: 'halftime', clockSeconds: null, remainingFraction: 0.5,
    });
  });

  it('does not reintroduce regulation baseline volume when overtime starts', () => {
    expect(resolveGameTime({ statusCode: 1, period: 'OT', clock: null })).toEqual({
      phase: 'overtime', clockSeconds: null, remainingFraction: 0,
    });
  });
});

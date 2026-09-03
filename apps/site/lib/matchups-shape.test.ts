import { describe, expect, it } from 'vitest';
import { isMatchupsData } from './matchups-response';
import { validationCases, validationPayload } from './matchups-validation-test-support';

describe('shared matchup shape preserves the existing JavaScript boundary', () => {
  it.each(validationCases())('$name', ({ name, json, valid }) => {
    if (name === 'status throwing coercion') {
      expect(() => isMatchupsData(JSON.parse(json))).toThrow(TypeError);
    } else expect(isMatchupsData(JSON.parse(json))).toBe(valid);
  });

  it('rejects non-finite in-memory numbers before JSON serialization', () => {
    for (const pointsFor of [NaN, Infinity, -Infinity]) {
      const data = validationPayload();
      data.teams[0].pointsFor = pointsFor;
      expect(isMatchupsData(data)).toBe(false);
    }
  });
});

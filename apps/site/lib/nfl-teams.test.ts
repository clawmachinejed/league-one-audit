import { describe, expect, it } from 'vitest';
import { canonicalNflTeam, isNflTeam, NFL_TEAMS, NFL_TEAM_COUNT } from './nfl-teams';

describe('NFL team normalization', () => {
  it('maintains one complete canonical team registry', () => {
    expect(NFL_TEAM_COUNT).toBe(32);
    expect(new Set(NFL_TEAMS).size).toBe(32);
    expect(NFL_TEAMS).toContain('JAX');
    expect(NFL_TEAMS).not.toContain('JAC');
  });

  it.each([
    ['wsh', 'WAS'],
    [' JAC ', 'JAX'],
    ['la', 'LAR'],
    ['lac', 'LAC'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalNflTeam(input)).toBe(expected);
  });

  it('rejects unknown, blank, and non-string values', () => {
    expect(canonicalNflTeam('???')).toBeNull();
    expect(canonicalNflTeam('')).toBeNull();
    expect(canonicalNflTeam(31)).toBeNull();
  });

  it('recognizes only canonical uppercase values as already normalized', () => {
    expect(isNflTeam('WAS')).toBe(true);
    expect(isNflTeam('WSH')).toBe(false);
    expect(isNflTeam('was')).toBe(false);
  });
});

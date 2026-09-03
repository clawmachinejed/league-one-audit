import { describe, expect, it, vi } from 'vitest';
import type { ProjectionCadenceInput } from '../../../sleeper';
import { externalLeagueRef } from '../../shared/provider-identity';
import { createSleeperNflCalendar } from './nfl-calendar';

const configuration = {
  key: 'premier',
  displayName: 'Premier League',
  leagueRef: externalLeagueRef('official-source', 'league-001'),
};

function cadence(
  overrides: Partial<ProjectionCadenceInput> = {},
): ProjectionCadenceInput {
  return {
    sleeperLeagueId: 'league-001',
    season: '2026',
    week: 1,
    schedule: {
      JAX: {
        kind: 'scheduled',
        opponent: 'KC',
        location: 'home',
        date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
      KC: {
        kind: 'scheduled',
        opponent: 'JAX',
        location: 'away',
        date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
    },
    currentNflSeason: '2026',
    currentNflWeek: 1,
    currentNflSeasonType: 'regular',
    ...overrides,
  };
}

describe('Sleeper NFL calendar adapter', () => {
  it('performs one injected load and translates the cadence without changing timestamps', async () => {
    const load = vi.fn(async () => cadence());
    const calendar = createSleeperNflCalendar(load);

    const result = await calendar.getCadenceState(configuration);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('league-001');
    expect(result).toEqual({
      configuration,
      period: { season: 2026, seasonType: 'regular', week: 1 },
      currentPeriod: { season: 2026, week: 1, seasonType: 'regular' },
      schedule: cadence().schedule,
    });
  });

  it('preserves unavailable or unknown current-NFL state', async () => {
    const result = await createSleeperNflCalendar(async () => cadence({
      currentNflSeason: null,
      currentNflWeek: null,
      currentNflSeasonType: 'mystery-stage',
    })).getCadenceState(configuration);

    expect(result.currentPeriod).toEqual({
      season: null,
      week: null,
      seasonType: 'mystery-stage',
    });
  });

  it.each([
    cadence({ sleeperLeagueId: 'another-league' }),
    cadence({ season: '1999' }),
    cadence({ week: 19 }),
  ])('rejects provider identity or period mismatches', async (source) => {
    await expect(createSleeperNflCalendar(async () => source)
      .getCadenceState(configuration)).rejects.toThrow(/Sleeper returned/u);
  });

  it('rejects ambiguous or invalid schedule identities', async () => {
    await expect(createSleeperNflCalendar(async () => cadence({
      schedule: {
        JAC: { kind: 'bye' },
        JAX: { kind: 'bye' },
      },
    })).getCadenceState(configuration)).rejects.toThrow('Sleeper returned an invalid NFL schedule.');
  });
});

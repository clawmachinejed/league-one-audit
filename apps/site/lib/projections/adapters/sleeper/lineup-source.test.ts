import { describe, expect, it, vi } from 'vitest';
import { calculateLineupRevision } from '../../domain/lineup-revision';
import { externalLeagueRef, externalRosterRef } from '../../shared/provider-identity';
import { createSleeperLineupSource } from './lineup-source';
import { createRawSleeperMatchupLoader } from './raw-matchups';
import { translateSleeperLineupObservation } from './lineup-observation';

vi.mock('server-only', () => ({}));

const configuration = { key: 'example', displayName: 'Example', leagueRef: externalLeagueRef('official-source', 'example-league'),
  matchupWeekRange: { firstWeek: 1, lastWeek: 18 } };
const period = { season: 2026, seasonType: 'regular' as const, week: 5 };
const shape = { expectedRosterCount: 2, expectedStarterSlotCount: 2,
  expectedRosterRefs: [1, 2].map((id) => externalRosterRef(configuration.leagueRef, String(id))) };
const rows = [
  { roster_id: 1, matchup_id: 1, starters: ['p1', '0'], points: 2 },
  { roster_id: 2, matchup_id: 1, starters: ['p2', '0'], points: 4 },
];
const started = '2026-09-03T12:00:00.000Z';
const ended = '2026-09-03T12:00:01.000Z';
function source(value: unknown = rows) {
  const readJson = vi.fn(async () => value);
  let tick = 0;
  const raw = createRawSleeperMatchupLoader({ readJson, now: () => tick++ === 0 ? started : ended });
  const adapter = createSleeperLineupSource((league, week, signal) => raw(league, week, 0, signal), () => new Date(ended));
  return { adapter, readJson };
}

describe('thin Sleeper lineup source', () => {
  it('uses exactly one uncached weekly request and hashes identically to the full raw-row translation', async () => {
    const { adapter, readJson } = source();
    const controller = new AbortController();
    const actual = await adapter.getLineup({ configuration, period, shape }, controller.signal);
    expect(readJson).toHaveBeenCalledExactlyOnceWith('/league/example-league/matchups/5', 0, controller.signal);
    expect(actual).toMatchObject({ status: 'complete', requestStartedAt: started, requestCompletedAt: ended });
    const full = translateSleeperLineupObservation(configuration.leagueRef, period, shape, rows);
    if (actual.status !== 'complete' || full.status !== 'complete') throw new Error('Expected complete fixture.');
    expect(await calculateLineupRevision(actual.observation)).toEqual(await calculateLineupRevision(full.observation));
  });
  it.each([
    [[], 'not-ready'],
    [rows.map((row) => ({ ...row, matchup_id: null })), 'not-ready'],
    [[rows[0]], 'invalid'],
    [[rows[0], rows[0]], 'invalid'],
    [[rows[0], { ...rows[1], roster_id: 3 }], 'invalid'],
    [[rows[0], { ...rows[1], starters: ['p2'] }], 'invalid'],
    [{ broken: 'payload' }, 'invalid'],
  ])('classifies structural outcome without another request', async (value, expected) => {
    const { adapter, readJson } = source(value);
    expect((await adapter.getLineup({ configuration, period, shape })).status).toBe(expected);
    expect(readJson).toHaveBeenCalledTimes(1);
  });
  it('does not fetch when authority shape or scope is invalid', async () => {
    const { adapter, readJson } = source();
    expect((await adapter.getLineup({ configuration, period, shape: { ...shape, expectedRosterRefs: [] } })).status).toBe('invalid');
    expect((await adapter.getLineup({ configuration, period: { ...period, week: 19 }, shape })).status).toBe('invalid');
    expect(readJson).not.toHaveBeenCalled();
  });
  it('returns unavailable for a transport failure without exposing raw errors', async () => {
    const load = vi.fn(async () => { throw new Error('private transport information'); });
    const result = await createSleeperLineupSource(load, () => new Date(ended)).getLineup({ configuration, period, shape });
    expect(result).toEqual({ status: 'unavailable', reason: 'source-unavailable', requestStartedAt: ended, requestCompletedAt: ended });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

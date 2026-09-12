import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  buildSleeperAllPlayerInventory,
  createSleeperAllPlayerStatSource,
  sleeperOfficialRosteredPoints,
} from './all-player-stats';
import { NFL_TEAM_CODES } from '../../domain/contracts';

function clock(...values: string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

const catalog = {
  p1: { full_name: 'Quarter Back', position: 'QB', team: 'NE' },
  p2: { full_name: 'Running Back', position: 'RB', team: 'ATL' },
  inactive: {
    full_name: 'Inactive Player', position: 'WR', team: 'NE', active: false, status: 'Inactive',
  },
};
const gamesByTeam = {
  NE: { nflGameId: '11111111-1111-4111-8111-111111111111', phase: 'final' as const },
  ATL: { nflGameId: '22222222-2222-4222-8222-222222222222', phase: 'final' as const },
};
const byeTeamIds = NFL_TEAM_CODES.filter((team) => !(team in gamesByTeam));

function completeInventory() {
  const result = buildSleeperAllPlayerInventory({
    catalog, catalogComplete: true, catalogRevision: 'catalog:2026-09-15',
    rosteredPlayerIds: [], projectionPlayerIds: [],
    gamesByTeam, byeTeamIds, scheduleRevision: 'schedule:2026-week-1',
  });
  if (result.status !== 'available') throw new Error('Expected a complete inventory fixture.');
  return result.inventory;
}

describe('Sleeper all-player weekly-stat adapter', () => {
  it('reuses exact rostered players_points and rejects missing, null, or duplicate evidence', () => {
    expect(sleeperOfficialRosteredPoints([{
      roster_id: 1, matchup_id: 1, players: ['p1', 'p2'], players_points: { p2: 0, p1: 22 },
    }], [1])).toMatchObject({
      status: 'available', entityCount: 2, rosterCount: 1, rosterIds: ['1'],
      fingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      points: [
        { providerExternalId: 'p1', points: 22 },
        { providerExternalId: 'p2', points: 0 },
      ],
    });
    expect(sleeperOfficialRosteredPoints([{
      roster_id: 1, matchup_id: 1, players: ['p1'], players_points: { p1: null },
    }], [1])).toEqual({ status: 'unavailable', reason: 'invalid' });
    expect(sleeperOfficialRosteredPoints([{
      roster_id: 1, matchup_id: 1, players: ['p1', 'p2'], players_points: { p1: 1 },
    }], [1])).toEqual({ status: 'unavailable', reason: 'missing' });
    expect(sleeperOfficialRosteredPoints([{
      roster_id: 1, matchup_id: 1, players: ['p1'], players_points: { p1: 1 },
    }, {
      roster_id: 2, matchup_id: 1, players: ['p1'], players_points: { p1: 1 },
    }], [1, 2])).toEqual({ status: 'unavailable', reason: 'ambiguous' });
    expect(sleeperOfficialRosteredPoints([{
      roster_id: 1, matchup_id: 1, players: ['p1'], players_points: { p1: 1 },
    }], [1, 2])).toEqual({ status: 'unavailable', reason: 'missing' });
    expect(sleeperOfficialRosteredPoints([{
      roster_id: 1, matchup_id: 1, players: ['p1'], players_points: { p1: 1 },
    }], [2])).toEqual({ status: 'unavailable', reason: 'missing' });
  });

  it('validates the whole response, excludes team aggregates, and preserves active-zero evidence', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      p1: { gms_active: 1, gp: 1, pass_yd: 250, pass_td: 2 },
      p2: { gms_active: 1 },
      inactive: { gms_active: 0, gp: 0 },
      NE: { gms_active: 1, gp: 1, sack: 3 },
      ATL: { gms_active: 1, gp: 1, int: 1 },
      TEAM_NE: { pass_yd: 250 },
      'idp-linebacker': { gms_active: 1, gp: 1, tackle_solo: 4 },
    }), { status: 200, headers: { etag: '"week-1"' } }));
    const source = createSleeperAllPlayerStatSource({
      fetch: fetcher as typeof fetch,
      now: clock('2026-09-15T00:00:00.000Z', '2026-09-15T00:00:01.000Z'),
    });
    const result = await source.load({
      season: 2026, week: 1, inventory: completeInventory(),
      gamesByTeam, requireFinalCoverage: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.sleeper.app/v1/stats/nfl/regular/2026/1',
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Expected available stats.');
    expect(result.observation).toMatchObject({
      quality: 'complete', sourceRevision: 'etag:"week-1"',
      coverage: {
        complete: true, responseEntityCount: 7, fantasyEntityCount: 35,
        expectedEntityCount: 35, providerPresentEntityCount: 5,
        providerMissingEntityCount: 30, excludedResponseEntityCount: 2,
      },
    });
    expect(result.observation.entries).not.toContainEqual(
      expect.objectContaining({ providerExternalId: 'TEAM_NE' }),
    );
    expect(result.observation.entries).toContainEqual(expect.objectContaining({
      providerExternalId: 'p2', eligibleGameCount: 1, appearanceGameCount: 0,
    }));
    expect(result.observation.entries).toContainEqual(expect.objectContaining({
      providerExternalId: 'inactive', eligibleGameCount: 0, appearanceGameCount: 0,
    }));
  });

  it('rejects a malformed member instead of publishing the remaining response', async () => {
    const source = createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(JSON.stringify({
        p1: { gms_active: 1 }, p2: { pass_td: '1' },
      }), { status: 200 })) as typeof fetch,
      now: () => new Date('2026-09-15T00:00:00.000Z'),
    });
    await expect(source.load({
      season: 2026, week: 1, inventory: completeInventory(), gamesByTeam,
    })).resolves.toEqual({ status: 'unavailable', reason: 'malformed' });
  });

  it('keeps unknown eligibility unavailable and marks incomplete coverage partial', async () => {
    const source = createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(JSON.stringify({
        p1: { pass_yd: 12 }, NE: { gms_active: 1, gp: 1 },
      }), { status: 200 })) as typeof fetch,
      now: () => new Date('2026-09-15T00:00:00.000Z'),
    });
    const result = await source.load({
      season: 2026, week: 1, inventory: completeInventory(),
      gamesByTeam, requireFinalCoverage: true,
    });
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Expected a retained partial observation.');
    expect(result.observation.quality).toBe('partial');
    expect(result.observation.coverage).toMatchObject({
      complete: false, unknownEligibilityCount: 3,
    });
    expect(result.observation.entries.find((entry) => entry.providerExternalId === 'p1'))
      .toMatchObject({ eligibleGameCount: null, appearanceGameCount: null });
  });

  it('does not let contradictory explicit eligibility evidence become an active zero', async () => {
    const source = createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(JSON.stringify({
        p2: { gms_active: 1, gp: 2 }, NE: { gms_active: 1, gp: 1 },
      }), { status: 200 })) as typeof fetch,
      now: () => new Date('2026-09-15T00:00:00.000Z'),
    });
    const result = await source.load({
      season: 2026, week: 1, inventory: completeInventory(),
      gamesByTeam, requireFinalCoverage: true,
    });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.observation.quality).toBe('partial');
    expect(result.observation.entries.find((entry) => entry.providerExternalId === 'p2'))
      .toMatchObject({ eligibleGameCount: null, appearanceGameCount: null });
  });

  it('uses a deterministic body fingerprint when Sleeper supplies no ETag', async () => {
    const load = async (body: string) => createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(body, { status: 200 })) as typeof fetch,
      now: () => new Date('2026-09-15T00:00:00.000Z'),
    }).load({
      season: 2026, week: 1, inventory: completeInventory(),
      gamesByTeam, requireFinalCoverage: true,
    });
    const left = await load('{"p1":{"gp":1,"gms_active":1},"NE":{"gp":1,"gms_active":1}}');
    const right = await load('{"NE":{"gms_active":1,"gp":1},"p1":{"gms_active":1,"gp":1}}');
    expect(left.status).toBe('available');
    expect(right.status).toBe('available');
    if (left.status !== 'available' || right.status !== 'available') return;
    expect(left.observation.sourceRevision).toBe(right.observation.sourceRevision);
    expect(left.observation.sourceRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('keeps an omitted unrostered target unknown instead of silently treating it as zero', async () => {
    const source = createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(JSON.stringify({
        p1: { gms_active: 1, gp: 1 },
        inactive: { gms_active: 0, gp: 0 },
        NE: { gms_active: 1, gp: 1 }, ATL: { gms_active: 1, gp: 1 },
      }), { status: 200 })) as typeof fetch,
      now: () => new Date('2026-09-15T00:00:00.000Z'),
    });
    const result = await source.load({
      season: 2026, week: 1, inventory: completeInventory(),
      gamesByTeam, requireFinalCoverage: true,
    });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.observation.quality).toBe('partial');
    expect(result.observation.entries.find((entry) => entry.providerExternalId === 'p2'))
      .toMatchObject({
        stats: {}, eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: { kind: 'missing-provider-row' },
      });
  });

  it('fails inventory construction when the reused catalog or weekly schedule is incomplete', () => {
    expect(buildSleeperAllPlayerInventory({
      catalog, catalogComplete: false, catalogRevision: 'catalog:fixture',
      rosteredPlayerIds: [], projectionPlayerIds: [],
      gamesByTeam, byeTeamIds, scheduleRevision: 'schedule:fixture',
    })).toEqual({ status: 'unavailable', reason: 'catalog' });
    expect(buildSleeperAllPlayerInventory({
      catalog, catalogComplete: true, catalogRevision: 'catalog:fixture',
      rosteredPlayerIds: [], projectionPlayerIds: [],
      gamesByTeam, byeTeamIds: [], scheduleRevision: 'schedule:fixture',
    })).toEqual({ status: 'unavailable', reason: 'schedule' });
    expect(buildSleeperAllPlayerInventory({
      catalog, catalogComplete: true, catalogRevision: 'catalog:fixture',
      rosteredPlayerIds: ['missing-rostered'], projectionPlayerIds: [],
      gamesByTeam, byeTeamIds, scheduleRevision: 'schedule:fixture',
    })).toEqual({ status: 'unavailable', reason: 'identity' });
  });

  it('fingerprints exact catalog and schedule eligibility evidence', () => {
    const inventory = completeInventory();
    expect(inventory.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(inventory.entities.find((entity) => entity.providerExternalId === 'inactive'))
      .toMatchObject({
        absentIneligibilityEvidence: {
          kind: 'explicit-ineligible', reason: 'inactive', source: 'player-status-provider',
          sourceRevision: 'catalog:2026-09-15',
        },
      });
    expect(inventory.entities.find((entity) => entity.providerExternalId === 'BUF'))
      .toMatchObject({
        absentIneligibilityEvidence: {
          kind: 'explicit-ineligible', reason: 'bye', source: 'schedule',
          sourceRevision: 'schedule:2026-week-1',
        },
      });
    expect(inventory.sourceEvidence).toEqual({
      catalogRevision: 'catalog:2026-09-15',
      scheduleRevision: 'schedule:2026-week-1',
      rosteredPlayerIds: [], projectionPlayerIds: [], byeTeamIds: [...byeTeamIds].sort(),
    });
  });

  it('marks an unknown offensive response identity incomplete instead of treating it as IDP', async () => {
    const source = createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(JSON.stringify({
        p1: { gms_active: 1, gp: 1 }, NE: { gms_active: 1, gp: 1 },
        'unknown-offense': { gms_active: 1, gp: 1, pass_td: 1 },
      }), { status: 200 })) as typeof fetch,
      now: () => new Date('2026-09-15T00:00:00.000Z'),
    });
    const result = await source.load({
      season: 2026, week: 1, inventory: completeInventory(), gamesByTeam,
    });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.observation).toMatchObject({
      quality: 'partial',
      coverage: { complete: false, unexpectedResponseEntityCount: 1 },
    });
    expect(result.observation.warnings).toContain('unexpected-response-entities:1');
  });

  it('rejects a schedule that marks the same team as playing and on bye', () => {
    expect(buildSleeperAllPlayerInventory({
      catalog, catalogComplete: true, catalogRevision: 'catalog:fixture',
      rosteredPlayerIds: [], projectionPlayerIds: [], gamesByTeam,
      byeTeamIds: NFL_TEAM_CODES.filter((team) => team !== 'ATL'),
      scheduleRevision: 'schedule:fixture',
    })).toEqual({ status: 'unavailable', reason: 'schedule' });
  });
});

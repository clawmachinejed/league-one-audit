import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  buildSleeperAllPlayerInventory,
  createSleeperAllPlayerStatSource,
  sleeperOfficialRosteredPoints,
} from './all-player-stats';
import { NFL_TEAM_CODES } from '../../domain/contracts';
import { validateAllPlayerEligibility } from '../../domain/all-player-eligibility';
import { allPlayerStatSemanticHash } from '../neon/all-player-statistics';

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
  'idp-linebacker': { full_name: 'Defensive Player', position: 'LB', team: 'NE' },
};
const period = { season: 2026, seasonType: 'reg' as const, week: 1 };
const observedAt = '2026-09-15T00:00:00.000Z';
const periodInventoryEvidence = {
  source: 'manual-review' as const, sourceRevision: 'synthetic-period-inventory-v1', observedAt,
  effectivePeriod: period, excludedPlayerReasons: {}, teamsByPlayerId: { p1: 'NE', p2: 'ATL', inactive: 'NE' },
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
    period, observedAt, scheduleObservedAt: observedAt, periodInventoryEvidence,
  });
  if (result.status !== 'available') throw new Error('Expected a complete inventory fixture.');
  return result.inventory;
}

describe('Sleeper all-player weekly-stat adapter', () => {
  it.each(['appearance', 'dressed-unused'] as const)(
    'rejects contradictory reviewed inactive and %s inputs before any weekly request', async (decision) => {
      const fetcher = vi.fn<typeof fetch>();
      const inventory = buildSleeperAllPlayerInventory({
        catalog, catalogComplete: true, catalogRevision: 'catalog', rosteredPlayerIds: ['p1'], projectionPlayerIds: [],
        gamesByTeam, byeTeamIds, scheduleRevision: 'schedule', period, observedAt, periodInventoryEvidence,
        ineligibilityEvidenceByPlayerId: { p1: { kind: 'explicit-ineligible', reason: 'inactive',
          source: 'manual-review', sourceRevision: 'reviewed-period-status', effectivePeriod: period, observedAt } },
        periodEligibilityEvidenceByPlayerId: { p1: { kind: 'period-participation', decision,
          source: 'gamebook', sourceRevision: 'reviewed-gamebook', reason: 'Reviewed participation',
          effectivePeriod: period, observedAt } },
      });
      if (inventory.status === 'available') {
        await createSleeperAllPlayerStatSource({ fetch: fetcher, now: () => new Date(observedAt) })
          .load({ season: 2026, week: 1, inventory: inventory.inventory, gamesByTeam });
      }
      expect(inventory).toEqual({ status: 'unavailable', reason: 'eligibility-evidence-conflict', diagnostics: [
        `sleeper/p1:required-official:reviewed-eligibility-conflict:inactive:${decision}`,
      ] });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('rejects a reviewed appearance that contradicts the canonical requested-week bye', () => {
    const byeGames = { ATL: gamesByTeam.ATL };
    const inventory = buildSleeperAllPlayerInventory({
      catalog, catalogComplete: true, catalogRevision: 'catalog', rosteredPlayerIds: [], projectionPlayerIds: [],
      gamesByTeam: byeGames, byeTeamIds: NFL_TEAM_CODES.filter((team) => !(team in byeGames)),
      scheduleRevision: 'reviewed-bye-schedule', scheduleObservedAt: observedAt, period, observedAt, periodInventoryEvidence,
      periodEligibilityEvidenceByPlayerId: { p1: { kind: 'period-participation', decision: 'appearance',
        source: 'gamebook', sourceRevision: 'reviewed-gamebook', reason: 'Reviewed appearance',
        effectivePeriod: period, observedAt } },
    });
    expect(inventory).toMatchObject({ status: 'unavailable', reason: 'eligibility-evidence-conflict', diagnostics: [
      'sleeper/p1:catalog-inventory:reviewed-eligibility-conflict:bye:appearance',
    ] });
  });

  it('keeps unchanged bye evidence material stable with retained source time and records honest fallback churn', async () => {
    const retrieve = async (retrievedAt: string, scheduleObservedAt?: string) => {
      const inventory = buildSleeperAllPlayerInventory({
        catalog, catalogComplete: true, catalogRevision: 'catalog', rosteredPlayerIds: [], projectionPlayerIds: [],
        gamesByTeam, byeTeamIds, scheduleRevision: 'schedule', period, observedAt: retrievedAt,
        scheduleObservedAt, periodInventoryEvidence,
      });
      if (inventory.status !== 'available') throw new Error('Expected inventory.');
      const result = await createSleeperAllPlayerStatSource({ fetch: vi.fn(async () => Response.json(
        Object.fromEntries(['p1', 'p2', 'inactive', 'NE', 'ATL'].map((id) => [id, { gp: 1 }])),
      )), now: () => new Date(retrievedAt) }).load({ season: 2026, week: 1,
        inventory: inventory.inventory, gamesByTeam, requireFinalCoverage: true });
      if (result.status !== 'available') throw new Error('Expected observation.');
      return result.observation;
    };
    const first = await retrieve(observedAt, observedAt);
    const later = await retrieve('2026-09-15T12:00:00.000Z', observedAt);
    expect(first.quality).toBe('complete');
    expect(allPlayerStatSemanticHash(first)).toBe(allPlayerStatSemanticHash(later));
    expect(later.entries.find((entry) => entry.providerExternalId === 'ARI')?.eligibilityEvidence)
      .toMatchObject({ reason: 'bye', observedAt });
    const newlyObservedSchedule = await retrieve('2026-09-15T12:00:00.000Z');
    expect(newlyObservedSchedule.quality).toBe('complete');
    expect(newlyObservedSchedule.entries.find((entry) => entry.providerExternalId === 'ARI'))
      .toMatchObject({ eligibleGameCount: 0, appearanceGameCount: 0,
        eligibilityEvidence: { reason: 'bye', observedAt: '2026-09-15T12:00:00.000Z' } });
    expect(allPlayerStatSemanticHash(newlyObservedSchedule)).not.toBe(allPlayerStatSemanticHash(first));
  });

  it.each([2, -1, 0.5, null, '1', true, [], {}])('retains malformed gp %j with null counts through the shared validator', async (gp) => {
    const result = await createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(JSON.stringify({ p1: { gms_active: 1, gp } }))),
      now: () => new Date(observedAt),
    }).load({ season: 2026, week: 1, inventory: completeInventory(), gamesByTeam });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const entry = result.observation.entries.find((value) => value.providerExternalId === 'p1')!;
    expect(entry).toMatchObject({ eligibleGameCount: null, appearanceGameCount: null,
      eligibilityEvidence: { rawFlags: { gp } } });
    expect(validateAllPlayerEligibility(entry)).toBe(true);
    expect(result.observation.quality).toBe('partial');
  });

  it('does not create dressed-unused evidence from gms_active alone or reject faithful 0/1 contradictions', async () => {
    const result = await createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(JSON.stringify({ p1: { gms_active: 0, gp: 1 }, p2: { gms_active: 1 } }))),
      now: () => new Date(observedAt),
    }).load({ season: 2026, week: 1, inventory: completeInventory(), gamesByTeam });
    if (result.status !== 'available') throw new Error('Expected partial evidence.');
    for (const id of ['p1', 'p2']) {
      const entry = result.observation.entries.find((value) => value.providerExternalId === id)!;
      expect(entry).toMatchObject({ eligibleGameCount: null, appearanceGameCount: null });
      expect(validateAllPlayerEligibility(entry)).toBe(true);
    }
  });

  it('requires finality of every canonical scheduled game even when all rows report ineligibility', async () => {
    const pendingGames = { ...gamesByTeam, ATL: { ...gamesByTeam.ATL, phase: 'unknown' as const } };
    const inventory = buildSleeperAllPlayerInventory({
      catalog, catalogComplete: true, catalogRevision: 'catalog', rosteredPlayerIds: [], projectionPlayerIds: [],
      gamesByTeam: pendingGames, byeTeamIds, scheduleRevision: 'schedule', period, observedAt,
      scheduleObservedAt: observedAt, periodInventoryEvidence,
    });
    if (inventory.status !== 'available') throw new Error('Expected inventory.');
    const source = createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(JSON.stringify(Object.fromEntries(
        ['p1', 'p2', 'inactive', 'NE', 'ATL'].map((id) => [id, { gms_active: 0, gp: 0 }]),
      )))), now: () => new Date(observedAt),
    });
    const complete = await source.load({ season: 2026, week: 1, inventory: inventory.inventory,
      gamesByTeam: pendingGames, requireFinalCoverage: true });
    expect(complete).toMatchObject({ status: 'available', observation: { quality: 'partial', coverage: {
      nonFinalEligibleCount: 0, scheduledGameCount: 2, nonFinalScheduledGameCount: 1, scheduleFinalityComplete: false,
    } } });
    const recurring = await source.load({ season: 2026, week: 1, inventory: inventory.inventory,
      gamesByTeam: pendingGames, requireFinalCoverage: false });
    expect(recurring).toMatchObject({ status: 'available', observation: { quality: 'complete', coverage: {
      mode: 'recurring-current-week', scheduleFinalityComplete: false,
    } } });
  });

  it('preserves current teamless fantasy identities and refuses to call the inventory historically complete', async () => {
    const inventory = buildSleeperAllPlayerInventory({
      catalog: { ...catalog, teamless: { full_name: 'Old Player', position: 'WR', team: null, active: false } },
      catalogComplete: true, catalogRevision: 'current', rosteredPlayerIds: [], projectionPlayerIds: ['8063'],
      gamesByTeam, byeTeamIds, scheduleRevision: 'schedule', period, observedAt,
    });
    if (inventory.status !== 'available') throw new Error('Expected conservative inventory.');
    expect(inventory.inventory.entities).toContainEqual(expect.objectContaining({ providerExternalId: 'teamless',
      absentIneligibilityEvidence: null }));
    const result = await createSleeperAllPlayerStatSource({
      fetch: vi.fn(async () => new Response(JSON.stringify({ p1: { gp: 1 } }))), now: () => new Date(observedAt),
    }).load({ season: 2026, week: 1, inventory: inventory.inventory, gamesByTeam });
    expect(result).toMatchObject({ status: 'available', observation: { quality: 'partial', coverage: {
      periodInventoryComplete: false, unresolvedOptionalProjectionIds: ['8063'],
    } } });
  });

  it('rejects evidence for another week before retrieving weekly statistics', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSleeperAllPlayerStatSource({ fetch: fetcher, now: () => new Date(observedAt) })
      .load({ season: 2026, week: 2, inventory: completeInventory(), gamesByTeam }))
      .resolves.toEqual({ status: 'unavailable', reason: 'malformed' });
    expect(fetcher).not.toHaveBeenCalled();
  });

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
      p2: { gms_active: 1, gp: 0 },
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
      complete: false, unknownEligibilityCount: 4,
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

  it('keeps canonical defenses out of player identity resolution and emits all 32 exactly once', () => {
    const result = buildSleeperAllPlayerInventory({
      catalog: {
        ...catalog,
        ARI: { full_name: 'Arizona Cardinals', position: 'DEF', team: 'ARI' },
        BAL: { full_name: 'Baltimore Ravens', position: 'DEF', team: 'BAL' },
      },
      catalogComplete: true,
      catalogRevision: 'catalog:fixture',
      rosteredPlayerIds: ['p1', 'ARI'],
      projectionPlayerIds: ['p2', 'BAL'],
      gamesByTeam,
      byeTeamIds,
      scheduleRevision: 'schedule:fixture',
    });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const defenses = result.inventory.entities.filter((entity) => entity.entityKind === 'team_defense');
    expect(defenses).toHaveLength(32);
    expect(defenses.map((entity) => entity.providerExternalId).sort())
      .toEqual([...NFL_TEAM_CODES].sort());
    expect(new Set(defenses.map((entity) => entity.providerExternalId)).size).toBe(32);
    expect(defenses.every((entity) => entity.position === 'DEF')).toBe(true);
    expect(result.inventory.entities).not.toContainEqual(expect.objectContaining({
      entityKind: 'player', position: 'DEF',
    }));
    expect(result.inventory.entities.filter((entity) => entity.providerExternalId === 'ARI'))
      .toEqual([expect.objectContaining({
        entityKind: 'team_defense', providerExternalId: 'ARI', nflTeam: 'ARI', position: 'DEF',
      })]);
  });

  it('does not let a canonical defense hide a genuinely missing rostered player', () => {
    expect(buildSleeperAllPlayerInventory({
      catalog,
      catalogComplete: true,
      catalogRevision: 'catalog:fixture',
      rosteredPlayerIds: ['ARI', 'missing-rostered-player'],
      projectionPlayerIds: ['BAL'],
      gamesByTeam,
      byeTeamIds,
      scheduleRevision: 'schedule:fixture',
    })).toEqual({ status: 'unavailable', reason: 'identity' });
  });

  it('fingerprints period evidence without deriving ineligibility from current catalog status', () => {
    const inventory = completeInventory();
    expect(inventory.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(inventory.entities.find((entity) => entity.providerExternalId === 'inactive'))
      .toMatchObject({
        absentIneligibilityEvidence: null,
      });
    expect(inventory.entities.find((entity) => entity.providerExternalId === 'BUF'))
      .toMatchObject({
        absentIneligibilityEvidence: {
          kind: 'explicit-ineligible', reason: 'bye', source: 'schedule',
          sourceRevision: 'schedule:2026-week-1',
        },
      });
    expect(inventory.sourceEvidence).toMatchObject({
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

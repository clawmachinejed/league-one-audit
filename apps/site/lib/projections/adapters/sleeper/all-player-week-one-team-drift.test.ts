import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PlayerCatalog } from '../../../transform';
import type { AllPlayerHistoricalTeamContext } from '../../domain/all-player-team-context';
import { sleeperAllPlayerCatalogContext } from './all-player-catalog-context';
import { prepareAllPlayerBatch } from '../neon/all-player-statistics';
import { buildSleeperAllPlayerInventory, createSleeperAllPlayerStatSource } from './all-player-stats';

/** Sanitized excerpt, not a complete-week fixture or a new provider capture.
 * Weekly entries: accepted 2026-09-15T04:01:25.903Z observation.
 * Read-only export SHA256: 1883d3a8d129dc3b48413606c46bce4ecfc299d8e98261c3dcf2c36bf86b474e.
 * Current catalog: 2026-09-16T22:49:27.925Z, response SHA256
 * cf82ad550ae88d9040b8f24d0474f0487f494d2f7426c01fc150a440805a83f7.
 * Retains only six affected public player identities, their raw weekly statistics,
 * and canonical Week 1 game context. No owner, manager or connection metadata.
 */
const affected = [
  { id: '10937', name: 'Jake Moody', position: 'K', previousTeam: 'BAL' },
  { id: '12523', name: 'Jimmy Horn', position: 'WR', previousTeam: 'CAR' },
  { id: '13674', name: 'Chris Hilton', position: 'WR', previousTeam: 'GB' },
  { id: '7559', name: 'Ihmir Smith-Marsette', position: 'WR', previousTeam: 'ARI' },
  { id: '8041', name: 'Shane Zylstra', position: 'TE', previousTeam: 'NE' },
  { id: '8123', name: 'Hassan Haskins', position: 'RB', previousTeam: 'NE' },
] as const;

const weekOneGames = [
  ['ARI', 'LAC', '452c9b3a-3e2e-5d63-b09a-39d8798876e3'],
  ['ATL', 'PIT', 'd6d61135-1daf-54ce-90f2-67600a244660'],
  ['BAL', 'IND', '48300b3f-b910-5794-9ae6-950deb4c364e'],
  ['BUF', 'HOU', '6f14cc22-988c-5c7e-a68c-5f4fe004d6dc'],
  ['CAR', 'CHI', '1b88a771-3532-5ca2-a16d-72574618ea8b'],
  ['CIN', 'TB', '4a8e1a8c-6129-50bc-af7f-f9c64df5a0b2'],
  ['CLE', 'JAX', '402985d7-fd61-5e2e-a16a-23eb5194b30a'],
  ['DAL', 'NYG', '5f515a0a-09aa-59d8-908e-a208d5f0cc01'],
  ['DEN', 'KC', 'f934895e-ab78-5245-9a10-23458fc5bcb3'],
  ['DET', 'NO', '2cc4c337-cdd1-5630-91b0-a7ba53eb4aa8'],
  ['GB', 'MIN', '4025b797-05c6-5c06-9aa5-bb7ba79a34bd'],
  ['LAR', 'SF', '3f96fc1f-4bc1-5f28-9d3d-fd4bc2e625f1'],
  ['LV', 'MIA', '566bbd64-0d2a-5d12-bf56-f94471adad04'],
  ['NE', 'SEA', '3177a718-7c5e-57cf-bbf1-9d3eea6fef3f'],
  ['NYJ', 'TEN', '188c699b-ed14-58fb-8638-4be91b72a6f8'],
  ['PHI', 'WAS', '49941d42-b7d3-5ede-aa2b-cabe8cc031e5'],
] as const;
const gamesByTeam = Object.fromEntries(weekOneGames.flatMap(([first, second, nflGameId]) => (
  [first, second].map((team) => [team, { nflGameId, phase: 'final' as const }])
)));
const rankOnly = { gms_active: 1, pos_rank_ppr: 999, pos_rank_std: 999, pos_rank_half_ppr: 999 };
const weeklyRows: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  ...Object.fromEntries(affected.map(({ id }) => [id, rankOnly])),
  '12523': {
    gp: 1, kr: 5, pr: 2, fum: 1, kr_yd: 101, pr_yd: 17, kr_lng: 26, kr_ypa: 20.2,
    pr_lng: 17, pr_ypa: 8.5, st_snp: 12, off_snp: 14, pts_ppr: -2, pts_std: -2,
    rec_tgt: 1, fum_lost: 1, tm_st_snp: 37, gms_active: 1, tm_def_snp: 75,
    tm_off_snp: 68, pos_rank_ppr: 110, pos_rank_std: 110, pts_half_ppr: -2,
    pos_rank_half_ppr: 110,
  },
};
const now = '2026-09-16T22:49:27.925Z';
const period = { season: 2026, seasonType: 'reg' as const, week: 1 };

async function replay(currentCatalog: boolean, required: boolean, completed: boolean,
  historicalTeamContexts?: readonly AllPlayerHistoricalTeamContext[]) {
  const catalog: PlayerCatalog = Object.fromEntries(affected.map(({ id, name, position, previousTeam }) => [id, {
    player_id: id, full_name: name, position, fantasy_positions: [position],
    team: currentCatalog ? null : previousTeam,
  }]));
  const inventory = buildSleeperAllPlayerInventory({
    catalog, catalogComplete: true, catalogRevision: currentCatalog ? 'captured-current-catalog' : 'retained-catalog-context',
    rosteredPlayerIds: required ? affected.map(({ id }) => id) : [], projectionPlayerIds: [],
    gamesByTeam, byeTeamIds: [], scheduleRevision: 'retained-2026-week-one-schedule',
    period, observedAt: now, scheduleObservedAt: now,
    ...(historicalTeamContexts ? { historicalTeamContexts } : {}),
  });
  if (inventory.status !== 'available') throw new Error('Expected captured inventory excerpt.');
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(weeklyRows));
  const result = await createSleeperAllPlayerStatSource({ fetch: fetcher, now: () => new Date(now) })
    .load({ season: 2026, week: 1, inventory: inventory.inventory, gamesByTeam, requireFinalCoverage: completed });
  if (result.status !== 'available') throw new Error('Expected retained weekly evidence.');
  return { fetcher, observation: result.observation, catalog };
}

describe('captured Week 1 participation after current catalog team removal', () => {
  it.each([false, true])('retains each affected identity when required=%s without inventing a historical game', async (required) => {
    const before = await replay(false, required, false);
    const after = await replay(true, required, false);
    expect(before.observation.coverage.unmappedGameCount).toBe(0);
    expect(after.observation).toMatchObject({ quality: 'partial', coverage: {
      complete: false, unmappedGameCount: 6, providerPresentEntityCount: 6,
    } });
    const prepared = prepareAllPlayerBatch({ observation: after.observation, scoreSets: [], verifiedAt: now });
    for (const player of affected) {
      const entry = prepared.entries.find((value) => value.providerExternalId === player.id)!;
      expect(entry).toMatchObject({ nflTeam: null, nflGameId: null, eligibleGameCount: 1,
        appearanceGameCount: player.id === '12523' ? 1 : 0, stats: weeklyRows[player.id] });
      expect(entry.eligibilityEvidence).toEqual(before.observation.entries
        .find((value) => value.providerExternalId === player.id)!.eligibilityEvidence);
    }
    expect(prepared.scoreSets).toEqual([]);
    expect(prepared.scoreRows).toEqual([]);
    expect(after.fetcher).toHaveBeenCalledOnce();
  });

  it('keeps raw evidence usable after rollover without treating incomplete context as complete scoring', async () => {
    const { observation } = await replay(true, false, true);
    const prepared = prepareAllPlayerBatch({ observation, scoreSets: [], verifiedAt: now });
    expect(prepared.observation.coverage).toMatchObject({ mode: 'completed-backfill',
      complete: false, scheduleFinalityComplete: true, unmappedGameCount: 6 });
    expect(prepared.entries.find((entry) => entry.providerExternalId === '12523'))
      .toMatchObject({ stats: { fum_lost: 1, off_snp: 14, st_snp: 12 }, appearanceGameCount: 1 });
    expect(() => prepareAllPlayerBatch({ observation: { ...observation, quality: 'complete',
      coverage: { ...observation.coverage, complete: true } }, scoreSets: [], verifiedAt: now }))
      .toThrow();
  });

  it('retains captured conflict provenance and requires an unknown phase for partial missing-game players', async () => {
    const historicalTeamContexts = affected.map(({ id, previousTeam }) => ({
      providerExternalId: id, nflTeam: previousTeam,
      sourceObservationId: '10f1b6f3-08a6-587c-9398-f22bf174e23f', observedAt: '2026-09-15T04:01:25.903Z',
      effectivePeriod: period, hasUnresolvedConflict: false,
    }));
    const { observation } = await replay(true, true, true, historicalTeamContexts);
    expect(Object.keys(observation.coverage.periodTeamContextConflicts as object)).toHaveLength(6);
    expect(observation.warnings).toContain('sleeper/12523:required-official:period-team-context-conflict');
    expect(observation.coverage.historicalTeamContextFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(() => prepareAllPlayerBatch({ observation: { ...observation,
      entries: observation.entries.map((entry) => entry.providerExternalId === '12523'
        ? { ...entry, gamePhase: 'final' } : entry) }, scoreSets: [], verifiedAt: now }))
      .toThrow('invalid-missing-game-context:12523');
  });

  it('does not silently clear unresolved history when the catalog cycles back to its former team', async () => {
    const historicalTeamContexts = [{ providerExternalId: '12523', nflTeam: 'CAR',
      sourceObservationId: '10f1b6f3-08a6-587c-9398-f22bf174e23f', observedAt: '2026-09-15T04:01:25.903Z',
      effectivePeriod: period, hasUnresolvedConflict: true }];
    const { observation, catalog } = await replay(false, false, true, historicalTeamContexts);
    expect(observation.entries.find((entry) => entry.providerExternalId === '12523'))
      .toMatchObject({ nflTeam: null, nflGameId: null, gamePhase: 'unknown', appearanceGameCount: 1 });
    const context = sleeperAllPlayerCatalogContext({ catalog, sourceRevision: `sha256:${'a'.repeat(64)}`,
      observedAt: now, entries: observation.entries });
    expect(context.players.find((entry) => entry.providerExternalId === '12523'))
      .toMatchObject({ currentTeam: 'CAR', nflGameId: null });
  });

  it('does not use a new current team to assign Brock Lampe or Tyler Goodson to a different Week 1 game', async () => {
    const catalog: PlayerCatalog = {
      '12983': { player_id: '12983', full_name: 'Brock Lampe', position: 'FB', fantasy_positions: ['RB'], team: 'BUF' },
      '8207': { player_id: '8207', full_name: 'Tyler Goodson', position: 'RB', fantasy_positions: ['RB'], team: 'DAL' },
    };
    const historicalTeamContexts = [
      { providerExternalId: '12983', nflTeam: 'SEA' }, { providerExternalId: '8207', nflTeam: 'ATL' },
    ].map((entry) => ({ ...entry, sourceObservationId: '10f1b6f3-08a6-587c-9398-f22bf174e23f',
      observedAt: '2026-09-15T04:01:25.903Z', effectivePeriod: period, hasUnresolvedConflict: false }));
    const input = { catalog, catalogComplete: true, catalogRevision: 'captured-two-team-changes',
      rosteredPlayerIds: [], projectionPlayerIds: [], gamesByTeam, byeTeamIds: [],
      scheduleRevision: 'retained-2026-week-one-schedule', period, observedAt: now,
      scheduleObservedAt: now, historicalTeamContexts };
    const inventory = buildSleeperAllPlayerInventory(input);
    if (inventory.status !== 'available') throw new Error('Expected team-conflict inventory.');
    const source = createSleeperAllPlayerStatSource({ fetch: async () => Response.json({
      '12983': rankOnly, '8207': rankOnly,
    }), now: () => new Date(now) });
    const result = await source.load({ season: 2026, week: 1, inventory: inventory.inventory,
      gamesByTeam, requireFinalCoverage: true });
    if (result.status !== 'available') throw new Error('Expected team-conflict partial.');
    for (const id of ['12983', '8207']) {
      expect(result.observation.entries.find((entry) => entry.providerExternalId === id))
        .toMatchObject({ nflTeam: null, nflGameId: null, gamePhase: 'unknown', eligibleGameCount: 1,
          appearanceGameCount: 0, stats: rankOnly, position: 'RB' });
    }
    const providerContext = sleeperAllPlayerCatalogContext({ catalog,
      sourceRevision: `sha256:${'a'.repeat(64)}`, observedAt: now, entries: result.observation.entries });
    expect(providerContext.players).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerExternalId: '12983', currentTeam: 'BUF', nflGameId: null }),
      expect.objectContaining({ providerExternalId: '8207', currentTeam: 'DAL', nflGameId: null }),
    ]));
    expect(prepareAllPlayerBatch({ observation: { ...result.observation, providerContext },
      scoreSets: [], verifiedAt: now }).entries).toHaveLength(34);
    const reviewed = buildSleeperAllPlayerInventory({ ...input, periodInventoryEvidence: {
      source: 'manual-review', sourceRevision: 'synthetic-reviewed-period-resolution', observedAt: now,
      effectivePeriod: period, excludedPlayerReasons: {}, teamsByPlayerId: { '12983': 'SEA', '8207': 'ATL' },
    } });
    if (reviewed.status !== 'available') throw new Error('Expected reviewed inventory.');
    expect(reviewed.inventory.entities.find((entry) => entry.providerExternalId === '12983')?.nflTeam).toBe('SEA');
    expect(reviewed.inventory.sourceEvidence.periodTeamContextConflicts).toEqual({});
    for (const malformed of [
      historicalTeamContexts.map((entry) => ({ ...entry, effectivePeriod: { ...period, week: 2 } })),
      historicalTeamContexts.map((entry) => ({ ...entry, observedAt: '2026-09-17T00:00:00.000Z' })),
      [...historicalTeamContexts, historicalTeamContexts[0]],
    ]) expect(buildSleeperAllPlayerInventory({ ...input, historicalTeamContexts: malformed }))
      .toMatchObject({ status: 'unavailable', diagnostics: ['invalid-historical-team-context'] });
  });
});

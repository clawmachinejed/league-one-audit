import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { foundationFixture, loadFoundationFixtureCatalogPosition } from '../../../../test-support/all-player-foundation-fixture';
import nullRoleIdentity from '../../../../test-support/fixtures/all-player-foundation/null-role-identity.json';
import { loadFoundationWeeklyIdentityCatalog } from '../../../../test-support/all-player-weekly-identity-fixture';
import { loadFantasyPlayerCatalog, classifySleeperCatalogIdentity } from '../../../sleeper-player-catalog';
import { createSleeperAllPlayerStatSource, buildSleeperAllPlayerInventory } from './all-player-stats';
import { scoreSparseStatistics } from '../../domain/scoring';
import { validateAllPlayerObservationEvidence, buildAllPlayerScoreSets } from '../../domain/all-player-statistics';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from './scoring-profile';
import { allPlayerStatSemanticHash, prepareAllPlayerBatch } from '../neon/all-player-statistics';

async function capturedObservation(retrievedAt = foundationFixture.replayObservedAt) {
  const catalog = await loadFantasyPlayerCatalog(loadFoundationFixtureCatalogPosition);
  expect(Object.keys(catalog.catalog).flatMap((id) => {
    const classification = classifySleeperCatalogIdentity(catalog.catalog, id);
    return classification.status === 'invalid' ? [`${id}:${classification.reason}`] : [];
  })).toEqual([]);
  const gamesByTeam = Object.fromEntries(foundationFixture.games.flatMap((game) => [
    [game.homeTeam, { nflGameId: game.nflGameId, phase: game.phase }],
    [game.awayTeam, { nflGameId: game.nflGameId, phase: game.phase }],
  ]));
  const inventory = buildSleeperAllPlayerInventory({
    catalog: catalog.catalog, catalogComplete: catalog.complete, catalogRevision: catalog.sourceRevision!,
    rosteredPlayerIds: foundationFixture.leagues.flatMap((league) => league.rosters.flatMap((roster) => [
      ...roster.players, ...roster.starters, ...(roster.reserve ?? []), ...(roster.taxi ?? []),
    ])).filter((id) => id !== '0'),
    projectionPlayerIds: ['8063'], gamesByTeam, byeTeamIds: [], scheduleRevision: 'retained-canonical-week1',
    period: foundationFixture.period, observedAt: retrievedAt,
    periodEligibilityEvidenceByPlayerId: foundationFixture.reviewedParticipation,
  });
  if (inventory.status !== 'available') throw new Error(`Fixture inventory failed: ${inventory.reason}`);
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(foundationFixture.weekly)));
  const result = await createSleeperAllPlayerStatSource({ fetch: fetcher,
    now: () => new Date(retrievedAt) }).load({ season: 2026, week: 1,
    inventory: inventory.inventory, gamesByTeam, requireFinalCoverage: true });
  if (result.status !== 'available') throw new Error(`Fixture response failed: ${result.reason}`);
  return { catalog, inventory: inventory.inventory, observation: result.observation, fetcher };
}

describe('retained September12 incomplete Week1 foundation evidence', () => {
  it('retains the actual null-role catalog identity as unknown response evidence and rejects it when required', async () => {
    const catalog = { ...loadFoundationWeeklyIdentityCatalog().catalog,
      [nullRoleIdentity.id]: nullRoleIdentity as never };
    const gamesByTeam = Object.fromEntries(foundationFixture.games.flatMap((game) => [
      [game.homeTeam, { nflGameId: game.nflGameId, phase: game.phase }],
      [game.awayTeam, { nflGameId: game.nflGameId, phase: game.phase }],
    ]));
    const input = { catalog, catalogComplete: true, catalogRevision: 'actual-null-role-catalog',
      rosteredPlayerIds: [] as string[], projectionPlayerIds: [], gamesByTeam, byeTeamIds: [],
      scheduleRevision: 'retained-canonical-week1', period: foundationFixture.period,
      observedAt: foundationFixture.replayObservedAt };
    const inventory = buildSleeperAllPlayerInventory(input);
    if (inventory.status !== 'available') throw new Error(`Null-role inventory failed: ${inventory.reason}`);
    expect(inventory.inventory.sourceEvidence.catalogResponseClassifications).not.toHaveProperty('2901');
    expect(inventory.inventory.entities.some((entry) => entry.providerExternalId === '2901')).toBe(false);
    expect(buildSleeperAllPlayerInventory({ ...input, rosteredPlayerIds: ['2901'] }))
      .toEqual({ status: 'unavailable', reason: 'identity' });
    // This constructed weekly row tests classification only; it is not captured
    // participation evidence for Kennedy and never modifies the retained file.
    const result = await createSleeperAllPlayerStatSource({ fetch: async () => Response.json({
      ...foundationFixture.weekly, '2901': { gp: 1 },
    }), now: () => new Date(foundationFixture.replayObservedAt) }).load({ season: 2026, week: 1,
      inventory: inventory.inventory, gamesByTeam, requireFinalCoverage: true });
    if (result.status !== 'available') throw new Error(`Null-role response failed: ${result.reason}`);
    expect(result.observation.quality).toBe('partial');
    expect(result.observation.coverage.unexpectedResponseIds).toEqual(['2901']);
    expect(result.observation.coverage.excludedResponseIds).not.toContain('2901');
    expect(result.observation.coverage.unexpectedResponseEvidence).toHaveProperty('2901', {
      stats: { gp: 1 }, weekly: { appearances: 1, kind: 'weekly-stat', source: 'weekly-stat-provider' },
    });
  });

  it('separately classifies all 201 unseen weekly identities from the later official catalog without enlarging historical inventory', async () => {
    const supplement = loadFoundationWeeklyIdentityCatalog();
    expect(supplement.canonicalJsonSha256).toBe('1ce72b13e654617fbfe81c3f408c2ad0a2574f81d7c3a73b70c5b4cce226146e');
    expect(supplement.addedIdentityIds).toHaveLength(201);
    expect(supplement.overlappingIdentityIds).toHaveLength(97);
    expect(supplement.overlapMetadataDifferences).toEqual([]);
    expect(supplement.catalog['5859']).toEqual(supplement.original['5859']);
    expect(supplement.catalog['5859'].status).toBe('Inactive');
    const positionCounts: Record<string, number> = {};
    for (const id of supplement.addedIdentityIds) {
      expect(Object.hasOwn(foundationFixture.weekly, id), id).toBe(true);
      expect(classifySleeperCatalogIdentity(supplement.original, id), id).toMatchObject({ status: 'missing' });
      expect(classifySleeperCatalogIdentity(supplement.catalog, id), id).toMatchObject({ status: 'out-of-scope' });
      const position = supplement.catalog[id].position!;
      positionCounts[position] = (positionCounts[position] ?? 0) + 1;
    }
    expect(positionCounts).toEqual({ C: 3, CB: 13, DB: 41, DE: 17, DL: 14, DT: 20, LB: 34,
      LS: 4, OG: 3, OL: 34, OT: 9, P: 6, T: 3 });
    const original = await capturedObservation();
    const gamesByTeam = Object.fromEntries(foundationFixture.games.flatMap((game) => [
      [game.homeTeam, { nflGameId: game.nflGameId, phase: game.phase }],
      [game.awayTeam, { nflGameId: game.nflGameId, phase: game.phase }],
    ]));
    const inventory = buildSleeperAllPlayerInventory({
      catalog: supplement.catalog, catalogComplete: true, catalogRevision: `reviewed-current-identities:${supplement.canonicalJsonSha256}`,
      rosteredPlayerIds: original.inventory.sourceEvidence.rosteredPlayerIds,
      projectionPlayerIds: original.inventory.sourceEvidence.projectionPlayerIds,
      gamesByTeam, byeTeamIds: [], scheduleRevision: 'retained-canonical-week1',
      period: foundationFixture.period, observedAt: supplement.supplement.observedAt,
      periodEligibilityEvidenceByPlayerId: foundationFixture.reviewedParticipation,
    });
    if (inventory.status !== 'available') throw new Error(`Supplement inventory failed: ${inventory.reason}`);
    expect(inventory.inventory.entities.map((entry) => entry.providerExternalId))
      .toEqual(original.inventory.entities.map((entry) => entry.providerExternalId));
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(foundationFixture.weekly));
    const result = await createSleeperAllPlayerStatSource({ fetch: fetcher,
      now: () => new Date(supplement.supplement.observedAt) }).load({ season: 2026, week: 1,
      inventory: inventory.inventory, gamesByTeam, requireFinalCoverage: true });
    if (result.status !== 'available') throw new Error(`Supplement response failed: ${result.reason}`);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.observation).toMatchObject({ quality: 'partial', coverage: {
      complete: false, periodInventoryComplete: false, responseEntityCount: 301,
      expectedEntityCount: 4385, expectedTeamDefenseCount: 32,
      providerPresentEntityCount: 96, providerMissingEntityCount: 4289, unknownEligibilityCount: 4320,
      excludedResponseEntityCount: 205, unexpectedResponseEntityCount: 0, unexpectedResponseIds: [],
      nonFinalScheduledGameCount: 14, scheduleFinalityComplete: false,
    } });
    expect(result.observation.coverage.excludedResponseIds).toEqual([
      ...supplement.addedIdentityIds, 'TEAM_LAR', 'TEAM_NE', 'TEAM_SEA', 'TEAM_SF',
    ].sort());
    expect(validateAllPlayerObservationEvidence(result.observation)).toEqual([]);
    expect(() => prepareAllPlayerBatch({ observation: result.observation, scoreSets: [],
      verifiedAt: result.observation.observedAt })).not.toThrow();
    expect(original.observation.coverage).toMatchObject({ expectedEntityCount: 4385,
      unexpectedResponseEntityCount: 201, unknownEligibilityCount: 4320 });
  });

  it('reuses unchanged raw material across actual inventory rebuilds and later retrievals while retaining each observation time', async () => {
    const first = await capturedObservation();
    const later = await capturedObservation('2026-09-13T02:54:37.000Z');
    expect(first.inventory.sourceEvidence.observedAt).not.toBe(later.inventory.sourceEvidence.observedAt);
    expect(first.inventory.fingerprint).toBe(later.inventory.fingerprint);
    expect(first.observation.observedAt).not.toBe(later.observation.observedAt);
    expect(first.observation.entries).toEqual(later.observation.entries);
    expect(allPlayerStatSemanticHash(first.observation)).toBe(allPlayerStatSemanticHash(later.observation));
    for (const { observation } of [first, later]) {
      expect(() => prepareAllPlayerBatch({ observation, scoreSets: [], verifiedAt: observation.observedAt })).not.toThrow();
      expect(observation.quality).toBe('partial');
    }
    const corrected = { ...later.observation, entries: later.observation.entries.map((entry) => (
      entry.providerExternalId === '5859' ? { ...entry, stats: { ...entry.stats, rec_yd: entry.stats.rec_yd + 1 } } : entry
    )) };
    expect(allPlayerStatSemanticHash(corrected)).not.toBe(allPlayerStatSemanticHash(first.observation));
  });

  it('replays both real roster populations, full weekly schema, all canonical defenses and optional8063 without manufacturing completeness', async () => {
    const { inventory, observation, fetcher } = await capturedObservation();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(observation.quality).toBe('partial');
    expect(observation.coverage).toMatchObject({ periodInventoryComplete: false,
      scheduledGameCount: 16, nonFinalScheduledGameCount: 14, scheduleFinalityComplete: false,
      responseEntityCount: 301, expectedEntityCount: 4385, expectedTeamDefenseCount: 32,
      providerPresentEntityCount: 96, providerMissingEntityCount: 4289, unknownEligibilityCount: 4320,
      unexpectedResponseEntityCount: 201, unresolvedOptionalProjectionIds: ['8063'],
    });
    expect(inventory.entities.filter((entry) => entry.entityKind === 'team_defense')).toHaveLength(32);
    expect(validateAllPlayerObservationEvidence(observation)).toEqual([]);
    expect(observation.coverage.unexpectedResponseEvidence).toHaveProperty('3439');
    expect(observation.coverage.excludedResponseIds).toEqual(expect.arrayContaining(['TEAM_LAR', 'TEAM_NE', 'TEAM_SEA', 'TEAM_SF']));
    expect(await buildAllPlayerScoreSets({ observation, profiles: [], expectedScoringProfileIds: [],
      scorerVersion: 'sleeper-actual-v1', supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: () => ({ scoringEntityId: null, conflict: false }) })).toMatchObject({
      status: 'unavailable', reason: 'incomplete-coverage',
    });
  });

  it('preserves Jones and DeVito proven zeros, Willis ambiguity, Brown appearance and Henderson unknown', async () => {
    const { catalog, observation } = await capturedObservation();
    for (const id of ['7527', '11292']) {
      expect(foundationFixture.weekly[id].gp).toBeUndefined();
      const entry = observation.entries.find((value) => value.providerExternalId === id)!;
      expect(entry).toMatchObject({ eligibleGameCount: 1, appearanceGameCount: 0,
        eligibilityEvidence: { kind: 'period-participation', decision: 'dressed-unused', source: 'gamebook' } });
      expect(scoreSparseStatistics(entry.stats, foundationFixture.leagues[0].settings.scoring_settings,
        SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS)).toMatchObject({ available: true, points: 0 });
    }
    expect(observation.entries.find((entry) => entry.providerExternalId === '10224')).toMatchObject({
      eligibleGameCount: null, appearanceGameCount: null, eligibilityEvidence: { decision: 'ambiguous' },
    });
    expect(catalog.catalog['5859'].status).toBe('Inactive');
    const brown = observation.entries.find((entry) => entry.providerExternalId === '5859')!;
    expect(brown).toMatchObject({ eligibleGameCount: 1, appearanceGameCount: 1 });
    expect(scoreSparseStatistics(brown.stats, foundationFixture.leagues[0].settings.scoring_settings,
      SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS)).toMatchObject({ available: true, points: 4.1 });
    expect(foundationFixture.weekly['12529']).toBeUndefined();
    expect(observation.entries.find((entry) => entry.providerExternalId === '12529')).toMatchObject({
      eligibleGameCount: null, appearanceGameCount: null, stats: {},
      eligibilityEvidence: { kind: 'missing-provider-row' },
    });
  });

  it('reproduces exactly49 actual official roster comparisons as subset arithmetic, retaining all missing rows outside that claim', () => {
    let comparisons = 0;
    let missingOccurrences = 0;
    const uniqueIds = new Set<string>();
    for (const league of foundationFixture.leagues) {
      for (const matchup of league.matchups) {
        for (const id of matchup.players ?? []) {
          const stats = foundationFixture.weekly[id];
          if (!stats) { missingOccurrences += 1; continue; }
          const result = scoreSparseStatistics(stats, league.settings.scoring_settings, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
          expect(result.available, `${league.key}:${id}`).toBe(true);
          expect(result.points, `${league.key}:${id}`).toBeCloseTo(matchup.players_points![id]!, 6);
          comparisons += 1;
          uniqueIds.add(id);
        }
      }
    }
    expect(comparisons).toBe(49);
    expect(uniqueIds.size).toBe(25);
    expect(missingOccurrences).toBeGreaterThan(0);
  });
});

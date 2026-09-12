import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { NFL_TEAM_CODES } from './contracts';
import type { AllPlayerStatEntry, AllPlayerStatObservation } from './all-player-observation-evidence';
import { validateAllPlayerPublicationCoverage } from './all-player-publication-coverage';
import { buildSleeperAllPlayerInventory, createSleeperAllPlayerStatSource } from '../adapters/sleeper/all-player-stats';
import { foundationFixture } from '../../../test-support/all-player-foundation-fixture';

const fingerprint = `sha256:${'a'.repeat(64)}`;
const period = { season: 2026, seasonType: 'reg' as const, week: 1 };
const observedAt = '2026-09-15T00:00:00.000Z';

/** Synthetic period proof: variable schedule size, all 32 canonical defenses. */
function observation(gameCount = 16, final = true): AllPlayerStatObservation {
  const playing = NFL_TEAM_CODES.slice(0, gameCount * 2);
  const team = playing[0];
  const defenses: AllPlayerStatEntry[] = NFL_TEAM_CODES.map((nflTeam, index): AllPlayerStatEntry => {
    const active = playing.includes(nflTeam);
    return {
      entityKind: 'team_defense', providerExternalId: nflTeam, nflTeam, position: 'DEF',
      nflGameId: active ? `game-${Math.floor(index / 2)}` : null,
      stats: active ? { gms_active: 1, gp: 1 } : {},
      eligibilityEvidence: active ? { kind: 'weekly-stat', source: 'weekly-stat-provider',
        gmsActive: 1, appearances: 1 } : { kind: 'explicit-ineligible', reason: 'bye', source: 'schedule',
        sourceRevision: 'synthetic-schedule', observedAt, effectivePeriod: period },
      eligibleGameCount: active ? 1 : 0, appearanceGameCount: active ? 1 : 0,
      gamePhase: active ? final ? 'final' : 'live' : 'unknown',
    };
  });
  const player: AllPlayerStatEntry = {
    ...defenses[0], entityKind: 'player', providerExternalId: 'official-player', position: 'QB',
  };
  const entries = [player, ...defenses];
  return {
    provider: 'official-provider', ...period, normalizerVersion: 'synthetic-stat-v1',
    sourceRevision: 'synthetic-stat-revision', requestStartedAt: observedAt,
    requestCompletedAt: observedAt, observedAt, quality: 'complete', warnings: [], entries,
    coverage: {
      complete: true, periodInventoryComplete: true,
      periodInventoryEvidence: { source: 'manual-review', sourceRevision: 'synthetic-period-scope',
        observedAt, effectivePeriod: period, excludedPlayerReasons: {}, teamsByPlayerId: { 'official-player': team } },
      mode: final ? 'completed-backfill' : 'recurring-current-week',
      expectedInventoryFingerprint: fingerprint, rosterInventoryFingerprint: fingerprint,
      projectionInventoryFingerprint: fingerprint, byeInventoryFingerprint: fingerprint,
      catalogRevision: 'synthetic-catalog', scheduleRevision: 'synthetic-schedule',
      expectedEntityCount: 33, fantasyEntityCount: 33, expectedPlayerCount: 1, expectedTeamDefenseCount: 32,
      providerPresentEntityCount: playing.length + 1, providerMissingEntityCount: 32 - playing.length,
      responseEntityCount: playing.length + 1, excludedResponseEntityCount: 0,
      unexpectedResponseEntityCount: 0, unknownEligibilityCount: 0, unmappedGameCount: 0,
      scheduledGameCount: gameCount, nonFinalScheduledGameCount: final ? 0 : gameCount,
      scheduleFinalityComplete: final, nonFinalEligibleCount: 0,
    },
  };
}

describe('shared publication coverage preflight', () => {
  it.each([1, 12, 16])('accepts an honest complete period with %i games', (games) => {
    expect(validateAllPlayerPublicationCoverage(observation(games), { requireFinalCoverage: true })).toEqual([]);
  });

  it('rejects the former shadow success shape that SQL cannot publish', () => {
    expect(validateAllPlayerPublicationCoverage({ ...observation(), coverage: { complete: true } }))
      .toEqual(expect.arrayContaining([
        'invalid-publication-coverage:expectedInventoryFingerprint',
        'invalid-publication-coverage:expectedEntityCount',
        'invalid-publication-coverage:periodInventoryComplete',
      ]));
  });

  it.each([
    ['expectedEntityCount', 32], ['expectedPlayerCount', 2], ['expectedTeamDefenseCount', 31],
    ['fantasyEntityCount', 32], ['providerPresentEntityCount', 0], ['providerMissingEntityCount', 1],
    ['unknownEligibilityCount', 1], ['unmappedGameCount', 1], ['unexpectedResponseEntityCount', 1],
    ['expectedEntityCount', '33'], ['expectedEntityCount', 33.1], ['scheduledGameCount', 15],
    ['nonFinalScheduledGameCount', 1], ['scheduleFinalityComplete', false],
    ['nonFinalEligibleCount', 1], ['responseEntityCount', 32],
  ])('rejects incorrect coverage %s=%s', (key, value) => {
    const source = observation();
    expect(validateAllPlayerPublicationCoverage({ ...source, coverage: { ...source.coverage, [key]: value } }))
      .not.toEqual([]);
  });

  it.each(['expectedInventoryFingerprint', 'rosterInventoryFingerprint', 'projectionInventoryFingerprint',
    'byeInventoryFingerprint', 'catalogRevision', 'scheduleRevision'])(
    'rejects an absent publication field %s', (key) => {
      const source = observation();
      const coverage = { ...source.coverage };
      delete coverage[key];
      expect(validateAllPlayerPublicationCoverage({ ...source, coverage }))
        .toContain(`invalid-publication-coverage:${key}`);
    },
  );

  it.each(['missing', 'duplicate', 'noncanonical', 'wrong-team'] as const)(
    'checks actual canonical defenses: %s', (variant) => {
      const source = observation();
      const entries = [...source.entries];
      if (variant === 'missing') entries.pop();
      if (variant === 'duplicate') entries[32] = entries[31];
      if (variant === 'noncanonical') entries[32] = { ...entries[32], providerExternalId: 'FAKE' };
      if (variant === 'wrong-team') entries[32] = { ...entries[32], nflTeam: entries[31].nflTeam };
      expect(validateAllPlayerPublicationCoverage({ ...source, entries }))
        .toContain('invalid-publication-coverage:canonical-defenses');
    },
  );

  it('does not infer finality from eligible entries or from a declared zero', () => {
    const source = observation(12, false);
    const forced = { ...source, coverage: { ...source.coverage, mode: 'completed-backfill',
      nonFinalEligibleCount: 25, nonFinalScheduledGameCount: 0, scheduleFinalityComplete: true } };
    expect(validateAllPlayerPublicationCoverage(forced)).toContain('invalid-publication-coverage:completed-period-finality');
    expect(validateAllPlayerPublicationCoverage(source)).toEqual([]);
    expect(validateAllPlayerPublicationCoverage(source, { requireFinalCoverage: true }))
      .toContain('invalid-publication-coverage:completed-period-finality');
  });

  it.each(['wrong-period', 'future-proof', 'missing-team', 'excluded-included'] as const)(
    'requires honest period inventory provenance: %s', (variant) => {
      const source = observation();
      const evidence = { ...(source.coverage.periodInventoryEvidence as Record<string, unknown>) };
      if (variant === 'wrong-period') evidence.effectivePeriod = { ...period, week: 2 };
      if (variant === 'future-proof') evidence.observedAt = '2026-09-16T00:00:00.000Z';
      if (variant === 'missing-team') evidence.teamsByPlayerId = {};
      if (variant === 'excluded-included') evidence.excludedPlayerReasons = { 'official-player': 'outside scope' };
      expect(validateAllPlayerPublicationCoverage({ ...source, coverage: { ...source.coverage, periodInventoryEvidence: evidence } }))
        .toContain('invalid-publication-coverage:periodInventoryEvidence');
    },
  );

  it('preserves sparse partial contradictory raw history without publishing it', () => {
    const source = observation();
    const partial: AllPlayerStatObservation = { ...source, quality: 'partial', coverage: { complete: false },
      entries: [{ ...source.entries[0], stats: { gms_active: 0, gp: 1 },
        eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 0, appearances: 1 },
        eligibleGameCount: null, appearanceGameCount: null }] };
    expect(validateAllPlayerPublicationCoverage(partial, { requireFinalCoverage: true })).toEqual([]);
    expect(validateAllPlayerPublicationCoverage({ ...partial, coverage: { complete: false, unknownEligibilityCount: 0 } }))
      .toContain('invalid-publication-coverage:unknownEligibilityCount');
  });

  it('accepts the unchanged retained incomplete Week 1 as partial evidence', async () => {
    const catalog = Object.fromEntries([
      ...Object.values(foundationFixture.catalogs).flat(), ...foundationFixture.selectedUnfilteredIdentities,
    ].map((player) => [player.id, player]));
    const gamesByTeam = Object.fromEntries(foundationFixture.games.flatMap((game) => [
      [game.homeTeam, { nflGameId: game.nflGameId, phase: game.phase }],
      [game.awayTeam, { nflGameId: game.nflGameId, phase: game.phase }],
    ]));
    const inventory = buildSleeperAllPlayerInventory({
      period: foundationFixture.period, observedAt: foundationFixture.replayObservedAt,
      catalog, catalogComplete: true, catalogRevision: 'retained-audit-catalog',
      scheduleRevision: 'retained-audit-game-context', gamesByTeam, byeTeamIds: [],
      rosteredPlayerIds: foundationFixture.leagues.flatMap((league) => league.rosters.flatMap((roster) => roster.players)),
      projectionPlayerIds: [], periodEligibilityEvidenceByPlayerId: foundationFixture.reviewedParticipation,
    });
    expect(inventory.status).toBe('available');
    if (inventory.status !== 'available') throw new Error('Retained inventory unexpectedly rejected');
    const source = createSleeperAllPlayerStatSource({
      fetch: async () => Response.json(foundationFixture.weekly),
      now: () => new Date(foundationFixture.replayObservedAt),
    });
    const result = await source.load({ season: 2026, week: 1, inventory: inventory.inventory,
      gamesByTeam, requireFinalCoverage: true });
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Retained response unexpectedly rejected');
    expect(result.observation.quality).toBe('partial');
    expect(validateAllPlayerPublicationCoverage(result.observation, { requireFinalCoverage: true })).toEqual([]);
  });
});

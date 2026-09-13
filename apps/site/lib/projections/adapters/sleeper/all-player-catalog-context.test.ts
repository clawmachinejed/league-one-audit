import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { playerCatalogIdentityRevision, projectPlayerCatalog } from '../../../sleeper-player-catalog';
import { validateAllPlayerProviderContext } from '../../domain/all-player-provider-context';
import type { AllPlayerStatObservation } from '../../domain/all-player-observation-evidence';
import { prepareAllPlayerBatch } from '../neon/all-player-statistics';
import { sleeperAllPlayerCatalogContext } from './all-player-catalog-context';

const game = '33333333-3333-4333-8333-333333333333';
const observedAt = '2026-09-12T14:00:00.000Z';
const catalog = { '5859': { player_id: '5859', full_name: 'A.J. Brown', position: 'WR',
  team: 'PHI', active: false, status: 'Inactive', injury_status: 'Out' } } as const;
const observation: AllPlayerStatObservation = {
  provider: 'sleeper', season: 2026, seasonType: 'reg', week: 1,
  normalizerVersion: 'sleeper-weekly-stats-v3', sourceRevision: 'retained-week-1',
  requestStartedAt: observedAt, requestCompletedAt: observedAt, observedAt,
  quality: 'partial', coverage: { complete: false }, warnings: [], entries: [{
    entityKind: 'player', providerExternalId: '5859', nflGameId: game, nflTeam: 'PHI',
    position: 'WR', stats: { gp: 1, off_snp: 31 }, gamePhase: 'final',
    eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider',
      appearances: 1, individualSnaps: { off_snp: 31 } },
    eligibleGameCount: 1, appearanceGameCount: 1,
  }],
};
function context() {
  return sleeperAllPlayerCatalogContext({ catalog, sourceRevision: projectPlayerCatalog(catalog).sourceRevision,
    observedAt: '2026-09-12T13:00:00.000Z', entries: observation.entries });
}

describe('dated catalog context without historical eligibility claims', () => {
  it('retains labels with their actual time and requested game while preserving Brown appearance', () => {
    const source = { ...observation, providerContext: context() };
    const prepared = prepareAllPlayerBatch({ observation: source, scoreSets: [], verifiedAt: observedAt });
    expect(source.providerContext).toMatchObject({ role: 'context-only', effectivePeriod: null,
      observedAt: '2026-09-12T13:00:00.000Z', players: [{ providerExternalId: '5859', nflGameId: game,
        status: 'Inactive', active: false, injuryStatus: 'Out' }] });
    expect(prepared.entries[0]).toMatchObject({ eligibleGameCount: 1, appearanceGameCount: 1 });
    expect(prepared.scoreSets).toEqual([]);
  });

  it('reuses raw contents for refreshed advisory labels and dates, retaining a distinct observation', () => {
    const initial = { ...observation, providerContext: context() };
    const later = { ...initial, observedAt: '2026-09-12T15:00:00.000Z', providerContext: {
      ...context(), observedAt: '2026-09-12T14:30:00.000Z', players: [{ ...context().players[0], status: 'Active' }],
    } };
    const first = prepareAllPlayerBatch({ observation: initial, scoreSets: [], verifiedAt: initial.observedAt });
    const next = prepareAllPlayerBatch({ observation: later, scoreSets: [], verifiedAt: later.observedAt });
    expect(first.semanticHash).toBe(next.semanticHash);
    expect(first.contentId).toBe(next.contentId);
    expect(first.observationId).not.toBe(next.observationId);
    const changed = { '5859': { ...catalog['5859'], status: 'Active', active: true, injury_status: 'Questionable' } };
    expect(playerCatalogIdentityRevision(catalog)).toBe(playerCatalogIdentityRevision(changed));
    expect(projectPlayerCatalog(catalog).sourceRevision).not.toBe(projectPlayerCatalog(changed).sourceRevision);
    expect(playerCatalogIdentityRevision(catalog)).not.toBe(playerCatalogIdentityRevision({
      '5859': { ...catalog['5859'], team: 'NE' },
    }));
  });

  it.each([
    ['future observation', () => ({ ...context(), observedAt: '2026-09-13T00:00:00.000Z' })],
    ['date without time', () => ({ ...context(), observedAt: '2026-09-12' })],
    ['invalid calendar date', () => ({ ...context(), observedAt: '2026-02-30T00:00:00.000Z' })],
    ['historic claim', () => ({ ...context(), effectivePeriod: { season: 2026, week: 1 } })],
    ['unknown player', () => ({ ...context(), players: [{ ...context().players[0], providerExternalId: 'unknown' }] })],
    ['different game', () => ({ ...context(), players: [{ ...context().players[0], nflGameId: null }] })],
    ['duplicate player', () => ({ ...context(), players: [context().players[0], context().players[0]] })],
    ['unbounded label', () => ({ ...context(), players: [{ ...context().players[0], status: 'x'.repeat(129) }] })],
    ['coerced active', () => ({ ...context(), players: [{ ...context().players[0], active: 'false' }] })],
    ['unnecessary details', () => ({ ...context(), players: [{ ...context().players[0], injuryNotes: 'omitted' }] })],
  ])('rejects %s before writes', (_name, makeContext) => {
    const source = { ...observation, providerContext: makeContext() } as AllPlayerStatObservation;
    expect(validateAllPlayerProviderContext(source).length).toBeGreaterThan(0);
    expect(() => prepareAllPlayerBatch({ observation: source, scoreSets: [], verifiedAt: observedAt })).toThrow('provider-context');
  });

  it('preserves old observations without inventing a catalog timestamp', () => {
    expect(validateAllPlayerProviderContext(observation)).toEqual([]);
    expect(validateAllPlayerProviderContext({ ...observation, providerContext: null })).toEqual([]);
  });
});

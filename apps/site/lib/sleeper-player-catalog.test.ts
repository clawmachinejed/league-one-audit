import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  classifySleeperCatalogIdentity, loadCompletePlayerCatalog,
  loadFantasyPlayerCatalog, projectPlayerCatalog, playerCatalogIdentityRevision, FANTASY_PLAYER_POSITIONS,
} from './sleeper-player-catalog';
import { foundationFixture, loadFoundationFixtureCatalogPosition } from '../test-support/all-player-foundation-fixture';

afterEach(() => vi.unstubAllGlobals());

describe('shared official catalog identity boundary', () => {
  it('preserves original mixed cache ages separately without changing aggregate identity or activating global context', async () => {
    const load = async (laterDates = false) => loadFantasyPlayerCatalog(async position => ({
      ...projectPlayerCatalog({ [position]: { full_name: `Player ${position}`, position } }),
      observedAt: position === 'QB' ? '2026-09-27T10:00:00.000Z'
        : laterDates ? '2026-09-29T10:00:00.000Z' : '2026-09-28T10:00:00.000Z',
    }));
    const first = await load(); const repeat = await load(); const refreshed = await load(true);
    expect(repeat).toEqual(first);
    expect(refreshed.catalog).toEqual(first.catalog);
    expect(refreshed.sourceRevision).toBe(first.sourceRevision);
    expect(first).not.toHaveProperty('observedAt');
    expect(first).not.toHaveProperty('identityRevision');
    expect(first.sourceSlices?.map(slice => ({ scope: slice.scope, observedAt: slice.observedAt }))).toEqual(
      FANTASY_PLAYER_POSITIONS.map(position => ({ scope: position, observedAt: position === 'QB'
        ? '2026-09-27T10:00:00.000Z' : '2026-09-28T10:00:00.000Z' })));
    expect(first.sourceSlices?.every(slice => slice.status === 'available' && slice.complete && slice.playerIds.length === 1)).toBe(true);
  });

  it('retains absent dates and failed slices without inventing acquisition evidence', async () => {
    const catalog = await loadFantasyPlayerCatalog(async position => {
      if (position === 'QB') throw new Error('Synthetic unavailable position.');
      return projectPlayerCatalog({ [position]: { full_name: `Player ${position}`, position } });
    });
    expect(catalog).toMatchObject({ complete: false, sourceRevision: null });
    expect(catalog).not.toHaveProperty('observedAt');
    expect(catalog.sourceSlices?.[0]).toEqual({ scope: 'QB', status: 'unavailable', sourceRevision: null,
      observedAt: null, complete: false, playerIds: [] });
    expect(catalog.sourceSlices?.slice(1).every(slice => slice.observedAt === null && slice.status === 'available')).toBe(true);
  });

  it('keeps every supporting slice for equal duplicate identities and removes conflicting rows as before', async () => {
    const catalog = await loadFantasyPlayerCatalog(async () => ({
      ...projectPlayerCatalog({ shared: { full_name: 'Shared Player', position: 'TE' } }),
      observedAt: '2026-09-28T10:00:00.000Z',
    }));
    expect(catalog.complete).toBe(true);
    expect(Object.keys(catalog.catalog)).toEqual(['shared']);
    expect(catalog.sourceSlices?.map(slice => slice.playerIds)).toEqual(FANTASY_PLAYER_POSITIONS.map(() => ['shared']));
    const conflicting = await loadFantasyPlayerCatalog(async position => projectPlayerCatalog({ shared: {
      full_name: position === 'TE' ? 'Conflicting Player' : 'Shared Player', position: 'TE',
    } }));
    expect(conflicting.complete).toBe(false);
    expect(Object.hasOwn(conflicting.catalog, 'shared')).toBe(false);
  });

  it('changes metadata revision for injury-only corrections while preserving identity revision', async () => {
    const load = (injury: string) => loadFantasyPlayerCatalog(async position => projectPlayerCatalog({ [position]: {
      full_name: `Player ${position}`, position, injury_status: position === 'QB' ? injury : undefined,
    } }));
    const questionable = await load('Questionable'); const out = await load('Out');
    expect(out.sourceRevision).not.toBe(questionable.sourceRevision);
    expect(playerCatalogIdentityRevision(out.catalog)).toBe(playerCatalogIdentityRevision(questionable.catalog));
    expect(out.sourceSlices?.[0].sourceRevision).not.toBe(questionable.sourceSlices?.[0].sourceRevision);
    expect(out).not.toHaveProperty('identityRevision');
  });

  it('retains nine identical real memberships and all eight FB fantasy identities', async () => {
    const catalog = await loadFantasyPlayerCatalog(loadFoundationFixtureCatalogPosition);
    expect(catalog.complete).toBe(true);
    expect(Object.keys(catalog.catalog)).toHaveLength(4385);
    for (const id of ['1379', '4353', '6109', '7204', '8181', '11510', '13433', '13516']) {
      expect(classifySleeperCatalogIdentity(catalog.catalog, id)).toMatchObject({ status: 'fantasy' });
    }
    expect(classifySleeperCatalogIdentity(catalog.catalog, '13433')).toMatchObject({ status: 'fantasy', position: 'TE' });
  });

  it('rejects conflicting duplicate catalog identities without choosing a last value', async () => {
    const result = await loadFantasyPlayerCatalog(async (position) => {
      const slice = await loadFoundationFixtureCatalogPosition(position);
      if (position !== 'TE') return slice;
      return { ...slice, catalog: { ...slice.catalog, '372': { ...slice.catalog['372'], full_name: 'Different identity' } } };
    });
    expect(result.complete).toBe(false);
    expect(result.warning).toContain('372');
    expect(Object.hasOwn(result.catalog, '372')).toBe(false);
  });

  it('rejects catalog key/player-ID mismatch and malformed IDs deterministically', () => {
    const row = { player_id: '10213', full_name: 'Tre Tucker', position: 'WR' };
    const result = projectPlayerCatalog({ '10213': row, '8063': row });
    expect(result.malformedRowCount).toBe(1);
    expect(Object.keys(result.catalog)).toEqual(['10213']);
    expect(classifySleeperCatalogIdentity({ '8063': row }, '8063')).toMatchObject({ status: 'invalid', reason: 'official-catalog-key-mismatch' });
    expect(classifySleeperCatalogIdentity({}, ' 8063')).toMatchObject({ status: 'invalid' });
  });

  it('classifies actual Silvanic outside fantasy without using a stat-key heuristic', () => {
    const catalog = Object.fromEntries(foundationFixture.selectedUnfilteredIdentities.map((row) => [row.id, row]));
    expect(classifySleeperCatalogIdentity(catalog, '8063')).toMatchObject({ status: 'out-of-scope', player: { full_name: 'George Silvanic' } });
    // The captured package does not retain an authoritative catalog row for this
    // unusual receiving-stat identity; its stat shape may not manufacture one.
    expect(classifySleeperCatalogIdentity(catalog, '3439')).toMatchObject({ status: 'missing' });
    for (const position of ['DT', 'LB', 'P', 'C', 'OT']) {
      expect(classifySleeperCatalogIdentity({ x: { full_name: 'Scope fixture', position, fantasy_positions: [position] } }, 'x'))
        .toMatchObject({ status: 'out-of-scope' });
    }
  });

  it('uses one deduplicated bulk request through the same validated catalog boundary', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      '8063': { player_id: '8063', full_name: 'George Silvanic', position: 'DT', fantasy_positions: ['DL'] },
      '12048': { player_id: '12048', full_name: 'George Holani', position: 'RB', fantasy_positions: ['RB'] },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const [first, second] = await Promise.all([loadCompletePlayerCatalog(), loadCompletePlayerCatalog()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toHaveLength(2);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.sleeper.app/v1/players/nfl');
    expect(first).toEqual(second);
    expect(first.complete).toBe(true);
    expect(Number.isFinite(Date.parse(first.observedAt!))).toBe(true);
    expect(first.identityRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(classifySleeperCatalogIdentity(first.catalog, '8063').status).toBe('out-of-scope');
  });

  it('accepts absent null fantasy memberships while rejecting malformed non-null values', () => {
    expect(classifySleeperCatalogIdentity({ x: { position: null as never, fantasy_positions: ['QB'] } }, 'x'))
      .toMatchObject({ status: 'fantasy', position: 'QB' });
    expect(classifySleeperCatalogIdentity({ x: { position: 'C', fantasy_positions: null as never } }, 'x'))
      .toMatchObject({ status: 'out-of-scope' });
    expect(classifySleeperCatalogIdentity({ x: { position: 'QB', fantasy_positions: null as never } }, 'x'))
      .toMatchObject({ status: 'fantasy', position: 'QB' });
    for (const malformed of ['QB', 1, [null]]) {
      expect(classifySleeperCatalogIdentity({ x: { position: 'QB', fantasy_positions: malformed as never } }, 'x'))
        .toMatchObject({ status: 'invalid', reason: 'malformed-official-position' });
    }
    for (const malformed of [1, {}, ['QB']]) {
      expect(classifySleeperCatalogIdentity({ x: { position: malformed as never, fantasy_positions: ['QB'] } }, 'x'))
        .toMatchObject({ status: 'invalid', reason: 'malformed-official-position' });
    }
  });
});

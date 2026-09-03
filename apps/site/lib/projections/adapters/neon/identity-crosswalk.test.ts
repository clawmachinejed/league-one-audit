import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { NflTeam, ScoringEntity } from '../../domain/contracts';
import type {
  NflGameIdentityInput,
  ScoringEntityIdentityInput,
} from '../../ports/identity-crosswalk';
import {
  externalGameRef,
  externalPlayerRef,
  externalTeamDefenseRef,
  providerKey,
  type ExternalScoringEntityRef,
} from '../../shared/provider-identity';
import { deterministicUuid } from './database-values';
import { createNeonIdentityCrosswalk } from './identity-crosswalk';

type IdentityStore = Parameters<typeof createNeonIdentityCrosswalk>[0];

const officialProvider = providerKey('official-source');
const projectionProvider = providerKey('projection-source');
const gameProvider = providerKey('game-source');

function playerInput(
  key: string,
  externalId: string,
  nflTeam: NflTeam | null = 'PHI',
  aliases: readonly ExternalScoringEntityRef[] = [],
): ScoringEntityIdentityInput {
  const externalRef = externalPlayerRef(officialProvider, externalId);
  const entity: ScoringEntity = {
    kind: 'player', externalRef, displayName: `Player ${key}`, nflTeam,
    position: 'WR', injuryStatus: null,
  };
  return { key, entity, providerRefs: [externalRef, ...aliases] };
}

function defenseInput(
  key: string,
  team: NflTeam,
  aliases: readonly ExternalScoringEntityRef[] = [],
): ScoringEntityIdentityInput {
  const externalRef = externalTeamDefenseRef(officialProvider, team);
  const entity: ScoringEntity = {
    kind: 'team-defense', externalRef, displayName: `${team} Defense`, nflTeam: team,
    position: 'DEF', injuryStatus: null,
  };
  return { key, entity, providerRefs: [externalRef, ...aliases] };
}

function gameInput(
  key: string,
  primaryId: string,
  aliases: readonly string[] = [],
): NflGameIdentityInput {
  return {
    key,
    primaryRef: externalGameRef(officialProvider, primaryId),
    aliasRefs: aliases.map((id) => externalGameRef(gameProvider, id)),
    period: { season: 2026, seasonType: 'regular', week: 1 },
    homeTeam: 'PHI',
    awayTeam: 'DAL',
    kickoffAt: '2026-09-13T20:25:00.000Z',
  };
}

function createStore(overrides: Partial<IdentityStore> = {}): IdentityStore {
  return {
    enabled: true,
    upsertScoringEntities: vi.fn(async (
      inputs: Parameters<IdentityStore['upsertScoringEntities']>[0],
    ) => ({
      kind: 'stored' as const,
      value: inputs.map((input, index) => ({
        key: input.key, entityId: `entity-${index + 1}`, conflict: false,
      })),
    })),
    upsertNflGames: vi.fn(async (
      inputs: Parameters<IdentityStore['upsertNflGames']>[0],
    ) => ({
      kind: 'stored' as const,
      value: inputs.map((input, index) => ({ key: input.key, gameId: `game-${index + 1}` })),
    })),
    ...overrides,
  };
}

describe('Neon canonical identity crosswalk', () => {
  it('returns exact disabled results without invoking the low-level store', async () => {
    const store = createStore({ enabled: false });
    const crosswalk = createNeonIdentityCrosswalk(store);

    expect(crosswalk.enabled).toBe(false);
    await expect(crosswalk.resolveScoringEntities(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(crosswalk.resolveNflGames(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    expect(store.upsertScoringEntities).not.toHaveBeenCalled();
    expect(store.upsertNflGames).not.toHaveBeenCalled();
  });

  it('translates player and defense identities and preserves known, unknown, and conflict status', async () => {
    const player = playerInput(
      'player', 'official-player', 'PHI', [externalPlayerRef(projectionProvider, 'projection-player')],
    );
    const defense = defenseInput(
      'defense', 'DAL', [externalTeamDefenseRef(projectionProvider, 'projection-defense')],
    );
    const unknown = playerInput('unknown', 'unknown-player', null);
    const store = createStore({
      upsertScoringEntities: vi.fn(async () => ({
        kind: 'stored' as const,
        value: [
          { key: 'player:unknown-player', entityId: null, conflict: false },
          { key: 'team_defense:DAL', entityId: null, conflict: true },
          { key: 'player:official-player', entityId: 'player-uuid', conflict: false },
        ],
      })),
    });
    const crosswalk = createNeonIdentityCrosswalk(store);

    await expect(crosswalk.resolveScoringEntities([player, defense, unknown])).resolves.toEqual({
      kind: 'resolved',
      value: [
        { key: 'player', status: 'known', entityId: 'player-uuid' },
        { key: 'defense', status: 'conflict', entityId: null },
        { key: 'unknown', status: 'unknown', entityId: null },
      ],
    });
    expect(store.upsertScoringEntities).toHaveBeenCalledWith([
      {
        key: 'player:official-player', kind: 'player', displayName: 'Player player', nflTeam: 'PHI',
        providerIds: [
          { provider: 'official-source', externalId: 'official-player' },
          { provider: 'projection-source', externalId: 'projection-player' },
        ],
      },
      {
        key: 'team_defense:DAL', kind: 'team_defense', displayName: 'DAL Defense', nflTeam: 'DAL',
        providerIds: [
          { provider: 'official-source', externalId: 'DAL' },
          { provider: 'projection-source', externalId: 'projection-defense' },
        ],
      },
      {
        key: 'player:unknown-player', kind: 'player', displayName: 'Player unknown', nflTeam: null,
        providerIds: [{ provider: 'official-source', externalId: 'unknown-player' }],
      },
    ]);
  });

  it('preserves the legacy identity seeds and therefore stable deterministic UUIDs', async () => {
    const store = createStore({
      upsertScoringEntities: vi.fn(async (
        inputs: Parameters<IdentityStore['upsertScoringEntities']>[0],
      ) => ({
        kind: 'stored' as const,
        value: inputs.map((input) => ({
          key: input.key,
          entityId: deterministicUuid(`scoring-entity:${input.kind}`, input.key),
          conflict: false,
        })),
      })),
      upsertNflGames: vi.fn(async (
        inputs: Parameters<IdentityStore['upsertNflGames']>[0],
      ) => ({
        kind: 'stored' as const,
        value: inputs.map((input) => ({
          key: input.key,
          gameId: deterministicUuid('nfl-game', `${input.provider}:${input.externalGameId}`),
        })),
      })),
    });
    const crosswalk = createNeonIdentityCrosswalk(store);

    await expect(crosswalk.resolveScoringEntities([
      playerInput('canonical-player-key', 'official-player'),
      defenseInput('canonical-defense-key', 'DAL'),
    ])).resolves.toEqual({
      kind: 'resolved',
      value: [
        { key: 'canonical-player-key', status: 'known', entityId: 'ac827398-4f86-5944-a6ad-53b7515d6b7a' },
        { key: 'canonical-defense-key', status: 'known', entityId: 'f0768a4b-353a-512a-8b1c-2e4c1325bb0b' },
      ],
    });
    await expect(crosswalk.resolveNflGames([
      gameInput('canonical-game-key', 'official-game'),
    ])).resolves.toEqual({
      kind: 'resolved',
      value: [{
        key: 'canonical-game-key', status: 'known', gameId: '1b34ca6c-0e1e-5579-a4c6-7749be81fcaa',
      }],
    });
  });

  it('isolates ambiguous aliases while still resolving unrelated identities', async () => {
    const shared = externalPlayerRef(projectionProvider, 'shared-alias');
    const first = playerInput('first', 'first', 'PHI', [shared]);
    const second = playerInput('second', 'second', 'DAL', [shared]);
    const safe = defenseInput('safe', 'BUF');
    const store = createStore({
      upsertScoringEntities: vi.fn(async () => ({
        kind: 'stored' as const,
        value: [{ key: 'team_defense:BUF', entityId: 'safe-uuid', conflict: false }],
      })),
    });

    await expect(createNeonIdentityCrosswalk(store).resolveScoringEntities([first, safe, second]))
      .resolves.toEqual({
        kind: 'resolved',
        value: [
          { key: 'first', status: 'ambiguous', entityId: null },
          { key: 'safe', status: 'known', entityId: 'safe-uuid' },
          { key: 'second', status: 'ambiguous', entityId: null },
        ],
      });
    expect(store.upsertScoringEntities).toHaveBeenCalledTimes(1);
    expect(store.upsertScoringEntities).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'team_defense:BUF' }),
    ]);
  });

  it('rejects a player/defense reference-kind mismatch without a low-level write', async () => {
    const input = defenseInput('defense', 'BUF');
    const mismatched = {
      ...input,
      providerRefs: [externalPlayerRef(officialProvider, 'BUF')],
    } satisfies ScoringEntityIdentityInput;
    const store = createStore();

    await expect(createNeonIdentityCrosswalk(store).resolveScoringEntities([mismatched]))
      .resolves.toEqual({
        kind: 'resolved', value: [{ key: 'defense', status: 'conflict', entityId: null }],
      });
    expect(store.upsertScoringEntities).not.toHaveBeenCalled();
  });

  it('passes an NFL player team change through while retaining the canonical entity', async () => {
    const upsert = vi.fn(async (inputs: Parameters<IdentityStore['upsertScoringEntities']>[0]) => ({
      kind: 'stored' as const,
      value: inputs.map((input) => ({ key: input.key, entityId: 'same-entity-uuid', conflict: false })),
    }));
    const store = createStore({ upsertScoringEntities: upsert });
    const crosswalk = createNeonIdentityCrosswalk(store);

    await crosswalk.resolveScoringEntities([playerInput('player', 'official-player', 'PHI')]);
    await crosswalk.resolveScoringEntities([playerInput('player', 'official-player', 'TEN')]);
    expect(upsert.mock.calls[0][0][0]).toMatchObject({ key: 'player:official-player', nflTeam: 'PHI' });
    expect(upsert.mock.calls[1][0][0]).toMatchObject({ key: 'player:official-player', nflTeam: 'TEN' });
  });

  it('resolves a corrected external game alias to the primary canonical game', async () => {
    const input = gameInput('game', 'official-game', ['corrected-provider-game']);
    const upsert = vi.fn()
      .mockResolvedValueOnce({
        kind: 'stored', value: [{ key: 'official-game', gameId: 'canonical-game-uuid' }],
      })
      .mockResolvedValueOnce({
        kind: 'stored', value: [{ key: 'corrected-provider-game', gameId: 'canonical-game-uuid' }],
      });
    const store = createStore({ upsertNflGames: upsert });

    await expect(createNeonIdentityCrosswalk(store).resolveNflGames([input])).resolves.toEqual({
      kind: 'resolved', value: [{ key: 'game', status: 'known', gameId: 'canonical-game-uuid' }],
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0]).toEqual([{
      key: 'official-game', provider: 'official-source', externalGameId: 'official-game',
      season: 2026, seasonType: 'reg', week: 1, homeTeam: 'PHI', awayTeam: 'DAL',
      kickoffAt: '2026-09-13T20:25:00.000Z',
    }]);
    expect(upsert.mock.calls[1][0]).toEqual([{
      key: 'corrected-provider-game', provider: 'game-source', externalGameId: 'corrected-provider-game',
      season: 2026, seasonType: 'reg', week: 1, homeTeam: 'PHI', awayTeam: 'DAL',
      kickoffAt: '2026-09-13T20:25:00.000Z',
    }]);
  });

  it('isolates ambiguous game aliases while resolving an unrelated game', async () => {
    const shared = externalGameRef(gameProvider, 'shared-game');
    const first = { ...gameInput('first', 'first'), aliasRefs: [shared] };
    const second = { ...gameInput('second', 'second'), aliasRefs: [shared] };
    const safe = { ...gameInput('safe', 'safe'), homeTeam: 'BUF' as const, awayTeam: 'MIA' as const };
    const store = createStore({
      upsertNflGames: vi.fn(async () => ({
        kind: 'stored' as const, value: [{ key: 'safe', gameId: 'safe-game-uuid' }],
      })),
    });

    await expect(createNeonIdentityCrosswalk(store).resolveNflGames([first, safe, second]))
      .resolves.toEqual({
        kind: 'resolved',
        value: [
          { key: 'first', status: 'ambiguous', gameId: null },
          { key: 'safe', status: 'known', gameId: 'safe-game-uuid' },
          { key: 'second', status: 'ambiguous', gameId: null },
        ],
      });
    expect(store.upsertNflGames).toHaveBeenCalledTimes(1);
    expect(store.upsertNflGames).toHaveBeenCalledWith([expect.objectContaining({ key: 'safe' })]);
  });

  it('reports only the mismatched external game alias as a conflict', async () => {
    const first = gameInput('first', 'official-first', ['alias-first']);
    const second = {
      ...gameInput('second', 'official-second', ['alias-second']),
      homeTeam: 'BUF' as const,
      awayTeam: 'MIA' as const,
    };
    const upsert = vi.fn()
      .mockResolvedValueOnce({
        kind: 'stored', value: [
          { key: 'official-first', gameId: 'game-first' },
          { key: 'official-second', gameId: 'game-second' },
        ],
      })
      .mockResolvedValueOnce({
        kind: 'stored', value: [
          { key: 'alias-first', gameId: 'different-game' },
          { key: 'alias-second', gameId: 'game-second' },
        ],
      });
    const store = createStore({ upsertNflGames: upsert });

    await expect(createNeonIdentityCrosswalk(store).resolveNflGames([first, second]))
      .resolves.toEqual({
        kind: 'resolved',
        value: [
          { key: 'first', status: 'conflict', gameId: null },
          { key: 'second', status: 'known', gameId: 'game-second' },
        ],
      });
  });

  it('turns the low-level external game conflict into an explicit canonical conflict', async () => {
    const store = createStore({
      upsertNflGames: vi.fn(async () => {
        throw new Error('An external NFL game ID conflicts with its scheduled game identity.');
      }),
    });
    await expect(createNeonIdentityCrosswalk(store).resolveNflGames([
      gameInput('game', 'conflicting-game'),
    ])).resolves.toEqual({
      kind: 'resolved', value: [{ key: 'game', status: 'conflict', gameId: null }],
    });
  });

  it('returns empty resolved batches without low-level writes', async () => {
    const store = createStore();
    const crosswalk = createNeonIdentityCrosswalk(store);
    await expect(crosswalk.resolveScoringEntities([])).resolves.toEqual({ kind: 'resolved', value: [] });
    await expect(crosswalk.resolveNflGames([])).resolves.toEqual({ kind: 'resolved', value: [] });
    expect(store.upsertScoringEntities).not.toHaveBeenCalled();
    expect(store.upsertNflGames).not.toHaveBeenCalled();
  });
});

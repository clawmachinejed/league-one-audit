import 'server-only';

import type { LiveProjectionKind } from '../../live-projection';
import { canonicalNflTeam } from '../../nfl-teams';
import type { ScoringEntityIdentityInput } from '../../projection-store';
import type { ProjectionSyncInput } from '../../sleeper';
import type { Tank01AvailableResult } from '../../tank01';
import type { MatchupsData, Player } from '../../types';
import type { ActiveStarter, ProviderGroup } from './contracts';

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isEmptySlot(player: Player): boolean {
  return player.id.startsWith('empty-');
}

export function isDefense(player: Player): boolean {
  return player.position.trim().toUpperCase() === 'DEF' || player.slot.trim().toUpperCase() === 'DEF';
}

export function projectionKind(player: Player): LiveProjectionKind {
  if (isDefense(player)) return 'defense';
  return player.position.trim().toUpperCase() === 'K' ? 'kicker' : 'offense';
}

export function entityKind(player: Player): 'player' | 'team_defense' {
  return isDefense(player) ? 'team_defense' : 'player';
}

export function entityKey(player: Player): string {
  return `${entityKind(player)}:${player.id}`;
}

export function activeStarters(data: MatchupsData): ActiveStarter[] {
  return data.matchups.flatMap((matchup) => matchup.sides.flatMap((side) => side.starters
    .filter((player) => !isEmptySlot(player))
    .map((player) => ({ rosterId: String(side.team.id), player }))));
}

export function projectionPlayers(source: ProjectionSyncInput): Player[] {
  const players = new Map<string, Player>();
  for (const player of source.rosteredPlayers) {
    if (!isEmptySlot(player)) players.set(player.id, player);
  }
  for (const { player } of activeStarters(source.data)) players.set(player.id, player);
  return [...players.values()];
}

export function assertUniqueStarters(starters: readonly ActiveStarter[]): void {
  const seen = new Set<string>();
  for (const { player } of starters) {
    if (seen.has(player.id)) throw new Error('Sleeper returned a duplicate starter.');
    seen.add(player.id);
  }
}

export function numericScoringRules(value: Readonly<Record<string, unknown>> | null): Readonly<Record<string, number>> {
  if (!value || Object.keys(value).length === 0) {
    throw new Error('Sleeper scoring settings are unavailable.');
  }
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [key, points] of Object.entries(value)) {
    if (!finite(points)) throw new Error('Sleeper scoring settings contain an invalid value.');
    result[key] = points;
  }
  return result;
}

export function scoringEntities(group: ProviderGroup, projections: Tank01AvailableResult): ScoringEntityIdentityInput[] {
  const entities = new Map<string, ScoringEntityIdentityInput>();
  for (const league of group.leagues) {
    for (const player of projectionPlayers(league.source)) {
      const key = entityKey(player);
      if (entities.has(key)) continue;
      const kind = entityKind(player);
      const team = canonicalNflTeam(player.nflTeam);
      const tank01Id = kind === 'team_defense'
        ? team
        : projections.projections.bySleeperId[player.id]?.tank01PlayerId ?? null;
      entities.set(key, {
        key,
        kind,
        displayName: player.name,
        nflTeam: team,
        providerIds: [
          { provider: 'sleeper', externalId: player.id },
          ...(tank01Id ? [{ provider: 'tank01', externalId: tank01Id }] : []),
        ],
      });
    }
  }
  return [...entities.values()];
}

export function projectionStats(player: Player, result: Tank01AvailableResult): Readonly<Record<string, unknown>> {
  const team = canonicalNflTeam(player.nflTeam);
  const value = isDefense(player)
    ? (team ? result.projections.byDefenseTeam[team] : undefined)
    : result.projections.bySleeperId[player.id];
  return value?.stats ?? {};
}


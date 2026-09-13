import type { PlayerCatalog } from '../../../transform';
import type { AllPlayerProviderContext } from '../../domain/all-player-provider-context';
import type { AllPlayerStatEntry } from '../../domain/all-player-observation-evidence';

/** No status here can establish an effective week or a healthy scratch. */
export function sleeperAllPlayerCatalogContext(input: Readonly<{
  catalog: PlayerCatalog;
  sourceRevision: string;
  observedAt: string;
  entries: readonly AllPlayerStatEntry[];
}>): AllPlayerProviderContext {
  return {
    version: 'catalog-status-context-v1', role: 'context-only',
    source: 'official-player-catalog', sourceRevision: input.sourceRevision,
    observedAt: input.observedAt, effectivePeriod: null,
    players: input.entries.filter((entry) => entry.entityKind === 'player').map((entry) => {
      const player = input.catalog[entry.providerExternalId];
      return {
        providerExternalId: entry.providerExternalId, nflGameId: entry.nflGameId,
        ...(player?.team ? { currentTeam: player.team } : {}),
        ...(player?.status ? { status: player.status } : {}),
        ...(typeof player?.active === 'boolean' ? { active: player.active } : {}),
        ...(typeof player?.injury_status === 'string' && player.injury_status
          ? { injuryStatus: player.injury_status } : {}),
      };
    }).sort((left, right) => left.providerExternalId.localeCompare(right.providerExternalId)),
  };
}

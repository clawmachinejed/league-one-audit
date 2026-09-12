import type { PlayerCatalog, SleeperPlayer } from '../../transform';
import { canonicalNflTeam } from '../../nfl-teams';
import type { ScoringEntity } from '../domain/contracts';
import { externalPlayerRef, type ProviderKey } from './provider-identity';

export const OFFICIAL_FANTASY_PLAYER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'] as const;
export type OfficialFantasyPlayerPosition = typeof OFFICIAL_FANTASY_PLAYER_POSITIONS[number];

export type OfficialCatalogIdentityClassification =
  | Readonly<{ status: 'fantasy'; position: OfficialFantasyPlayerPosition; player: SleeperPlayer }>
  | Readonly<{ status: 'out-of-scope'; player: SleeperPlayer }>
  | Readonly<{ status: 'missing' | 'invalid'; reason: string }>;

function fantasyPosition(value: unknown): OfficialFantasyPlayerPosition | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return OFFICIAL_FANTASY_PLAYER_POSITIONS.includes(normalized as OfficialFantasyPlayerPosition)
    ? normalized as OfficialFantasyPlayerPosition : null;
}

/** Classifies the official identity, never the shape of its weekly statistics.
 * FB is included through official fantasy membership, preserving RB/TE roles.
 * Canonical defenses are constructed independently by the league registry. */
export function classifySleeperCatalogIdentity(
  catalog: PlayerCatalog,
  externalId: string,
): OfficialCatalogIdentityClassification {
  if (!externalId.trim() || externalId !== externalId.trim()) {
    return { status: 'invalid', reason: 'malformed-official-id' };
  }
  if (!Object.prototype.hasOwnProperty.call(catalog, externalId)) {
    return { status: 'missing', reason: 'official-catalog-identity-missing' };
  }
  const player = catalog[externalId];
  if (!player || typeof player !== 'object' || Array.isArray(player)) {
    return { status: 'invalid', reason: 'malformed-official-catalog-row' };
  }
  if (player.player_id !== undefined && player.player_id !== externalId) {
    return { status: 'invalid', reason: 'official-catalog-key-mismatch' };
  }
  if (player.position != null && typeof player.position !== 'string'
    || player.fantasy_positions != null && (!Array.isArray(player.fantasy_positions)
      || player.fantasy_positions.some((position) => typeof position !== 'string'))) {
    return { status: 'invalid', reason: 'malformed-official-position' };
  }
  const memberships = [...new Set((player.fantasy_positions ?? [])
    .map(fantasyPosition).filter((position): position is OfficialFantasyPlayerPosition => position !== null))];
  const primary = fantasyPosition(player.position);
  if (primary && (memberships.length === 0 || memberships.includes(primary))) {
    return { status: 'fantasy', position: primary, player };
  }
  if (memberships.length > 0) {
    // Multiple official fantasy memberships describe one person, not an
    // ambiguous identity. Preserve them on player; this fixed representative
    // is only existing storage metadata and does not introduce ranking rules.
    const position = OFFICIAL_FANTASY_PLAYER_POSITIONS.find((value) => memberships.includes(value))!;
    return { status: 'fantasy', position, player };
  }
  return { status: 'out-of-scope', player };
}

/** The one conversion of validated catalog memberships into neutral identities.
 * No observed projection alias can add an identity to this inventory. */
export function officialPlayerIdentityInventory(
  catalog: PlayerCatalog,
  provider: ProviderKey,
): ScoringEntity[] {
  return Object.keys(catalog).sort().flatMap((id) => {
    const identity = classifySleeperCatalogIdentity(catalog, id);
    if (identity.status === 'invalid') throw new Error(`${identity.reason}:${id}`);
    if (identity.status !== 'fantasy') return [];
    return [{
      kind: 'player' as const,
      externalRef: externalPlayerRef(provider, id),
      displayName: identity.player.full_name
        || [identity.player.first_name, identity.player.last_name].filter(Boolean).join(' ') || id,
      nflTeam: canonicalNflTeam(identity.player.team),
      position: identity.position,
      injuryStatus: null,
    }];
  });
}

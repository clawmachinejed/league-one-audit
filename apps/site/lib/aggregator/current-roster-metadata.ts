import type { ProviderReference, RosterMembership } from './contracts';
import { assertInstant } from './validation';
import type { FantasyPlayerCatalog, PlayerCatalogSourceSlice } from '../sleeper-player-catalog';
import type { SleeperPlayer } from '../sleeper-catalog-types';

export type CurrentRosterReadOptions = Readonly<{
  playerCatalog?: FantasyPlayerCatalog;
  includeSeasonOverview?: true;
  includePlayerLinks?: true;
}>;
type MetadataField<T> = Readonly<{
  value: T | null; availability: 'present' | 'empty' | 'missing'; sourcePaths: readonly string[];
}>;
type MetadataSource = Readonly<{
  provider: 'sleeper'; resource: 'nfl-player-catalog'; scope: PlayerCatalogSourceSlice['scope'];
  sourceRevision: string | null; observedAt: string | null; complete: boolean;
}>;
export type CurrentRosterPlayerMetadata = Readonly<{
  sourceEntity: ProviderReference;
  availability: 'present' | 'missing';
  sources: readonly MetadataSource[];
  /** Every contributing cache age remains separate; this does not assert current freshness. */
  sourceAge: 'known' | 'mixed' | 'unknown';
  reasons: readonly string[];
  name: MetadataField<string>; nflTeam: MetadataField<string>; primaryPosition: MetadataField<string>;
  fantasyPositions: MetadataField<readonly string[]>; injuryStatus: MetadataField<string>;
  status: MetadataField<string>; active: MetadataField<boolean>;
}>;
type Context = Readonly<{
  kind: 'current-roster-metadata-evidence'; temporalContext: 'current-display';
  historicalApplicability: 'unverified'; freshness: 'unknown';
}>;
export type CurrentRosterMetadata = Context & (
  | Readonly<{ status: 'available'; catalogSourceRevision: string | null; catalogComplete: boolean;
    players: readonly CurrentRosterPlayerMetadata[] }>
  | Readonly<{ status: 'unavailable'; reason: 'catalog_evidence_unavailable' }>);
const context: Context = { kind: 'current-roster-metadata-evidence', temporalContext: 'current-display',
  historicalApplicability: 'unverified', freshness: 'unknown' };

function field<T>(value: T | undefined, sourcePaths: readonly string[]): MetadataField<T> {
  return { value: value ?? null, availability: value === undefined ? 'missing'
    : Array.isArray(value) && value.length === 0 ? 'empty' : 'present', sourcePaths: [...sourcePaths] };
}
function text(value: unknown): string | undefined {
  // Values already passed through the shared catalog normalizer; no fallback label is official metadata.
  return typeof value === 'string' && value.length ? value : undefined;
}
function instant(value: unknown): string | null {
  try { assertInstant(value); return value; } catch { return null; }
}
function revision(value: unknown): string | null {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value) ? value : null;
}

/** Pure optional decoration of an already verified current roster and already loaded catalog.
 * Metadata errors are local: official membership and its capture lineage never depend on this projection.
 */
export function projectCurrentRosterMetadata(teams: readonly Readonly<{ players: readonly RosterMembership[] }>[],
  options: CurrentRosterReadOptions): CurrentRosterMetadata {
  try {
    const catalog = options.playerCatalog;
    if (!catalog || !catalog.catalog || typeof catalog.catalog !== 'object' || Array.isArray(catalog.catalog)) {
      throw new Error('Missing catalog.');
    }
    const held = new Map(teams.flatMap(team => team.players.map(member => [member.sourceEntity.nativeId, member] as const)));
    const players = [...held].map(([id, member]): CurrentRosterPlayerMetadata => {
      const raw = id !== '0' && Object.hasOwn(catalog.catalog, id) ? catalog.catalog[id] : undefined;
      const valid = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
      const player: SleeperPlayer = valid ? raw : {};
      const sources: MetadataSource[] = (catalog.sourceSlices ?? [])
        .filter(slice => slice.status === 'available' && slice.playerIds.includes(id) && valid)
        .map(slice => ({ provider: 'sleeper', resource: 'nfl-player-catalog', scope: slice.scope,
          sourceRevision: revision(slice.sourceRevision), observedAt: instant(slice.observedAt), complete: slice.complete }));
      const sourceAge = sources.length === 0 || sources.some(source => source.observedAt === null) ? 'unknown'
        : new Set(sources.map(source => Date.parse(source.observedAt!))).size > 1 ? 'mixed' : 'known';
      const fullName = text(player.full_name);
      const firstName = text(player.first_name); const lastName = text(player.last_name);
      const name = fullName ?? ([firstName, lastName].filter(value => value !== undefined).join(' ') || undefined);
      return {
        sourceEntity: { ...member.sourceEntity }, availability: valid ? 'present' : 'missing', sources, sourceAge,
        reasons: [
          ...(raw === undefined ? [id === '0' ? 'vacancy_marker_is_not_player' : 'catalog_player_missing'] : []),
          ...(raw !== undefined && !valid ? ['catalog_player_invalid'] : []),
          ...(sources.length === 0 ? ['catalog_source_evidence_missing'] : []),
          ...(sourceAge === 'unknown' ? ['catalog_source_age_unknown'] : []),
          ...(sources.some(source => source.sourceRevision === null) ? ['catalog_source_revision_unknown'] : []),
          ...(sources.some(source => !source.complete) ? ['catalog_source_incomplete'] : []),
        ],
        name: field(name, fullName ? ['full_name'] : [firstName ? 'first_name' : null, lastName ? 'last_name' : null]
          .filter((path): path is string => path !== null)),
        nflTeam: field(text(player.team), ['team']), primaryPosition: field(text(player.position), ['position']),
        fantasyPositions: field(Array.isArray(player.fantasy_positions) && player.fantasy_positions.every(position => typeof position === 'string')
          ? [...player.fantasy_positions] : undefined, ['fantasy_positions']),
        injuryStatus: field(text(player.injury_status), ['injury_status']), status: field(text(player.status), ['status']),
        active: field(typeof player.active === 'boolean' ? player.active : undefined, ['active']),
      };
    });
    return { ...context, status: 'available', catalogSourceRevision: revision(catalog.sourceRevision),
      catalogComplete: catalog.complete, players };
  } catch { return { ...context, status: 'unavailable', reason: 'catalog_evidence_unavailable' }; }
}

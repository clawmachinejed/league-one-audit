import type { RosterMembership } from './contracts';
import type { AdministrationProvenance, AdministrationSourceMapping, JsonValue } from '../league-administration/contracts';
import type { PlayerDirectoryFieldState, PlayerDirectoryVersion } from '../league-administration/player-directory-contracts';

export const ROSTER_PLAYER_LINK_VERSION = 'sleeper-roster-player-links-v1' as const;
export const ROSTER_PLAYER_LINK_MAX_ROWS = 10_000;
export const ROSTER_PLAYER_LINK_MAX_TEAMS = 1_000;
export const ROSTER_PLAYER_LINK_MAX_BYTES = 32 * 1024 * 1024;
export type RosterPlayerLinksSelection = Readonly<{ rosterReceiptId: string; leagueSeasonId: string }>;
export type RosterPlayerKindEvidence = Readonly<{
  position: string | null; fantasyPositions: readonly string[] | null;
  positionState: PlayerDirectoryFieldState; fantasyPositionsState: PlayerDirectoryFieldState;
}>;
export type RosterPlayerKind = 'player' | 'team_defense';
export type RosterPlayerMappingProof = Readonly<{
  provider: 'sleeper'; entityKind: RosterPlayerKind; externalId: string; scoringEntityId: string;
  mappingStatus: 'verified' | 'unverified' | 'retired'; validFrom: string; validTo: string | null; canonicalKind: RosterPlayerKind;
}>;
export type RosterPlayerLink = Readonly<{
  seasonTeamId: string; externalRosterId: string; nativePlayerId: string; membershipOrdinal: number;
  entityKind: RosterPlayerKind | null; identityState: 'resolved' | 'unresolved' | 'conflict';
  canonicalEntityId: string | null; reasons: readonly string[];
  directoryIdentityStatus: 'valid' | 'invalid' | 'conflict' | 'missing';
  kindEvidence: RosterPlayerKindEvidence | null; mappingProof: readonly RosterPlayerMappingProof[];
}>;
export type RosterCategoryEvidence = Readonly<{
  state: 'missing' | 'null' | 'empty' | 'supplied' | 'invalid';
  /** Original values and order; a vacancy marker is not a player identity. */
  raw: JsonValue | null; nativePlayerIds: readonly string[] | null;
}>;
export type RosterPlayerLinkTeam = Readonly<{
  seasonTeamId: string; externalRosterId: string;
  categories: Readonly<Record<'players' | 'starters' | 'reserve' | 'taxi', RosterCategoryEvidence>>;
}>;
export type RosterPlayerLinksRead = Readonly<{
  status: 'available'; version: typeof ROSTER_PLAYER_LINK_VERSION;
  provider: 'sleeper'; nativeNamespace: 'nfl'; directoryNamespace: 'nfl:players';
  rosterAcceptanceId: string; rosterReceiptId: string; rosterContentId: string;
  mapping: AdministrationSourceMapping; rosterSource: AdministrationProvenance;
  /** Resolution is an acceptance event, never a provider transfer/effective time. */
  resolvedAt: string; mappingEvaluatedAt: string; directory: PlayerDirectoryVersion | null;
  outcome: 'complete' | 'partial'; reasons: readonly string[];
  counts: Readonly<{ teams: number; held: number; resolved: number; unresolved: number; conflict: number }>;
  teams: readonly RosterPlayerLinkTeam[]; links: readonly RosterPlayerLink[];
}> | Readonly<{ status: 'capacity_exceeded'; reason: string; rosterReceiptId: string;
  counts: Readonly<{ teams: number; held: number }> }>
  | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

/** Native kind evidence is broader than fantasy projection eligibility (including IDP). */
export function rosterPlayerKind(evidence: RosterPlayerKindEvidence):
  Readonly<{ entityKind: RosterPlayerKind; reason: null }> | Readonly<{ entityKind: null; reason: 'kind_unavailable' | 'kind_conflict' }> {
  const codes = [evidence.position, ...(evidence.fantasyPositions ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim().toUpperCase());
  const defense = codes.includes('DEF');
  const player = codes.some(code => code !== 'DEF');
  return defense && player ? { entityKind: null, reason: 'kind_conflict' }
    : defense ? { entityKind: 'team_defense', reason: null }
      : player ? { entityKind: 'player', reason: null } : { entityKind: null, reason: 'kind_unavailable' };
}

/** Presence comes from the retained native object, independent of v1's null projection. */
export function rosterCategoryEvidence(raw: Readonly<Record<string, JsonValue>>, field: 'players' | 'starters' | 'reserve' | 'taxi'): RosterCategoryEvidence {
  if (!Object.hasOwn(raw, field)) return { state: 'missing', raw: null, nativePlayerIds: null };
  const value = raw[field];
  if (value === null) return { state: 'null', raw: null, nativePlayerIds: null };
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.length || id.trim() !== id || /[\x00-\x1f\x7f]/u.test(id))
    || new Set(value.filter(id => field !== 'starters' || id !== '0')).size !== value.filter(id => field !== 'starters' || id !== '0').length) {
    return { state: 'invalid', raw: value, nativePlayerIds: null };
  }
  return { state: value.length ? 'supplied' : 'empty', raw: value, nativePlayerIds: value as readonly string[] };
}

/** Validate the complete association before applying any frozen canonical identity. */
export function applyRosterPlayerLinks<T extends Readonly<{ seasonTeamId: string; externalRosterId: string; players: readonly RosterMembership[] }>>(
  teams: readonly T[], evidence: Extract<RosterPlayerLinksRead, { status: 'available' }>): readonly T[] {
  if (teams.length !== evidence.teams.length || teams.length !== evidence.counts.teams
    || evidence.links.length !== evidence.counts.held) throw new Error('Incomplete roster link associations.');
  const sourceTeams = new Map(evidence.teams.map(team => [team.seasonTeamId, team]));
  const links = new Map(evidence.links.map(link => [JSON.stringify([link.seasonTeamId, link.nativePlayerId]), link]));
  if (sourceTeams.size !== teams.length || new Set(teams.map(team => team.seasonTeamId)).size !== teams.length || links.size !== evidence.links.length) throw new Error('Duplicate roster link associations.');
  const consumed = new Set<string>();
  const result = teams.map(team => {
    const sourceTeam = sourceTeams.get(team.seasonTeamId);
    if (!sourceTeam || sourceTeam.externalRosterId !== team.externalRosterId
      || JSON.stringify(sourceTeam.categories.players.nativePlayerIds) !== JSON.stringify(team.players.map(player => player.sourceEntity.nativeId))) {
      throw new Error('Foreign roster link association.');
    }
    return { ...team, players: team.players.map((player, ordinal) => {
      const key = JSON.stringify([team.seasonTeamId, player.sourceEntity.nativeId]);
      const link = links.get(key);
      if (!link || consumed.has(key) || link.externalRosterId !== team.externalRosterId || link.membershipOrdinal !== ordinal + 1 || player.seasonTeamId !== team.seasonTeamId
        || player.sourceEntity.provider !== 'sleeper' || player.sourceEntity.nativeNamespace !== 'nfl') throw new Error('Invalid roster link association.');
      consumed.add(key);
      return { ...player, canonicalEntityId: link.canonicalEntityId,
        identityState: link.identityState === 'resolved' ? 'resolved' as const : 'unresolved' as const };
    }) };
  });
  if (consumed.size !== links.size) throw new Error('Extra roster link association.');
  return result;
}

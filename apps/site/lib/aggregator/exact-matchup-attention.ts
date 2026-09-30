import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { MatchupPeriodContext } from '../matchup-period';
import { assessStarterAttention, type MyFantasyAttention } from '../my-fantasy';
import { stableJson } from '../projections/shared/stable-json';
import type { Player } from '../types';
import { PLAYER_CACHE_SECONDS } from '../sleeper-player-cache-policy';
import type { CurrentRosterMetadata, CurrentRosterPlayerMetadata } from './current-roster-metadata';
import type { ExactMatchupCompatibilityRead } from './exact-matchup-compatibility';
import type { AcceptedExactMatchupsRead } from './exact-matchups';
import { exactMatchupReferenceFailure, hasExactNflMapping } from './exact-matchup-reference-scope';

export type ExactMatchupAttentionInput = Readonly<{
  accepted: AcceptedExactMatchupsRead; expectedMapping: AdministrationSourceMapping;
  compatibility: ExactMatchupCompatibilityRead | null; selectedSeasonTeamId: string | null;
  metadata: CurrentRosterMetadata | null; context: MatchupPeriodContext; now: Date;
}>;
export type ExactMatchupAttentionRead = Readonly<{ status: 'unavailable'; reason: string }> | Readonly<{
  status: 'available'; selectedSeasonTeamId: string; evaluatedAt: string; assessment: MyFantasyAttention;
  references: Readonly<{ receiptId: string; sourceMappingRevisionId: string;
    metadata: CurrentRosterMetadata | null; metadataFreshness: 'unknown';
    gameState: ExactMatchupCompatibilityRead['gameState'] | null }>;
  limitations: readonly string[];
}>;

function metadataHasEvidence(metadata: CurrentRosterPlayerMetadata, now: Date): boolean {
  return metadata.availability === 'present' && metadata.sourceEntity.provider === 'sleeper'
    && metadata.sourceEntity.resourceKind === 'scoring-entity' && metadata.sourceEntity.nativeNamespace === 'nfl'
    && metadata.sources.length > 0 && metadata.sources.every(source => source.provider === 'sleeper'
      && source.resource === 'nfl-player-catalog' && source.sourceRevision !== null
      && /^sha256:[a-f0-9]{64}$/u.test(source.sourceRevision) && source.observedAt !== null
      && Number.isFinite(Date.parse(source.observedAt)) && Date.parse(source.observedAt) <= now.getTime());
}

/** Reuses My Fantasy's rules over exactly selected starters; no current injury is applied to past/future periods. */
export function assessAcceptedExactMatchupAttention(input: ExactMatchupAttentionInput): ExactMatchupAttentionRead {
  try {
    const { accepted, expectedMapping, compatibility, metadata, context, now } = input;
    const failure = exactMatchupReferenceFailure(accepted, expectedMapping, context);
    if (failure) return { status: 'unavailable', reason: failure };
    if (accepted.status !== 'available' || !Number.isFinite(now.getTime())) return { status: 'unavailable', reason: 'invalid_request' };
    const teams = accepted.value.teams.filter(team => team.seasonTeamId === input.selectedSeasonTeamId);
    if (teams.length !== 1) return { status: 'unavailable', reason: 'selected_team_unavailable' };
    const team = teams[0];
    const limitations: string[] = [];
    const result = (assessment: MyFantasyAttention): ExactMatchupAttentionRead => ({ status: 'available',
      selectedSeasonTeamId: team.seasonTeamId, evaluatedAt: now.toISOString(), assessment,
      references: { receiptId: accepted.receipt.id, sourceMappingRevisionId: expectedMapping.revisionId,
        metadata, metadataFreshness: 'unknown', gameState: compatibility?.gameState ?? null }, limitations });
    if (context.temporalState === 'past' || context.lifecycle === 'complete') {
      limitations.push('current_metadata_not_historical', 'local_completion_not_provider_finality');
      return result({ status: 'completed', issues: [], reason: 'This matchup is complete.' });
    }
    if (context.temporalState !== 'active' || context.lifecycle !== 'active'
      || context.activeSeason !== accepted.value.period.season || context.activeWeek !== accepted.value.period.nativeWeek
      || context.refreshDue) {
      limitations.push(context.refreshDue ? 'current_period_refresh_due' : 'current_period_only');
      return result({ status: 'unknown', issues: [], reason: 'Current lineup status is unavailable.' });
    }
    if (team.starters === null || !team.starters.length) {
      limitations.push('complete_starting_lineup_unavailable');
      return result({ status: 'unknown', issues: [], reason: 'The complete starting lineup is unavailable.' });
    }
    const sameOfficial = compatibility?.official.status === 'available'
      && stableJson(compatibility.official.accepted) === stableJson(accepted.accepted)
      && compatibility.official.receipt.id === accepted.receipt.id
      && stableJson(compatibility.official.value.teams.map(value => [value.seasonTeamId, value.externalRosterId,
        value.officialTeamPoints, value.starters?.map(slot => [slot.index, slot.playerExternalId, slot.empty, slot.officialPoints])]))
        === stableJson(accepted.value.teams.map(value => [value.seasonTeamId, value.externalRosterId,
          value.officialTeamPoints, value.starters?.map(slot => [slot.index, slot.playerExternalId, slot.empty, slot.officialPoints])]));
    const gameState = sameOfficial && hasExactNflMapping(accepted) && compatibility?.gameState.status === 'available'
      && !compatibility.gameState.reference.refreshDue ? compatibility.gameState : null;
    const selectedGroups = accepted.value.groups.filter(group => group.participantTeamIds.includes(team.seasonTeamId));
    if (selectedGroups.length === 1 && gameState?.groups.some(group => group.identity === selectedGroups[0].identity
      && group.authority === 'local-interpretation' && group.status === 'final')) {
      limitations.push('local_completion_not_provider_finality');
      return result({ status: 'completed', issues: [], reason: 'This matchup is complete.' });
    }
    const gameTeams = gameState?.teams.filter(value => value.seasonTeamId === team.seasonTeamId) ?? [];
    const games = gameTeams.length === 1 ? gameTeams[0].starters : [];
    const gameInventoryValid = games.length === team.starters.length && new Set(games.map(value => value.index)).size === games.length
      && team.starters.every(slot => games.some(value => value.index === slot.index));
    if (!gameState || !gameInventoryValid) limitations.push('compatible_game_state_unavailable');
    if (metadata?.status !== 'available' || !metadata.catalogComplete) limitations.push('catalog_coverage_incomplete');
    if (!accepted.value.lineupDefinitionRef || team.starters.some(slot => slot.nativeSlot === null)) limitations.push('slot_definition_unproved');
    const players: Player[] = team.starters.map((slot, index) => {
      if (slot.index !== index || slot.empty !== (slot.playerExternalId === null)) throw new Error('Invalid starter identity.');
      const label = slot.nativeSlot ?? `Starting position ${index + 1}`;
      if (slot.empty) return { id: `empty-${label}-${index}`, name: 'Empty slot', position: '—', nflTeam: null,
        injuryStatus: null, game: null, slot: label, points: null, projectedPoints: null };
      const entries = metadata?.status === 'available'
        ? metadata.players.filter(player => player.sourceEntity.nativeId === slot.playerExternalId) : [];
      const evidencedEntry = entries.length === 1 && metadataHasEvidence(entries[0], now) ? entries[0] : null;
      // A dated old label is retained evidence, not a confirmed current injury. Every
      // contributing cache slice must still be within the website's daily window.
      const expired = evidencedEntry?.sources.some(source => now.getTime() - Date.parse(source.observedAt!)
        >= PLAYER_CACHE_SECONDS * 1_000) ?? false;
      const entry = expired ? null : evidencedEntry;
      if (expired) limitations.push(`player_metadata_stale:${slot.playerExternalId}`);
      if (!entry || entry.sources.some(source => !source.complete)) limitations.push(`player_metadata_incomplete:${slot.playerExternalId}`);
      let game = gameInventoryValid ? games.find(value => value.index === slot.index)!.game : null;
      if (game?.kind === 'scheduled') {
        const scheduled = game;
        const teamMatches = entry?.nflTeam.value && gameState?.observations.some(observation => scheduled.location === 'home'
          ? observation.homeTeam === entry.nflTeam.value && observation.awayTeam === scheduled.opponent
          : observation.awayTeam === entry.nflTeam.value && observation.homeTeam === scheduled.opponent);
        if (!teamMatches) { game = null; limitations.push(`player_game_identity_unproved:${slot.playerExternalId}`); }
        else if (!scheduled.liveScore && !scheduled.finalScore && entry?.injuryStatus.availability === 'missing') {
          limitations.push(`player_availability_missing:${slot.playerExternalId}`);
        }
      }
      return { id: slot.playerExternalId!, name: entry?.name.value ?? slot.playerExternalId!,
        position: entry?.primaryPosition.value ?? '—', nflTeam: entry?.nflTeam.value ?? null,
        injuryStatus: entry?.injuryStatus.value ?? null,
        // Missing metadata cannot certify availability, but exact bye/started game evidence remains useful.
        game,
        slot: label, points: slot.officialPoints === null ? null : Number(slot.officialPoints), projectedPoints: null };
    });
    return result(assessStarterAttention(players, now, limitations.length === 0,
      limitations.length ? 'Some current league information is unavailable.' : null));
  } catch { return { status: 'unavailable', reason: 'attention_evidence_invalid' }; }
}

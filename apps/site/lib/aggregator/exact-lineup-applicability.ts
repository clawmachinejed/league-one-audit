import { resolveConfigurationComponent, type ConfigurationVersion } from '../league-administration/applicability';
import type { ConfigurationBinding } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { startingSlots } from '../sleeper-lineup';
import type { FantasyPlayerCatalog } from '../sleeper-player-catalog';
import type { RosterMembership } from './contracts';
import { projectCurrentRosterMetadata, type CurrentRosterMetadata } from './current-roster-metadata';
import type { AcceptedExactMatchupsRead, ExactPeriodMappingQualification, NativeMatchupPeriod, ExactLineupApplicability } from './exact-matchups';
export type { ExactLineupApplicability } from './exact-matchups';

/** Only component-specific, explicitly effective evidence can label an exact lineup.
 * The adapter proves source identity before expanding stored ranges to this period.
 */
export function resolveExactLineupApplicability(input: Readonly<{
  mapping: AdministrationSourceMapping; periodMapping: ExactPeriodMappingQualification;
  bindings: readonly ConfigurationBinding[]; versions: readonly ConfigurationVersion[];
  activationRefs: Readonly<Record<number, string>>;
}>): ExactLineupApplicability {
  if (input.periodMapping.status !== 'mapped' || input.periodMapping.season !== input.mapping.scope.season) {
    return { status: 'unavailable', reason: 'period_mapping_unproved' };
  }
  const period = { season: input.periodMapping.season, seasonType: input.periodMapping.seasonType, week: input.periodMapping.week };
  const resolved = resolveConfigurationComponent({ leagueSeasonId: input.mapping.leagueSeasonId,
    component: 'roster', period, bindings: input.bindings, versions: input.versions });
  if (resolved.status === 'unknown') return { status: 'unavailable', reason: resolved.reason };
  const positions = resolved.component.value.roster_positions;
  if (!Array.isArray(positions) || positions.some(position => typeof position !== 'string' || !position.trim() || position !== position.trim())) {
    return { status: 'unavailable', reason: 'roster_positions_missing' };
  }
  const activationRef = input.activationRefs[resolved.binding.generation];
  if (!activationRef) return { status: 'unavailable', reason: 'inconsistent_binding' };
  const nativeRosterPositions = [...positions] as string[];
  return { status: 'available', activationRef, configurationVersionId: resolved.binding.configurationVersionId,
    componentHash: resolved.component.hash, sourceMappingRevisionId: input.mapping.revisionId,
    periodMappingRef: input.periodMapping.evidenceRef, period, recordedAt: resolved.binding.recordedAt,
    evidence: { ...resolved.binding.evidence }, nativeRosterPositions, startingSlots: startingSlots(nativeRosterPositions) };
}

export type ExactLineupMetadata = Readonly<{
  status: 'available'; kind: 'exact-lineup-current-display-metadata'; period: NativeMatchupPeriod;
  /** Catalog labels and statuses are dated current-display evidence, even for an old lineup. */
  historicalPlayerState: 'unverified'; currentDisplay: CurrentRosterMetadata;
}> | Readonly<{ status: 'unavailable'; reason: 'official_matchup_unavailable' }>;

/** Select historical identities from that capture, never from today's roster. */
export function projectExactMatchupMetadata(accepted: AcceptedExactMatchupsRead,
  catalog?: FantasyPlayerCatalog): ExactLineupMetadata {
  if (accepted.status !== 'available') return { status: 'unavailable', reason: 'official_matchup_unavailable' };
  const teams = accepted.value.teams.map(team => ({ players: [...new Set([
    ...(team.players ?? []), ...(team.starters ?? []).flatMap(slot => slot.playerExternalId ? [slot.playerExternalId] : []),
  ])].filter(id => id !== '0').map((id): RosterMembership => ({
    seasonTeamId: team.seasonTeamId, sourceTeam: { provider: 'sleeper', resourceKind: 'team',
      nativeNamespace: accepted.value.period.source.nativeNamespace, nativeId: team.externalRosterId },
    sourceEntity: { provider: 'sleeper', resourceKind: 'scoring-entity', nativeNamespace: 'nfl', nativeId: id },
    canonicalEntityId: null, identityState: 'unresolved', nativeSection: null, section: 'unknown',
    effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown',
  })) }));
  return { status: 'available', kind: 'exact-lineup-current-display-metadata', period: accepted.value.period,
    historicalPlayerState: 'unverified', currentDisplay: projectCurrentRosterMetadata(teams,
      { playerCatalog: catalog as FantasyPlayerCatalog }) };
}

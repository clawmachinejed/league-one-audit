import type { AdministrationProvenance, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import { matchupTemporalState, type MatchupPeriodContext } from '../matchup-period';
import { matchesMatchupWinProbability } from '../matchup-win-probability-validation';
import { isMatchupsData } from '../matchups-response';
import { selectSnapshotMetadata, snapshotFreshnessMetadata } from '../projection-freshness';
import type { StoredProjectionSnapshot } from '../projections/shared/stored-snapshot';
import { compatibleScoringRulesHash } from '../projections/shared/revision-compatibility';
import { stableJson } from '../projections/shared/stable-json';
import { MAX_SOURCE_SKEW_MS } from '../projections/shared/source-timing';
import type { CalculationObservationSourceHistory, SnapshotSourceHistoryInput, SnapshotSourceHistoryRead } from '../projections/shared/source-history';
import type { Matchup, MatchupSide, MatchupWinProbability, Player } from '../types';
import { myFantasyProjectedOutcome } from '../my-fantasy';
import { exactMatchupsScope, projectExactMatchups, type AcceptedExactMatchupsRead,
  type ExactMatchupValue, type ExactPeriodMappingQualification } from './exact-matchups';

/** Immutable configuration/content facts; no current configuration head is accepted here. */
export type CompatibilityConfigurationEvidence = Readonly<{
  contentId: string; contentHash: string; leagueSeasonId: string; provider: string; externalLeagueId: string;
  configurationVersionId: string; scoringProfileId: string | null; payload: JsonValue;
  periodMapping: ExactPeriodMappingQualification;
}>;
export type CompatibilityCalculationEvidence = Readonly<{
  leagueWeekObservationId: string; matchupContentId: string; matchupContentHash: string;
  matchupPayload: JsonValue; configuration: CompatibilityConfigurationEvidence;
}>;
export type CompatibilityGameEvidence = Readonly<{
  id: string; nflGameId: string; provider: string; season: number; seasonType: string; week: number;
  observedAt: string; requestStartedAt: string; requestCompletedAt: string; homeTeam: string; awayTeam: string;
}>;
export type ExactMatchupCompatibilityEvidence = Readonly<{
  /** Selected through the snapshot's immutable league-season, never today's baseline rows. */
  profile: Readonly<{ id: string; rulesHash: string; rules: Readonly<Record<string, number>> }>;
  acceptedConfiguration: CompatibilityConfigurationEvidence;
  original: CompatibilityCalculationEvidence;
  verification: CompatibilityCalculationEvidence | null;
  games: Readonly<{ leagueWeekObservationId: string; expectedGameCount: number;
    expectedGameIds: readonly string[]; observations: readonly CompatibilityGameEvidence[] }> | null;
}>;
export type JoinAcceptedExactMatchupDerivedInput = Readonly<{
  request: SnapshotSourceHistoryInput; expectedMapping: AdministrationSourceMapping;
  accepted: AcceptedExactMatchupsRead; snapshot: StoredProjectionSnapshot | null;
  sourceHistory: SnapshotSourceHistoryRead; immutableEvidence: ExactMatchupCompatibilityEvidence | null;
  context: MatchupPeriodContext; now: Date;
}>;
type Unavailable = Readonly<{ status: 'unavailable'; reason: string }>;
type SnapshotReference = Readonly<{ snapshotId: string; revisionKey: string; modelVersion: string; calculatedAt: string;
  scoringProfileId: string; scoringRulesHash: string; verifiedAt: string; publishedAt: string | null; refreshDue: boolean }>;
export type ExactMatchupCompatibilityRead = Readonly<{
  official: AcceptedExactMatchupsRead;
  /** Source and input times remain original/verification-specific; no calculation-input reconstruction. */
  sourceHistory: SnapshotSourceHistoryRead;
  forecast: Unavailable | Readonly<{ status: 'available'; reference: SnapshotReference;
    teams: readonly Readonly<{ seasonTeamId: string; externalRosterId: string; projectedPoints: number | null;
      display: Readonly<{ source: 'stored-snapshot'; temporalContext: 'snapshot-display'; name: string; managerName: string; avatar: string | null }>;
      projectedOutcome: ReturnType<typeof myFantasyProjectedOutcome>;
      starters: readonly Readonly<{ index: number; playerExternalId: string | null; projectedPoints: number | null }>[] }>[] }>;
  gameState: Unavailable | Readonly<{ status: 'available'; reference: SnapshotReference;
    observations: readonly CompatibilityGameEvidence[];
    groups: readonly Readonly<{ identity: string; status: Matchup['status']; authority: 'local-interpretation' }>[];
    teams: readonly Readonly<{ seasonTeamId: string; starters: readonly Readonly<{ index: number; game: Player['game'] }>[] }>[] }>;
  probability: Unavailable | Readonly<{ status: 'available'; reference: SnapshotReference;
    groups: readonly Readonly<{ identity: string; value: MatchupWinProbability;
      teams: readonly Readonly<{ seasonTeamId: string; externalRosterId: string }>[] }>[] }>;
}>;

const uuid = (value: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const equal = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const unavailable = (reason: string): Unavailable => ({ status: 'unavailable', reason });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : null;

function mappingEqual(a: AdministrationSourceMapping, b: AdministrationSourceMapping): boolean {
  return isAdministrationSourceMapping(a) && equal(a, b);
}
function mapped(value: ExactPeriodMappingQualification, request: SnapshotSourceHistoryInput): boolean {
  return value.status === 'mapped' && value.purpose === 'native-period-identity'
    && uuid(value.evidenceRef) && value.season === request.season && value.week === request.week
    && value.seasonType === 'regular' && value.policyVersion === 'sleeper-native-week-to-nfl-regular-v1';
}
function configurationValid(configuration: CompatibilityConfigurationEvidence, input: JoinAcceptedExactMatchupDerivedInput,
  provenance: AdministrationProvenance): boolean {
  const { expectedMapping: mapping, request, immutableEvidence: evidence } = input;
  const raw = object(configuration.payload);
  if (!evidence || !raw || configuration.leagueSeasonId !== request.leagueSeasonId
    || configuration.provider !== mapping.scope.provider || configuration.externalLeagueId !== mapping.scope.externalLeagueId
    || !uuid(configuration.configurationVersionId) || configuration.scoringProfileId !== evidence.profile.id
    || raw.sport !== 'nfl' || raw.season_type !== 'regular' || !object(raw.scoring_settings)
    || input.accepted.status !== 'available' || raw.total_rosters !== input.accepted.receipt.expectedTeamCount
    || !equal(raw.scoring_settings, evidence.profile.rules) || !mapped(configuration.periodMapping, request)) return false;
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
    family: 'league', week: null, completeness: 'complete', provenance, payload: configuration.payload });
  return normalized.status === 'accepted' && normalized.contentHash === configuration.contentHash;
}
function officialFacts(value: ExactMatchupValue): unknown {
  return { teams: value.teams.map(team => ({ seasonTeamId: team.seasonTeamId, externalRosterId: team.externalRosterId,
    nativeMatchupId: team.nativeMatchupId, points: team.officialTeamPoints.effective,
    starters: team.starters?.map(slot => ({ index: slot.index, playerExternalId: slot.playerExternalId,
      empty: slot.empty, points: slot.officialPoints })) ?? null })).sort((a, b) => a.seasonTeamId.localeCompare(b.seasonTeamId)),
  groups: [...value.groups].sort((a, b) => a.identity.localeCompare(b.identity)) };
}
function calculationValid(source: CalculationObservationSourceHistory | null, evidence: CompatibilityCalculationEvidence | null,
  observationId: string | null, input: JoinAcceptedExactMatchupDerivedInput): string | null {
  if (!source || source.status !== 'linked') return 'source_unproved';
  if (!evidence || evidence.leagueWeekObservationId !== observationId || !mappingEqual(source.mapping, input.expectedMapping)
    || evidence.configuration.contentId !== source.leagueInput.contentId
    || evidence.configuration.contentHash !== source.leagueInput.contentHash
    || evidence.configuration.configurationVersionId !== source.leagueInput.configurationVersionId
    || evidence.matchupContentId !== source.matchupInput.contentId
    || evidence.matchupContentHash !== source.matchupInput.contentHash) return 'source_mismatch';
  if (source.leagueInput.acquisitionSourceEpoch !== 'capture_mapping_proved'
    || source.matchupInput.acquisitionSourceEpoch !== 'capture_mapping_proved') return 'source_unproved';
  if (!configurationValid(evidence.configuration, input, source.leagueInput.provenance)) return 'configuration_mismatch';
  if (input.accepted.status !== 'available') return 'official_unavailable';
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: input.expectedMapping.scope,
    family: 'matchups', week: input.request.week, completeness: 'complete', provenance: source.matchupInput.provenance,
    payload: evidence.matchupPayload }, { expectedRosterCount: input.accepted.receipt.expectedTeamCount });
  if (normalized.status !== 'accepted' || normalized.contentHash !== evidence.matchupContentHash) return 'source_mismatch';
  const projected = projectExactMatchups(normalized, input.accepted.value.teams);
  return equal(officialFacts(projected), officialFacts(input.accepted.value)) ? null : 'official_facts_mismatch';
}
function pointsEqual(official: string | null, stored: number | null): boolean {
  return official === null ? stored === null : finite(stored) && Number(official) === stored;
}
function snapshotSides(value: ExactMatchupValue, snapshot: StoredProjectionSnapshot): Map<string, MatchupSide> | null {
  const sides = snapshot.payload.matchups.flatMap(matchup => matchup.sides);
  const byRoster = new Map(sides.map(side => [String(side.team.id), side]));
  const rosterIds = value.teams.map(team => team.externalRosterId);
  if (new Set(rosterIds).size !== rosterIds.length || new Set(value.teams.map(team => team.seasonTeamId)).size !== rosterIds.length
    || sides.length !== rosterIds.length || byRoster.size !== rosterIds.length
    || snapshot.payload.teams.length !== rosterIds.length
    || new Set(snapshot.payload.teams.map(team => String(team.id))).size !== rosterIds.length
    || snapshot.payload.teams.some(team => !rosterIds.includes(String(team.id)))) return null;
  if (value.groups.some(group => group.format !== 'paired' || group.nativeMatchupId === null)
    || snapshot.payload.matchups.length !== value.groups.length
    || new Set(snapshot.payload.matchups.map(matchup => matchup.id)).size !== value.groups.length) return null;
  for (const group of value.groups) {
    const matchup = snapshot.payload.matchups.find(item => item.id === group.nativeMatchupId);
    const actual = matchup?.sides.map(side => value.teams.find(team => team.externalRosterId === String(side.team.id))?.seasonTeamId).sort();
    if (!actual || actual.length !== 2 || !equal(actual, [...group.participantTeamIds].sort())) return null;
  }
  for (const team of value.teams) {
    const side = byRoster.get(team.externalRosterId);
    if (!side || !pointsEqual(team.officialTeamPoints.effective, side.points) || team.starters === null
      || team.starters.length !== side.starters.length) return null;
    for (const [index, slot] of team.starters.entries()) {
      const player = side.starters[index];
      if (slot.index !== index || (slot.empty ? player.id !== `empty-${player.slot}-${index}`
        || player.points !== null || player.projectedPoints !== null || player.nflTeam !== null || player.game !== null
        : player.id !== slot.playerExternalId || !pointsEqual(slot.officialPoints, player.points))) return null;
    }
  }
  return byRoster;
}
function gamesValid(input: JoinAcceptedExactMatchupDerivedInput): boolean {
  const evidence = input.immutableEvidence!;
  if (input.sourceHistory.status !== 'available') return false;
  const games = evidence.games;
  if (!games) return false;
  const source = input.sourceHistory.original;
  if (source.source.status !== 'linked') return false;
  const originalCompleted = Date.parse(source.source.matchupInput.provenance.requestCompletedAt ?? '');
  const originalObserved = Date.parse(source.source.matchupInput.provenance.sourceObservedAt ?? '');
  const calculatedAt = Date.parse(input.snapshot!.calculatedAt);
  if (![originalCompleted, originalObserved, calculatedAt].every(Number.isFinite)
    || Math.max(originalCompleted, originalObserved, calculatedAt) - Math.min(originalCompleted, originalObserved, calculatedAt)
      > MAX_SOURCE_SKEW_MS) return false;
  const expected = games.expectedGameIds;
  if (games.leagueWeekObservationId !== source.leagueWeekObservationId || !Number.isSafeInteger(games.expectedGameCount)
    || games.expectedGameCount < 0 || games.expectedGameCount !== expected.length || new Set(expected).size !== expected.length
    || !expected.every(uuid) || games.observations.length !== expected.length
    || new Set(games.observations.map(game => game.id)).size !== expected.length
    || !equal([...source.gameStateObservationIds].sort(), games.observations.map(game => game.id).sort())
    || !equal([...expected].sort(), games.observations.map(game => game.nflGameId).sort())) return false;
  const sourceTimes = [originalCompleted, originalObserved, calculatedAt];
  for (const game of games.observations) {
    const started = Date.parse(game.requestStartedAt), completed = Date.parse(game.requestCompletedAt), observed = Date.parse(game.observedAt);
    if (!uuid(game.id) || game.provider !== 'tank01' || game.season !== input.request.season
      || game.week !== input.request.week || game.seasonType !== 'reg'
      || !game.homeTeam || !game.awayTeam || game.homeTeam === game.awayTeam
      || !Number.isFinite(started) || !Number.isFinite(completed) || !Number.isFinite(observed)
      || started > completed || observed < started || observed > completed) return false;
    sourceTimes.push(completed, observed);
  }
  if (Math.max(...sourceTimes) - Math.min(...sourceTimes) > MAX_SOURCE_SKEW_MS) return false;
  return input.snapshot!.payload.matchups.flatMap(matchup => matchup.sides).every(side => side.starters.every(player => {
    if (player.game?.kind !== 'scheduled') return true;
    const game = player.game;
    const matching = games.observations.filter(item => item.homeTeam === player.nflTeam || item.awayTeam === player.nflTeam);
    return matching.length === 1 && (game.location === 'home'
      ? matching[0].homeTeam === player.nflTeam && matching[0].awayTeam === game.opponent
      : matching[0].awayTeam === player.nflTeam && matching[0].homeTeam === game.opponent);
  }));
}

function temporalContextValid(input: JoinAcceptedExactMatchupDerivedInput): boolean {
  const { context, request } = input;
  if (context.defaultSeason !== request.season || !Number.isInteger(context.defaultWeek)
    || context.defaultWeek < 1 || context.defaultWeek > 18
    || (context.activeSeason === null) !== (context.activeWeek === null)
    || context.activeWeek !== null && (!Number.isInteger(context.activeWeek) || context.activeWeek < 1 || context.activeWeek > 18)
    || context.activeSeason !== null && (!Number.isInteger(context.activeSeason) || context.activeSeason < 1920 || context.activeSeason > 2200)
    || !['preseason', 'active', 'complete'].includes(context.lifecycle)) return false;
  return context.temporalState === matchupTemporalState({ lifecycle: context.lifecycle,
    defaultDisplayPeriod: { season: context.defaultSeason, seasonType: 'regular', week: context.defaultWeek },
    activeScoringPeriod: context.activeSeason !== null && context.activeWeek !== null
      ? { season: context.activeSeason, seasonType: 'regular', week: context.activeWeek } : null }, request.week);
}

/** Copies compatible stored results only. Never scores, forecasts, or changes accepted official facts. */
export function joinAcceptedExactMatchupDerived(input: JoinAcceptedExactMatchupDerivedInput): ExactMatchupCompatibilityRead {
  const failed = (reason: string): ExactMatchupCompatibilityRead => ({ official: input.accepted, sourceHistory: input.sourceHistory,
    forecast: unavailable(reason), gameState: unavailable(reason), probability: unavailable(reason) });
  try {
    const { request, expectedMapping: mapping, accepted, snapshot, sourceHistory: history, immutableEvidence: evidence } = input;
    if (!uuid(request.snapshotId) || !uuid(request.leagueSeasonId) || !isAdministrationSourceMapping(mapping)
      || request.leagueSeasonId !== mapping.leagueSeasonId || request.season !== mapping.scope.season
      || !Number.isSafeInteger(request.week) || request.week < 1 || request.week > 18 || !request.modelVersion
      || !Number.isFinite(input.now.getTime())) return failed('invalid_request');
    if (accepted.status !== 'available') return failed('official_unavailable');
    if (!equal(accepted.accepted.scope, exactMatchupsScope(mapping, request.week))
      || accepted.accepted.sourceMappingRevisionId !== mapping.revisionId
      || accepted.value.period.season !== request.season || accepted.value.period.nativeWeek !== request.week
      || accepted.value.period.source.provider !== mapping.scope.provider
      || accepted.value.period.source.nativeNamespace !== mapping.scope.externalLeagueId) return failed('official_scope_mismatch');
    if (!mapped(accepted.periodMapping, request)) return failed('period_mapping_unproved');
    if (history.status === 'available' && history.verification.status === 'not_current_snapshot') return failed('snapshot_not_current');
    if (!snapshot) return failed('snapshot_missing');
    if (snapshot.snapshotId !== request.snapshotId || snapshot.leagueSeasonId !== request.leagueSeasonId
      || snapshot.week !== request.week || snapshot.modelVersion !== request.modelVersion || !isMatchupsData(snapshot.payload)
      || snapshot.payload.week !== request.week || snapshot.payload.league.week !== request.week
      || snapshot.payload.league.season !== String(request.season)) return failed('snapshot_scope_mismatch');
    if (!snapshot.isCurrent) return failed('snapshot_not_current');
    if (history.status !== 'available' || !equal(history.scope, request)) return failed('source_history_unavailable');
    if (history.original.source.status !== 'linked'
      || history.original.source.leagueInput.acquisitionSourceEpoch !== 'capture_mapping_proved'
      || history.original.source.matchupInput.acquisitionSourceEpoch !== 'capture_mapping_proved') return failed('original_source_unproved');
    if (history.verification.source?.status !== 'linked'
      || history.verification.source.leagueInput.acquisitionSourceEpoch !== 'capture_mapping_proved'
      || history.verification.source.matchupInput.acquisitionSourceEpoch !== 'capture_mapping_proved') return failed('verification_source_unproved');
    if (!evidence) return failed('source_history_unavailable');
    if (!uuid(evidence.profile.id) || !Object.values(evidence.profile.rules).every(finite)
      || compatibleScoringRulesHash(evidence.profile.rules) !== evidence.profile.rulesHash) return failed('scoring_profile_mismatch');
    if (accepted.receipt.configurationContentId !== evidence.acceptedConfiguration.contentId
      || !equal(accepted.periodMapping, evidence.acceptedConfiguration.periodMapping)
      || !configurationValid(evidence.acceptedConfiguration, input, accepted.receipt.provenance)) return failed('accepted_configuration_mismatch');
    const originalFailure = calculationValid(history.original.source, evidence.original, history.original.leagueWeekObservationId, input);
    if (originalFailure) return failed(`original_${originalFailure}`);
    const verificationFailure = calculationValid(history.verification.source, evidence.verification, history.verification.leagueWeekObservationId, input);
    if (verificationFailure) return failed(`verification_${verificationFailure}`);
    const sides = snapshotSides(accepted.value, snapshot);
    if (!sides) return failed('official_facts_mismatch');
    if (!temporalContextValid(input)) return failed('freshness_context_mismatch');
    const selected = selectSnapshotMetadata(snapshotFreshnessMetadata(snapshot), input.context, input.now);
    if (selected.kind !== 'usable') return failed('snapshot_stale');
    const reference: SnapshotReference = { snapshotId: snapshot.snapshotId, revisionKey: snapshot.revisionKey, modelVersion: snapshot.modelVersion,
      calculatedAt: snapshot.calculatedAt, verifiedAt: snapshot.verifiedAt, publishedAt: snapshot.publishedAt,
      scoringProfileId: evidence.profile.id, scoringRulesHash: evidence.profile.rulesHash, refreshDue: selected.context.refreshDue };
    const gameOK = gamesValid(input);
    const forecastTeams = accepted.value.teams.map(team => ({ seasonTeamId: team.seasonTeamId, externalRosterId: team.externalRosterId,
      projectedPoints: sides.get(team.externalRosterId)!.projectedPoints,
      display: { source: 'stored-snapshot' as const, temporalContext: 'snapshot-display' as const,
        name: sides.get(team.externalRosterId)!.team.name, managerName: sides.get(team.externalRosterId)!.team.managerName,
        avatar: sides.get(team.externalRosterId)!.team.avatar },
      projectedOutcome: myFantasyProjectedOutcome(snapshot.payload, input.context, (() => {
        const matchup = snapshot.payload.matchups.find(value => value.id === team.nativeMatchupId)!;
        return { ...matchup, sides: [sides.get(team.externalRosterId)!,
          ...matchup.sides.filter(side => String(side.team.id) !== team.externalRosterId)] };
      })()),
      starters: team.starters!.map((slot, index) => ({ index, playerExternalId: slot.playerExternalId,
        projectedPoints: sides.get(team.externalRosterId)!.starters[index].projectedPoints })) }));
    const hasForecast = forecastTeams.some(team => finite(team.projectedPoints));
    const probabilityGroups = accepted.value.groups.map(group => ({ identity: group.identity,
      teams: group.participantTeamIds.map(id => { const team = accepted.value.teams.find(team => team.seasonTeamId === id)!;
        return { seasonTeamId: id, externalRosterId: team.externalRosterId }; }),
      matchup: snapshot.payload.matchups.find(matchup => matchup.id === group.nativeMatchupId)! }));
    const probabilityOK = probabilityGroups.length > 0 && probabilityGroups.every(({ matchup }) => matchup.winProbability !== undefined
      && matchup.winProbability.status !== 'unavailable' && matchesMatchupWinProbability(matchup));
    return { official: accepted, sourceHistory: history,
      forecast: !gameOK ? unavailable('game_evidence_unavailable') : hasForecast
        ? { status: 'available', reference, teams: forecastTeams } : unavailable('forecast_unavailable'),
      gameState: gameOK ? { status: 'available', reference, observations: evidence.games!.observations,
        groups: probabilityGroups.map(({ identity, matchup }) => ({ identity, status: matchup.status, authority: 'local-interpretation' as const })),
        teams: accepted.value.teams.map(team => ({ seasonTeamId: team.seasonTeamId,
          starters: sides.get(team.externalRosterId)!.starters.map((player, index) => ({ index, game: player.game })) })) }
        : unavailable('game_evidence_unavailable'),
      probability: !gameOK ? unavailable('game_evidence_unavailable') : probabilityOK
        ? { status: 'available', reference, groups: probabilityGroups.map(({ identity, teams, matchup }) => ({ identity, teams, value: matchup.winProbability! })) }
        : unavailable('probability_unavailable') };
  } catch { return failed('compatibility_evidence_invalid'); }
}

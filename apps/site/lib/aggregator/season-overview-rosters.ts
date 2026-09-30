import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { isAdministrationSourceMapping } from '../league-administration/source-mapping';
import type { AllPlayerMetricReadInput, StoredAllPlayerMetricRead, StoredAllPlayerPlayerMetric } from '../projection-store';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { playerMetricBoundary } from '../roster-metrics';
import type { WeeklyPlayerMetricWindow } from '../site-week';
import type { LeagueAdministrationStoreRead } from '../league-administration/store-contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { normalizeTeams, type SleeperUser } from '../transform';
import { displayedManagerOwnerId, displayedManagerTeams } from '../manager-display';
import type { Team } from '../types';
import { calculateTeamPpg, compareRosterStandings, rosterHistoryBoundary, type RosterHistoryBoundaryInput } from '../roster-metrics';
import type { SeasonOverviewSourceRead, SeasonOverviewTeamFacts } from './season-overview-source';
import { currentRosterScope, type AcceptedCurrentRosterRead } from './current-roster';
import { teamManagersScope, type AcceptedTeamManagersRead, type TeamManagerRelationships } from './team-managers';
import { seasonOverviewHistory, type SeasonOverviewMatchupCapture, type SeasonOverviewWeek } from './season-overview-schedules';
import { isNflTeam } from '../nfl-teams';

type Unavailable = Readonly<{ status: 'unavailable'; reason: string }>;
export type SeasonPlayerMetricInput = Readonly<{
  mapping: AdministrationSourceMapping;
  /** Mapping captured by the caller before the existing metric read. */
  sourceMapping: AdministrationSourceMapping;
  expectedScoringProfileId: string;
  selectedWeek: number;
  window: WeeklyPlayerMetricWindow | null;
  request: AllPlayerMetricReadInput;
  read: StoredAllPlayerMetricRead;
  now: Date;
}>;
export type SeasonPlayerMetricRead = Unavailable | Readonly<{
  status: 'available'; kind: 'season-player-metric-reference';
  scope: Readonly<{ leagueSeasonId: string; sourceMappingRevisionId: string; season: number }>;
  reference: Readonly<{ request: AllPlayerMetricReadInput; scoringProfileId: string;
    status: 'provisional'; observedAt: string; sourceAgeMilliseconds: number;
    throughWeek: number; asOf: string; nextRefreshAt: string | null; calendarHoldReason: string | null;
    publicationEvidence: 'immutable_publication_unproved' }>;
  metrics: readonly StoredAllPlayerPlayerMetric[];
  coverage: Readonly<{ status: 'partial'; reasons: readonly string[] }>;
}>;

const uuid = (value: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const timestamp = (value: string | null): number => value === null ? NaN : Date.parse(value);
const validWeek = (week: number) => Number.isSafeInteger(week) && week >= 1 && week <= 18;
const same = (left: unknown, right: unknown) => compatibleRevision(left) === compatibleRevision(right);

type CurrentSource = Extract<SeasonOverviewSourceRead, { status: 'available' }>;
type SourceAge = Readonly<{ observedAt: string | null; sourceAgeMilliseconds: number | null; freshness: 'unknown' }>;
type TeamCompatibilityInput = Readonly<{
  mapping: AdministrationSourceMapping; source: SeasonOverviewSourceRead;
  users: LeagueAdministrationStoreRead; now: Date;
}>;
export type SeasonTeamCompatibilityRead = Unavailable | Readonly<{
  status: 'available'; kind: 'season-team-compatibility';
  scope: Readonly<{ leagueSeasonId: string; sourceMappingRevisionId: string; season: number }>;
  /** Legacy defaults/rounding live only here, never in official typed facts. */
  teams: readonly Team[];
  semantics: 'legacy-compatibility';
  sourceRefs: Readonly<{ roster: CurrentSource['source'] & SourceAge;
    users: (SourceAge & Readonly<{ observationId: string; contentHash: string }>) | null }>;
  users: Readonly<{ status: 'available' | 'unavailable'; knownManagerIds: readonly string[] }>;
  coverage: Readonly<{ status: 'complete' | 'partial'; reasons: readonly string[] }>;
}>;

function sourceAge(observedAt: string | null, now: Date): SourceAge {
  const time = timestamp(observedAt);
  return { observedAt, sourceAgeMilliseconds: Number.isFinite(time) && time <= now.getTime() ? now.getTime() - time : null,
    // Resource consumers own freshness limits; an old capture is never restamped here.
    freshness: 'unknown' };
}
function sourceCompatible(source: SeasonOverviewSourceRead, mapping: AdministrationSourceMapping): source is CurrentSource {
  return source.status === 'available' && isAdministrationSourceMapping(mapping) && same(source.mapping, mapping)
    && source.source.expectedTeamCount === source.teams.length && source.teams.length > 0
    && new Set(source.teams.map(team => team.seasonTeamId)).size === source.teams.length
    && new Set(source.teams.map(team => team.externalRosterId)).size === source.teams.length;
}

/** Reuses the established display adapter over the same roster capture and separately dated users. */
export function buildSeasonTeamCompatibility(input: TeamCompatibilityInput): SeasonTeamCompatibilityRead {
  try {
    const { mapping, source, users, now } = input;
    if (!sourceCompatible(source, mapping) || !Number.isFinite(now.getTime())) return { status: 'unavailable', reason: 'season_source_scope_mismatch' };
    let directory: SleeperUser[] = [];
    let userReference: Extract<SeasonTeamCompatibilityRead, { status: 'available' }>['sourceRefs']['users'] = null;
    const reasons: string[] = [];
    if (users.status === 'available' && users.envelope.family === 'users' && users.envelope.week === null
      && users.envelope.completeness === 'complete' && same(users.envelope.scope, mapping.scope)
      && Array.isArray(users.envelope.payload)) {
      const normalized = normalizeAdministrationObservation(users.envelope);
      const observedAt = users.envelope.provenance.sourceObservedAt;
      if (normalized.status === 'accepted' && normalized.value?.family === 'users'
        && (observedAt === null || Number.isFinite(timestamp(observedAt)) && timestamp(observedAt) <= now.getTime())) {
        directory = users.envelope.payload.map(value => ({ ...(value as unknown as SleeperUser) }));
        userReference = { observationId: users.observationId, contentHash: normalized.contentHash,
          ...sourceAge(observedAt, now) };
        if (observedAt === null) reasons.push('users_source_age_unknown');
      }
    }
    if (userReference === null) reasons.push('users_evidence_unavailable');
    const rosters = source.compatibility.sourceRosters.map(roster => ({ ...roster }));
    if (rosters.length !== source.teams.length || rosters.some(roster => !source.teams.some(team => team.externalRosterId === String(roster.roster_id)))) {
      return { status: 'unavailable', reason: 'compatibility_roster_identity_mismatch' };
    }
    const knownUsers = new Set(directory.map(user => user.user_id));
    for (const roster of rosters) {
      if (roster.owner_id && !knownUsers.has(roster.owner_id)) reasons.push(`manager_display_missing:${roster.roster_id}`);
    }
    const legacyTeams = displayedManagerTeams(mapping.scope.externalLeagueId, normalizeTeams(rosters, directory),
      rosters, mapping.scope.leagueKey);
    const rosterAge = sourceAge(source.source.provenance.sourceObservedAt, now);
    if (rosterAge.sourceAgeMilliseconds === null) reasons.push('roster_source_age_unknown');
    return { status: 'available', kind: 'season-team-compatibility', semantics: 'legacy-compatibility',
      scope: { leagueSeasonId: mapping.leagueSeasonId, sourceMappingRevisionId: mapping.revisionId, season: mapping.scope.season },
      teams: legacyTeams, sourceRefs: { roster: { ...source.source, ...rosterAge }, users: userReference },
      users: { status: userReference === null ? 'unavailable' : 'available', knownManagerIds: [...knownUsers].sort() },
      coverage: { status: reasons.length ? 'partial' : 'complete', reasons: [...new Set(reasons)].sort() } };
  } catch { return { status: 'unavailable', reason: 'team_compatibility_invalid' }; }
}

function currentRosterCompatible(read: AcceptedCurrentRosterRead, source: CurrentSource, mapping: AdministrationSourceMapping) {
  return read.status === 'available' && same(read.accepted.scope, currentRosterScope(mapping))
    && read.accepted.sourceMappingRevisionId === mapping.revisionId
    && read.accepted.contentId === source.source.contentId && read.receipt.legacyObservationId === source.source.legacyObservationId
    && read.receipt.id === source.source.receiptId && read.teams.length === source.teams.length
    && read.teams.every(team => source.teams.some(fact => fact.seasonTeamId === team.seasonTeamId && fact.externalRosterId === team.externalRosterId));
}

export type SeasonRosterSummariesInput = TeamCompatibilityInput & Readonly<{
  currentRoster: AcceptedCurrentRosterRead;
  /** Explicit accepted weekly reads; absent periods do not become empty successful weeks. */
  history: readonly SeasonOverviewMatchupCapture[];
  boundary: RosterHistoryBoundaryInput;
}>;
export type SeasonRosterSummariesRead = Unavailable | Readonly<{
  status: 'available'; kind: 'season-roster-summaries'; scope: Extract<SeasonTeamCompatibilityRead, { status: 'available' }>['scope'];
  sourceRefs: Extract<SeasonTeamCompatibilityRead, { status: 'available' }>['sourceRefs'];
  history: Readonly<{ selectedWeek: number; throughWeek: number | null; policy: 'existing-official-team-ppg-v1';
    sources: readonly Readonly<{ week: number; source: SeasonOverviewWeek['source'] }>[] }>;
  teams: readonly Readonly<{ seasonTeamId: string; externalRosterId: string; display: Team;
    currentRecord: SeasonOverviewTeamFacts['record']; standingsRank: number | null;
    heldPlayerCount: number | null; averagePpg: number | null; averagePpgRank: number | null;
    reasons: readonly string[] }>[];
  coverage: Readonly<{ status: 'complete' | 'partial'; reasons: readonly string[] }>;
}>;

/** Current roster facts and selected history metrics keep their independent temporal scopes. */
export function buildSeasonRosterSummaries(input: SeasonRosterSummariesInput): SeasonRosterSummariesRead {
  try {
    const { mapping, source, boundary } = input;
    const compatibility = buildSeasonTeamCompatibility(input);
    if (!sourceCompatible(source, mapping) || compatibility.status !== 'available') return { status: 'unavailable', reason: 'season_source_scope_mismatch' };
    if (!validWeek(boundary.selectedWeek) || boundary.activeWeek !== null && !validWeek(boundary.activeWeek)
      || boundary.lastScoredWeek !== null && !validWeek(boundary.lastScoredWeek)
      || !['active', 'preseason', 'complete'].includes(boundary.lifecycle)) return { status: 'unavailable', reason: 'roster_boundary_invalid' };
    const throughWeek = rosterHistoryBoundary(boundary);
    const display = new Map(compatibility.teams.map(team => [String(team.id), team]));
    const historyRead = seasonOverviewHistory(mapping, source.teams.map(team => ({ seasonTeamId: team.seasonTeamId,
      externalRosterId: team.externalRosterId, team: display.get(team.externalRosterId)!, currentRecord: null, leagueOneRank: null })), input.history);
    const history = Array.from({ length: throughWeek ?? 0 }, (_, index) => historyRead.weeks.find(week => week.week === index + 1)?.rows ?? null);
    const retainedSources = historyRead.weeks.filter(week => week.week <= (throughWeek ?? 0)).map(week => ({ week: week.week, source: week.source }));
    const reasons = [...compatibility.coverage.reasons];
    reasons.push(...historyRead.failures.filter(failure => failure.week === null || failure.week <= (throughWeek ?? 0))
      .map(failure => `${failure.reason}:${failure.week ?? 'unknown'}`));
    const rosterIds = source.teams.map(team => Number(team.externalRosterId));
    const averages = calculateTeamPpg(history, throughWeek ?? 0, rosterIds);
    const recordsComplete = compatibility.coverage.status === 'complete' && source.teams.every(team => Object.values(team.record).every(field => field.state === 'known')
      && team.pointsFor.state === 'known' && display.has(team.externalRosterId));
    // Same legacy arithmetic and display name policy, with complete official inputs required.
    const order = recordsComplete ? [...compatibility.teams].sort(compareRosterStandings) : [];
    const ranks = new Map(order.map((team, index) => [String(team.id), index + 1]));
    const rosterAvailable = currentRosterCompatible(input.currentRoster, source, mapping);
    if (!rosterAvailable) reasons.push('current_membership_unavailable');
    if (!recordsComplete) reasons.push('roster_standings_incomplete');
    if (throughWeek === null) reasons.push('completed_history_boundary_unproved');
    if (throughWeek === 0) reasons.push('completed_history_empty');
    const teams = source.teams.map(team => {
      const metric = averages.get(Number(team.externalRosterId));
      const held = rosterAvailable && input.currentRoster.status === 'available'
        ? input.currentRoster.teams.find(roster => roster.seasonTeamId === team.seasonTeamId) : undefined;
      const teamReasons = metric ? [] : ['team_average_unavailable'];
      if (metric?.rank === null) teamReasons.push('team_average_rank_unavailable');
      reasons.push(...teamReasons.map(reason => `${reason}:${team.externalRosterId}`));
      return { seasonTeamId: team.seasonTeamId, externalRosterId: team.externalRosterId, display: display.get(team.externalRosterId)!,
        currentRecord: team.record, standingsRank: ranks.get(team.externalRosterId) ?? null,
        heldPlayerCount: held?.players.length ?? null, averagePpg: metric?.ppg ?? null, averagePpgRank: metric?.rank ?? null, reasons: teamReasons };
    });
    return { status: 'available', kind: 'season-roster-summaries', scope: compatibility.scope, sourceRefs: compatibility.sourceRefs,
      history: { selectedWeek: boundary.selectedWeek, throughWeek, policy: 'existing-official-team-ppg-v1', sources: retainedSources }, teams,
      coverage: { status: reasons.length ? 'partial' : 'complete', reasons: [...new Set(reasons)].sort() } };
  } catch { return { status: 'unavailable', reason: 'roster_summary_evidence_invalid' }; }
}

export type SeasonManagerDirectoryInput = TeamCompatibilityInput & Readonly<{ managers: AcceptedTeamManagersRead }>;
export type SeasonManagerDirectoryRead = Unavailable | Readonly<{
  status: 'available'; kind: 'current-season-manager-directory';
  scope: Extract<SeasonTeamCompatibilityRead, { status: 'available' }>['scope'];
  sourceRefs: Extract<SeasonTeamCompatibilityRead, { status: 'available' }>['sourceRefs'];
  ownership: Readonly<{ receiptId: string; observedAt: string | null }> | null;
  teams: readonly Readonly<{ seasonTeamId: string; externalRosterId: string; display: Team;
    currentRecord: SeasonOverviewTeamFacts['record']; relationship: TeamManagerRelationships | null;
    profileTarget: Readonly<{ seasonTeamId: string; externalRosterId: string }>;
    displayAttribution: Readonly<{ kind: 'provider' | 'curated'; externalManagerId: string | null }>;
    reasons: readonly string[] }>[];
  coverage: Readonly<{ status: 'complete' | 'partial'; reasons: readonly string[] }>;
}>;

/** Provider manager identity and owner-confirmed display attribution remain separate. */
export function buildSeasonManagerDirectory(input: SeasonManagerDirectoryInput): SeasonManagerDirectoryRead {
  try {
    const { source, mapping, managers } = input;
    const compatibility = buildSeasonTeamCompatibility(input);
    if (!sourceCompatible(source, mapping) || compatibility.status !== 'available') return { status: 'unavailable', reason: 'season_source_scope_mismatch' };
    const namespace = JSON.stringify(['nfl', mapping.scope.season, mapping.scope.externalLeagueId]);
    const relationshipsValid = managers.status === 'available' && same(managers.accepted.scope, teamManagersScope(mapping))
      && managers.accepted.sourceMappingRevisionId === mapping.revisionId && managers.accepted.contentId === source.source.contentId
      && managers.receipt.legacyObservationId === source.source.legacyObservationId
      && same(managers.receipt.provenance, source.source.provenance) && managers.teams.length === source.teams.length
      && new Set(managers.teams.map(team => team.seasonTeamId)).size === managers.teams.length
      && managers.teams.every(team => team.sourceTeam.provider === mapping.scope.provider && team.sourceTeam.resourceKind === 'team'
        && team.sourceTeam.nativeNamespace === namespace && source.teams.some(fact => fact.seasonTeamId === team.seasonTeamId
          && fact.externalRosterId === team.sourceTeam.nativeId)
        && source.compatibility.sourceRosters.some(roster => String(roster.roster_id) === team.sourceTeam.nativeId
          && (team.primaryOwner.state === 'owned' ? team.primaryOwner.manager.sourceManager.provider === mapping.scope.provider
            && team.primaryOwner.manager.sourceManager.resourceKind === 'manager'
            && team.primaryOwner.manager.sourceManager.nativeNamespace === 'account'
            && team.primaryOwner.manager.sourceManager.nativeId === roster.owner_id
            : team.primaryOwner.state === 'unowned' && roster.owner_id === null)));
    const reasons = [...compatibility.coverage.reasons];
    if (!relationshipsValid) reasons.push('manager_relationships_unavailable');
    const display = new Map(compatibility.teams.map(team => [String(team.id), team]));
    const teams = source.teams.map(team => {
      const roster = source.compatibility.sourceRosters.find(roster => String(roster.roster_id) === team.externalRosterId)!;
      const relationship = relationshipsValid && managers.status === 'available'
        ? managers.teams.find(manager => manager.seasonTeamId === team.seasonTeamId)! : null;
      const effective = displayedManagerOwnerId(mapping.scope.externalLeagueId, Number(team.externalRosterId),
        roster.owner_id, roster.co_owners, mapping.scope.leagueKey) ?? null;
      const teamReasons: string[] = [];
      if (relationship === null || relationship.primaryOwner.state === 'unknown') teamReasons.push('primary_owner_unknown');
      else if (relationship.primaryOwner.state === 'unowned') teamReasons.push('team_unowned');
      if (relationship?.coManagers.state === 'unknown') teamReasons.push('co_managers_unknown');
      reasons.push(...teamReasons.map(reason => `${reason}:${team.externalRosterId}`));
      return { seasonTeamId: team.seasonTeamId, externalRosterId: team.externalRosterId, display: display.get(team.externalRosterId)!,
        currentRecord: team.record, relationship, profileTarget: { seasonTeamId: team.seasonTeamId, externalRosterId: team.externalRosterId },
        displayAttribution: { kind: effective !== (roster.owner_id ?? null) ? 'curated' as const : 'provider' as const, externalManagerId: effective },
        reasons: teamReasons };
    });
    return { status: 'available', kind: 'current-season-manager-directory', scope: compatibility.scope, sourceRefs: compatibility.sourceRefs,
      ownership: relationshipsValid && managers.status === 'available' ? { receiptId: managers.receipt.id,
        observedAt: managers.receipt.provenance.sourceObservedAt } : null, teams,
      coverage: { status: reasons.length ? 'partial' : 'complete', reasons: [...new Set(reasons)].sort() } };
  } catch { return { status: 'unavailable', reason: 'manager_directory_evidence_invalid' }; }
}

/** Copies the existing cutoff reader's results; never scores or claims an immutable publication. */
export function joinSeasonPlayerMetrics(input: SeasonPlayerMetricInput): SeasonPlayerMetricRead {
  try {
    const { mapping, request, read, now } = input;
    if (!isAdministrationSourceMapping(mapping) || !isAdministrationSourceMapping(input.sourceMapping)
      || !same(mapping, input.sourceMapping)) return { status: 'unavailable', reason: 'metric_mapping_mismatch' };
    if (!validWeek(input.selectedWeek) || !uuid(input.expectedScoringProfileId) || !Number.isFinite(now.getTime())) {
      return { status: 'unavailable', reason: 'metric_context_invalid' };
    }
    const boundary = playerMetricBoundary({ selectedWeek: input.selectedWeek, window: input.window });
    if (boundary.throughWeek === null || boundary.asOf === null) return { status: 'unavailable', reason: 'metric_cutoff_unproved' };
    const asOf = timestamp(boundary.asOf);
    if (!Number.isFinite(asOf) || new Date(asOf).toISOString() !== boundary.asOf || asOf > now.getTime()
      || request.leagueKey !== mapping.scope.leagueKey || request.provider !== mapping.scope.provider
      || request.season !== mapping.scope.season || request.seasonType !== 'reg'
      || request.scorerVersion !== 'sleeper-actual-v1' || request.throughWeek !== boundary.throughWeek
      || request.provisionalWeek !== boundary.provisionalWeek || request.asOf !== boundary.asOf) {
      return { status: 'unavailable', reason: 'metric_request_scope_mismatch' };
    }
    if (read.status === 'unavailable') return { status: 'unavailable', reason: 'stored_metrics_unavailable' };
    const observedAt = timestamp(read.observedAt);
    if (read.status !== 'provisional' || !Number.isFinite(observedAt) || observedAt > asOf
      || read.throughWeek === null || !validWeek(read.throughWeek) || read.throughWeek > boundary.throughWeek
      || !Number.isSafeInteger(read.rowsRead) || read.rowsRead < 0 || !read.metrics.length) {
      return { status: 'unavailable', reason: 'metric_evidence_invalid' };
    }
    const seen = new Set<string>(), canonical = new Set<string>(), nativeKinds = new Map<string, string>();
    const reasons = new Set(['immutable_metric_publication_unproved']);
    if (read.throughWeek < boundary.throughWeek) reasons.add('metric_history_incomplete');
    for (const metric of read.metrics) {
      const key = `${metric.entityKind}:${metric.providerExternalId}`;
      if (metric.scoringProfileId !== input.expectedScoringProfileId || seen.has(key)
        || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(metric.position)
        || !['player', 'team_defense'].includes(metric.entityKind)
        || (metric.entityKind === 'team_defense') !== (metric.position === 'DEF')
        || !metric.providerExternalId || metric.providerExternalId.trim() !== metric.providerExternalId
        || (metric.entityKind === 'team_defense' ? !isNflTeam(metric.providerExternalId) : !/^[1-9]\d*$/u.test(metric.providerExternalId))
        || nativeKinds.has(metric.providerExternalId) && nativeKinds.get(metric.providerExternalId) !== metric.entityKind
        || !Number.isFinite(metric.totalFantasyPoints)
        || !Number.isSafeInteger(metric.appearanceGameCount) || metric.appearanceGameCount < 0
        || metric.appearanceGameCount > boundary.throughWeek
        || !Number.isSafeInteger(metric.publishedWeekCount) || metric.publishedWeekCount < 0
        || metric.publishedWeekCount > boundary.throughWeek
        || metric.pointsPerGame !== null && (!Number.isFinite(metric.pointsPerGame) || metric.appearanceGameCount === 0)
        || metric.positionRank !== null && (!Number.isSafeInteger(metric.positionRank) || metric.positionRank < 1)
        || metric.scoringEntityId !== null && (!uuid(metric.scoringEntityId) || canonical.has(metric.scoringEntityId))
        || metric.scoringEntityId === null && (metric.entityKind !== 'player' || !/^[1-9]\d*$/u.test(metric.providerExternalId))) {
        return { status: 'unavailable', reason: 'metric_identity_or_value_invalid' };
      }
      seen.add(key); nativeKinds.set(metric.providerExternalId, metric.entityKind);
      if (metric.scoringEntityId !== null) canonical.add(metric.scoringEntityId);
      else reasons.add('provisional_source_only_identity');
      if (metric.pointsPerGame === null) reasons.add('player_ppg_unavailable');
      if (metric.positionRank === null) reasons.add('player_position_rank_unavailable');
    }
    return { status: 'available', kind: 'season-player-metric-reference',
      scope: { leagueSeasonId: mapping.leagueSeasonId, sourceMappingRevisionId: mapping.revisionId, season: mapping.scope.season },
      reference: { request: { ...request }, scoringProfileId: input.expectedScoringProfileId,
        status: 'provisional', observedAt: read.observedAt!, sourceAgeMilliseconds: now.getTime() - observedAt,
        throughWeek: read.throughWeek, asOf: boundary.asOf, nextRefreshAt: boundary.nextRefreshAt, calendarHoldReason: input.window?.holdReason ?? null,
        publicationEvidence: 'immutable_publication_unproved' },
      metrics: read.metrics.map(metric => ({ ...metric })), coverage: { status: 'partial', reasons: [...reasons].sort() } };
  } catch { return { status: 'unavailable', reason: 'metric_evidence_invalid' }; }
}

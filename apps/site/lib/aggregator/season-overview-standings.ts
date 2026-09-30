import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { isAdministrationSourceMapping } from '../league-administration/source-mapping';
import type { LeagueAdministrationStoreRead } from '../league-administration/store-contracts';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { compareTeams, waiverBudgetRemaining } from '../transform';
import { exactMatchupsScope, type AcceptedExactMatchupsRead } from './exact-matchups';
import type { AcceptedLeagueSettingsRead } from './league-settings';
import { buildSeasonTeamCompatibility } from './season-overview-rosters';
import type { SeasonOverviewSourceRead } from './season-overview-source';

export type SeasonStandingsInput = Readonly<{
  mapping: AdministrationSourceMapping; source: SeasonOverviewSourceRead;
  users: LeagueAdministrationStoreRead; settings: AcceptedLeagueSettingsRead; now: Date;
}>;
const same = (left: unknown, right: unknown) => compatibleRevision(left) === compatibleRevision(right);

/** Exact official season facts and local presentation order have separate authority. */
export function buildSeasonOfficialStandings(input: SeasonStandingsInput) {
  const { mapping, source, settings, now } = input;
  if (!isAdministrationSourceMapping(mapping) || source.status !== 'available' || !same(mapping, source.mapping)) {
    return { status: 'unavailable' as const, reason: 'season_standings_scope_unavailable' };
  }
  const observed = Date.parse(source.source.provenance.sourceObservedAt ?? '');
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(observed) || observed > now.getTime()) {
    return { status: 'unavailable' as const, reason: 'season_standings_time_unavailable' };
  }
  const compatibility = buildSeasonTeamCompatibility(input);
  const complete = source.completeness === 'complete' && compatibility.status === 'available'
    && compatibility.coverage.status === 'complete';
  const ordered = compatibility.status === 'available' ? [...compatibility.teams].sort(compareTeams) : [];
  const localPlaces = new Map(ordered.map((team, index) => [String(team.id), index + 1]));
  const qualifiedSettings = settings.status === 'available'
    && settings.leagueSeasonId === mapping.leagueSeasonId
    && settings.accepted.scope.connectionId === mapping.connectionId
    && settings.accepted.sourceMappingRevisionId === mapping.revisionId
    && settings.value.season === mapping.scope.season
    && settings.value.sourceLeague.provider === mapping.scope.provider
    && settings.value.sourceLeague.nativeId === mapping.scope.externalLeagueId;
  const budget = qualifiedSettings && settings.status === 'available' ? settings.value.waivers.budget : null;
  return {
    status: 'available' as const, kind: 'season-official-standings' as const,
    mapping, temporalContext: 'current-display' as const,
    source: { ...source.source, sourceAgeMilliseconds: now.getTime() - observed },
    freshness: 'unknown' as const,
    teams: source.teams.map(team => ({
      seasonTeamId: team.seasonTeamId, externalRosterId: team.externalRosterId,
      official: { record: team.record, pointsFor: team.pointsFor, pointsAgainst: team.pointsAgainst,
        providerRank: team.providerRank, providerSeed: team.providerSeed },
      leagueOneOrder: complete ? localPlaces.get(team.externalRosterId) ?? null : null,
      waiver: { priority: team.waiver.priority, budgetUsed: team.waiver.budgetUsed,
        policy: qualifiedSettings && settings.status === 'available' ? settings.value.waivers : null,
        policySource: qualifiedSettings && settings.status === 'available'
          ? { receiptId: settings.receipt.id, provenance: settings.receipt.provenance } : null,
        budgetRemaining: waiverBudgetRemaining(budget?.state === 'known' ? budget.value : null,
          team.waiver.budgetUsed.state === 'known' ? team.waiver.budgetUsed.value : null),
      },
    })),
    localOrder: { authority: 'presentation-derived' as const, policy: 'existing-compareTeams' as const,
      status: complete ? 'available' as const : 'unavailable' as const,
      reason: complete ? null : 'complete_official_standings_required' },
    compatibility,
    coverage: { status: source.completeness, reasons: [...source.reasons] },
  };
}
export type SeasonOfficialStandings = ReturnType<typeof buildSeasonOfficialStandings>;

/** A past matchup never changes the temporal meaning of the current record/rank overlay. */
export function joinCurrentSeasonMatchupSummary(mapping: AdministrationSourceMapping,
  matchup: AcceptedExactMatchupsRead, standings: SeasonOfficialStandings) {
  if (!isAdministrationSourceMapping(mapping) || matchup.status !== 'available' || standings.status !== 'available' || !same(mapping, standings.mapping)
    || matchup.accepted.scope.leagueSeasonId !== mapping.leagueSeasonId
    || matchup.accepted.scope.connectionId !== mapping.connectionId
    || matchup.accepted.sourceMappingRevisionId !== mapping.revisionId
    || matchup.value.period.season !== mapping.scope.season
    || !Number.isSafeInteger(matchup.value.period.nativeWeek) || matchup.value.period.nativeWeek < 1 || matchup.value.period.nativeWeek > 18
    || !same(matchup.accepted.scope, exactMatchupsScope(mapping, matchup.value.period.nativeWeek))
    || matchup.value.period.source.provider !== mapping.scope.provider
    || matchup.value.period.source.nativeNamespace !== mapping.scope.externalLeagueId
    || matchup.value.period.source.nativeId !== String(matchup.value.period.nativeWeek)
    || matchup.value.period.source.resourceKind !== 'competition-period') {
    return { status: 'unavailable' as const, reason: 'current_record_overlay_scope_mismatch' };
  }
  const byTeam = new Map(standings.teams.map(team => [team.seasonTeamId, team]));
  if (matchup.value.teams.length !== standings.teams.length
    || new Set(matchup.value.teams.map(team => team.seasonTeamId)).size !== standings.teams.length
    || matchup.value.teams.some(team => byTeam.get(team.seasonTeamId)?.externalRosterId !== team.externalRosterId)) {
    return { status: 'unavailable' as const, reason: 'current_record_overlay_team_mismatch' };
  }
  return { status: 'available' as const, temporalContext: 'current-display' as const,
    matchupPeriod: matchup.value.period, currentSource: standings.source,
    teams: matchup.value.teams.map(team => ({ seasonTeamId: team.seasonTeamId,
      currentRecord: byTeam.get(team.seasonTeamId)!.official.record,
      providerRank: byTeam.get(team.seasonTeamId)!.official.providerRank,
      leagueOneOrder: byTeam.get(team.seasonTeamId)!.leagueOneOrder })) };
}

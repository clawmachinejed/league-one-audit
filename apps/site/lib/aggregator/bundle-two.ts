import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { LeagueAdministrationStore } from '../league-administration/store-contracts';
import type { MatchupPeriodContext } from '../matchup-period';
import type { AllPlayerMetricReadInput, StoredAllPlayerMetricRead } from '../projection-store';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { playerMetricBoundary, rosterHistoryBoundary } from '../roster-metrics';
import { resolveWeeklyPlayerMetrics } from '../site-week';
import type { League } from '../types';
import type { ExactMatchupCompatibilityRead, JoinAcceptedExactMatchupDerivedInput } from './exact-matchup-compatibility';
import { buildSeasonOverviewProjection } from './season-overview-projections';
import { buildSeasonManagerDirectory, buildSeasonRosterSummaries, joinSeasonPlayerMetrics } from './season-overview-rosters';
import { buildSeasonOverviewSchedule, seasonOverviewCalendar, type SeasonOverviewCalendarEvidence,
  type SeasonOverviewTeamIdentity } from './season-overview-schedules';
import { buildSeasonOfficialStandings, joinCurrentSeasonMatchupSummary } from './season-overview-standings';
import type { SeasonOverviewSourceRead } from './season-overview-source';

export type BundleTwoReadInput = Readonly<{
  expectedMapping: AdministrationSourceMapping; league: League; context: MatchupPeriodContext;
  selectedWeek: number; selectedSeasonTeamId: string | null; now: Date;
  /** Already acquired calendar evidence; this reader has no provider capability. */
  calendar: SeasonOverviewCalendarEvidence | null;
  /** Null preserves lazy schedules: no 14/15-week schedule scan until explicitly requested. */
  scheduleRange: 'my-team' | 'manager' | null;
  snapshot: Readonly<{ snapshotId: string; modelVersion: string }> | null;
}>;
export type BundleTwoDependencies = Pick<LeagueAdministrationStore, 'enabled' | 'readSourceMapping'
  | 'readAcceptedCurrentRoster' | 'readAcceptedTeamManagers' | 'readAcceptedLeagueSettings'
  | 'readAcceptedExactMatchups' | 'readSource' | 'readEnrollment'> & Readonly<{
    readExactMatchupCompatibility: (input: Pick<JoinAcceptedExactMatchupDerivedInput,
      'request' | 'expectedMapping' | 'context' | 'now'>) => Promise<ExactMatchupCompatibilityRead>;
    readAllPlayerPlayerMetrics: (input: AllPlayerMetricReadInput) => Promise<StoredAllPlayerMetricRead>;
  }>;
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });
const same = (left: unknown, right: unknown) => compatibleRevision(left) === compatibleRevision(right);
async function isolated<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try { return await read(); } catch { return fallback; }
}

/** Internal composition over the existing accepted/store paths. No capture or writer is added. */
export function createBundleTwoReadService(dependencies: BundleTwoDependencies) {
  return {
    async readBundleTwo(request: BundleTwoReadInput) {
      if (!dependencies.enabled) return { kind: 'bundle-two-season-overview' as const,
        status: 'disabled' as const, reason: 'persistence_disabled' };
      // Detach scope and request before the first asynchronous read.
      const input = structuredClone(request), mapping = input.expectedMapping;
      if (!isAdministrationSourceMapping(mapping) || !Number.isFinite(input.now.getTime())
        || input.league.season !== String(mapping.scope.season) || !Number.isSafeInteger(input.selectedWeek)
        || input.selectedWeek < 1 || input.selectedWeek > 18
        || ![null, 'my-team', 'manager'].includes(input.scheduleRange)) return unavailable('invalid_season_overview_request');
      const originalMapping = await isolated(() => dependencies.readSourceMapping(mapping.scope.externalLeagueId), null);
      if (!same(mapping, originalMapping)) return unavailable('season_overview_mapping_changed');
      const [roster, managers, settings, users, enrollment] = await Promise.all([
        isolated(() => dependencies.readAcceptedCurrentRoster(mapping, { includeSeasonOverview: true }), unavailable('current_roster_read_failed')),
        isolated(() => dependencies.readAcceptedTeamManagers(mapping), unavailable('team_managers_read_failed')),
        isolated(() => dependencies.readAcceptedLeagueSettings(mapping), unavailable('league_settings_read_failed')),
        isolated(() => dependencies.readSource({ ...mapping.scope, family: 'users', week: null }), unavailable('users_read_failed')),
        isolated(() => dependencies.readEnrollment({ leagueKey: mapping.scope.leagueKey }, mapping.scope.season), { status: 'missing' as const }),
      ]);
      const source: SeasonOverviewSourceRead = roster.status === 'available' && roster.seasonOverview
        ? roster.seasonOverview : { status: 'unavailable', reason: 'season_overview_source_invalid' };
      const common = { mapping, source, users, now: input.now };
      const standings = buildSeasonOfficialStandings({ ...common, settings });
      const display = standings.status === 'available' && standings.compatibility.status === 'available'
        ? standings.compatibility.teams : [];
      const teams: SeasonOverviewTeamIdentity[] = source.status === 'available' ? source.teams.flatMap(team => {
        const compatible = display.find(item => String(item.id) === team.externalRosterId);
        if (!compatible) return [];
        return [{ seasonTeamId: team.seasonTeamId, externalRosterId: team.externalRosterId, team: compatible,
          currentRecord: Object.values(team.record).every(field => field.state === 'known')
            ? { wins: team.record.wins.value!, losses: team.record.losses.value!, ties: team.record.ties.value! } : null,
          leagueOneRank: standings.status === 'available'
            ? standings.teams.find(item => item.seasonTeamId === team.seasonTeamId)?.leagueOneOrder ?? null : null }];
      }) : [];
      const calendar = input.calendar
        && Date.parse(input.calendar.evidence.evaluatedAt) <= input.now.getTime()
        && Date.parse(input.calendar.evidence.retrievalCompletedAt) <= input.now.getTime()
        ? seasonOverviewCalendar(mapping, input.calendar) : null;
      const currentContext = input.context.activeSeason === mapping.scope.season
        || input.context.lifecycle === 'preseason' && input.context.defaultSeason === mapping.scope.season;
      const boundaryProved = !!calendar && (input.context.lifecycle === 'complete'
        || currentContext && (input.context.lifecycle === 'preseason' || input.context.activeWeek === calendar.resolution.week));
      const boundary = { selectedWeek: input.selectedWeek,
        activeWeek: boundaryProved ? input.context.activeWeek : null,
        lastScoredWeek: boundaryProved ? calendar!.resolution.lastCompletedWeek : null,
        lifecycle: input.context.lifecycle };
      const throughWeek = rosterHistoryBoundary(boundary);
      const scheduleEnd = input.scheduleRange === 'my-team' ? 15 : input.scheduleRange === 'manager' ? 14 : 0;
      const historyEnd = Math.max(throughWeek ?? 0, scheduleEnd,
        input.snapshot && currentContext ? input.context.activeWeek ?? 0 : 0);
      const requestedWeeks = [...new Set([...Array.from({ length: Math.min(historyEnd, 18) }, (_, index) => index + 1), input.selectedWeek])];
      // Small fixed batches bound database concurrency, without a new cache or collector.
      const captures = [];
      for (let index = 0; index < requestedWeeks.length; index += 4) {
        captures.push(...await Promise.all(requestedWeeks.slice(index, index + 4).map(async week => ({ week,
          read: await isolated(() => dependencies.readAcceptedExactMatchups(mapping, week), unavailable('exact_matchup_read_failed')) }))));
      }
      const history = captures.map(capture => capture.read);
      const selected = captures.find(capture => capture.week === input.selectedWeek)!.read;
      const compatibility = input.snapshot && currentContext && input.context.activeWeek !== null
        ? await isolated(() => dependencies.readExactMatchupCompatibility({ expectedMapping: mapping, context: input.context, now: input.now,
          request: { ...input.snapshot!, leagueSeasonId: mapping.leagueSeasonId, season: mapping.scope.season, week: input.context.activeWeek! } }), null) : null;
      const window = calendar ? resolveWeeklyPlayerMetrics({ season: String(mapping.scope.season),
        seasonSchedule: calendar.evidence.schedule, evaluatedAt: calendar.evidence.evaluatedAt }) : null;
      const metricBoundary = playerMetricBoundary({ selectedWeek: input.selectedWeek, window });
      const profile = enrollment.status === 'ready' && enrollment.enrollment.leagueSeasonId === mapping.leagueSeasonId
        && enrollment.enrollment.externalLeagueId === mapping.scope.externalLeagueId && enrollment.enrollment.provider === mapping.scope.provider
        && enrollment.enrollment.season === mapping.scope.season ? enrollment.enrollment.scoringProfileId : null;
      let metrics: ReturnType<typeof joinSeasonPlayerMetrics> = unavailable('metric_cutoff_or_profile_unavailable');
      if (profile && metricBoundary.throughWeek !== null && metricBoundary.asOf !== null) {
        const metricRequest: AllPlayerMetricReadInput = { leagueKey: mapping.scope.leagueKey, provider: mapping.scope.provider,
          season: mapping.scope.season, seasonType: 'reg', throughWeek: metricBoundary.throughWeek, provisionalWeek: null,
          asOf: metricBoundary.asOf, scorerVersion: 'sleeper-actual-v1' };
        const read = await isolated(() => dependencies.readAllPlayerPlayerMetrics(metricRequest),
          { status: 'unavailable' as const, observedAt: null, throughWeek: null, rowsRead: 0, metrics: [] });
        metrics = joinSeasonPlayerMetrics({ mapping, sourceMapping: originalMapping!, expectedScoringProfileId: profile,
          selectedWeek: input.selectedWeek, window, request: metricRequest, read, now: input.now });
      }
      const finalMapping = await isolated(() => dependencies.readSourceMapping(mapping.scope.externalLeagueId), null);
      if (!same(mapping, finalMapping)) return unavailable('season_overview_mapping_changed');
      const overview = { mapping, teams, league: input.league, updatedAt: source.status === 'available'
        ? source.source.provenance.checkedAt : input.now.toISOString(), captures: history,
        calendar: calendar ? input.calendar : null, context: input.context };
      return { status: 'read' as const, kind: 'bundle-two-season-overview' as const, source, standings,
        rosterSummaries: buildSeasonRosterSummaries({ ...common, currentRoster: roster,
          history: captures.filter(capture => capture.week <= (throughWeek ?? 0)).map(capture => capture.read), boundary }),
        managerDirectory: buildSeasonManagerDirectory({ ...common, managers }), playerMetrics: metrics,
        schedule: input.scheduleRange && input.selectedSeasonTeamId
          ? buildSeasonOverviewSchedule({ ...overview, range: input.scheduleRange, seasonTeamId: input.selectedSeasonTeamId })
          : unavailable('schedule_not_requested'),
        projectedStandings: buildSeasonOverviewProjection({ ...overview,
          captures: captures.filter(capture => capture.week < (input.context.activeWeek ?? 0)).map(capture => capture.read),
          source, settings, compatibility, context: input.context }),
        matchupSummary: joinCurrentSeasonMatchupSummary(mapping, selected, standings),
        limitations: ['internal_only_no_reader_cutover', 'current_metadata_not_historical_evidence',
          'retained_comparison_is_not_durable_replay', 'production_coverage_not_established'] as const };
    },
  };
}
export type BundleTwoRead = Awaited<ReturnType<ReturnType<typeof createBundleTwoReadService>['readBundleTwo']>>;

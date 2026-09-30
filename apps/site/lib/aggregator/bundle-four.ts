import 'server-only';

import type { AdministrationReadInput, LeagueAdministrationStore, LeagueAdministrationStoreRead } from '../league-administration/store-contracts';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import { createPageAdministrationReader } from '../page-source';
import { managerHistoryFirstSeason, managerHistoryRegularEnd, managerHistoryPreviousLeagueId,
  assertManagerHistoryPreviousSeasonIdentity } from '../manager-history-policy';
import type { MatchupPeriodContext } from '../matchup-period';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { seasonOverviewCalendar, type SeasonOverviewCalendarEvidence } from './season-overview-schedules';
import { projectHistoricalContinuity, type HistoricalContinuityInput } from './historical-continuity';

export type BundleFourReadInput = Readonly<{
  expectedMapping: AdministrationSourceMapping; context: MatchupPeriodContext;
  calendar: SeasonOverviewCalendarEvidence | null; now: Date;
}>;
export type BundleFourDependencies = Pick<LeagueAdministrationStore, 'enabled' | 'readSourceMapping' | 'readSource'>;
export type HistoricalSourceEvidence = Readonly<{
  request: AdministrationReadInput; status: LeagueAdministrationStoreRead['status'];
  sourceReason: string | null; observationId: string | null; generation: number | null;
  acceptedHeadCheckedAt: string | null; verifiedAt: string | null; sourceObservedAt: string | null;
  guard: 'usable' | 'rejected'; guardReason: string | null;
}>;
export type FrozenHistoricalContinuity = Readonly<{
  version: 'b4-frozen-comparison-v1'; evaluatedAt: string;
  sourceDigest: string; projectionDigest: string; input: HistoricalContinuityInput;
  sourceEvidence: readonly HistoricalSourceEvidence[];
  boundaryEvidence: Readonly<{ context: MatchupPeriodContext; calendar: SeasonOverviewCalendarEvidence | null }>;
}>;
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });
const same = (a: unknown, b: unknown) => compatibleRevision(a) === compatibleRevision(b);
const key = (input: AdministrationReadInput) => `${input.externalLeagueId}:${input.family}:${input.week ?? 0}`;
async function isolated<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try { return await read(); } catch { return fallback; }
}

/** Deterministic comparison of an already captured bounded input; no accepted head or IO. */
export function compareFrozenHistoricalContinuity(frozen: FrozenHistoricalContinuity) {
  if (frozen?.version !== 'b4-frozen-comparison-v1' || !Number.isFinite(Date.parse(frozen.evaluatedAt))
    || !Array.isArray(frozen.sourceEvidence) || frozen.sourceEvidence.length > 340
    || !frozen.boundaryEvidence
    || compatibleRevision({ input: frozen.input, evaluatedAt: frozen.evaluatedAt,
      sourceEvidence: frozen.sourceEvidence, boundaryEvidence: frozen.boundaryEvidence })
      !== frozen.sourceDigest) return unavailable('historical_comparison_manifest_invalid');
  const projection = projectHistoricalContinuity(structuredClone(frozen.input));
  // Curation or transformation changes need a new manifest, even when raw source
  // content is unchanged. Old captures must not silently acquire new policy.
  return compatibleRevision(projection) === frozen.projectionDigest ? projection
    : unavailable('historical_comparison_policy_changed');
}

/** Read-only B4 composition. Existing collectors and public history remain unchanged. */
export function createBundleFourReadService(dependencies: BundleFourDependencies) {
  return {
    async readBundleFour(request: BundleFourReadInput) {
      if (!dependencies.enabled) return { status: 'disabled' as const, reason: 'persistence_disabled' };
      const input = structuredClone(request), expected = input.expectedMapping;
      if (!isAdministrationSourceMapping(expected) || !Number.isFinite(input.now.getTime())
        || !['league1', 'league2', 'dynasty'].includes(expected.scope.leagueKey)
        || expected.scope.season < managerHistoryFirstSeason(expected.scope.leagueKey)
        || expected.scope.season - managerHistoryFirstSeason(expected.scope.leagueKey) >= 20
        || input.context.defaultSeason !== expected.scope.season) return unavailable('invalid_historical_continuity_request');
      const captured = new Map<string, { request: AdministrationReadInput; read: LeagueAdministrationStoreRead }>();
      const sourceEvidence = new Map<string, HistoricalSourceEvidence>();
      const mappings: AdministrationSourceMapping[] = [];
      async function readSource(request: AdministrationReadInput) {
        const id = key(request), existing = captured.get(id);
        if (existing) return existing.read;
        const read = structuredClone(await isolated(() => dependencies.readSource(request), unavailable('history_source_read_failed')));
        captured.set(id, { request, read });
        return read;
      }
      // The existing guard validates scope, completion verification and current TTL
      // against this frozen request clock, without a second acquisition path.
      const guarded = createPageAdministrationReader(() => ({ readSource,
        readSourceByConnection: async request => {
          const mapping = mappings.find(item => item.scope.externalLeagueId === request.externalLeagueId);
          return mapping ? readSource({ ...mapping.scope, family: request.family, week: request.week }) : unavailable('history_mapping_missing');
        },
      }), () => input.now.getTime());
      async function readGuarded(mapping: AdministrationSourceMapping, family: AdministrationReadInput['family'], week: number | null) {
        const request = { ...mapping.scope, family, week };
        const raw = await readSource(request);
        let result: LeagueAdministrationStoreRead;
        try {
          const checked = await guarded({ ...request, maxAgeSeconds: 60,
            historicalSeason: mapping.scope.season < expected.scope.season });
          result = checked.status === 'available' ? raw : unavailable(`history_source_${checked.reason}`);
        } catch { result = { status: 'conflict', reason: 'history_source_scope_or_completion_conflict' }; }
        sourceEvidence.set(key(request), { request, status: raw.status,
          sourceReason: raw.status === 'available' ? null : raw.reason ?? null,
          observationId: raw.status === 'available' ? raw.observationId : null,
          generation: raw.status === 'available' ? raw.generation : null,
          acceptedHeadCheckedAt: raw.status === 'available' ? raw.checkedAt : null,
          verifiedAt: raw.status === 'available' ? raw.verifiedAt : null,
          sourceObservedAt: raw.status === 'available' ? raw.envelope.provenance.sourceObservedAt : null,
          guard: result.status === 'available' ? 'usable' : 'rejected',
          guardReason: result.status === 'available' ? null : result.reason ?? result.status });
        return result;
      }
      const seasons: HistoricalContinuityInput['seasons'][number][] = [];
      const seen = new Set<string>();
      let externalLeagueId = expected.scope.externalLeagueId;
      let chainWarning: string | undefined;
      const firstSeason = managerHistoryFirstSeason(expected.scope.leagueKey);
      for (let season = expected.scope.season; season >= firstSeason; season -= 1) {
        const mapping = await isolated(() => dependencies.readSourceMapping(externalLeagueId), null);
        if (!mapping || !isAdministrationSourceMapping(mapping) || mapping.scope.season !== season
          || mapping.scope.leagueKey !== expected.scope.leagueKey || mapping.scope.externalLeagueId !== externalLeagueId
          || (season === expected.scope.season && !same(expected, mapping))) {
          if (season === expected.scope.season) return unavailable('historical_mapping_changed');
          chainWarning = `${season} manager history is unavailable; its league connection, owners, and weekly results must be verified.`;
          break;
        }
        mappings.push(structuredClone(mapping)); seen.add(externalLeagueId);
        const league = await readGuarded(mapping, 'league', null);
        const payload = league.status === 'available' ? league.envelope.payload : null;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('season' in payload)
          || payload.season !== String(season) || !('league_id' in payload) || payload.league_id !== externalLeagueId) {
          seasons.push({ mapping, league, rosters: unavailable('history_configuration_unavailable'),
            users: unavailable('history_configuration_unavailable'), throughWeek: null, matchups: [] });
          break;
        }
        if (season !== expected.scope.season) {
          try { assertManagerHistoryPreviousSeasonIdentity(payload, externalLeagueId, season); }
          catch { chainWarning = `${season} manager history is unavailable; its league connection, owners, and weekly results must be verified.`; break; }
        }
        const end = managerHistoryRegularEnd(payload);
        let throughWeek: number | null = season < expected.scope.season ? end : null;
        if (season === expected.scope.season) {
          if (input.context.lifecycle === 'complete' && 'status' in payload && payload.status === 'complete') throughWeek = end;
          else if (input.context.lifecycle === 'preseason' && 'status' in payload
            && ['pre_draft', 'drafting'].includes(String(payload.status))) throughWeek = 0;
          else {
            const calendar = input.calendar
              && Date.parse(input.calendar.evidence.evaluatedAt) <= input.now.getTime()
              && Date.parse(input.calendar.evidence.retrievalCompletedAt) <= input.now.getTime()
              ? seasonOverviewCalendar(mapping, input.calendar) : null;
            if (calendar && 'status' in payload && payload.status === 'in_season'
              && input.context.lifecycle === 'active' && input.context.activeSeason === season
              && input.context.activeWeek === calendar.resolution.week && input.context.activeWeek !== null) {
              throughWeek = Math.max(0, Math.min(end, input.context.activeWeek - 1));
            }
          }
        }
        const [rosters, users] = await Promise.all([readGuarded(mapping, 'rosters', null), readGuarded(mapping, 'users', null)]);
        const matchups: LeagueAdministrationStoreRead[] = [];
        for (let week = 1; week <= (throughWeek ?? 0); week += 4) {
          matchups.push(...await Promise.all(Array.from({ length: Math.min(4, throughWeek! - week + 1) },
            (_, index) => readGuarded(mapping, 'matchups', week + index))));
        }
        seasons.push({ mapping, league, rosters, users, throughWeek, matchups });
        if (season > firstSeason) {
          try { externalLeagueId = managerHistoryPreviousLeagueId('previous_league_id' in payload ? payload.previous_league_id : null, seen); }
          catch { chainWarning = `${season - 1} manager history is unavailable; its league connection, owners, and weekly results must be verified.`; break; }
        }
      }
      // A correction/remap during acquisition requires a fresh bounded capture.
      // Never combine generations and call the result an atomic provider snapshot.
      for (const mapping of mappings) {
        if (!same(mapping, await isolated(() => dependencies.readSourceMapping(mapping.scope.externalLeagueId), null))) {
          return unavailable('historical_mapping_changed');
        }
      }
      const records = [...captured.values()];
      for (let index = 0; index < records.length; index += 4) {
        const stable = await Promise.all(records.slice(index, index + 4).map(async record =>
          same(record.read, await isolated(() => dependencies.readSource(record.request), unavailable('history_source_read_failed')))));
        if (stable.some(value => !value)) return unavailable('historical_source_changed');
      }
      const projectionInput: HistoricalContinuityInput = { leagueKey: expected.scope.leagueKey,
        currentSeason: expected.scope.season, seasons, ...(chainWarning ? { chainWarning } : {}) };
      const projection = projectHistoricalContinuity(projectionInput);
      const evidence = [...sourceEvidence.values()].sort((left, right) => {
        const a = key(left.request), b = key(right.request);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      const evaluatedAt = input.now.toISOString();
      const boundaryEvidence = { context: input.context, calendar: input.calendar };
      const frozen: FrozenHistoricalContinuity = { version: 'b4-frozen-comparison-v1', evaluatedAt: input.now.toISOString(),
        input: structuredClone(projectionInput), sourceEvidence: structuredClone(evidence), boundaryEvidence,
        sourceDigest: compatibleRevision({ input: projectionInput, evaluatedAt, sourceEvidence: evidence, boundaryEvidence }),
        projectionDigest: compatibleRevision(projection) };
      return { status: 'read' as const, kind: 'bundle-four-historical-continuity' as const,
        history: compareFrozenHistoricalContinuity(frozen), frozen,
        limitations: ['internal_only_no_reader_cutover', 'accepted_v1_compatibility_not_v2_acceptance',
          'frozen_comparison_not_durable_replay', 'production_coverage_not_established'] as const };
    },
  };
}
export type BundleFourRead = Awaited<ReturnType<ReturnType<typeof createBundleFourReadService>['readBundleFour']>>;

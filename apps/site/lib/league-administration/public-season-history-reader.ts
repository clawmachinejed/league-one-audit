import 'server-only';
import type { DatabaseRow } from '../database';
import { composeWithinSeasonHistory, WITHIN_SEASON_HISTORY_VERSION, type HistoryPeriodDetail,
  type HistoryTask, type HistoryGap } from '../aggregator/within-season-history';
import type { OfficialResultsRead } from '../aggregator/official-results';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { isAdministrationSourceMapping } from './source-mapping';
import type { LeagueAdministrationStore } from './store-contracts';
import type { PublicExactPeriod, PublicIntakeReadOptions, PublicSeasonHistoryRetained } from './public-intake-contracts';
import { createRetainedMatchupComparison, isRetainedMatchupManifest } from './retained-matchup-comparison';
import { isRetainedMatchupSelection, RETAINED_MATCHUP_BATCH_LIMIT } from './retained-matchups-contracts';

export type PublicSeasonHistoryInput = Readonly<{
  requestId: string; candidates: readonly DatabaseRow[]; selection: readonly PublicExactPeriod[];
  periods: readonly HistoryPeriodDetail[]; bracketsRequested: boolean;
  officialResults: readonly Readonly<{ externalLeagueId: string; season: number; resource: OfficialResultsRead }>[];
  inventory?: Readonly<{ tasks: readonly HistoryTask[]; gaps: readonly (HistoryGap & { externalLeagueId: string; season: number })[];
    page: Readonly<{ afterOrdinal: number; limit: number; nextAfterOrdinal: number | null }> }>;
  retained?: PublicSeasonHistoryRetained;
}>;
type Reads = Pick<LeagueAdministrationStore, 'readSourceMapping' | 'scanRetainedMatchups' | 'readRetainedMatchups'>;
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });

/** Validate before any stored query. A cursor always resumes its complete original manifest. */
export function validatePublicSeasonHistoryOptions(options: PublicIntakeReadOptions): void {
  if (options.seasonHistoryVersion !== undefined && options.seasonHistoryVersion !== 'v1') {
    throw new Error('Unsupported public season history version.');
  }
  const value = options.seasonHistoryRetained;
  if (value === undefined) return;
  if (options.seasonHistoryVersion !== 'v1' || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['selection', 'batchSize', 'manifest', 'cursor'].includes(key))
    || !isRetainedMatchupSelection(value.selection) || value.selection.scope.season !== 2026
    || !Number.isSafeInteger(value.batchSize ?? 20) || (value.batchSize ?? 20) < 1
    || (value.batchSize ?? 20) > RETAINED_MATCHUP_BATCH_LIMIT) throw new Error('Invalid season history retained selection.');
  if (value.manifest !== undefined && (!isRetainedMatchupManifest(value.manifest)
    || compatibleRevision(value.manifest.selection) !== compatibleRevision(value.selection))) {
    throw new Error('Invalid season history retained manifest.');
  }
  if (value.cursor !== undefined && (!value.manifest || value.cursor.manifestId !== value.manifest.id
    || !Number.isSafeInteger(value.cursor.nextIndex) || value.cursor.nextIndex < 0
    || value.cursor.nextIndex > value.manifest.entries.length)) throw new Error('Invalid season history retained cursor.');
}

async function retainedHistory(reads: Reads, input: PublicSeasonHistoryInput) {
  const selected = input.retained;
  if (!selected) return undefined;
  const selection = selected.selection;
  if (!input.candidates.some(candidate => candidate.league_season_id === selection.leagueSeasonId
    && candidate.season === selection.scope.season && candidate.external_league_id === selection.scope.externalLeagueId)
    || selection.nativeWeeks.some(nativeWeek => !input.selection.some(period => period.season === 2026 && period.nativeWeek === nativeWeek))) {
    return unavailable('season-history-retained-request-scope-mismatch');
  }
  const service = createRetainedMatchupComparison(reads);
  try {
    const manifestRead = selected.manifest ? { status: 'available' as const, manifest: selected.manifest }
      : await service.createManifest(selection);
    if (manifestRead.status !== 'available') return manifestRead;
    const batch = await service.compareBatch({ manifest: manifestRead.manifest,
      cursor: selected.cursor, batchSize: selected.batchSize ?? 20 });
    if (batch.status !== 'complete' && batch.status !== 'more') return batch;
    return { status: 'available' as const, kind: 'retained-source-comparison' as const,
      acceptance: 'not-typed-acceptance' as const, manifest: manifestRead.manifest, batch,
      coverage: { inventoryCount: manifestRead.manifest.entries.length, selectedCount: batch.entries.length,
        readCoverage: batch.fromIndex === 0 && batch.status === 'complete' ? 'complete' as const : 'page' as const,
        rejectedCount: batch.entries.filter(entry => entry.result.status !== 'available').length },
      meaning: 'Cursor completion exhausts this frozen manifest only. Entry rejection and original limitations remain explicit; retained projections never replace accepted typed receipts.' };
  } catch { return unavailable('season-history-retained-read-failed'); }
}

/** Reuses the caller's existing bounded checkpoint reads. This service adds no SQL,
 * source access, acceptance, or new history enumeration; only retained comparison may read its existing store. */
export async function readPublicSeasonHistory(reads: Reads, input: PublicSeasonHistoryInput) {
  validatePublicSeasonHistoryOptions({ seasonHistoryVersion: 'v1', seasonHistoryRetained: input.retained });
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(input.requestId)
    || input.candidates.length > 1000
    || input.candidates.filter(candidate => candidate.stage !== 'capacity' && candidate.league_season_id).length > 20
    || input.periods.length > 20 || (input.inventory?.tasks.length ?? 0) > 360
    || input.selection.length > 18 || input.selection.some(period => period.season !== 2026)
    || new Set(input.candidates.map(candidate => candidate.season + ':' + candidate.external_league_id)).size !== input.candidates.length) {
    return unavailable('season-history-request-scope-mismatch');
  }
  const tasks = input.inventory?.tasks ?? input.periods;
  const leagues = [];
  for (const candidate of input.candidates) {
    const identity = { provider: 'sleeper' as const, externalLeagueId: String(candidate.external_league_id),
      season: Number(candidate.season), leagueSeasonId: typeof candidate.league_season_id === 'string' ? candidate.league_season_id : null };
    if (identity.season !== 2026 || !identity.leagueSeasonId || candidate.stage === 'capacity') {
      leagues.push({ identity, resource: unavailable(candidate.stage === 'capacity' ? 'season-history-capacity' : 'season-history-identity-unavailable') });
      continue;
    }
    try {
      const mapping = await reads.readSourceMapping(identity.externalLeagueId);
      if (!isAdministrationSourceMapping(mapping) || mapping.leagueSeasonId !== identity.leagueSeasonId
        || mapping.scope.season !== identity.season || mapping.scope.externalLeagueId !== identity.externalLeagueId) {
        throw new Error('Stored season mapping changed.');
      }
      const belongs = (value: { externalLeagueId: string; season: number }) =>
        value.externalLeagueId === identity.externalLeagueId && value.season === identity.season;
      const resource = composeWithinSeasonHistory({ mapping,
        requestedWeeks: input.selection.filter(period => period.season === identity.season).map(period => period.nativeWeek),
        tasks: tasks.filter(belongs), periods: input.periods.filter(belongs), bracketsRequested: input.bracketsRequested,
        officialResults: input.officialResults.find(belongs)?.resource ?? unavailable('season-history-official-results-unavailable'),
        sourceGaps: input.inventory?.gaps.filter(belongs) });
      if (compatibleRevision(await reads.readSourceMapping(identity.externalLeagueId)) !== compatibleRevision(mapping)) {
        throw new Error('Stored season mapping changed during read.');
      }
      leagues.push({ identity, resource });
    } catch { leagues.push({ identity, resource: unavailable('season-history-source-mapping-unavailable') }); }
  }
  const retained = await retainedHistory(reads, input);
  return { status: 'available' as const, version: WITHIN_SEASON_HISTORY_VERSION, scope: 'selected-request' as const,
    requestId: input.requestId, leagues, ...(input.inventory ? { page: input.inventory.page } : {}),
    ...(retained ? { retainedHistory: retained } : {}),
    coverage: { detailedPeriods: input.periods.length, taskCount: tasks.length, priorSeasons: 'not-requested' as const,
      corrections: 'original-request-receipts' as const },
    freshness: 'Original receipt provenance is preserved; a stored read is not a new observation. Applicability uses the existing latest evidenced decisions independently of original capture.' };
}

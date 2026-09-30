import 'server-only';

import type { DatabaseClient, DatabaseRow } from '../../../database';
import type { AdministrationProvenance } from '../../../league-administration/contracts';
import { isAdministrationSourceMapping } from '../../../league-administration/source-mapping';
import type {
  CalculationCaptureInputHistory, CalculationObservationSourceHistory,
  SnapshotSourceHistoryInput, SnapshotSourceHistoryRead,
} from '../../shared/source-history';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid source history.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Invalid source history identity.');
  }
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid source history text.');
  }
  return value;
}
function integer(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isSafeInteger(Number(value))) {
    throw new Error('Invalid source history number.');
  }
  return Number(value);
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new Error('Invalid source history timestamp.');
  return value;
}
/** Preserve sub-millisecond database reservation precision when checking acquisition order. */
function ticks(value: string): bigint {
  const fraction = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(value)?.[1] ?? '';
  return BigInt(Date.parse(value)) * 1_000_000n + BigInt(fraction.padEnd(9, '0').slice(3));
}
function provenance(value: unknown): AdministrationProvenance {
  const row = object(value);
  if (!['network', 'cache', 'bootstrap'].includes(String(row.origin))) throw new Error('Invalid provenance origin.');
  const result: AdministrationProvenance = {
    origin: row.origin as AdministrationProvenance['origin'],
    requestStartedAt: row.requestStartedAt === null ? null : timestamp(row.requestStartedAt),
    requestCompletedAt: row.requestCompletedAt === null ? null : timestamp(row.requestCompletedAt),
    sourceObservedAt: row.sourceObservedAt === null ? null : timestamp(row.sourceObservedAt),
    checkedAt: timestamp(row.checkedAt),
  };
  if ((result.requestStartedAt === null) !== (result.requestCompletedAt === null)
    || (result.requestStartedAt !== null && result.requestCompletedAt !== null
      && (ticks(result.requestStartedAt) > ticks(result.requestCompletedAt)
        || ticks(result.requestCompletedAt) > ticks(result.checkedAt)))
    || (result.sourceObservedAt !== null && ticks(result.sourceObservedAt) > ticks(result.checkedAt))) {
    throw new Error('Invalid provenance order.');
  }
  return result;
}

function captureInputIdSql(observation: 'original' | 'verification', input: 'leagueInputId' | 'matchupInputId'): string {
  const value = `${observation}.source_data#>>'{administration,sourceCapture,${input}}'`;
  // Keep the indexed UUID on the left; malformed legacy JSON must not make the cast throw.
  return `CASE WHEN (${value}) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (${value})::uuid END`;
}

function observationSql(alias: 'original' | 'verification'): string {
  const source = ['administration', 'season', 'week', 'leagueKey'].map(key =>
    `CASE WHEN ${alias}.source_data ? '${key}' THEN jsonb_build_object('${key}',${alias}.source_data->'${key}') ELSE '{}'::jsonb END`,
  ).join(' || ');
  return `CASE WHEN ${alias}.id IS NOT NULL THEN jsonb_build_object(
    'id',${alias}.id,'league_season_id',${alias}.league_season_id,'provider',${alias}.provider,
    'week',${alias}.week,'quality',${alias}.quality,'request_started_at',${alias}.request_started_at,
    'request_completed_at',${alias}.request_completed_at,'observed_at',${alias}.observed_at,
    'source_data',(${source})) END`;
}

function sourceHistory(value: unknown, expectedId: string, request: SnapshotSourceHistoryInput,
  leagueKey: string, inputs: readonly unknown[]): CalculationObservationSourceHistory {
  if (value === null) return { status: 'source_epoch_unproved', reason: 'missing_observation' };
  try {
    const observation = object(value);
    if (observation.id !== expectedId || observation.league_season_id !== request.leagueSeasonId
      || integer(observation.week) !== request.week || observation.provider !== 'sleeper'
      || observation.quality !== 'complete') throw new Error('Wrong source observation.');
    const data = object(observation.source_data);
    if (data.administration === undefined) return { status: 'source_epoch_unproved', reason: 'legacy_unlinked' };
    const administration = object(data.administration);
    if (administration.sourceCapture === undefined) return { status: 'source_epoch_unproved', reason: 'legacy_unlinked' };
    const marker = object(administration.sourceCapture);
    if ((data.season !== undefined && data.season !== String(request.season))
      || (data.week !== undefined && data.week !== request.week)
      || (data.leagueKey !== undefined && data.leagueKey !== leagueKey)) throw new Error('Wrong embedded source scope.');
    const captureId = id(marker.captureId);
    const leagueInputId = id(marker.leagueInputId);
    const matchupInputId = id(marker.matchupInputId);
    if (leagueInputId === matchupInputId) throw new Error('Repeated source capture input.');
    const readInput = (inputId: string, family: 'league' | 'matchups') => {
      const matching = inputs.filter(value => object(object(value).input).id === inputId);
      if (matching.length !== 1) throw new Error('Missing source capture input.');
      const entry = object(matching[0]);
      const input = object(entry.input);
      const capture = object(entry.capture);
      const revision = object(entry.revision);
      const content = object(entry.content);
      const legacy = object(entry.legacy_observation);
      const versionId = input.configuration_version_id === null ? null : id(input.configuration_version_id);
      const reservedAt = timestamp(capture.reserved_at);
      const mapping = {
        connectionId: capture.connection_id, leagueSeasonId: capture.league_season_id,
        revisionId: capture.source_mapping_revision_id, generation: integer(revision.generation),
        scope: { leagueKey, provider: revision.provider, externalLeagueId: revision.external_league_id, season: request.season },
      };
      if (!isAdministrationSourceMapping(mapping) || capture.id !== captureId || input.capture_id !== captureId
        || capture.league_season_id !== request.leagueSeasonId || integer(capture.week) !== request.week
        || revision.id !== mapping.revisionId || revision.connection_id !== mapping.connectionId
        || revision.league_season_id !== request.leagueSeasonId || revision.source_namespace !== `nfl:${request.season}`
        || input.family !== family || content.id !== input.content_id || content.family !== family
        || content.league_season_id !== request.leagueSeasonId || content.provider !== mapping.scope.provider
        || content.external_league_id !== mapping.scope.externalLeagueId
        || integer(content.week) !== (family === 'league' ? 0 : request.week)
        || content.accepted !== true || content.completeness !== 'complete'
        || content.normalizer_version !== 'sleeper-administration-v1'
        || content.configuration_version_id !== versionId
        || legacy.id !== input.observation_id || legacy.content_id !== content.id
        || legacy.league_season_id !== request.leagueSeasonId || legacy.family !== family
        || integer(legacy.week) !== integer(content.week)
        || !['changed', 'unchanged'].includes(String(legacy.outcome))) throw new Error('Invalid source capture scope.');
      const actual = provenance(input.provenance);
      const legacyProvenance = provenance({ origin: legacy.origin, requestStartedAt: legacy.request_started_at,
        requestCompletedAt: legacy.request_completed_at, sourceObservedAt: legacy.source_observed_at,
        checkedAt: legacy.checked_at });
      const acquiredUnderCapture = actual.origin === 'network' && actual.requestStartedAt !== null
        && actual.requestCompletedAt !== null && actual.sourceObservedAt !== null
        && ticks(actual.requestStartedAt) >= ticks(reservedAt)
        && ticks(actual.sourceObservedAt) >= ticks(actual.requestStartedAt)
        && ticks(actual.sourceObservedAt) <= ticks(actual.requestCompletedAt);
      if (ticks(actual.checkedAt) < ticks(reservedAt)
        || actual.requestStartedAt === null || actual.requestCompletedAt === null
        || (actual.origin === 'network' && !acquiredUnderCapture)
        || (actual.origin !== 'network' && (family !== 'league' || actual.origin !== 'cache' || actual.sourceObservedAt !== null))
        || (family === 'matchups' && (!acquiredUnderCapture
          || ticks(actual.requestStartedAt!) !== ticks(timestamp(observation.request_started_at))
          || ticks(actual.requestCompletedAt!) !== ticks(timestamp(observation.request_completed_at))
          || ticks(actual.sourceObservedAt!) !== ticks(timestamp(observation.observed_at))))) {
        throw new Error('Capture does not identify the consumed acquisition.');
      }
      if (family === 'league' && (versionId === null || input.observation_id !== administration.observationId
        || versionId !== administration.configurationVersionId)) throw new Error('Wrong configuration source.');
      const contentHash = text(content.content_hash);
      if (!/^(sha256:)?[0-9a-f]{64}$/.test(contentHash)) throw new Error('Invalid content hash.');
      const result: CalculationCaptureInputHistory = {
        id: inputId, family, observationId: id(input.observation_id), contentId: id(input.content_id),
        contentHash, configurationVersionId: versionId, provenance: actual,
        legacyObservationProvenance: legacyProvenance,
        acquisitionSourceEpoch: acquiredUnderCapture ? 'capture_mapping_proved' : 'source_epoch_unproved',
      };
      return { result, mapping, reservedAt };
    };
    const league = readInput(leagueInputId, 'league');
    const matchup = readInput(matchupInputId, 'matchups');
    if (JSON.stringify(league.mapping) !== JSON.stringify(matchup.mapping) || league.reservedAt !== matchup.reservedAt) {
      throw new Error('Inconsistent source capture.');
    }
    return { status: 'linked', captureId, reservedAt: league.reservedAt, mapping: league.mapping,
      leagueInput: league.result, matchupInput: matchup.result };
  } catch { return { status: 'source_epoch_unproved', reason: 'invalid_source_capture' }; }
}

export const SNAPSHOT_SOURCE_HISTORY_READ_SQL = `
          SELECT snapshot.id AS snapshot_id,snapshot.league_season_id,season.season,league.league_key,
            snapshot.week,snapshot.model_version,snapshot.league_week_observation_id,snapshot.game_state_observation_ids,
            current.snapshot_id AS current_snapshot_id,current.verification_source_observation_id,
            ${observationSql('original')} AS original_observation,${observationSql('verification')} AS verification_observation,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('input',to_jsonb(input),'capture',to_jsonb(capture),
              'revision',to_jsonb(revision),'legacy_observation',to_jsonb(legacy),
              'content',jsonb_build_object('id',content.id,'league_season_id',content.league_season_id,
                'provider',content.provider,'external_league_id',content.external_league_id,'family',content.family,
                'week',content.week,'content_hash',content.content_hash,'configuration_version_id',content.configuration_version_id,
                'normalizer_version',content.normalizer_version,'accepted',content.accepted,'completeness',content.completeness))),
              '[]'::jsonb)
              FROM public.league_calculation_capture_inputs input
              JOIN public.league_calculation_source_captures capture ON capture.id=input.capture_id
              JOIN public.league_source_mapping_revisions revision ON revision.id=capture.source_mapping_revision_id
              JOIN public.league_administration_contents content ON content.id=input.content_id
              JOIN public.league_administration_observations legacy ON legacy.id=input.observation_id
              WHERE input.id IN (
                ${captureInputIdSql('original', 'leagueInputId')},
                ${captureInputIdSql('original', 'matchupInputId')},
                ${captureInputIdSql('verification', 'leagueInputId')},
                ${captureInputIdSql('verification', 'matchupInputId')})) AS inputs
          FROM public.projection_snapshots snapshot
          JOIN public.league_seasons season ON season.id=snapshot.league_season_id
          JOIN public.leagues league ON league.id=season.league_id
          LEFT JOIN public.league_week_observations original ON original.id=snapshot.league_week_observation_id
          LEFT JOIN public.current_projection_snapshots current ON current.snapshot_id=snapshot.id
            AND current.league_season_id=snapshot.league_season_id AND current.week=snapshot.week
          LEFT JOIN public.league_week_observations verification ON verification.id=current.verification_source_observation_id
          WHERE snapshot.id=$1::uuid AND snapshot.league_season_id=$2::uuid
            AND season.season=$3 AND snapshot.week=$4 AND snapshot.model_version=$5`;

export function createSnapshotSourceHistoryReader(client: DatabaseClient) {
  return {
    async readSnapshotSourceHistory(input: SnapshotSourceHistoryInput): Promise<SnapshotSourceHistoryRead> {
      try {
        id(input.snapshotId); id(input.leagueSeasonId); text(input.modelVersion);
        if (!Number.isSafeInteger(input.season) || input.season < 1920 || input.season > 2200
          || !Number.isSafeInteger(input.week) || input.week < 1 || input.week > 18) throw new Error('Invalid period.');
      } catch { return { status: 'unavailable', reason: 'invalid_request' }; }
      try {
        const rows = await client.query(`/* projection-store:read-snapshot-source-history */${SNAPSHOT_SOURCE_HISTORY_READ_SQL}`,
        [input.snapshotId, input.leagueSeasonId, input.season, input.week, input.modelVersion]);
        if (rows.length === 0) return { status: 'missing' };
        if (rows.length !== 1) throw new Error('Ambiguous source history.');
        return readSnapshotSourceHistoryRow(rows[0], input);
      } catch { return { status: 'unavailable', reason: 'source_history_unavailable' }; }
    },
  };
}

export function readSnapshotSourceHistoryRow(row: DatabaseRow, input: SnapshotSourceHistoryInput): SnapshotSourceHistoryRead {
  if (row.snapshot_id !== input.snapshotId || row.league_season_id !== input.leagueSeasonId
    || integer(row.season) !== input.season || integer(row.week) !== input.week || row.model_version !== input.modelVersion
    || !Array.isArray(row.game_state_observation_ids) || !Array.isArray(row.inputs)
    || row.inputs.length > 4) throw new Error('Wrong snapshot scope.');
  const leagueKey = text(row.league_key);
  const originalId = id(row.league_week_observation_id);
  const gameIds = row.game_state_observation_ids.map(id);
  if (new Set(gameIds).size !== gameIds.length) throw new Error('Repeated original game source.');
  const current = row.current_snapshot_id !== null;
  if (current && row.current_snapshot_id !== input.snapshotId) throw new Error('Wrong current snapshot.');
  const verificationId = current && row.verification_source_observation_id !== null ? id(row.verification_source_observation_id) : null;
  return { status: 'available', purpose: 'calculation-input-source-history', scope: { ...input },
    analyticsCompatibility: 'not_evaluated', original: { leagueWeekObservationId: originalId,
      gameStateObservationIds: gameIds, source: sourceHistory(row.original_observation, originalId, input, leagueKey, row.inputs) },
    verification: { status: current ? 'current_snapshot' : 'not_current_snapshot', leagueWeekObservationId: verificationId,
      source: verificationId ? sourceHistory(row.verification_observation, verificationId, input, leagueKey, row.inputs)
        : current ? { status: 'source_epoch_unproved', reason: 'missing_observation' } : null } };
}

import 'server-only';
import { DEFENSE_PROJECTION_MODEL_VERSION } from '../../domain/contracts';

const VERSION = DEFENSE_PROJECTION_MODEL_VERSION;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function time(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

/** Private calculation evidence is optional for old callers. Unavailable detail
 * never supplies a freshness timestamp; actual points remain a separate source. */
export function validateLiveDefenseEvidence(value: unknown, week: number, season?: unknown): void {
  if (value === undefined) return;
  const invalid = () => { throw new Error('official-observation-live-defense-invalid'); };
  if (!object(value) || value.version !== VERSION) return invalid();
  if (value.status === 'unavailable') return;
  if (value.status !== 'available' || !object(value.period)
    || !Number.isInteger(value.period.season) || Number(value.period.season) < 2026
    || Number(value.period.season) > 2200 || value.period.seasonType !== 'regular'
    || value.period.week !== week
    || season !== undefined && Number(season) !== value.period.season
    || typeof value.sourceRevision !== 'string' || !value.sourceRevision.trim()) return invalid();
  const started = time(value.requestStartedAt);
  const completed = time(value.requestCompletedAt);
  const observed = time(value.observedAt);
  if (started === null || completed === null || observed === null
    || started > observed || observed > completed) return invalid();
}

// Cast only inside CASE after syntax and PostgreSQL's date parser have accepted
// the value. Malformed persisted JSON must reject publication, never throw while
// evaluating a cast or acquire a misleading source verification timestamp.
function timestamp(field: string): string {
  return `CASE WHEN evidence ->> 'status' = 'available'
    AND jsonb_typeof(evidence -> '${field}') = 'string'
    AND evidence ->> '${field}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    AND pg_input_is_valid(evidence ->> '${field}', 'timestamp with time zone')
    THEN (evidence ->> '${field}')::timestamptz END`;
}

/** Requires league_source, with season and source_data, in the publication CTE. */
export const LIVE_DEFENSE_SOURCE_CTES = `live_defense_source AS (
  SELECT source_data -> 'liveDefense' AS evidence, season FROM league_source
), live_defense_times AS (
  SELECT evidence, season,
    ${timestamp('requestStartedAt')} AS started_at,
    ${timestamp('requestCompletedAt')} AS completed_at,
    ${timestamp('observedAt')} AS observed_at
  FROM live_defense_source
), live_defense_validation AS (
  SELECT started_at, completed_at, observed_at,
    CASE WHEN evidence IS NULL THEN true
      WHEN jsonb_typeof(evidence) <> 'object' OR evidence ->> 'version' IS DISTINCT FROM '${VERSION}' THEN false
      WHEN evidence ->> 'status' = 'unavailable' THEN true
      WHEN evidence ->> 'status' = 'available' THEN
        evidence #> '{period,season}' = to_jsonb(season)
        AND evidence #>> '{period,seasonType}' = 'regular'
        AND evidence #> '{period,week}' = to_jsonb($3::integer)
        AND jsonb_typeof(evidence -> 'sourceRevision') = 'string'
        AND length(btrim(evidence ->> 'sourceRevision')) > 0
        AND started_at IS NOT NULL AND completed_at IS NOT NULL AND observed_at IS NOT NULL
        AND started_at <= observed_at AND observed_at <= completed_at
        AND to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = evidence ->> 'requestStartedAt'
        AND to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = evidence ->> 'requestCompletedAt'
        AND to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = evidence ->> 'observedAt'
      ELSE false END AS valid
  FROM live_defense_times
)`;

import 'server-only';

import { createHash } from 'node:crypto';
import { startProviderHttp } from '../../../provider-request-telemetry';
import { ALL_PLAYER_INDIVIDUAL_SNAP_KEYS, isAllPlayerIndividualSnapCount } from '../../domain/all-player-eligibility';
import type { AllPlayerWeeklyEligibilityEvidence } from '../../domain/all-player-statistics';

const API = 'https://api.sleeper.app/v1';

/** Bounded response metadata only. Never retain response keys, values, headers,
 * URLs or provider exception text in a durable failure diagnostic. */
export type SleeperAllPlayerStatResponseEvidence = Readonly<{
  httpStatus: number | null;
  bodyShape: 'object' | 'array' | 'null' | 'string' | 'number' | 'boolean'
    | 'invalid-json' | 'unreadable' | 'not-read';
  topLevelCount: number | null;
  /** SHA-256 of the UTF-8 decoded response text, not an ETag or source claim. */
  bodyHash: string | null;
  requestStartedAt: string;
  requestCompletedAt: string;
}>;


export type SleeperWeeklyStatPeriod = Readonly<{ season: number; seasonType: 'reg'; week: number }>;

/** A single bounded, period-specific source capture shared by existing consumers.
 * Never persist the complete capture in per-minute projection observations. */
export type SleeperWeeklyStatCapture = Readonly<{
  period: SleeperWeeklyStatPeriod;
  raw: Readonly<Record<string, unknown>>;
  rows: Readonly<Record<string, ValidatedSleeperWeeklyRow>>;
  sourceRevision: string;
  responseEvidence: SleeperAllPlayerStatResponseEvidence;
}>;
export type SleeperWeeklyStatResult =
  | Readonly<{ status: 'available'; capture: SleeperWeeklyStatCapture }>
  | Readonly<{ status: 'empty'; reason: 'empty-object'; responseEvidence: SleeperAllPlayerStatResponseEvidence }>
  | Readonly<{ status: 'unavailable'; reason: 'http' | 'malformed'; statusCode?: number;
      responseEvidence?: SleeperAllPlayerStatResponseEvidence }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export type ValidatedSleeperWeeklyRow = Readonly<{
  stats: Readonly<Record<string, number>>;
  weekly: AllPlayerWeeklyEligibilityEvidence;
}>;

export function validateSleeperWeeklyStatsResponse(value: unknown): Readonly<Record<string, ValidatedSleeperWeeklyRow>> | null {
  if (!isRecord(value) || Object.keys(value).length === 0) return null;
  const result: Record<string, ValidatedSleeperWeeklyRow> = {};
  for (const [externalId, rawStats] of Object.entries(value)) {
    if (!externalId.trim() || !isRecord(rawStats)) return null;
    const stats: Record<string, number> = {};
    const rawFlags: Record<string, unknown> = {};
    const individualSnaps: Partial<Record<typeof ALL_PLAYER_INDIVIDUAL_SNAP_KEYS[number], number>> = {};
    for (const [key, rawValue] of Object.entries(rawStats)) {
      const snapKey = ALL_PLAYER_INDIVIDUAL_SNAP_KEYS.find((candidate) => candidate === key);
      if (['gms_active', 'gp'].includes(key) && rawValue !== 0 && rawValue !== 1
        || snapKey && !isAllPlayerIndividualSnapCount(rawValue)) {
        rawFlags[key] = rawValue;
        if (typeof rawValue === 'number' && Number.isFinite(rawValue)) stats[key] = rawValue;
        continue;
      }
      if (!key.trim() || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return null;
      stats[key] = rawValue;
      if (snapKey) individualSnaps[snapKey] = rawValue;
    }
    result[externalId] = { stats, weekly: {
      kind: 'weekly-stat', source: 'weekly-stat-provider',
      ...(rawStats.gms_active === 0 || rawStats.gms_active === 1
        ? { gmsActive: rawStats.gms_active } : {}),
      ...(rawStats.gp === 0 || rawStats.gp === 1 ? { appearances: rawStats.gp } : {}),
      ...(Object.keys(individualSnaps).length ? { individualSnaps } : {}),
      ...(Object.keys(rawFlags).length ? { rawFlags } : {}),
    } };
  }
  return result;
}


/** The only network reader for Sleeper's bulk weekly statistics. Callers must
 * first reserve the existing durable global request budget. */
export function createSleeperWeeklyStatSource(dependencies: Readonly<{ fetch: typeof fetch; now: () => Date }>) {
  const fetcher = dependencies.fetch;
  const now = dependencies.now;
  return {
    async load(input: SleeperWeeklyStatPeriod & Readonly<{ signal?: AbortSignal }>): Promise<SleeperWeeklyStatResult> {
      if (!Number.isInteger(input.season) || input.season < 2026 || input.season > 2200
        || input.seasonType !== 'reg' || !Number.isInteger(input.week) || input.week < 1 || input.week > 18) {
        return { status: 'unavailable', reason: 'malformed' };
      }
      const requestStartedAt = now().toISOString();
      const responseEvidence = (
        httpStatus: number | null,
        bodyShape: SleeperAllPlayerStatResponseEvidence['bodyShape'],
        topLevelCount: number | null = null,
        bodyHash: string | null = null,
      ): SleeperAllPlayerStatResponseEvidence => ({
        httpStatus, bodyShape, topLevelCount, bodyHash, requestStartedAt,
        requestCompletedAt: now().toISOString(),
      });
      const finished = startProviderHttp('sleeper', 'all-player-stats', 'bypass');
      let response: Response;
      try {
        response = await fetcher(
          `${API}/stats/nfl/regular/${input.season}/${input.week}`,
          {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: input.signal
              ? AbortSignal.any([input.signal, AbortSignal.timeout(20_000)])
              : AbortSignal.timeout(20_000),
          },
        );
      } catch {
        finished('unavailable');
        return { status: 'unavailable', reason: 'http',
          responseEvidence: responseEvidence(null, 'not-read') };
      }
      if (!response.ok) {
        finished('unavailable');
        return { status: 'unavailable', reason: 'http', statusCode: response.status,
          responseEvidence: responseEvidence(response.status, 'not-read') };
      }
      let body: string;
      try {
        body = await response.text();
      } catch {
        finished('invalid');
        return { status: 'unavailable', reason: 'malformed',
          responseEvidence: responseEvidence(response.status, 'unreadable') };
      }
      const bodyHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        finished('invalid');
        return { status: 'unavailable', reason: 'malformed',
          responseEvidence: responseEvidence(response.status, 'invalid-json', null, bodyHash) };
      }
      const bodyShape: SleeperAllPlayerStatResponseEvidence['bodyShape'] = raw === null ? 'null'
        : Array.isArray(raw) ? 'array' : isRecord(raw) ? 'object'
          : typeof raw as 'string' | 'number' | 'boolean';
      const topLevelCount = Array.isArray(raw) ? raw.length : isRecord(raw) ? Object.keys(raw).length : null;
      const loadedEvidence = responseEvidence(response.status, bodyShape, topLevelCount, bodyHash);
      if (bodyShape === 'object' && topLevelCount === 0) {
        // Shape evidence only. The runtime must independently prove that the
        // exact period has not started before treating this as an expected skip.
        finished('unavailable');
        return { status: 'empty', reason: 'empty-object', responseEvidence: loadedEvidence };
      }
      const validated = validateSleeperWeeklyStatsResponse(raw);
      if (!validated) {
        finished('invalid');
        return { status: 'unavailable', reason: 'malformed', responseEvidence: loadedEvidence };
      }
      finished('available');
      return { status: 'available', capture: {
        period: { season: input.season, seasonType: 'reg', week: input.week }, raw: raw as Record<string, unknown>,
        rows: validated, responseEvidence: loadedEvidence,
        sourceRevision: response.headers.get('etag')?.trim()
          ? `etag:${response.headers.get('etag')!.trim()}`
          : `sha256:${createHash('sha256').update(stableJson(raw)).digest('hex')}`,
      } };
    },
  };
}

import { Buffer } from 'node:buffer';
import { MATCHUP_BOX_SCORE_STAT_KEYS } from '../../matchup-box-score-types';
import { isNflTeam } from '../../nfl-teams';
import type { LeaguePeriod } from '../domain/contracts';
import { compatibleRevision } from './revision-compatibility';
import { stableJson } from './stable-json';

export const LIVE_BOX_SCORE_VERSION = 'live-box-scores-v1';
export const LIVE_BOX_SCORE_MAX_ENTRIES = 512;
export const LIVE_BOX_SCORE_MAX_BYTES = 256 * 1024;

export type LiveBoxScoreEntry = Readonly<{
  entityKind: 'player' | 'team_defense';
  providerExternalId: string;
  gamePhase: 'live' | 'final' | 'unknown';
  stats: Readonly<Record<string, number>>;
}>;
export type LiveBoxScoreEvidenceInput = Readonly<{
  period: LeaguePeriod;
  sourceRevision: string;
  bodyHash: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  entries: readonly LiveBoxScoreEntry[];
}>;
export type LiveBoxScoreEvidence = LiveBoxScoreEvidenceInput & Readonly<{
  version: typeof LIVE_BOX_SCORE_VERSION;
  revision: string;
}>;

const statKeys = new Set<string>(MATCHUP_BOX_SCORE_STAT_KEYS);
const fields = ['version', 'revision', 'period', 'sourceRevision', 'bodyHash',
  'requestStartedAt', 'requestCompletedAt', 'observedAt', 'entries'];
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validTime(value: unknown): value is string {
  return typeof value === 'string' && iso.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
export function liveBoxScoreIdentityKey(entry: Pick<LiveBoxScoreEntry, 'entityKind' | 'providerExternalId'>): string {
  if (entry.entityKind === 'player' && /^[1-9]\d{0,19}$/u.test(entry.providerExternalId)) {
    return `player:${entry.providerExternalId}`;
  }
  if (entry.entityKind === 'team_defense' && isNflTeam(entry.providerExternalId)) return `defense:${entry.providerExternalId}`;
  throw new Error('Invalid live box-score identity.');
}

/** Compact descriptive evidence from one actual weekly retrieval, never inferred scores. */
export function buildLiveBoxScoreEvidence(input: LiveBoxScoreEvidenceInput): LiveBoxScoreEvidence {
  const material = {
    version: LIVE_BOX_SCORE_VERSION,
    ...input,
    entries: [...input.entries].sort((left, right) => liveBoxScoreIdentityKey(left).localeCompare(liveBoxScoreIdentityKey(right))),
  };
  const evidence = { ...material, revision: compatibleRevision(material) };
  const parsed = parseLiveBoxScoreEvidence(evidence, input.period);
  if (!parsed) throw new Error('Invalid live box-score evidence.');
  return parsed;
}

/** Fail closed on malformed persisted JSON; old observations can simply omit it. */
export function parseLiveBoxScoreEvidence(
  value: unknown,
  expectedPeriod: LeaguePeriod,
  now = Number.POSITIVE_INFINITY,
): LiveBoxScoreEvidence | null {
  try {
    if (!object(value) || !exactKeys(value, fields) || value.version !== LIVE_BOX_SCORE_VERSION
      || !object(value.period) || !exactKeys(value.period, ['season', 'seasonType', 'week'])
      || !Number.isInteger(value.period.season) || Number(value.period.season) < 2026 || Number(value.period.season) > 2200
      || value.period.seasonType !== 'regular' || !Number.isInteger(value.period.week)
      || Number(value.period.week) < 1 || Number(value.period.week) > 18
      || value.period.season !== expectedPeriod.season || value.period.seasonType !== expectedPeriod.seasonType
      || value.period.week !== expectedPeriod.week
      || typeof value.sourceRevision !== 'string' || !value.sourceRevision.trim()
      || value.sourceRevision.length > 1024
      || typeof value.bodyHash !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value.bodyHash)
      || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.revision)
      || !validTime(value.requestStartedAt) || !validTime(value.requestCompletedAt) || !validTime(value.observedAt)
      || Date.parse(value.requestStartedAt) > Date.parse(value.observedAt)
      || Date.parse(value.observedAt) > Date.parse(value.requestCompletedAt)
      || Number.isNaN(now) || Date.parse(value.requestCompletedAt) > now
      || !Array.isArray(value.entries) || value.entries.length > LIVE_BOX_SCORE_MAX_ENTRIES) return null;
    const seen = new Set<string>();
    for (const entry of value.entries) {
      if (!object(entry) || !exactKeys(entry, ['entityKind', 'providerExternalId', 'gamePhase', 'stats'])
        || typeof entry.providerExternalId !== 'string'
        || !['player', 'team_defense'].includes(String(entry.entityKind))
        || !['live', 'final', 'unknown'].includes(String(entry.gamePhase)) || !object(entry.stats)
        || Object.entries(entry.stats).some(([key, count]) => !statKeys.has(key)
          || typeof count !== 'number' || !Number.isFinite(count))) return null;
      const key = liveBoxScoreIdentityKey(entry as unknown as LiveBoxScoreEntry);
      if (seen.has(key)) return null;
      seen.add(key);
    }
    const { revision, ...material } = value;
    if (compatibleRevision(material) !== revision || Buffer.byteLength(stableJson(value), 'utf8') > LIVE_BOX_SCORE_MAX_BYTES) return null;
    return value as unknown as LiveBoxScoreEvidence;
  } catch { return null; }
}

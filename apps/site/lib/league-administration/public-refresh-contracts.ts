import type { AdministrationWriteFence } from './store-contracts';
import { normalizePublicTransactionHistory, type PublicTransactionHistory, normalizePublicDraftPicks, type PublicDraftPicks } from './public-intake-contracts';
import { normalizePublicWeeklyReports, normalizePublicExactPeriods, normalizePublicPeriodInventory, normalizePublicPlayoffBrackets, type PublicPlayoffBrackets, type PublicPeriodInventory, type PublicExactPeriod, type PublicIntakeOutcome } from './public-intake-contracts';

export const PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY = 'public-data-resource-schedule-v1' as const;
export type PublicDataResourceSchedulingPolicy = typeof PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY;
/** Declaration under an existing approval revision; it grants no separate collection authority. */
export type PublicDataResourceScheduleConfiguration = Readonly<{
  targetId: string; expectedRevision: number;
  activePeriods: readonly Readonly<{ season: 2026; externalLeagueId: string; nativeWeek: number }>[];
}>;
export type PublicDataResourceScheduleConfigured = Readonly<{ targetId: string; configurationRevision: number }>;
export type PublicDataResourceSelected = Readonly<{
  status: 'selected'; selectionId: string; requestId: string; lane: 'active' | 'history';
  resourceId: string | null; configurationRevision: number | null;
}>;
export type PublicDataResourceSelectionResult = PublicDataResourceSelected
  | Exclude<PublicDataRefreshSelectionResult, PublicDataRefreshSelected>;

export type PublicDataRefreshConfiguration = Readonly<{
  id: string; expectedRevision: number; identityRequestId: string; seasons: readonly number[];
  cadenceSeconds: number; expiresAt: string; paused: boolean; exactPeriods?: readonly PublicExactPeriod[]; periodInventory?: PublicPeriodInventory; playoffBrackets?: PublicPlayoffBrackets; weeklyReports?: readonly PublicExactPeriod[]; transactionHistory?: PublicTransactionHistory;
  draftPicks?: PublicDraftPicks;
}>;
export type PublicDataRefreshConfigured = Readonly<{
  status: 'configured' | 'replayed'; targetId: string; configurationRevision: number;
}>;
export type PublicDataRefreshSelected = Readonly<{
  status: 'selected'; targetId: string; configurationRevision: number; cycleConfigurationRevision: number;
  cycle: number; requestId: string;
}>;
export type PublicDataRefreshSelectionResult = PublicDataRefreshSelected
  | Readonly<{ status: 'idle' | 'backoff' | 'capacity'; reason?: string; nextEligibleAt?: string | null }>;
export type PublicDataRefreshSelectionFailure = 'selection-failed' | 'request-state-failed' | 'admission-unconfirmed';
export type PublicDataRefreshFailureResult = Readonly<{
  status: 'recorded' | 'already-recorded' | 'admitted' | 'unbound' | 'superseded'; retryAt?: string | null;
}>;
export type PublicDataRefreshStore = Readonly<{
  configureResourceSchedule?: (input: PublicDataResourceScheduleConfiguration) => Promise<PublicDataResourceScheduleConfigured>;
  selectResourceWork?: (fence: AdministrationWriteFence) => Promise<PublicDataResourceSelectionResult>;
  recordResourceSelectionFailure?: (selection: PublicDataResourceSelected | null, fence: AdministrationWriteFence,
    reason: PublicDataRefreshSelectionFailure) => Promise<PublicDataRefreshFailureResult>;
  configure: (input: PublicDataRefreshConfiguration) => Promise<PublicDataRefreshConfigured>;
  select: (fence: AdministrationWriteFence) => Promise<PublicDataRefreshSelectionResult>;
  /** Null reconciles only this worker/generation's persisted selection after an unknown acknowledgment. */
  recordSelectionFailure: (selection: PublicDataRefreshSelected | null, fence: AdministrationWriteFence,
    reason: PublicDataRefreshSelectionFailure) => Promise<PublicDataRefreshFailureResult>;
}>;
export type PublicDataRefreshOutcome = PublicIntakeOutcome
  | Readonly<{ status: 'idle' | 'capacity' | 'deadline' | 'disabled'; providerRequests: 0 }>;

export function refreshUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
}
export function refreshOrdinal(value: unknown, minimum = 1): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}
export function validatePublicDataResourceSchedule(input: PublicDataResourceScheduleConfiguration): PublicDataResourceScheduleConfiguration {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join('|') !== 'activePeriods|expectedRevision|targetId'
    || !refreshUuid(input.targetId) || !refreshOrdinal(input.expectedRevision)
    || !Array.isArray(input.activePeriods) || input.activePeriods.length > 20) {
    throw new Error('Invalid public DATA resource schedule.');
  }
  const periods = input.activePeriods.map(period => {
    if (!period || typeof period !== 'object' || Array.isArray(period)
      || Object.keys(period).sort().join('|') !== 'externalLeagueId|nativeWeek|season'
      || period.season !== 2026 || typeof period.externalLeagueId !== 'string'
      || !/^[1-9][0-9]{0,31}$/u.test(period.externalLeagueId)
      || !Number.isInteger(period.nativeWeek) || period.nativeWeek < 1 || period.nativeWeek > 18) {
      throw new Error('Invalid public DATA active period.');
    }
    return { season: 2026 as const, externalLeagueId: period.externalLeagueId, nativeWeek: period.nativeWeek };
  });
  if (new Set(periods.map(period => period.season + ':' + period.externalLeagueId)).size !== periods.length) {
    throw new Error('Duplicate public DATA active league.');
  }
  return { targetId: input.targetId.toLowerCase(), expectedRevision: input.expectedRevision,
    activePeriods: periods.sort((left, right) => left.externalLeagueId.localeCompare(right.externalLeagueId)) };
}

export function validatePublicDataRefresh(input: PublicDataRefreshConfiguration, now = new Date()): PublicDataRefreshConfiguration {
  if (!input || typeof input !== 'object') throw new Error('Invalid public DATA refresh configuration.');
  const expiry = typeof input.expiresAt === 'string' ? Date.parse(input.expiresAt) : NaN;
  if (!refreshUuid(input.id) || !refreshUuid(input.identityRequestId) || (!refreshOrdinal(input.expectedRevision, 0) || input.expectedRevision >= Number.MAX_SAFE_INTEGER)
    || !Array.isArray(input.seasons) || input.seasons.length < 1 || input.seasons.length > 3
    || input.seasons.some(season => !Number.isInteger(season) || season < 1920 || season > 2200)
    || new Set(input.seasons).size !== input.seasons.length || typeof input.paused !== 'boolean'
    || !Number.isInteger(input.cadenceSeconds) || input.cadenceSeconds < 60 || input.cadenceSeconds > 604_800
    || !Number.isFinite(now.getTime()) || !Number.isFinite(expiry) || expiry <= now.getTime()
    || expiry > now.getTime() + 90 * 86_400_000) throw new Error('Invalid public DATA refresh configuration.');
  const weeklyReports = normalizePublicWeeklyReports(input.weeklyReports, input.seasons);
  const draftPicks = normalizePublicDraftPicks(input.draftPicks, input.seasons);
  const transactionHistory = normalizePublicTransactionHistory(input.transactionHistory, input.seasons);
  if (Object.hasOwn(input, 'transactionPeriod')) throw new Error('Public refresh does not support an exact transaction-period selector.');
  const playoffBrackets = normalizePublicPlayoffBrackets(input.playoffBrackets, input.seasons);
  const periodInventory = normalizePublicPeriodInventory(input.periodInventory, input.seasons);
  if (periodInventory && input.exactPeriods !== undefined) throw new Error('Public period scopes are mutually exclusive.');
  const exactPeriods = normalizePublicExactPeriods(input.exactPeriods, input.seasons);
  return { id: input.id.toLowerCase(), expectedRevision: input.expectedRevision, identityRequestId: input.identityRequestId.toLowerCase(),
    seasons: [...input.seasons].sort((left, right) => left - right), cadenceSeconds: input.cadenceSeconds,
    expiresAt: new Date(expiry).toISOString(), paused: input.paused, ...(exactPeriods.length ? { exactPeriods } : {}), ...(periodInventory ? { periodInventory } : {}), ...(playoffBrackets ? { playoffBrackets } : {}), ...(weeklyReports.length ? { weeklyReports } : {}), ...(transactionHistory ? { transactionHistory } : {}), ...(draftPicks ? { draftPicks } : {}) };
}

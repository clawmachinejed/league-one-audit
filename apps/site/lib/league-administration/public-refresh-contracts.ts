import type { AdministrationWriteFence } from './store-contracts';
import { normalizePublicExactPeriods, normalizePublicPeriodInventory, type PublicPeriodInventory, type PublicExactPeriod, type PublicIntakeOutcome } from './public-intake-contracts';

export type PublicDataRefreshConfiguration = Readonly<{
  id: string; expectedRevision: number; identityRequestId: string; seasons: readonly number[];
  cadenceSeconds: number; expiresAt: string; paused: boolean; exactPeriods?: readonly PublicExactPeriod[]; periodInventory?: PublicPeriodInventory;
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
  const periodInventory = normalizePublicPeriodInventory(input.periodInventory, input.seasons);
  if (periodInventory && input.exactPeriods !== undefined) throw new Error('Public period scopes are mutually exclusive.');
  const exactPeriods = normalizePublicExactPeriods(input.exactPeriods, input.seasons);
  return { id: input.id.toLowerCase(), expectedRevision: input.expectedRevision, identityRequestId: input.identityRequestId.toLowerCase(),
    seasons: [...input.seasons].sort((left, right) => left - right), cadenceSeconds: input.cadenceSeconds,
    expiresAt: new Date(expiry).toISOString(), paused: input.paused, ...(exactPeriods.length ? { exactPeriods } : {}), ...(periodInventory ? { periodInventory } : {}) };
}

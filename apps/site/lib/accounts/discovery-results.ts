import 'server-only';
import type { AcquisitionAdmission, AcquisitionProgress, ProviderActivation, StoredDiscoveryResult } from './neon/discovery';
import { accountUuid } from './validation';

function invalid(): never { throw new Error('Acquisition unavailable.'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 200): string {
  // Display strings use the existing normalizer domain. JSON serialization
  // escapes control characters; they are never interpolated into URLs or SQL.
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid();
  return value;
}
function uuid(value: unknown) { try { return accountUuid(value); } catch { return invalid(); } }
function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) invalid();
  return value;
}
function season(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > 9999) invalid();
  return value;
}
function seasons(value: unknown): number[] {
  if (!Array.isArray(value)) invalid();
  const result = value.map(season);
  if (new Set(result).size !== result.length) invalid();
  return result;
}
function retry(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3600) invalid();
  return value;
}
function status(value: unknown): string { return value && typeof value === 'object' && 'status' in value ? text(value.status, 32) : invalid(); }
const reasons = new Set(['authority_unavailable', 'lookup_unqualified', 'exclusive_conflict', 'scope_invalid',
  'admission_unavailable', 'command_conflict', 'budget_exhausted', 'unavailable', 'expired', 'invalid_source', 'transport']);
function rejection(value: unknown, allowed: string[]) {
  const r = record(value, ['status', 'reason']);
  if (!allowed.includes(text(r.status)) || typeof r.reason !== 'string' || !reasons.has(r.reason)) invalid();
  return { status: r.status, reason: r.reason };
}
export function decodeAcquisitionAdmission(value: unknown): AcquisitionAdmission {
  const s = status(value);
  if (s === 'pending' || s === 'joined') {
    const r = record(value, ['status', 'demandId', 'retryAfterSeconds']);
    return { status: s, demandId: uuid(r.demandId), retryAfterSeconds: retry(r.retryAfterSeconds) };
  }
  return rejection(value, ['denied', 'limited', 'conflict', 'indeterminate']) as AcquisitionAdmission;
}
export function decodeAcquisitionActivation(value: unknown): ProviderActivation {
  const s = status(value);
  if (s === 'active' || s === 'already_active') {
    const r = record(value, ['status', 'associationId', 'associationRevision', 'assurance']);
    if (r.assurance !== 'user_asserted') invalid();
    return { status: s, associationId: uuid(r.associationId), associationRevision: revision(r.associationRevision), assurance: r.assurance };
  }
  return rejection(value, ['conflict', 'denied', 'indeterminate']) as ProviderActivation;
}
function field(value: unknown, avatar = false) {
  const r = record(value, ['state', 'value']);
  if (r.state === 'known') {
    const result = text(r.value, avatar ? 128 : 100);
    if (avatar && !/^[a-zA-Z0-9_-]{1,128}$/.test(result)) invalid();
    return { state: r.state, value: result };
  }
  if (r.state === 'empty' && r.value === '') return { state: r.state, value: '' };
  if (['absent', 'null', 'invalid'].includes(String(r.state)) && r.value === null) return { state: r.state, value: null };
  return invalid();
}
function account(value: unknown) {
  const r = record(value, ['id', 'provider', 'namespace', 'nativeAccountId', 'username', 'displayName', 'avatar', 'identityEvidenceKind', 'identityEvidenceRef']);
  if (r.provider !== 'sleeper' || r.identityEvidenceKind !== 'lookup'
    || typeof r.nativeAccountId !== 'string' || !/^[1-9]\d{0,31}$/.test(r.nativeAccountId)) invalid();
  return { id: uuid(r.id), provider: r.provider, namespace: text(r.namespace, 100), nativeAccountId: r.nativeAccountId,
    username: field(r.username), displayName: field(r.displayName), avatar: field(r.avatar, true), identityEvidenceKind: r.identityEvidenceKind,
    identityEvidenceRef: uuid(r.identityEvidenceRef) };
}
export function decodeAcquisitionProgress(value: unknown): AcquisitionProgress {
  const s = status(value);
  if (s === 'pending') return decodeAcquisitionAdmission(value) as Extract<AcquisitionProgress, { status: 'pending' }>;
  if (s === 'identified') {
    const r = record(value, ['status', 'demandId', 'lookupCaptureId', 'providerAccount']);
    return { status: s, demandId: uuid(r.demandId), lookupCaptureId: uuid(r.lookupCaptureId), providerAccount: account(r.providerAccount) };
  }
  if (s === 'discovery-progress') {
    const r = record(value, ['status', 'demandId', 'scanId', 'requiredSeasons', 'completedSeasons', 'coverage']);
    const requiredSeasons = seasons(r.requiredSeasons), completedSeasons = seasons(r.completedSeasons);
    if (!requiredSeasons.length || !['pending', 'partial', 'complete', 'failed'].includes(String(r.coverage))
      || completedSeasons.some(y => !requiredSeasons.includes(y))
      || (r.coverage === 'complete' && completedSeasons.length !== requiredSeasons.length)
      || (r.coverage === 'pending' && completedSeasons.length !== 0)
      || (r.coverage === 'partial' && (!completedSeasons.length || completedSeasons.length === requiredSeasons.length))) invalid();
    return { status: s, demandId: uuid(r.demandId), scanId: uuid(r.scanId), requiredSeasons, completedSeasons,
      coverage: r.coverage as 'pending' | 'partial' | 'complete' | 'failed' };
  }
  return rejection(value, ['denied', 'unavailable', 'indeterminate']) as AcquisitionProgress;
}
export function decodeStoredDiscovery(value: unknown): StoredDiscoveryResult {
  if (status(value) !== 'available') return rejection(value, ['denied', 'unavailable']) as StoredDiscoveryResult;
  const r = record(value, ['status', 'demandId', 'scanId', 'providerAccountId', 'nativeAccountId', 'displayName',
    'currentSeason', 'coverage', 'requiredSeasons', 'completedSeasons', 'candidates']);
  const progress = decodeAcquisitionProgress({ status: 'discovery-progress', demandId: r.demandId, scanId: r.scanId,
    requiredSeasons: r.requiredSeasons, completedSeasons: r.completedSeasons, coverage: r.coverage });
  if (progress.status !== 'discovery-progress' || !Array.isArray(r.candidates)
    || typeof r.nativeAccountId !== 'string' || !/^[1-9]\d{0,31}$/.test(r.nativeAccountId)) invalid();
  const currentSeason = season(r.currentSeason);
  if (![currentSeason, currentSeason - 1, currentSeason - 2].every(y => progress.requiredSeasons.includes(y))) invalid();
  const candidates = r.candidates.map(value => {
    const c = record(value, ['id', 'name', 'season', 'avatar']);
    if (typeof c.id !== 'string' || !/^[1-9]\d{0,31}$/.test(c.id)
      || typeof c.season !== 'string' || !/^\d{4}$/.test(c.season)
      || !progress.completedSeasons.includes(Number(c.season))
      || (c.avatar !== null && (typeof c.avatar !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(c.avatar)))) invalid();
    return { id: c.id, name: text(c.name), season: c.season, avatar: c.avatar as string | null };
  });
  if (new Set(candidates.map(c => c.id)).size !== candidates.length) invalid();
  return { status: 'available', demandId: progress.demandId, scanId: progress.scanId, providerAccountId: uuid(r.providerAccountId),
    nativeAccountId: r.nativeAccountId, displayName: text(r.displayName), currentSeason,
    coverage: progress.coverage, requiredSeasons: progress.requiredSeasons, completedSeasons: progress.completedSeasons, candidates };
}

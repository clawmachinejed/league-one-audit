import type { AdministrationSourceMapping } from './source-mapping';
import type { AdministrationWriteFence } from './store-contracts';
import type { CapturedAdministrationDocument, PublicCaptureWitness, PublicIntakeWork } from './contracts';
export type { PublicIntakeWork } from './contracts';

export const PUBLIC_INTAKE_JOB = 'league-administration-public-intake';
export const PUBLIC_INTAKE_VERSION = 'sleeper-public-intake-v1';
export type PublicExactPeriod = Readonly<{ season: number; nativeWeek: number }>;
export type PublicIntakeInput = Readonly<{ id: string; username: string; seasons: readonly number[];
  exactPeriods?: readonly PublicExactPeriod[] }>;
export type PublicIdentity = Readonly<{ userId: string; username: string; displayName: string; avatarUrl: string | null }>;
export type PublicLeague = Readonly<{ id: string; name: string; season: string }>;
export type PublicCapture<T> = Readonly<{ payload: unknown; requestStartedAt: string; requestCompletedAt: string; acquisition?: PublicCaptureWitness }>
  & (Readonly<{ value: T; diagnostic?: never }> | Readonly<{ value: null; diagnostic: 'invalid-source' }>);
export type PublicIntakeDisposition = 'complete' | 'partial' | 'unavailable' | 'backoff';
export type PublicIntakeOutcome = Readonly<{ status: 'progress' | 'busy' | PublicIntakeDisposition;
  resource?: PublicIntakeWork['kind']; providerRequests: number }>;
export type PublicCoreCheckpoint = Readonly<{
  observations: Readonly<{ league?: string; rosters?: string; users?: string }>;
  /** Fresh source request alongside its immutable, potentially deduplicated directory observation. */
  directoryCapture?: CapturedAdministrationDocument;
  receipts?: Readonly<{ settings: string; players: string; managers: string }>;
}>;
export type PublicExactPeriodCheckpoint = Readonly<{
  observations: Readonly<{ league: string; matchups: string }>;
  receipts: Readonly<{ settings: string; matchups: string }>;
}>;
export type PublicIntakeStore = Readonly<{
  submit: (input: PublicIntakeInput) => Promise<void>;
  recover: (requestId: string, fence: AdministrationWriteFence) => Promise<void>;
  next: (requestId: string) => Promise<PublicIntakeWork | PublicIntakeDisposition>;
  admit: (work: PublicIntakeWork, fence: AdministrationWriteFence) => Promise<boolean>;
  /** R039 only. Missing in explicitly legacy adapters; never invent a witness locally. */
  captureWitness?: (work: PublicIntakeWork, mapping: AdministrationSourceMapping | null,
    fence: AdministrationWriteFence) => Promise<PublicCaptureWitness>;
  recordIdentity: (work: Extract<PublicIntakeWork, { kind: 'identity' }>, capture: PublicCapture<PublicIdentity>, fence: AdministrationWriteFence) => Promise<void>;
  recordLeagues: (work: Extract<PublicIntakeWork, { kind: 'leagues' }>, capture: PublicCapture<readonly PublicLeague[]>, fence: AdministrationWriteFence) => Promise<void>;
  register: (work: Extract<PublicIntakeWork, { kind: 'bootstrap' | 'core' | 'users' }>, capture: CapturedAdministrationDocument,
    fence: AdministrationWriteFence) => Promise<void>;
  completeCore: (work: Extract<PublicIntakeWork, { kind: 'bootstrap' | 'core' | 'users' }>, mapping: AdministrationSourceMapping,
    checkpoint: PublicCoreCheckpoint, fence: AdministrationWriteFence) => Promise<void>;
  completeExactPeriod: (work: Extract<PublicIntakeWork, { kind: 'exact-matchups' }>, mapping: AdministrationSourceMapping,
    checkpoint: PublicExactPeriodCheckpoint, fence: AdministrationWriteFence) => Promise<void>;
  fail: (work: PublicIntakeWork, fence: AdministrationWriteFence) => Promise<void>;
}>;

/** An omitted or empty selector has exactly the old wire identity. */
export function normalizePublicExactPeriods(value: unknown, seasons: readonly number[]): readonly PublicExactPeriod[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw new Error('Invalid public exact-period scope.');
  const periods = value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid public exact-period scope.');
    const period = entry as Record<string, unknown>;
    if (Object.keys(period).length !== 2 || !Object.hasOwn(period, 'season') || !Object.hasOwn(period, 'nativeWeek')
      || !Number.isInteger(period.season) || !seasons.includes(Number(period.season))
      || !Number.isInteger(period.nativeWeek) || Number(period.nativeWeek) < 1 || Number(period.nativeWeek) > 18) {
      throw new Error('Invalid public exact-period scope.');
    }
    return { season: Number(period.season), nativeWeek: Number(period.nativeWeek) };
  });
  if (new Set(periods.map(period => period.season)).size !== periods.length) throw new Error('Duplicate public exact-period season.');
  return periods.sort((left, right) => left.season - right.season);
}

export function validatePublicIntake(input: PublicIntakeInput): PublicIntakeInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid public intake scope.');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(input.id)
    || !/^[a-zA-Z0-9_]{1,100}$/u.test(input.username)
    || !Array.isArray(input.seasons) || input.seasons.length < 1 || input.seasons.length > 3
    || input.seasons.some(season => !Number.isInteger(season) || season < 1920 || season > 2200)
    || new Set(input.seasons).size !== input.seasons.length) throw new Error('Invalid public intake scope.');
  const exactPeriods = normalizePublicExactPeriods(input.exactPeriods, input.seasons);
  return { id: input.id.toLowerCase(), username: input.username, seasons: [...input.seasons].sort((a, b) => a - b),
    ...(exactPeriods.length ? { exactPeriods } : {}) };
}

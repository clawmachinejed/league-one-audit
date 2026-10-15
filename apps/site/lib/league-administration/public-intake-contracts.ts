import type { RetainedMatchupSelection } from './retained-matchups-contracts';
import type { RetainedMatchupManifest, RetainedMatchupCursor } from './retained-matchup-comparison';
import type { AdministrationSourceMapping } from './source-mapping';
import type { AdministrationWriteFence } from './store-contracts';
import type { CapturedAdministrationDocument, PublicCaptureWitness, PublicIntakeWork } from './contracts';
export type { PublicIntakeWork } from './contracts';

export const PUBLIC_INTAKE_JOB = 'league-administration-public-intake';
export const PUBLIC_INTAKE_VERSION = 'sleeper-public-intake-v1';
export const PUBLIC_PERIOD_INVENTORY = 'sleeper-2026-native-period-inventory-v1' as const;
export type PublicPeriodInventory = typeof PUBLIC_PERIOD_INVENTORY;
export const PUBLIC_PLAYOFF_BRACKETS = 'sleeper-2026-playoff-brackets-v1' as const;
export type PublicPlayoffBrackets = typeof PUBLIC_PLAYOFF_BRACKETS;
export const PUBLIC_DRAFT_PICKS = 'sleeper-2026-draft-picks-v1' as const;
export type PublicDraftPicks = typeof PUBLIC_DRAFT_PICKS;
export type PublicPeriodInventoryPage = Readonly<{ afterOrdinal?: number; limit?: number }>;
export type PublicSeasonHistoryRetained = Readonly<{ selection: RetainedMatchupSelection; batchSize?: number;
  manifest?: RetainedMatchupManifest; cursor?: RetainedMatchupCursor }>;
export type PublicIntakeReadOptions = Readonly<{ managerEvidenceVersion?: 'v2'; periodInventoryPage?: PublicPeriodInventoryPage;
  /** Full transaction history metadata is complete; detailed receipts are bounded to this page. */
  transactionHistoryPage?: PublicPeriodInventoryPage;
  /** Complete task metadata, with at most twenty detailed immutable draft receipts per page. */
  draftPicksPage?: PublicPeriodInventoryPage;
  /** Optional evidence context for only the selected detailed period page. */
  periodContextVersion?: 'v1';
  /** Optional typed native lineup and point evidence for the same detailed period page. */
  exactMatchupValuesVersion?: 'v1';
  /** Independent receipt-bound standings and existing selected result evidence. */
  officialResultsVersion?: 'v1';
  /** Stored 2026 history from this request's bounded page and original receipts. */
  seasonHistoryVersion?: 'v1';
  /** One explicit source scope; continuation carries its original immutable manifest. */
  seasonHistoryRetained?: PublicSeasonHistoryRetained }>;
export type PublicExactPeriod = Readonly<{ season: number; nativeWeek: number }>;
/** One explicit 2026 transaction period; full history and refresh remain separate. */
export type PublicTransactionPeriod = Readonly<{ season: 2026; nativeWeek: number }>;
export const PUBLIC_TRANSACTION_HISTORY = 'sleeper-2026-transaction-history-v1' as const;
export type PublicTransactionHistory = typeof PUBLIC_TRANSACTION_HISTORY;
export type PublicIntakeInput = Readonly<{ id: string; username: string; seasons: readonly number[];
  exactPeriods?: readonly PublicExactPeriod[]; periodInventory?: PublicPeriodInventory; playoffBrackets?: PublicPlayoffBrackets;
  weeklyReports?: readonly PublicExactPeriod[]; transactionPeriod?: PublicTransactionPeriod; transactionHistory?: PublicTransactionHistory;
  draftPicks?: PublicDraftPicks }>;
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
export type PublicTransactionCheckpoint = Readonly<{
  observations: Readonly<{ transactions: string }>;
  receipts: Readonly<{ transactions: string }>;
}>;
export type PublicBracketCheckpoint = Readonly<{
  observations: Readonly<{ winners_bracket: string; losers_bracket: string }>;
  receipts: Readonly<{ winners_bracket: string; losers_bracket: string }>;
}>;
export type PublicWeeklyReportCheckpoint = Readonly<{
  observations: Readonly<{ weekly_report: string }>;
  receipts: Readonly<{ weekly_report: string }>;
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
  /** R047 capability; selected bracket tasks require witnessed paired completion. */
  completeBrackets?: (work: Extract<PublicIntakeWork, { kind: 'playoff-brackets' }>, mapping: AdministrationSourceMapping,
    checkpoint: PublicBracketCheckpoint, fence: AdministrationWriteFence) => Promise<void>;
  /** R050 optional exact-week report completion, bound to its original acquisition. */
  completeWeeklyReport?: (work: Extract<PublicIntakeWork, { kind: 'weekly-report' }>, mapping: AdministrationSourceMapping,
    checkpoint: PublicWeeklyReportCheckpoint, fence: AdministrationWriteFence) => Promise<void>;
  /** R051 optional exact transaction period, bound to its original receipt. */
  completeTransactions?: (work: Extract<PublicIntakeWork, { kind: 'transactions' }>, mapping: AdministrationSourceMapping,
    checkpoint: PublicTransactionCheckpoint, fence: AdministrationWriteFence) => Promise<void>;
  /** R056 returns only the immutable catalog row bound to this admitted endpoint task. */
  draftCatalog?: (work: Extract<PublicIntakeWork, { kind: 'drafts' }>, mapping: AdministrationSourceMapping,
    fence: AdministrationWriteFence) => Promise<unknown>;
  completeDraft?: (work: Extract<PublicIntakeWork, { kind: 'drafts' }>, mapping: AdministrationSourceMapping,
    checkpoint: Readonly<{ observations: Readonly<{ drafts: string }>; receipts: Readonly<{ drafts: string }> }>,
    fence: AdministrationWriteFence) => Promise<void>;
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

/** Input opt-in is separate from the unchanged legacy selector. */
export function normalizePublicPeriodInventory(value: unknown, seasons: readonly number[]): PublicPeriodInventory | undefined {
  if (value === undefined) return undefined;
  if (value !== PUBLIC_PERIOD_INVENTORY || seasons.length !== 1 || seasons[0] !== 2026) {
    throw new Error('Invalid public native-period inventory scope.');
  }
  return PUBLIC_PERIOD_INVENTORY;
}
export function normalizePublicPlayoffBrackets(value: unknown, seasons: readonly number[]): PublicPlayoffBrackets | undefined {
  if (value === undefined) return undefined;
  if (value !== PUBLIC_PLAYOFF_BRACKETS || seasons.length !== 1 || seasons[0] !== 2026) {
    throw new Error('Invalid public playoff bracket scope.');
  }
  return PUBLIC_PLAYOFF_BRACKETS;
}
/** Explicit report keys are independent of matchup inventory and never traverse seasons. */
export function normalizePublicWeeklyReports(value: unknown, seasons: readonly number[]): readonly PublicExactPeriod[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 18) throw new Error('Invalid public weekly-report scope.');
  if (!value.length) return [];
  if (seasons.length !== 1 || seasons[0] !== 2026) throw new Error('Invalid public weekly-report season.');
  const periods = value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid public weekly-report scope.');
    const period = entry as Record<string, unknown>;
    if (Object.keys(period).sort().join('|') !== 'nativeWeek|season' || period.season !== 2026
      || !Number.isInteger(period.nativeWeek) || Number(period.nativeWeek) < 1 || Number(period.nativeWeek) > 18) {
      throw new Error('Invalid public weekly-report scope.');
    }
    return { season: 2026, nativeWeek: Number(period.nativeWeek) };
  });
  if (new Set(periods.map(period => period.nativeWeek)).size !== periods.length) throw new Error('Duplicate public weekly-report week.');
  return periods.sort((left, right) => left.nativeWeek - right.nativeWeek);
}
export function normalizePublicTransactionPeriod(value: unknown, seasons: readonly number[]): PublicTransactionPeriod | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || seasons.length !== 1 || seasons[0] !== 2026) {
    throw new Error('Invalid public transaction-period scope.');
  }
  const period = value as Record<string, unknown>;
  if (Object.keys(period).sort().join('|') !== 'nativeWeek|season' || period.season !== 2026
    || !Number.isInteger(period.nativeWeek) || Number(period.nativeWeek) < 0 || Number(period.nativeWeek) > 18) {
    throw new Error('Invalid public transaction-period scope.');
  }
  return { season: 2026, nativeWeek: Number(period.nativeWeek) };
}
export function normalizePublicTransactionHistory(value: unknown, seasons: readonly number[]): PublicTransactionHistory | undefined {
  if (value === undefined) return undefined;
  if (value !== PUBLIC_TRANSACTION_HISTORY || seasons.length !== 1 || seasons[0] !== 2026) {
    throw new Error('Invalid public transaction-history scope.');
  }
  return PUBLIC_TRANSACTION_HISTORY;
}
export function normalizePublicDraftPicks(value: unknown, seasons: readonly number[]): PublicDraftPicks | undefined {
  if (value === undefined) return undefined;
  if (value !== PUBLIC_DRAFT_PICKS || seasons.length !== 1 || seasons[0] !== 2026) {
    throw new Error('Invalid public draft/pick scope.');
  }
  return PUBLIC_DRAFT_PICKS;
}
export function publicTransactionHistoryPeriods(): readonly PublicTransactionPeriod[] {
  return Array.from({ length: 19 }, (_, nativeWeek) => ({ season: 2026 as const, nativeWeek }));
}
export function publicInventoryPeriods(): readonly PublicExactPeriod[] {
  return Array.from({ length: 18 }, (_, index) => ({ season: 2026, nativeWeek: index + 1 }));
}
/** Stored full mode materializes its canonical requests; these are not source availability. */
export function normalizeStoredPublicPeriods(value: unknown, seasons: readonly number[], mode: unknown) {
  const periodInventory = normalizePublicPeriodInventory(mode ?? undefined, seasons);
  if (!periodInventory) return { exactPeriods: normalizePublicExactPeriods(value ?? undefined, seasons), periodInventory };
  const exactPeriods = publicInventoryPeriods();
  if (!Array.isArray(value) || value.length !== 18 || value.some((entry, index) => !entry || typeof entry !== 'object'
    || Array.isArray(entry) || Object.keys(entry).length !== 2 || entry.season !== 2026 || entry.nativeWeek !== index + 1)) {
    throw new Error('Invalid stored public native-period inventory.');
  }
  return { exactPeriods, periodInventory };
}

export function validatePublicIntake(input: PublicIntakeInput): PublicIntakeInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid public intake scope.');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(input.id)
    || !/^[a-zA-Z0-9_]{1,100}$/u.test(input.username)
    || !Array.isArray(input.seasons) || input.seasons.length < 1 || input.seasons.length > 3
    || input.seasons.some(season => !Number.isInteger(season) || season < 1920 || season > 2200)
    || new Set(input.seasons).size !== input.seasons.length) throw new Error('Invalid public intake scope.');
  const weeklyReports = normalizePublicWeeklyReports(input.weeklyReports, input.seasons);
  const draftPicks = normalizePublicDraftPicks(input.draftPicks, input.seasons);
  const transactionPeriod = normalizePublicTransactionPeriod(input.transactionPeriod, input.seasons);
  const transactionHistory = normalizePublicTransactionHistory(input.transactionHistory, input.seasons);
  if (transactionHistory && input.transactionPeriod !== undefined) throw new Error('Public transaction scopes are mutually exclusive.');
  const playoffBrackets = normalizePublicPlayoffBrackets(input.playoffBrackets, input.seasons);
  const periodInventory = normalizePublicPeriodInventory(input.periodInventory, input.seasons);
  if (periodInventory && input.exactPeriods !== undefined) throw new Error('Public period scopes are mutually exclusive.');
  const exactPeriods = normalizePublicExactPeriods(input.exactPeriods, input.seasons);
  return { id: input.id.toLowerCase(), username: input.username, seasons: [...input.seasons].sort((a, b) => a - b),
    ...(exactPeriods.length ? { exactPeriods } : {}), ...(periodInventory ? { periodInventory } : {}), ...(playoffBrackets ? { playoffBrackets } : {}), ...(weeklyReports.length ? { weeklyReports } : {}), ...(transactionPeriod ? { transactionPeriod } : {}), ...(transactionHistory ? { transactionHistory } : {}), ...(draftPicks ? { draftPicks } : {}) };
}

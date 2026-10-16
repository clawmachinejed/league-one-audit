import 'server-only';
import { validatePublicDataRefresh, refreshUuid, refreshOrdinal, type PublicDataRefreshStore,
  type PublicDataRefreshSelectionResult, type PublicDataRefreshFailureResult } from '../public-refresh-contracts';
import type { DatabaseClient, DatabaseRow, DatabaseQueryOptions } from '../../database';
import { createProjectionStore } from '../../projection-store';
import { normalizeAdministrationObservation } from '../normalize';
import { ADMINISTRATION_DIALECT, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_SCHEMA_VERSION, type JsonValue } from '../contracts';
import { validatePublicIntake, type PublicIntakeInput, type PublicIntakeStore, type PublicIntakeWork,
  type PublicIntakeSubmissionReceipt } from '../public-intake-contracts';
import { parsePublicCaptureWitness } from '../public-capture-witness';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid public intake record.');
  return value as Record<string, unknown>;
}

async function requireDraftCapability(client: DatabaseClient): Promise<void> {
  const rows = await client.query(`/* public-data-intake:draft-capability */
    SELECT to_regclass('public.public_data_draft_tasks') IS NOT NULL
      AND to_regclass('public.public_data_draft_checkpoints') IS NOT NULL
      AND to_regprocedure('public.read_public_data_draft_catalog(jsonb,jsonb,jsonb)') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_intakes')
        AND attname='draft_picks' AND NOT attisdropped)
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_refresh_configurations')
        AND attname='draft_picks' AND NOT attisdropped) AS supported`);
  if (rows.length !== 1 || rows[0].supported !== true) throw new Error('Public draft intake requires installed R056.');
}

/** Older JSON functions ignore unknown keys. Refuse explicit period scope before any mutation. */
async function requireExactPeriodCapability(client: DatabaseClient): Promise<void> {
  const rows = await client.query(`/* public-data-intake:exact-period-capability */
    SELECT to_regclass('public.public_data_exact_period_tasks') IS NOT NULL
      AND to_regclass('public.public_data_exact_period_checkpoints') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_intakes')
        AND attname='exact_periods' AND NOT attisdropped)
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_refresh_configurations')
        AND attname='exact_periods' AND NOT attisdropped) AS supported`);
  if (rows.length !== 1 || rows[0].supported !== true) throw new Error('Public exact-period intake requires installed R038.');
}

async function requirePeriodInventoryCapability(client: DatabaseClient): Promise<void> {
  const rows = await client.query(`/* public-data-intake:period-inventory-capability */
    SELECT to_regclass('public.public_data_period_inventory_plans') IS NOT NULL
      AND to_regclass('public.public_data_period_inventory_sources') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_intakes')
        AND attname='period_inventory' AND NOT attisdropped)
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_refresh_configurations')
        AND attname='period_inventory' AND NOT attisdropped) AS supported`);
  if (rows.length !== 1 || rows[0].supported !== true) throw new Error('Public native-period inventory requires installed R044.');
}

async function requireBracketCapability(client: DatabaseClient): Promise<void> {
  const rows = await client.query(`/* public-data-intake:bracket-capability */
    SELECT to_regclass('public.public_data_bracket_tasks') IS NOT NULL
      AND to_regclass('public.public_data_bracket_checkpoints') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_intakes')
        AND attname='playoff_brackets' AND NOT attisdropped)
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_refresh_configurations')
        AND attname='playoff_brackets' AND NOT attisdropped) AS supported`);
  if (rows.length !== 1 || rows[0].supported !== true) throw new Error('Public bracket intake requires installed R047.');
}

/** Omitted selection never probes new schema; selected work must not be silently ignored. */
async function requireWeeklyReportCapability(client: DatabaseClient): Promise<void> {
  const rows = await client.query(`/* public-data-intake:weekly-report-capability */
    SELECT to_regclass('public.public_data_report_tasks') IS NOT NULL
      AND to_regclass('public.public_data_report_checkpoints') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_intakes')
        AND attname='weekly_reports' AND NOT attisdropped)
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_refresh_configurations')
        AND attname='weekly_reports' AND NOT attisdropped) AS supported`);
  if (rows.length !== 1 || rows[0].supported !== true) throw new Error('Public weekly-report intake requires installed R050.');
}
async function requireTransactionCapability(client: DatabaseClient): Promise<void> {
  const rows = await client.query(`/* public-data-intake:transaction-capability */
    SELECT to_regclass('public.public_data_transaction_tasks') IS NOT NULL
      AND to_regclass('public.public_data_transaction_checkpoints') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_intakes')
        AND attname='transaction_period' AND NOT attisdropped) AS supported`);
  if (rows.length !== 1 || rows[0].supported !== true) throw new Error('Public transaction intake requires installed R051.');
}
async function requireTransactionHistoryCapability(client: DatabaseClient): Promise<void> {
  const rows = await client.query(`/* public-data-intake:transaction-history-capability */
    SELECT to_regclass('public.public_data_transaction_tasks') IS NOT NULL
      AND to_regclass('public.public_data_transaction_checkpoints') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_intakes')
        AND attname='transaction_history' AND NOT attisdropped)
      AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.public_data_refresh_configurations')
        AND attname='transaction_history' AND NOT attisdropped) AS supported`);
  if (rows.length !== 1 || rows[0].supported !== true) throw new Error('Public transaction history requires installed R052.');
}

export function createPublicIntakeStore(client: DatabaseClient): PublicIntakeStore & Readonly<{
  submitWithReceipt: (input: PublicIntakeInput) => Promise<PublicIntakeSubmissionReceipt>;
}> {
  async function checkpoint(work: PublicIntakeWork, capture: unknown, fence: unknown) {
    await client.query(`/* public-data-intake:checkpoint */
      SELECT public.checkpoint_public_data_intake($1::jsonb,$2::jsonb,$3::jsonb)`,
    [JSON.stringify(work), JSON.stringify(capture), JSON.stringify(fence)]);
  }
  async function submission(input: PublicIntakeInput) {
    const validated = validatePublicIntake(input);
    if (validated.draftPicks) await requireDraftCapability(client);
    if (validated.transactionHistory) await requireTransactionHistoryCapability(client);
    if (validated.transactionPeriod) await requireTransactionCapability(client);
    if (validated.weeklyReports?.length) await requireWeeklyReportCapability(client);
    if (validated.playoffBrackets) await requireBracketCapability(client);
    if (validated.periodInventory) await requirePeriodInventoryCapability(client);
    else if (validated.exactPeriods?.length) await requireExactPeriodCapability(client);
    return validated;
  }
  return {
    async submit(input) {
      const validated = await submission(input);
      await client.query(`/* public-data-intake:submit */ SELECT public.submit_public_data_intake($1::jsonb)`,
        [JSON.stringify(validated)]);
    },
    async submitWithReceipt(input) {
      const validated = await submission(input);
      const rows = await client.query(`/* public-data-intake:submit-with-receipt */
        SELECT public.submit_public_data_intake($1::jsonb,true) AS result`, [JSON.stringify(validated)]);
      if (rows.length !== 1) throw new Error('Missing public intake submission receipt.');
      const receipt = record(rows[0].result);
      if (Object.keys(receipt).sort().join('|') !== 'requestId|status'
        || typeof receipt.status !== 'string' || !['retained', 'capacity'].includes(receipt.status)
        || receipt.requestId !== validated.id) {
        throw new Error('Invalid public intake submission receipt.');
      }
      return { status: receipt.status as 'retained' | 'capacity', requestId: validated.id };
    },
    async recover(requestId, fence) {
      await client.query(`/* public-data-intake:recover */
        SELECT public.recover_public_data_dispatch($1::uuid,$2::jsonb)`, [requestId, JSON.stringify(fence)]);
    },
    async next(requestId) {
      const rows = await client.query(`/* public-data-intake:next */ SELECT public.next_public_data_intake($1::uuid) AS result`, [requestId]);
      const result = rows[0]?.result;
      if (result === 'complete' || result === 'partial' || result === 'unavailable' || result === 'backoff') return result;
      const work = record(result);
      if (work.requestId !== requestId || !Number.isSafeInteger(work.revision) || Number(work.revision) < 0
        || !['identity', 'leagues', 'bootstrap', 'core', 'users', 'exact-matchups', 'playoff-brackets', 'weekly-report', 'transactions', 'drafts'].includes(String(work.kind))) {
        throw new Error('Invalid public intake work.');
      }
      if (work.kind === 'drafts') {
        const child = ['detail', 'selections', 'draft-trades'].includes(String(work.resource));
        const expected = ['externalLeagueId', 'kind', 'requestId', 'revision', 'season', 'resource',
          ...(child ? ['externalDraftId', 'catalogReceiptId'] : [])].sort().join('|');
        if (Object.keys(work).sort().join('|') !== expected || work.season !== 2026
          || typeof work.externalLeagueId !== 'string' || !/^[1-9][0-9]{0,31}$/u.test(work.externalLeagueId)
          || !['catalog', 'detail', 'selections', 'league-trades', 'draft-trades'].includes(String(work.resource))
          || child && (typeof work.externalDraftId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(work.externalDraftId)
            || !refreshUuid(work.catalogReceiptId))) throw new Error('Invalid public draft work.');
      }
      if (work.kind === 'transactions' && (Object.keys(work).sort().join('|') !== 'externalLeagueId|kind|nativeWeek|requestId|revision|season'
        || work.season !== 2026 || typeof work.externalLeagueId !== 'string' || !/^[1-9][0-9]{0,31}$/u.test(work.externalLeagueId)
        || !Number.isInteger(work.nativeWeek) || Number(work.nativeWeek) < 0 || Number(work.nativeWeek) > 18)) {
        throw new Error('Invalid public transaction work.');
      }
      if (work.kind === 'weekly-report' && (Object.keys(work).sort().join('|') !== 'externalLeagueId|kind|nativeWeek|requestId|revision|season'
        || work.season !== 2026 || typeof work.externalLeagueId !== 'string' || !/^[1-9][0-9]{0,31}$/u.test(work.externalLeagueId)
        || !Number.isInteger(work.nativeWeek) || Number(work.nativeWeek) < 1 || Number(work.nativeWeek) > 18)) {
        throw new Error('Invalid public weekly-report work.');
      }
      if (work.kind === 'playoff-brackets' && (Object.keys(work).sort().join('|') !== 'externalLeagueId|kind|requestId|revision|season'
        || work.season !== 2026 || typeof work.externalLeagueId !== 'string' || !/^[1-9][0-9]{0,31}$/u.test(work.externalLeagueId))) {
        throw new Error('Invalid public bracket work.');
      }
      if (work.kind === 'exact-matchups' && (typeof work.externalLeagueId !== 'string'
        || !/^[1-9][0-9]{0,31}$/u.test(work.externalLeagueId) || !Number.isInteger(work.season)
        || Number(work.season) < 1920 || Number(work.season) > 2200 || !Number.isInteger(work.nativeWeek)
        || Number(work.nativeWeek) < 1 || Number(work.nativeWeek) > 18)) throw new Error('Invalid public exact-period work.');
      return work as PublicIntakeWork;
    },
    recordIdentity: checkpoint,
    recordLeagues: checkpoint,
    async admit(work, fence) {
      const rows = await client.query(`/* public-data-intake:admit-dispatch */
        SELECT public.admit_public_data_dispatch($1::jsonb,$2::jsonb) AS admitted`, [JSON.stringify(work), JSON.stringify(fence)]);
      return rows[0]?.admitted === true;
    },
    async captureWitness(work, mapping, fence) {
      const rows = await client.query(`/* public-data-intake:capture-witness */
        SELECT public.read_public_data_capture_witness($1::jsonb,$2::jsonb,$3::jsonb) AS witness`,
      [JSON.stringify(work), mapping ? JSON.stringify(mapping) : null, JSON.stringify(fence)]);
      if (rows.length !== 1) throw new Error('Missing public capture witness.');
      const witness = parsePublicCaptureWitness(rows[0].witness);
      if (compatibleRevision(witness.work) !== compatibleRevision(work)
        || compatibleRevision(witness.mapping) !== compatibleRevision(mapping)
        || compatibleRevision(witness.fence) !== compatibleRevision(fence)) throw new Error('Wrong public capture witness.');
      return witness;
    },
    async register(work, capture, fence) {
      const reject = () => checkpoint(work, { ...capture, diagnostic: 'invalid-source' }, fence);
      if (!capture.payload || typeof capture.payload !== 'object' || Array.isArray(capture.payload)) return reject();
      const payload = record(capture.payload);
      const rows = await client.query(`/* public-data-intake:resolve-registration */
        SELECT league.league_key,season.season,league.id AS league_id,season.id AS league_season_id FROM public.league_source_connections connection
        JOIN public.league_seasons season ON season.id=connection.league_season_id
        JOIN public.leagues league ON league.id=season.league_id
        WHERE connection.provider='sleeper' AND connection.external_league_id=$1`, [work.externalLeagueId]);
      if (rows.length > 1 || rows[0] && Number(rows[0].season) !== work.season) throw new Error('Ambiguous public source identity.');
      const leagueKey = rows.length ? String(rows[0].league_key) : `sleeper-${work.externalLeagueId}`;
      const scope = { leagueKey, provider: 'sleeper' as const, externalLeagueId: work.externalLeagueId, season: work.season };
      const normalized = normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
        normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT,
        scope, family: 'league', week: null, completeness: 'complete', payload: capture.payload as JsonValue,
        provenance: { origin: 'network', requestStartedAt: capture.requestStartedAt,
          requestCompletedAt: capture.requestCompletedAt, sourceObservedAt: capture.requestCompletedAt,
          checkedAt: new Date().toISOString() } });
      // Official representability only. Unrecognized analytics rules/slots/divisions
      // are retained, and do not enroll or enable the calculation workers.
      if (normalized.status !== 'accepted' || payload.sport !== 'nfl'
        || typeof payload.name !== 'string' || !payload.name.trim()
        || !Number.isInteger(payload.total_rosters) || Number(payload.total_rosters) < 1) return reject();
      // The existing normalizer validates supplied shapes and finite weights.
      // Absent, null and empty fields remain distinct official source evidence.
      const scoring = payload.scoring_settings as Readonly<Record<string, number>> | null | undefined;
      if (Number(payload.total_rosters) > 20) {
        await checkpoint(work, { ...capture, capacity: 'roster-count-unqualified' }, fence);
        return;
      }
      // Reuse shared registration. It keeps existing season scoring profiles immutable
      // and source mapping triggers reject rebinds; no annual continuity is inferred.
      if (!client.queryAfterLock) throw new Error('Fenced public registration requires the shared transaction boundary.');
      const lockedQuery = client.queryAfterLock.bind(client);
      const guarded: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow = DatabaseRow>(
        statement: string, parameters: readonly unknown[] = [], options?: DatabaseQueryOptions) => {
        const result = await lockedQuery<Row>(statement, parameters, {
          statement: 'SELECT public.guard_public_data_intake($1::jsonb,$2::jsonb)',
          parameters: [JSON.stringify(work), JSON.stringify({ ...fence, reserveCollection: true })],
          verifyAfter: { statement: 'SELECT public.guard_public_data_intake($1::jsonb,$2::jsonb)',
            parameters: [JSON.stringify(work), JSON.stringify(fence)] },
        }, options);
        return result[1];
      } };
      const registered = rows.length ? { kind: 'stored' as const, value: { leagueId: String(rows[0].league_id),
        leagueSeasonId: String(rows[0].league_season_id) } }
        : await createProjectionStore(guarded).registerLeagueSeason({ mode: 'official-data', leagueKey, leagueName: payload.name,
        season: work.season, sleeperLeagueId: work.externalLeagueId, scoringRules: scoring });
      if (registered.kind !== 'stored') throw new Error('Public registration unavailable.');
      await checkpoint(work, { ...capture, leagueId: registered.value.leagueId,
        leagueSeasonId: registered.value.leagueSeasonId }, fence);
    },
    completeCore: (work, mapping, captured, fence) => checkpoint(work, { mapping, ...captured }, fence),
    completeExactPeriod: (work, mapping, captured, fence) => checkpoint(work, { mapping, ...captured }, fence),
    completeBrackets: (work, mapping, captured, fence) => checkpoint(work, { mapping, ...captured }, fence),
    completeWeeklyReport: (work, mapping, captured, fence) => checkpoint(work, { mapping, ...captured }, fence),
    completeTransactions: (work, mapping, captured, fence) => checkpoint(work, { mapping, ...captured }, fence),
    async draftCatalog(work, mapping, fence) {
      const rows = await client.query(`/* public-data-intake:draft-catalog */
        SELECT public.read_public_data_draft_catalog($1::jsonb,$2::jsonb,$3::jsonb) AS result`,
        [JSON.stringify(work), JSON.stringify(mapping), JSON.stringify(fence)]);
      if (rows.length !== 1) throw new Error('Missing public draft catalog.');
      return record(rows[0].result);
    },
    completeDraft: (work, mapping, captured, fence) => checkpoint(work, { mapping, ...captured }, fence),
    fail: (work, fence) => checkpoint(work, { failed: true }, fence),
  };
}


/** Optional R036 surface. Constructed only by explicitly selected backend callers. */
export function createPublicDataRefreshStore(client: DatabaseClient): PublicDataRefreshStore {
  const date = (value: unknown) => value === undefined || value === null
    || typeof value === 'string' && Number.isFinite(Date.parse(value));
  return {
    async configure(input) {
      const validated = validatePublicDataRefresh(input);
      if (validated.draftPicks) await requireDraftCapability(client);
      if (validated.transactionHistory) await requireTransactionHistoryCapability(client);
      if (validated.weeklyReports?.length) await requireWeeklyReportCapability(client);
      if (validated.playoffBrackets) await requireBracketCapability(client);
      if (validated.periodInventory) await requirePeriodInventoryCapability(client);
      else if (validated.exactPeriods?.length) await requireExactPeriodCapability(client);
      const rows = await client.query('/* public-data-refresh:configure */ SELECT public.configure_public_data_refresh($1::jsonb) AS result',
        [JSON.stringify(validated)]);
      if (rows.length !== 1) throw new Error('Missing refresh configuration result.');
      const value = record(rows[0].result);
      if (!['configured', 'replayed'].includes(String(value.status)) || value.targetId !== validated.id
        || value.configurationRevision !== validated.expectedRevision + 1) throw new Error('Invalid refresh configuration result.');
      return { status: value.status as 'configured' | 'replayed', targetId: validated.id, configurationRevision: Number(value.configurationRevision) };
    },
    async select(fence) {
      const rows = await client.query('/* public-data-refresh:select */ SELECT public.select_public_data_refresh($1::jsonb) AS result',
        [JSON.stringify(fence)]);
      if (rows.length !== 1) throw new Error('Missing refresh selection result.');
      const value = record(rows[0].result);
      if (value.status === 'selected') {
        if (!refreshUuid(value.targetId) || !refreshUuid(value.requestId) || !refreshOrdinal(value.configurationRevision)
          || !refreshOrdinal(value.cycleConfigurationRevision) || Number(value.cycleConfigurationRevision) > Number(value.configurationRevision)
          || !refreshOrdinal(value.cycle)) throw new Error('Invalid refresh selection token.');
      } else if (!['idle', 'backoff', 'capacity'].includes(String(value.status))
        || value.reason !== undefined && typeof value.reason !== 'string' || !date(value.nextEligibleAt)) {
        throw new Error('Invalid refresh selection disposition.');
      }
      return value as PublicDataRefreshSelectionResult;
    },
    async recordSelectionFailure(selection, fence, reason) {
      const rows = await client.query('/* public-data-refresh:selection-failure */ SELECT public.record_public_data_refresh_selection_failure($1::jsonb,$2::jsonb,$3::text) AS result',
        [selection ? JSON.stringify(selection) : null, JSON.stringify(fence), reason]);
      if (rows.length !== 1) throw new Error('Missing refresh failure result.');
      const value = record(rows[0].result);
      if (!['recorded', 'already-recorded', 'admitted', 'unbound', 'superseded'].includes(String(value.status)) || !date(value.retryAt)) {
        throw new Error('Invalid refresh failure disposition.');
      }
      return value as PublicDataRefreshFailureResult;
    },
  };
}

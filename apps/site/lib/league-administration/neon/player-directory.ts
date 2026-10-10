import 'server-only';
import type { DatabaseClient } from '../../database';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import { isPlayerDirectoryNativeId, normalizePlayerDirectoryRow, validatePlayerDirectoryAttempt } from '../player-directory';
import { PLAYER_DIRECTORY_PAGE_LIMIT, type PlayerDirectoryAttempt, type PlayerDirectoryCapture,
  type PlayerDirectoryLatestAttempt, type PlayerDirectoryRead, type PlayerDirectoryReadSelection,
  type PlayerDirectoryReservation, type PlayerDirectoryRow, type PlayerDirectorySourceSlice,
  type PlayerDirectoryWriteResult } from '../player-directory-contracts';
import type { AdministrationWriteFence } from '../contracts';

/** Raw transport is <=16 MiB; this cap also bounds its typed/native duplication. */
export const PLAYER_DIRECTORY_STORE_MAX_BYTES = 64 * 1024 * 1024;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid directory database evidence.');
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid directory UUID.');
  return value;
}
function integer(value: unknown, minimum = 0): number {
  const result = typeof value === 'number' || typeof value === 'string' && value !== '' ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < minimum) throw new Error('Invalid directory integer.');
  return result;
}
function timestamp(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== 'string') throw new Error('Invalid directory timestamp.');
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid directory timestamp.');
  return date.toISOString();
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid directory strings.');
  return value;
}
function fence(input: AdministrationWriteFence): string {
  if (!input || input.jobKey !== 'league-administration-public-intake' || !input.workerId
    || !Number.isSafeInteger(input.generation) || input.generation < 1 || !Number.isFinite(Date.parse(input.deadlineAt))) {
    throw new Error('Existing directory owner fence required.');
  }
  return JSON.stringify(input);
}
function latest(value: unknown): PlayerDirectoryLatestAttempt | null {
  if (value === null) return null;
  const row = object(value);
  if (!['pending', 'complete', 'partial', 'invalid', 'unavailable'].includes(String(row.status))) throw new Error('Invalid directory attempt status.');
  return { attemptId: uuid(row.attemptId), ordinal: integer(row.ordinal, 1), reservedAt: timestamp(row.reservedAt),
    status: row.status as PlayerDirectoryLatestAttempt['status'], receiptId: row.receiptId === null ? null : uuid(row.receiptId),
    reasons: strings(row.reasons), retryAt: timestamp(row.retryAt) };
}
const nativeRowSql = `jsonb_build_object('externalPlayerId',entry.external_player_id,'providerPlayerId',entry.provider_player_id,
  'fullName',entry.full_name,'firstName',entry.first_name,'lastName',entry.last_name,'position',entry.position,'team',entry.team,
  'active',entry.active,'status',entry.status,'fantasyPositions',entry.fantasy_positions,'injuryStatus',entry.injury_status,
  'fieldStates',entry.field_states,'identityStatus',entry.identity_status,'reasons',entry.reasons,'source',entry.source)`;
export const PLAYER_DIRECTORY_READ_SQL = `/* league-administration:read-player-directory */
  SELECT head.generation AS head_generation,
    CASE WHEN attempt.id IS NULL THEN NULL ELSE jsonb_build_object('attemptId',attempt.id,'ordinal',attempt.ordinal,
      'reservedAt',attempt.reserved_at,'status',coalesce(latest_capture.status,'pending'),'receiptId',latest_capture.id,
      'reasons',coalesce(latest_capture.reasons,'[]'::jsonb),'retryAt',head.next_network_at) END AS latest_attempt,
    version.id AS version_id,version.generation,version.accepted_at,capture.id AS receipt_id,capture.attempt_id,
    content.id AS content_id,content.source_revision,content.row_count,capture.request_started_at,
    capture.request_completed_at,capture.source_observed_at,
    CASE WHEN slice.capture_id IS NULL THEN NULL ELSE jsonb_build_object('scope',slice.scope,'endpoint',slice.endpoint,
      'status',slice.status,'sourceRevision',slice.source_revision,'observedAt',slice.observed_at,'complete',slice.complete,
      'rowCount',slice.row_count,'validRowCount',slice.valid_row_count,'invalidRowCount',slice.invalid_row_count,
      'conflictRowCount',slice.conflict_row_count) END AS source_slice,
    coalesce(page.rows,'[]'::jsonb) AS native_rows
  FROM public.league_player_directory_heads head
  LEFT JOIN public.league_player_directory_attempts attempt ON attempt.ordinal=head.latest_ordinal
  LEFT JOIN public.league_player_directory_captures latest_capture ON latest_capture.attempt_id=attempt.id
  LEFT JOIN public.league_player_directory_versions version ON version.id=coalesce($1::uuid,head.accepted_version_id)
  LEFT JOIN public.league_player_directory_captures capture ON capture.id=version.capture_id AND capture.content_id=version.content_id
    AND capture.status='complete'
  LEFT JOIN public.league_player_directory_contents content ON content.id=capture.content_id
  LEFT JOIN public.league_player_directory_source_slices slice ON slice.capture_id=capture.id AND slice.complete
  LEFT JOIN LATERAL (SELECT jsonb_agg(selected.row ORDER BY selected.native_id COLLATE "C") AS rows FROM (
    SELECT entry.external_player_id AS native_id,${nativeRowSql} AS row
    FROM public.league_player_directory_entries entry WHERE entry.content_id=content.id AND entry.identity_status='valid'
      AND ($2::text IS NULL OR entry.external_player_id>$2::text COLLATE "C")
      AND ($3::text[] IS NULL OR entry.external_player_id=ANY($3::text[]))
    ORDER BY entry.external_player_id COLLATE "C" LIMIT $4
  ) selected) page ON true WHERE head.provider='sleeper' AND head.sport='nfl'`;

export function playerDirectoryMethods(client: DatabaseClient) {
  return {
    async beginPlayerDirectoryAttempt(id: string, owner: AdministrationWriteFence): Promise<PlayerDirectoryReservation> {
      const rows = await client.query(`/* league-administration:begin-player-directory */
        SELECT public.begin_player_directory_attempt($1::uuid,$2::jsonb) AS result`, [uuid(id), fence(owner)]);
      if (rows.length !== 1) throw new Error('Missing directory reservation.');
      const result = object(rows[0].result);
      if (result.status === 'backoff') return { status: 'backoff', retryAt: timestamp(result.retryAt) };
      if (result.status !== 'reserved') throw new Error('Invalid directory reservation disposition.');
      const attempt = validatePlayerDirectoryAttempt(object(result.attempt) as PlayerDirectoryAttempt);
      if (attempt.id !== id) throw new Error('Directory reservation identity changed.');
      return { status: 'reserved', attempt };
    },
    async recordPlayerDirectoryCapture(attempt: PlayerDirectoryAttempt, capture: PlayerDirectoryCapture,
      owner: AdministrationWriteFence): Promise<PlayerDirectoryWriteResult> {
      validatePlayerDirectoryAttempt(attempt);
      const serialized = JSON.stringify(capture);
      if (Buffer.byteLength(serialized, 'utf8') > PLAYER_DIRECTORY_STORE_MAX_BYTES) throw new Error('Directory storage envelope exceeds bound.');
      const rows = await client.query(`/* league-administration:record-player-directory */
        SELECT public.record_player_directory_capture($1::jsonb,$2::jsonb,$3::jsonb) AS result`,
      [JSON.stringify(attempt), serialized, fence(owner)]);
      if (rows.length !== 1) throw new Error('Missing directory acceptance result.');
      const result = object(rows[0].result);
      if (!['accepted', 'preserved', 'replayed'].includes(String(result.status)) || typeof result.reason !== 'string') throw new Error('Invalid directory result.');
      return { status: result.status as PlayerDirectoryWriteResult['status'], reason: result.reason,
        receiptId: uuid(result.receiptId), contentId: result.contentId === null ? null : uuid(result.contentId),
        acceptedVersionId: result.acceptedVersionId === null ? null : uuid(result.acceptedVersionId), generation: integer(result.generation) };
    },
    async readAcceptedPlayerDirectory(selection: PlayerDirectoryReadSelection = {}): Promise<PlayerDirectoryRead> {
      try {
        const limit = selection.limit ?? 100;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > PLAYER_DIRECTORY_PAGE_LIMIT
          || selection.afterPlayerId !== undefined && (selection.versionId === undefined || !isPlayerDirectoryNativeId(selection.afterPlayerId))
          || selection.playerIds !== undefined && (!Array.isArray(selection.playerIds) || selection.playerIds.length > PLAYER_DIRECTORY_PAGE_LIMIT
            || selection.playerIds.some(id => !isPlayerDirectoryNativeId(id)) || new Set(selection.playerIds).size !== selection.playerIds.length)
          || selection.afterPlayerId !== undefined && selection.playerIds !== undefined) return { status: 'unavailable', reason: 'invalid_directory_selection' };
        const rows = await client.query(PLAYER_DIRECTORY_READ_SQL, [selection.versionId === undefined ? null : uuid(selection.versionId),
          selection.afterPlayerId ?? null, selection.playerIds ?? null, limit + 1]);
        if (!rows.length) return { status: 'missing', latestAttempt: null };
        if (rows.length !== 1) throw new Error('Ambiguous directory head.');
        const row = rows[0]; const latestAttempt = latest(row.latest_attempt);
        if (row.version_id === null) return { status: 'missing', latestAttempt };
        const versionId = uuid(row.version_id); const rowCount = integer(row.row_count, 1);
        if (selection.versionId && versionId !== selection.versionId || rowCount > 100_000
          || typeof row.source_revision !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(row.source_revision)
          || !Array.isArray(row.native_rows) || row.native_rows.length > limit + 1
          || Buffer.byteLength(JSON.stringify(row.native_rows), 'utf8') > PLAYER_DIRECTORY_STORE_MAX_BYTES) throw new Error('Invalid directory version.');
        const sourceObservedAt = timestamp(row.source_observed_at);
        const sourceSlice = object(row.source_slice);
        const normalizedSlice = { ...sourceSlice, observedAt: timestamp(sourceSlice.observedAt) };
        if (compatibleRevision(normalizedSlice) !== compatibleRevision({ scope: 'all', endpoint: '/players/nfl', status: 'available',
          sourceRevision: row.source_revision, observedAt: sourceObservedAt, complete: true, rowCount, validRowCount: rowCount,
          invalidRowCount: 0, conflictRowCount: 0 })) throw new Error('Invalid directory source slice.');
        const nativeRows = row.native_rows.map(value => {
          const native = object(value) as PlayerDirectoryRow;
          if (!isPlayerDirectoryNativeId(native.externalPlayerId) || native.identityStatus !== 'valid'
            || compatibleRevision(native) !== compatibleRevision(normalizePlayerDirectoryRow(native.externalPlayerId, native.source))) throw new Error('Invalid stored native parity.');
          return native;
        });
        for (let index = 0; index < nativeRows.length; index++) {
          const id = nativeRows[index].externalPlayerId;
          if (index > 0 && Buffer.compare(Buffer.from(nativeRows[index - 1].externalPlayerId), Buffer.from(id)) >= 0
            || selection.afterPlayerId !== undefined && Buffer.compare(Buffer.from(selection.afterPlayerId), Buffer.from(id)) >= 0
            || selection.playerIds !== undefined && !selection.playerIds.includes(id)) throw new Error('Invalid directory page.');
        }
        const page = nativeRows.slice(0, limit);
        return { status: 'available', provider: 'sleeper', sport: 'nfl', namespace: 'nfl:players', latestAttempt,
          version: { versionId, contentId: uuid(row.content_id), receiptId: uuid(row.receipt_id), attemptId: uuid(row.attempt_id),
            generation: integer(row.generation, 1), sourceRevision: row.source_revision,
            requestStartedAt: timestamp(row.request_started_at), requestCompletedAt: timestamp(row.request_completed_at), sourceObservedAt,
            acceptedAt: timestamp(row.accepted_at), rowCount, sourceSlices: [normalizedSlice as PlayerDirectorySourceSlice] },
          rows: page, nextCursor: nativeRows.length > limit ? page.at(-1)!.externalPlayerId : null };
      } catch { return { status: 'unavailable', reason: 'player_directory_evidence_unavailable' }; }
    },
  };
}

import type { JsonObject, JsonValue, SourceTransaction } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { isAdministrationSourceMapping } from '../league-administration/source-mapping';
import { isRetainedTransactionSelection, isTransactionCaptureId, RETAINED_TRANSACTION_INVENTORY_LIMIT,
  type TransactionCapture } from '../league-administration/transaction-capture-contracts';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { numberOrNull, transactionResult, transactionTimestamp, waiverBid, type SleeperTransaction } from '../transform';
import { transactionCalendarDay } from '../transaction-time';
import { TRANSACTION_ACTIVITY_VERSION, type ActivityFact, type ActivityParticipant, type TransactionActivityEvent,
  type TransactionActivityInput, type TransactionActivityPage, type TransactionActivityRequest,
  type TransactionWeekProjection } from './transaction-activity-contracts';
export * from './transaction-activity-contracts';

/** Timestamp comparisons preserve SQL microseconds and offset-equivalent instants. */
function instant(value: unknown): bigint | null {
  const match = typeof value === 'string'
    ? /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/u.exec(value) : null;
  if (!match) return null;
  const local = Date.parse(`${match[1]}Z`); const base = Date.parse(`${match[1]}${match[3]}`);
  return Number.isFinite(local) && Number.isFinite(base) && new Date(local).toISOString().slice(0, 19) === match[1]
    ? BigInt(base) * 1_000n + BigInt((match[2] ?? '').padEnd(6, '0')) : null;
}
export { instant as transactionActivityInstant };
function frozen<T>(value: T): T {
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  const copy = structuredClone(value); freeze(copy); return copy;
}
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}
function fact<T>(row: JsonObject | null, key: string, path: string, parse: (raw: JsonValue) => T | null): ActivityFact<T> {
  if (row === null) return { state: 'invalid', value: null, raw: null, sourcePath: path };
  if (!Object.hasOwn(row, key)) return { state: 'absent', value: null, raw: null, sourcePath: path };
  const raw = row[key]; const value = raw === null ? null : parse(raw);
  return { state: raw === null ? 'null' : value === null ? 'invalid' : 'known', value, raw, sourcePath: path };
}
const stringValue = (value: JsonValue) => typeof value === 'string' ? value : null;
const integerValue = (value: JsonValue) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const bidValue = (value: JsonValue) => {
  const number = numberOrNull(value);
  return number !== null && Number.isSafeInteger(number) && number >= 0 ? number : null;
};
function scopedId(capture: TransactionCapture, kind: string, nativeId: string): string {
  return JSON.stringify(['sleeper', capture.leagueSeasonId, capture.envelope.scope.externalLeagueId, kind, nativeId]);
}
function projectEvent(capture: TransactionCapture, row: JsonObject, source: SourceTransaction): TransactionActivityEvent {
  const teamIds = new Map(capture.seasonTeams.map(team => [team.externalRosterId, team.seasonTeamId]));
  const participant = (id: string): ActivityParticipant => ({ id: scopedId(capture, 'team', id), externalRosterId: id,
    seasonTeamId: teamIds.get(id) ?? null, mappingEvidence: !teamIds.has(id) ? 'unresolved' : capture.mapping ? 'captured' : 'unverified' });
  const nativeType = fact(row, 'type', 'type', stringValue); const nativeStatus = fact(row, 'status', 'status', stringValue);
  const created = fact(row, 'created', 'created', integerValue); const updated = fact(row, 'status_updated', 'status_updated', integerValue);
  const rosters = fact(row, 'roster_ids', 'roster_ids', () => source.externalRosterIds);
  const consenters = fact(row, 'consenter_ids', 'consenter_ids', () => source.consenterExternalRosterIds);
  const movements = (direction: 'add' | 'drop') => source.playerMovements.filter(move => move.direction === direction)
    .map(move => ({ player: { provider: 'sleeper' as const, nativeNamespace: 'nfl' as const, nativeId: move.externalPlayerId },
      direction, team: participant(move.externalRosterId) }));
  const adds = fact(row, 'adds', 'adds', () => movements('add')); const drops = fact(row, 'drops', 'drops', () => movements('drop'));
  const picks = fact(row, 'draft_picks', 'draft_picks', () => source.draftPickMovements.map(move => ({
    season: move.season, round: move.round, originalTeam: participant(move.originalExternalRosterId),
    from: participant(move.previousOwnerExternalRosterId), to: participant(move.ownerExternalRosterId) })));
  const budget = fact(row, 'waiver_budget', 'waiver_budget', () => source.budgetMovements.map(move => ({
    from: participant(move.senderExternalRosterId), to: participant(move.receiverExternalRosterId), amount: move.amount, unit: 'FAAB' as const })));
  const settings = fact(row, 'settings', 'settings', object); const metadata = fact(row, 'metadata', 'metadata', object);
  // A missing parent means an absent nested field; null/invalid parents remain independently visible above.
  const settingsObject = settings.state === 'absent' ? {} : settings.value;
  const metadataObject = metadata.state === 'absent' ? {} : metadata.value;
  const bids = { settings: fact(settingsObject, 'waiver_bid', 'settings.waiver_bid', bidValue),
    direct: fact(row, 'waiver_bid', 'waiver_bid', bidValue), metadata: fact(metadataObject, 'waiver_bid', 'metadata.waiver_bid', bidValue) };
  const notes = { notes: fact(metadataObject, 'notes', 'metadata.notes', stringValue),
    note: fact(metadataObject, 'note', 'metadata.note', stringValue), reason: fact(metadataObject, 'reason', 'metadata.reason', stringValue),
    failure_reason: fact(metadataObject, 'failure_reason', 'metadata.failure_reason', stringValue) };
  const rosterValues = [...source.externalRosterIds, ...source.consenterExternalRosterIds,
    ...source.playerMovements.map(move => move.externalRosterId),
    ...source.draftPickMovements.flatMap(move => [move.previousOwnerExternalRosterId, move.ownerExternalRosterId]),
    ...source.budgetMovements.flatMap(move => [move.senderExternalRosterId, move.receiverExternalRosterId])];
  const participants = [...new Set(rosterValues)].sort().map(participant);
  const sourceRow: Record<string, unknown> = { transaction_id: source.externalTransactionId };
  for (const [key, value] of Object.entries({ type: nativeType, status: nativeStatus, created, status_updated: updated,
    roster_ids: rosters, consenter_ids: consenters, adds, drops, draft_picks: picks, waiver_budget: budget,
    settings, metadata, waiver_bid: bids.direct })) if (value.state !== 'absent') sourceRow[key] = value.raw;
  const extensions = Object.fromEntries(Object.entries(row).filter(([key]) => !Object.hasOwn(sourceRow, key)));
  // Object spread creates own data properties even for a supplied __proto__ key.
  const compatibility = { sourceRow: { ...sourceRow, ...extensions } as unknown as SleeperTransaction };
  const timestamp = transactionTimestamp(compatibility.sourceRow);
  const supported = ['waiver', 'trade', 'free_agent', 'commissioner', 'ir', 'reversal'];
  return { id: scopedId(capture, 'transaction', source.externalTransactionId), externalTransactionId: source.externalTransactionId,
    leagueSeasonId: capture.leagueSeasonId, nativeType,
    type: source.type === 'waiver' || source.type === 'trade' || source.type === 'free_agent' ? source.type : source.type ? 'other' : 'unknown',
    typeSupport: !source.type ? 'unknown' : supported.includes(source.type) ? 'supported' : 'unsupported', nativeStatus,
    result: transactionResult(compatibility.sourceRow), createdAtMilliseconds: created, statusUpdatedAtMilliseconds: updated,
    timestamp: timestamp ? new Date(timestamp).toISOString() : null, calendarDay: transactionCalendarDay(timestamp),
    participants, rosterIds: rosters, consenterIds: consenters, adds, drops, picks, budget,
    claim: { eligible: source.type === 'waiver', visibility: 'supplied-only', losingClaimInventory: 'unknown',
      bid: waiverBid(compatibility.sourceRow), unit: 'FAAB', policy: 'settings-root-metadata-v1', bids, notes }, settings, metadata,
    nativeExtensions: { provider: 'sleeper', value: extensions },
    evidence: { captureId: capture.captureId, observationId: capture.observationId, contentId: capture.contentId, week: capture.week,
      sourceMappingRevisionId: capture.mapping?.revisionId ?? null, provenance: capture.envelope.provenance },
    limitations: [...(!capture.mapping ? ['mapping_revision_not_captured'] : []),
      ...(participants.some(team => team.mappingEvidence === 'unresolved') ? ['participant_mapping_missing'] : []),
      ...(!timestamp ? ['event_time_unknown'] : []), ...(!source.type || !supported.includes(source.type) ? ['transaction_type_unsupported'] : [])],
    compatibility };
}

/** Optional projection through the existing normalizer. No new acquisition, writer or v1 hash. */
export function projectTransactionCapture(capture: TransactionCapture): TransactionWeekProjection {
  try {
    const { envelope, receipt, mapping } = capture;
    if (!isTransactionCaptureId(capture.leagueSeasonId) || !isTransactionCaptureId(capture.captureId)
      || !isTransactionCaptureId(capture.observationId) || !isTransactionCaptureId(capture.contentId)
      || envelope.family !== 'transactions' || envelope.week !== capture.week
      || !Number.isInteger(capture.week) || capture.week < 0 || capture.week > 18
      || !['receipt', 'original-observation'].includes(capture.captureKind)
      || capture.captureKind === 'receipt' && capture.captureId !== receipt?.id
      || capture.captureKind === 'original-observation' && capture.captureId !== capture.observationId) throw new Error('scope');
    const provenance = envelope.provenance;
    const times = [provenance.requestStartedAt, provenance.requestCompletedAt, provenance.sourceObservedAt, provenance.checkedAt];
    const started = instant(provenance.requestStartedAt); const completed = instant(provenance.requestCompletedAt);
    const observed = instant(provenance.sourceObservedAt); const checked = instant(provenance.checkedAt);
    if (times.some(time => time !== null && instant(time) === null) || instant(capture.recordedAt) === null
      || checked === null || (started === null) !== (completed === null)
      || started !== null && completed !== null && (started > completed || completed > checked)
      || observed !== null && observed > checked
      || provenance.origin === 'network' && (started === null || completed === null || observed === null)
      || instant(capture.orderingAt) !== instant(provenance.sourceObservedAt ?? provenance.requestCompletedAt ?? provenance.checkedAt)) throw new Error('time');
    if ((mapping === null) !== (receipt === null)) throw new Error('mapping');
    if (mapping && (!isAdministrationSourceMapping(mapping) || mapping.leagueSeasonId !== capture.leagueSeasonId
      || compatibleRevision(mapping.scope) !== compatibleRevision(envelope.scope))) throw new Error('mapping');
    if (receipt && (!isTransactionCaptureId(receipt.id) || !isTransactionCaptureId(receipt.attemptId)
      || !Number.isSafeInteger(receipt.ordinal) || receipt.ordinal < 1 || !Number.isSafeInteger(receipt.expectedGeneration)
      || receipt.expectedGeneration < 0 || provenance.origin !== 'network' || receipt.provenance.origin !== 'network'
      || (['requestStartedAt', 'requestCompletedAt', 'sourceObservedAt', 'checkedAt'] as const)
        .some(key => instant(receipt.provenance[key]) === null || instant(receipt.provenance[key]) !== instant(provenance[key])))) throw new Error('receipt');
    if (receipt) {
      const coverage = receipt.coverage;
      if (receipt.acceptedGeneration !== null && (!Number.isSafeInteger(receipt.acceptedGeneration) || receipt.acceptedGeneration < 1)
        || receipt.acceptedGeneration !== null && receipt.acceptedGeneration !== receipt.expectedGeneration + 1
        || !coverage || compatibleRevision(coverage.periodIds) !== compatibleRevision([`sleeper:transaction-week:${capture.week}`])
        || coverage.interval !== null || coverage.nextCursor !== null || coverage.pagination !== 'complete'
        || coverage.entitySet !== (envelope.completeness === 'complete' ? 'full' : 'unknown')
        || compatibleRevision(coverage.fields) !== compatibleRevision(['transaction_id'])
        || coverage.completeness !== envelope.completeness || !Array.isArray(coverage.reasons)) throw new Error('coverage');
    }
    if (!Array.isArray(capture.seasonTeams) || new Set(capture.seasonTeams.map(team => team.seasonTeamId)).size !== capture.seasonTeams.length
      || new Set(capture.seasonTeams.map(team => team.externalRosterId)).size !== capture.seasonTeams.length
      || capture.seasonTeams.some(team => !isTransactionCaptureId(team.seasonTeamId) || !/^[1-9]\d*$/u.test(team.externalRosterId)
        || !Number.isSafeInteger(Number(team.externalRosterId)))) throw new Error('teams');
    const normalized = normalizeAdministrationObservation(envelope);
    if (normalized.contentHash !== capture.contentHash || normalized.semanticHash !== capture.semanticHash
      || compatibleRevision(normalized.value) !== compatibleRevision(capture.normalizedValue)) return { status: 'unavailable', reason: 'transaction_capture_hash_or_value_mismatch' };
    if (capture.accepted !== (normalized.status === 'accepted' && envelope.completeness === 'complete')
      || normalized.status !== 'accepted' || normalized.value?.family !== 'transactions'
      || !Array.isArray(envelope.payload)) return { status: 'unavailable', reason: 'transaction_capture_invalid' };
    const value = normalized.value;
    const events = envelope.payload.map((raw, index) => projectEvent(capture, raw as JsonObject, value.transactions[index]));
    return frozen({ status: 'available', version: TRANSACTION_ACTIVITY_VERSION, captureId: capture.captureId,
      leagueSeasonId: capture.leagueSeasonId, scope: envelope.scope, week: capture.week, source: provenance,
      mappingEvidence: mapping ? 'captured' : 'unverified', sourceCompleteness: envelope.completeness, events,
      limitations: [...(!mapping ? ['mapping_revision_not_captured'] : []), 'losing_claim_inventory_unknown', 'current_waiver_state_requires_b2'],
      compatibility: { sourceRows: envelope.payload as unknown as SleeperTransaction[] } });
  } catch { return { status: 'unavailable', reason: 'transaction_capture_evidence_invalid' }; }
}

/** Frozen bounded input selection: new source observations require a new revision/cursor. */
export function buildTransactionActivity(input: TransactionActivityInput, request: TransactionActivityRequest = {}): TransactionActivityPage {
  try {
    const { selection } = input; const limit = request.limit ?? 25;
    const window = input.window ?? { from: null, to: null }; const from = instant(window.from); const to = instant(window.to);
    if (!isRetainedTransactionSelection(selection) || !Array.isArray(input.captures)
      || input.captures.length > RETAINED_TRANSACTION_INVENTORY_LIMIT || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || window.from !== null && from === null || window.to !== null && to === null || from !== null && to !== null && from >= to
      || request.teamId !== undefined && !isTransactionCaptureId(request.teamId)
      || request.types !== undefined && (!Array.isArray(request.types) || request.types.length > 20
        || request.types.some(type => typeof type !== 'string' || !type || type.trim() !== type))) throw new Error('selection');
    const captures = [...input.captures].sort((a, b) => a.captureId.localeCompare(b.captureId));
    if (new Set(captures.map(capture => capture.captureId)).size !== captures.length
      || captures.some(capture => capture.leagueSeasonId !== selection.leagueSeasonId || !selection.nativeWeeks.includes(capture.week)
        || compatibleRevision(capture.envelope.scope) !== compatibleRevision(selection.scope))) throw new Error('scope');
    const failures = [...(input.failures ?? [])].sort((a, b) => a.week - b.week || a.checkedAt.localeCompare(b.checkedAt));
    if (failures.length > 1_000 || failures.some(failure => !selection.nativeWeeks.includes(failure.week)
      || instant(failure.checkedAt) === null || typeof failure.reason !== 'string' || !failure.reason)) throw new Error('failures');
    const types = request.types ? [...new Set(request.types)].sort() : null;
    const revision = compatibleRevision({ version: TRANSACTION_ACTIVITY_VERSION, selection, captures, failures, window,
      teamId: request.teamId ?? null, types });
    let offset = 0;
    if (request.cursor) {
      const [cursorRevision, cursorOffset, extra] = request.cursor.split('.');
      if (extra !== undefined || cursorRevision !== revision || !/^(0|[1-9]\d*)$/u.test(cursorOffset)) throw new Error('cursor');
      offset = Number(cursorOffset); if (!Number.isSafeInteger(offset)) throw new Error('cursor');
    }
    const projections = new Map(captures.map(capture => [capture.captureId, projectTransactionCapture(capture)]));
    type Week = Extract<TransactionActivityPage, { status: 'available' }>['sourceCoverage']['weeks'][number];
    const selected: TransactionActivityEvent[] = []; const sourceRows: SleeperTransaction[] = [];
    const weeks: Week[] = selection.nativeWeeks.map(week => {
      const rows = captures.filter(capture => capture.week === week).sort((a, b) => {
        const left = instant(a.orderingAt); const right = instant(b.orderingAt);
        if (left === null || right === null) throw new Error('ordering');
        return left === right ? a.captureId.localeCompare(b.captureId) : left > right ? -1 : 1;
      });
      const latest = rows[0]; const latestProjection = latest ? projections.get(latest.captureId)! : null;
      const failure = failures.filter(item => item.week === week).sort((a, b) => instant(a.checkedAt)! > instant(b.checkedAt)! ? -1 : 1)[0];
      const latestFailed = failure && (!latest || instant(failure.checkedAt)! >= instant(latest.envelope.provenance.checkedAt)!);
      const complete = rows.find(capture => { const result = projections.get(capture.captureId)!;
        return result.status === 'available' && result.sourceCompleteness === 'complete'; });
      const candidate = complete ?? rows.find(capture => projections.get(capture.captureId)!.status === 'available');
      const equalTimeConflict = candidate && rows.some(row => instant(row.orderingAt) === instant(candidate.orderingAt)
        // Match the existing writer's conservative equal-time/raw-content conflict policy.
        && (row.contentHash !== candidate.contentHash || compatibleRevision(row.mapping) !== compatibleRevision(candidate.mapping))
        && projections.get(row.captureId)!.status === 'available');
      const state: Week['state'] = equalTimeConflict ? 'conflict' : latestFailed ? 'failed' : !latest ? 'missing'
        : latestProjection?.status === 'unavailable' ? 'invalid' : latestProjection?.sourceCompleteness === 'partial' ? 'partial' : 'complete';
      if (candidate && !equalTimeConflict) {
        const result = projections.get(candidate.captureId)!;
        if (result.status === 'available') { selected.push(...result.events); sourceRows.push(...result.compatibility.sourceRows); }
      }
      return { week, state, selectedCaptureId: equalTimeConflict ? null : candidate?.captureId ?? null,
        latestCaptureId: latest?.captureId ?? null, lastGood: !!candidate && (candidate !== latest || !!latestFailed),
        reasons: state === 'complete' ? [] : [state === 'failed' ? `latest_attempt_failed:${failure.reason}` : `transaction_week_${state}`] };
    });
    if (selected.length > 20_000) return { status: 'unavailable', reason: 'transaction_activity_event_limit_exceeded' };
    const byId = new Map<string, TransactionActivityEvent[]>();
    for (const event of selected) byId.set(event.id, [...(byId.get(event.id) ?? []), event]);
    const conflicts: Extract<TransactionActivityPage, { status: 'available' }>['conflicts'][number][] = [];
    const events: TransactionActivityEvent[] = [];
    for (const copies of byId.values()) {
      copies.sort((a, b) => transactionTimestamp(b.compatibility.sourceRow) - transactionTimestamp(a.compatibility.sourceRow)
        || a.evidence.captureId.localeCompare(b.evidence.captureId));
      const newest = copies[0]; const ties = copies.filter(copy => copy.timestamp === newest.timestamp);
      if (new Set(ties.map(copy => compatibleRevision(copy.compatibility.sourceRow))).size > 1) {
        conflicts.push({ eventId: newest.id, captureIds: ties.map(copy => copy.evidence.captureId).sort(), reason: 'equal_time_event_conflict' });
      } else events.push(newest);
    }
    const filtered = events.filter(event => (!request.teamId || event.participants.some(team => team.seasonTeamId === request.teamId))
      && (!types || types.includes(event.nativeType.value ?? '')));
    const unknownTimestampEvents = from !== null || to !== null ? filtered.filter(event => event.timestamp === null).length : 0;
    const inWindow = filtered.filter(event => {
      if (from === null && to === null) return true;
      const time = instant(event.timestamp); return time !== null && (from === null || time >= from) && (to === null || time < to);
    }).sort((a, b) => transactionTimestamp(b.compatibility.sourceRow) - transactionTimestamp(a.compatibility.sourceRow)
      || b.externalTransactionId.localeCompare(a.externalTransactionId));
    if (offset > inWindow.length) throw new Error('cursor');
    const page = inWindow.slice(offset, offset + limit); const next = offset + page.length;
    return frozen({ status: 'available', version: TRANSACTION_ACTIVITY_VERSION, revision, selection, window, events: page,
      sourceCoverage: { completeness: weeks.every(week => week.state === 'complete') ? 'complete'
        : weeks.some(week => week.selectedCaptureId !== null) ? 'partial' : 'unknown', weeks },
      windowCoverage: { completeness: unknownTimestampEvents || conflicts.length ? 'partial' : 'complete', unknownTimestampEvents },
      pagination: { state: next < inWindow.length ? 'more' : 'complete', nextCursor: next < inWindow.length ? `${revision}.${next}` : null,
        total: inWindow.length, limit }, claimVisibility: { visibility: 'supplied-only', losingClaimInventory: 'unknown' }, conflicts,
      limitations: [...new Set(selected.flatMap(event => event.limitations)), 'losing_claim_inventory_unknown', 'current_waiver_state_requires_b2'],
      compatibility: { sourceRows, withheldEventIds: conflicts.map(conflict => conflict.eventId) } });
  } catch { return { status: 'unavailable', reason: 'transaction_activity_scope_or_cursor_invalid' }; }
}

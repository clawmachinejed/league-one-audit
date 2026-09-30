import { normalizeLeagueTransactions } from '../league-transactions';
import { isLeagueRouteKey, type LeagueRouteKey } from '../leagues';
import type { Team } from '../types';
import { dedupeTransactions, normalizeTransactions, transactionTimestamp, type PlayerCatalog, type SleeperTransaction } from '../transform';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { stableJson } from '../projections/shared/stable-json';
import {
  isRetainedTransactionSelection, RETAINED_TRANSACTION_BATCH_LIMIT, RETAINED_TRANSACTION_INVENTORY_LIMIT,
  type RetainedTransactionSelection, type TransactionCapture,
} from '../league-administration/transaction-capture-contracts';
import { buildTransactionActivity, projectTransactionCapture, transactionActivityInstant } from './transaction-activity';
import { TRANSACTION_ACTIVITY_VERSION, type TransactionActivityInput } from './transaction-activity-contracts';

export const TRANSACTION_COMPARISON_VERSION = 'transaction-activity-comparison-v1' as const;
const MANIFEST_VERSION = 'retained-transaction-comparison-v1' as const;
type Failure = Readonly<{ status: 'unavailable'; reason: string }>;
type DisplayObservation = Readonly<{ observationId: string | null; observedAt: string | null }>;

/** Display evidence is scoped and frozen independently; it never proves past names or NFL teams. */
export type TransactionDisplayInput = Readonly<{
  leagueSeasonId: string; leagueKey: LeagueRouteKey;
  teams: readonly Team[]; catalog: PlayerCatalog; managerRosterIds: readonly number[];
  teamsObservation: DisplayObservation; catalogObservation: DisplayObservation;
}>;
export type TransactionComparisonInput = Readonly<{ kind?: 'capture'; capture: TransactionCapture; display: TransactionDisplayInput }>
  | Readonly<{ kind: 'activity'; activity: TransactionActivityInput; display: TransactionDisplayInput }>;
type Entry = Readonly<{ entryId: string; inputHash: string; input: TransactionComparisonInput }>;
export type TransactionComparisonManifest = Readonly<{
  version: typeof MANIFEST_VERSION; comparisonVersion: typeof TRANSACTION_COMPARISON_VERSION;
  transformationVersion: string; selection: RetainedTransactionSelection;
  entries: readonly Entry[]; id: string;
}>;
export type TransactionComparisonCursor = Readonly<{ manifestId: string; nextIndex: number }>;

const fail = (reason: string): Failure => ({ status: 'unavailable', reason });
const same = (left: unknown, right: unknown) => stableJson(left) === stableJson(right);
// Source map order can affect legacy asset display and the v1 normalized movement array.
// Hash the exact serialized artifact, not a key-sorted substitute for those frozen inputs.
const artifactRevision = (value: unknown) => compatibleRevision(JSON.stringify(value));

/** Strict JSON copying refuses values whose meaning would change across a serialized restart. */
function retained<T>(value: T): T {
  const check = (item: unknown): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) { for (const child of item) check(child); return; }
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      Object.values(item).forEach(check); return;
    }
    throw new Error('Retained comparison requires exact JSON values.');
  };
  check(value);
  const copy: T = JSON.parse(JSON.stringify(value));
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(copy);
  return copy;
}

function validDisplay(display: TransactionDisplayInput, leagueSeasonId: string, leagueKey: string): boolean {
  const observation = (value: DisplayObservation): boolean => !!value
    && (value.observationId === null || typeof value.observationId === 'string' && value.observationId.trim().length > 0)
    && (value.observedAt === null || typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)));
  return !!display && display.leagueSeasonId === leagueSeasonId
    && isLeagueRouteKey(display.leagueKey) && display.leagueKey === leagueKey
    && Array.isArray(display.teams) && display.teams.length <= 1_000
    && display.teams.every(team => Number.isSafeInteger(team.id) && team.id > 0 && typeof team.name === 'string')
    && new Set(display.teams.map(team => team.id)).size === display.teams.length
    && Array.isArray(display.managerRosterIds) && display.managerRosterIds.length <= 1_000
    && display.managerRosterIds.every(id => Number.isSafeInteger(id) && id > 0)
    && new Set(display.managerRosterIds).size === display.managerRosterIds.length
    && !!display.catalog && typeof display.catalog === 'object' && !Array.isArray(display.catalog)
    && observation(display.teamsObservation) && observation(display.catalogObservation);
}

function present(rows: readonly SleeperTransaction[], display: TransactionDisplayInput) {
  const teams = [...display.teams];
  return {
    league: normalizeLeagueTransactions([...rows], display.leagueKey, teams, display.catalog),
    managers: [...display.managerRosterIds].sort((a, b) => a - b).map(rosterId => ({ rosterId,
      transactions: normalizeTransactions([...rows], rosterId, teams, display.catalog) })),
  };
}

/**
 * Same captured response through the old presenter and the typed projector's compatibility rows.
 * This deliberately reuses the released formatters, including their different pending behavior.
 * Equality covers presentation only; mapping proof, historical display applicability and source
 * completeness remain separate evidence in the result.
 */
export function compareTransactionCapture(capture: TransactionCapture, display: TransactionDisplayInput) {
  try {
    if (!validDisplay(display, capture.leagueSeasonId, capture.envelope.scope.leagueKey)) return fail('transaction_display_scope_or_evidence_invalid');
    const projection = projectTransactionCapture(capture);
    if (projection.status !== 'available') return fail(projection.reason);
    const legacy = present(projection.compatibility.sourceRows, display);
    const proposed = present(projection.events.map(event => event.compatibility.sourceRow), display);
    const fields: string[] = [];
    if (!same(legacy.league, proposed.league)) fields.push('league');
    for (let index = 0; index < legacy.managers.length; index++) {
      if (!same(legacy.managers[index], proposed.managers[index])) fields.push(`manager:${legacy.managers[index].rosterId}`);
    }
    return retained({ status: 'available' as const, version: TRANSACTION_COMPARISON_VERSION,
      transformationVersion: projection.version, captureId: capture.captureId,
      comparison: { status: fields.length ? 'different' as const : 'equal' as const, fields },
      source: { observationId: capture.observationId, contentId: capture.contentId,
        contentHash: capture.contentHash, semanticHash: capture.semanticHash,
        provenance: capture.envelope.provenance, orderingAt: capture.orderingAt, recordedAt: capture.recordedAt },
      mappingEvidence: projection.mappingEvidence, mapping: capture.mapping,
      sourceCompleteness: projection.sourceCompleteness, limitations: projection.limitations,
      display: { temporalContext: 'current-display' as const, historicalApplicability: 'unverified' as const,
        teamsObservation: display.teamsObservation, catalogObservation: display.catalogObservation,
        inputHash: compatibleRevision(display) },
      legacy, proposed,
    });
  } catch { return fail('transaction_comparison_input_invalid'); }
}

/** Compare the same selected weekly captures, separately from output page boundaries. */
export function compareTransactionActivity(input: TransactionActivityInput, display: TransactionDisplayInput) {
  try {
    if (!validDisplay(display, input.selection.leagueSeasonId, input.selection.scope.leagueKey)) {
      return fail('transaction_display_scope_or_evidence_invalid');
    }
    const frozen = retained(input);
    const first = buildTransactionActivity(frozen, { limit: RETAINED_TRANSACTION_BATCH_LIMIT });
    if (first.status !== 'available') return fail(first.reason);
    const events = [...first.events];
    let nextCursor = first.pagination.nextCursor;
    for (let pages = 1; nextCursor !== null; pages++) {
      if (pages >= 200) return fail('transaction_comparison_page_limit');
      const page = buildTransactionActivity(frozen, { limit: RETAINED_TRANSACTION_BATCH_LIMIT, cursor: nextCursor });
      if (page.status !== 'available' || page.revision !== first.revision) return fail('transaction_comparison_page_changed');
      events.push(...page.events); nextCursor = page.pagination.nextCursor;
    }
    const rows = dedupeTransactions([...first.compatibility.sourceRows]).filter(row => {
      if (first.window.from === null && first.window.to === null) return true;
      const timestamp = transactionTimestamp(row);
      const exact = timestamp > 0 ? transactionActivityInstant(new Date(timestamp).toISOString()) : null;
      return exact !== null && (first.window.from === null || exact >= transactionActivityInstant(first.window.from)!)
        && (first.window.to === null || exact < transactionActivityInstant(first.window.to)!);
    });
    const selectedIds = new Set(first.sourceCoverage.weeks.map(week => week.selectedCaptureId));
    const withheldIds = new Set(first.compatibility.withheldEventIds);
    const withheldSourceIds = new Set<string>();
    for (const capture of frozen.captures.filter(item => selectedIds.has(item.captureId))) {
      const projection = projectTransactionCapture(capture);
      if (projection.status !== 'available') return fail('transaction_comparison_selected_capture_changed');
      for (const event of projection.events) if (withheldIds.has(event.id)) withheldSourceIds.add(event.externalTransactionId);
    }
    const legacy = present(rows, display);
    const proposed = present(events.map(event => event.compatibility.sourceRow), display);
    const explained = present(rows.filter(row => !withheldSourceIds.has(row.transaction_id)), display);
    const fields: string[] = [];
    if (!same(legacy.league, proposed.league)) fields.push('league');
    for (let index = 0; index < legacy.managers.length; index++) {
      if (!same(legacy.managers[index], proposed.managers[index])) fields.push(`manager:${legacy.managers[index].rosterId}`);
    }
    return retained({ status: 'available' as const, version: TRANSACTION_COMPARISON_VERSION,
      transformationVersion: first.version, revision: first.revision,
      comparison: { status: !fields.length ? 'equal' as const : same(explained, proposed) ? 'explained-difference' as const : 'different' as const,
        fields, explanations: first.conflicts.map(conflict => ({ ...conflict,
          behavior: 'The legacy presenter selects the last equal-time copy; the internal activity resource withholds conflicting evidence.' })) },
      sourceCoverage: first.sourceCoverage, windowCoverage: first.windowCoverage, claimVisibility: first.claimVisibility,
      display: { temporalContext: 'current-display' as const, historicalApplicability: 'unverified' as const,
        teamsObservation: display.teamsObservation, catalogObservation: display.catalogObservation,
        inputHash: compatibleRevision(display) },
      outputPagination: { complete: true as const, count: events.length }, legacy, proposed,
    });
  } catch { return fail('transaction_comparison_input_invalid'); }
}

function inSelection(selection: RetainedTransactionSelection, capture: TransactionCapture): boolean {
  return capture.leagueSeasonId === selection.leagueSeasonId && same(capture.envelope.scope, selection.scope)
    && selection.nativeWeeks.includes(capture.week);
}

function inputInSelection(selection: RetainedTransactionSelection, input: TransactionComparisonInput): boolean {
  return input.kind === 'activity' ? same(selection, input.activity.selection) : inSelection(selection, input.capture);
}
function entryIdentity(input: TransactionComparisonInput): string {
  return input.kind === 'activity' ? `activity:${compatibleRevision(input.activity)}` : `capture:${input.capture.captureId}`;
}
function compareInput(input: TransactionComparisonInput) {
  return input.kind === 'activity' ? compareTransactionActivity(input.activity, input.display)
    : compareTransactionCapture(input.capture, input.display);
}

/** No scan, fetch, database writes or accepted-head movement: only explicitly supplied captures. */
export function createTransactionActivityManifest(selection: RetainedTransactionSelection,
  inputs: readonly TransactionComparisonInput[]): Readonly<{ status: 'available'; manifest: TransactionComparisonManifest }> | Failure {
  try {
    if (!isRetainedTransactionSelection(selection) || !Array.isArray(inputs) || !inputs.length
      || inputs.length > RETAINED_TRANSACTION_INVENTORY_LIMIT) return fail('invalid_transaction_comparison_inventory');
    if (inputs.reduce((count, input) => count + (input.kind === 'activity' ? input.activity.captures.length : 1), 0)
      > RETAINED_TRANSACTION_INVENTORY_LIMIT) return fail('invalid_transaction_comparison_inventory');
    const entries: Entry[] = [];
    let transformationVersion: string | null = null;
    for (const source of inputs) {
      const input = retained(source);
      if (!inputInSelection(selection, input)) return fail('transaction_comparison_scope_mismatch');
      const result = compareInput(input);
      if (result.status !== 'available') return fail(result.reason);
      transformationVersion ??= result.transformationVersion;
      if (transformationVersion !== result.transformationVersion) return fail('transaction_comparison_version_mismatch');
      entries.push({ entryId: entryIdentity(input), inputHash: artifactRevision(input), input });
    }
    entries.sort((a, b) => a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0);
    if (new Set(entries.map(entry => entry.entryId)).size !== entries.length) return fail('duplicate_transaction_comparison_capture');
    const body = retained({ version: MANIFEST_VERSION, comparisonVersion: TRANSACTION_COMPARISON_VERSION,
      transformationVersion: transformationVersion!, selection, entries });
    return { status: 'available', manifest: retained({ ...body, id: artifactRevision(body) }) };
  } catch { return fail('invalid_transaction_comparison_inventory'); }
}

/** Serialized restart/retry is deterministic; this is not a database-persisted replay checkpoint. */
export function compareTransactionActivityBatch(manifest: TransactionComparisonManifest,
  cursor: TransactionComparisonCursor = { manifestId: manifest.id, nextIndex: 0 }, batchSize = 25) {
  try {
    if (manifest.version !== MANIFEST_VERSION || manifest.comparisonVersion !== TRANSACTION_COMPARISON_VERSION
      || manifest.transformationVersion !== TRANSACTION_ACTIVITY_VERSION
      || !isRetainedTransactionSelection(manifest.selection) || !Array.isArray(manifest.entries)
      || !manifest.entries.length || manifest.entries.length > RETAINED_TRANSACTION_INVENTORY_LIMIT) {
      return fail('invalid_transaction_comparison_manifest');
    }
    if (manifest.entries.reduce((count, entry) => count + (entry.input.kind === 'activity' ? entry.input.activity.captures.length : 1), 0)
      > RETAINED_TRANSACTION_INVENTORY_LIMIT) return fail('invalid_transaction_comparison_manifest');
    // Reject lossy non-JSON mutations before compatibleRevision's legacy null policy can mask them.
    retained(manifest);
    const { id, ...body } = manifest;
    if (id !== artifactRevision(body)) return fail('transaction_comparison_manifest_changed');
    if (cursor.manifestId !== id || !Number.isSafeInteger(cursor.nextIndex) || cursor.nextIndex < 0
      || cursor.nextIndex > manifest.entries.length || !Number.isSafeInteger(batchSize) || batchSize < 1
      || batchSize > RETAINED_TRANSACTION_BATCH_LIMIT) return fail('invalid_transaction_comparison_cursor_or_batch');
    for (const [index, entry] of manifest.entries.entries()) {
      if (entry.entryId !== entryIdentity(entry.input) || entry.inputHash !== artifactRevision(entry.input)
        || !inputInSelection(manifest.selection, entry.input)
        || index > 0 && manifest.entries[index - 1].entryId >= entry.entryId) return fail('transaction_comparison_evidence_changed');
    }
    const entries = [];
    for (let index = cursor.nextIndex; index < Math.min(manifest.entries.length, cursor.nextIndex + batchSize); index++) {
      const entry = manifest.entries[index];
      const result = compareInput(entry.input);
      if (result.status !== 'available') return fail(result.reason);
      if (result.transformationVersion !== manifest.transformationVersion) return fail('transaction_comparison_version_mismatch');
      entries.push({ index, entryId: entry.entryId, inputHash: entry.inputHash, result, resultHash: compatibleRevision(result) });
    }
    const nextIndex = cursor.nextIndex + entries.length;
    return retained({ status: nextIndex === manifest.entries.length ? 'complete' as const : 'more' as const,
      manifestId: id, entries, cursor: { manifestId: id, nextIndex },
      processing: 'read-only-comparison' as const, durableReplay: false as const });
  } catch { return fail('invalid_transaction_comparison_manifest'); }
}

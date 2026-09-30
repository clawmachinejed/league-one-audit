import 'server-only';

import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { projectRetainedMatchups, RETAINED_MATCHUPS_TRANSFORMATION_VERSION } from '../aggregator/retained-matchups';
import type { LeagueAdministrationStore } from './store-contracts';
import {
  isRetainedMatchupId, isRetainedMatchupSelection, RETAINED_MATCHUP_BATCH_LIMIT,
  RETAINED_MATCHUP_INVENTORY_LIMIT, RETAINED_MATCHUP_MAPPING_LIMIT, type RetainedMatchupEvidence, type RetainedMatchupSelection,
} from './retained-matchups-contracts';

export const RETAINED_MATCHUP_MANIFEST_VERSION = 'retained-matchup-comparison-v1';
export const RETAINED_MATCHUP_SELECTION_VERSION = 'explicit-scope-ordering-at-observation-id-v1';

export type RetainedMatchupManifestEntry = Readonly<{
  observationId: string; contentId: string; orderingAt: string;
  mappingRevisionId: string | null;
  mappingEvidence: readonly Readonly<{ kind: 'matchup-receipt' | 'calculation-input'; id: string; revisionId: string | null }>[];
  expectedRawHash: string | null; expectedLegacySemanticHash: string | null;
  expectedLegacyValueHash: string; expectedEvidenceHash: string;
}>;
export type RetainedMatchupManifest = Readonly<{
  version: typeof RETAINED_MATCHUP_MANIFEST_VERSION;
  selectionVersion: typeof RETAINED_MATCHUP_SELECTION_VERSION;
  transformationVersion: typeof RETAINED_MATCHUPS_TRANSFORMATION_VERSION;
  selection: RetainedMatchupSelection; entries: readonly RetainedMatchupManifestEntry[];
  /** Digest of the entire versioned manifest body, including its fixed input order. */
  id: string;
}>;
export type RetainedMatchupCursor = Readonly<{ manifestId: string; nextIndex: number }>;
type Failure = Readonly<{ status: 'unavailable' | 'disabled'; reason: string }>;
export type RetainedMatchupComparisonEntry = Readonly<{
  index: number; observationId: string; contentId: string;
  result: ReturnType<typeof projectRetainedMatchups> | Readonly<{ status: 'rejected'; reason: string }>;
  projectionSemanticHash: string | null;
  /** Includes original source lineage and limitations as well as semantic values. */
  resultHash: string;
}>;
export type RetainedMatchupBatch = Readonly<{
  status: 'complete' | 'more'; manifestId: string; fromIndex: number;
  entries: readonly RetainedMatchupComparisonEntry[]; cursor: RetainedMatchupCursor;
}>;
type Reads = Pick<LeagueAdministrationStore, 'scanRetainedMatchups' | 'readRetainedMatchups'>;

function immutable<T>(value: T): T {
  const copy: T = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}
function compare(left: RetainedMatchupManifestEntry, right: RetainedMatchupManifestEntry): number {
  const key = (time: string) => time.replace(/\.(\d+)Z$/u, (_, fraction: string) => `.${fraction.padEnd(6, '0')}Z`);
  const leftTime = key(left.orderingAt); const rightTime = key(right.orderingAt);
  const time = leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0;
  return time || (left.observationId < right.observationId ? -1 : left.observationId > right.observationId ? 1 : 0);
}
function entry(evidence: RetainedMatchupEvidence): RetainedMatchupManifestEntry {
  const mappings = [...evidence.mappingCandidates].sort((left, right) => {
    const a = `${left.kind}:${left.id}`; const b = `${right.kind}:${right.id}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return {
    observationId: evidence.observation.id, contentId: evidence.observation.contentId,
    orderingAt: evidence.observation.orderingAt,
    mappingRevisionId: evidence.mapping?.revisionId ?? null,
    mappingEvidence: mappings.map(candidate => ({ kind: candidate.kind, id: candidate.id,
      revisionId: candidate.sourceMapping?.revisionId ?? candidate.revision?.id ?? null })),
    expectedRawHash: evidence.content?.contentHash ?? null,
    expectedLegacySemanticHash: evidence.content?.semanticHash ?? null,
    expectedLegacyValueHash: compatibleRevision(evidence.content?.normalizedValue ?? null),
    expectedEvidenceHash: compatibleRevision({ ...evidence, mappingCandidates: mappings }),
  };
}
function validEntries(entries: readonly RetainedMatchupManifestEntry[]): boolean {
  const hash = /^[0-9a-f]{64}$/u;
  return Array.isArray(entries) && entries.length <= RETAINED_MATCHUP_INVENTORY_LIMIT
    && new Set(entries.map(item => item.observationId)).size === entries.length
    && entries.every((item, index) => isRetainedMatchupId(item.observationId)
      && isRetainedMatchupId(item.contentId) && Number.isFinite(Date.parse(item.orderingAt))
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/u.test(item.orderingAt)
      && (item.mappingRevisionId === null || isRetainedMatchupId(item.mappingRevisionId))
      && Array.isArray(item.mappingEvidence) && item.mappingEvidence.length <= RETAINED_MATCHUP_MAPPING_LIMIT
      && item.mappingEvidence.every((ref: RetainedMatchupManifestEntry['mappingEvidence'][number], refIndex: number) => ['matchup-receipt', 'calculation-input'].includes(ref.kind)
        && isRetainedMatchupId(ref.id) && (ref.revisionId === null || isRetainedMatchupId(ref.revisionId))
        && (refIndex === 0 || `${item.mappingEvidence[refIndex - 1].kind}:${item.mappingEvidence[refIndex - 1].id}` < `${ref.kind}:${ref.id}`))
      && (item.expectedRawHash === null || hash.test(item.expectedRawHash))
      && (item.expectedLegacySemanticHash === null || hash.test(item.expectedLegacySemanticHash))
      && hash.test(item.expectedLegacyValueHash) && hash.test(item.expectedEvidenceHash)
      && (index === 0 || compare(entries[index - 1], item) < 0));
}
export function isRetainedMatchupManifest(manifest: RetainedMatchupManifest): boolean {
  try {
    if (manifest?.version !== RETAINED_MATCHUP_MANIFEST_VERSION
      || manifest.selectionVersion !== RETAINED_MATCHUP_SELECTION_VERSION
      || manifest.transformationVersion !== RETAINED_MATCHUPS_TRANSFORMATION_VERSION
      || !isRetainedMatchupSelection(manifest.selection) || !validEntries(manifest.entries)) return false;
    const { id, ...body } = manifest;
    return id === compatibleRevision(body);
  } catch { return false; }
}

/** Internal read-only service. It accepts no writer or provider capability and never allocates source IDs. */
export function createRetainedMatchupComparison(reads: Reads) {
  return {
    async createManifest(selection: RetainedMatchupSelection, signal?: AbortSignal): Promise<
      Readonly<{ status: 'available'; manifest: RetainedMatchupManifest }> | Failure
    > {
      if (!isRetainedMatchupSelection(selection)) return { status: 'unavailable', reason: 'invalid_retained_selection' };
      // Detach before the await: caller mutation cannot alter the selected source scope.
      const frozenSelection = immutable(selection);
      signal?.throwIfAborted();
      const scanned = await reads.scanRetainedMatchups(frozenSelection);
      signal?.throwIfAborted();
      if (scanned.status !== 'available') return scanned;
      if (scanned.evidence.length > RETAINED_MATCHUP_INVENTORY_LIMIT) {
        return { status: 'unavailable', reason: 'retained_inventory_limit_exceeded' };
      }
      let entries: RetainedMatchupManifestEntry[];
      try { entries = scanned.evidence.map(entry).sort(compare); }
      catch { return { status: 'unavailable', reason: 'invalid_retained_inventory' }; }
      if (!validEntries(entries)) return { status: 'unavailable', reason: 'invalid_retained_inventory' };
      const body = { version: RETAINED_MATCHUP_MANIFEST_VERSION, selectionVersion: RETAINED_MATCHUP_SELECTION_VERSION,
        transformationVersion: RETAINED_MATCHUPS_TRANSFORMATION_VERSION, selection: frozenSelection, entries } as const;
      return { status: 'available', manifest: immutable({ ...body, id: compatibleRevision(body) }) };
    },

    async compareBatch(input: Readonly<{
      manifest: RetainedMatchupManifest; cursor?: RetainedMatchupCursor; batchSize: number; signal?: AbortSignal;
    }>): Promise<RetainedMatchupBatch | Failure> {
      if (!isRetainedMatchupManifest(input.manifest)) return { status: 'unavailable', reason: 'invalid_retained_manifest' };
      const manifest = immutable(input.manifest);
      const cursor = input.cursor ?? { manifestId: manifest.id, nextIndex: 0 };
      if (cursor.manifestId !== manifest.id || !Number.isSafeInteger(cursor.nextIndex)
        || cursor.nextIndex < 0 || cursor.nextIndex > manifest.entries.length) {
        return { status: 'unavailable', reason: 'invalid_retained_cursor' };
      }
      if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > RETAINED_MATCHUP_BATCH_LIMIT) {
        return { status: 'unavailable', reason: 'invalid_retained_batch_size' };
      }
      const fromIndex = cursor.nextIndex;
      const selected = manifest.entries.slice(fromIndex, fromIndex + input.batchSize);
      input.signal?.throwIfAborted();
      // Completed cursors are idempotent and need no storage roundtrip.
      const read = selected.length ? await reads.readRetainedMatchups(manifest.selection, selected.map(item => item.observationId))
        : { status: 'available' as const, evidence: [] };
      input.signal?.throwIfAborted();
      if (read.status !== 'available') return read;
      const selectedIds = new Set(selected.map(item => item.observationId));
      let byId: Map<string, RetainedMatchupEvidence>;
      try { byId = new Map(read.evidence.map(item => [item.observation.id, item])); }
      catch { return { status: 'unavailable', reason: 'retained_batch_membership_mismatch' }; }
      if (byId.size !== read.evidence.length || read.evidence.some(item => !selectedIds.has(item.observation.id))) {
        return { status: 'unavailable', reason: 'retained_batch_membership_mismatch' };
      }
      const entries = selected.map((expected, offset): RetainedMatchupComparisonEntry => {
        const evidence = byId.get(expected.observationId);
        let result: RetainedMatchupComparisonEntry['result'];
        if (!evidence) result = { status: 'rejected', reason: 'retained_observation_missing' };
        else {
          try {
            // Association membership is frozen too. Later receipts for the same legacy
            // observation belong to a new manifest; a missing/changed frozen ref fails its hash.
            const refs = new Set(expected.mappingEvidence.map(ref => `${ref.kind}:${ref.id}`));
            const frozenEvidence = { ...evidence, mappingCandidates: evidence.mappingCandidates
              .filter(candidate => refs.has(`${candidate.kind}:${candidate.id}`)) };
            result = compatibleRevision(entry(frozenEvidence)) !== compatibleRevision(expected)
              ? { status: 'rejected', reason: 'retained_evidence_changed' }
              : projectRetainedMatchups(manifest.selection, frozenEvidence);
          } catch { result = { status: 'rejected', reason: 'retained_evidence_changed' }; }
        }
        return { index: fromIndex + offset, observationId: expected.observationId, contentId: expected.contentId,
          result, projectionSemanticHash: result.status === 'available' ? compatibleRevision(result.value) : null,
          resultHash: compatibleRevision(result) };
      });
      input.signal?.throwIfAborted();
      const nextIndex = fromIndex + selected.length;
      return immutable({ status: nextIndex === manifest.entries.length ? 'complete' : 'more', manifestId: manifest.id,
        fromIndex, entries, cursor: { manifestId: manifest.id, nextIndex } });
    },
  };
}

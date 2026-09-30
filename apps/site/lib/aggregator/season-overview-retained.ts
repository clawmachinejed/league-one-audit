import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { stableJson } from '../projections/shared/stable-json';
import { projectSeasonOverviewSource, SEASON_OVERVIEW_SOURCE_VERSION, type SeasonOverviewSourceInput } from './season-overview-source';

const VERSION = 'retained-season-overview-comparison-v1' as const;
const LIMIT = 1_000;
const BATCH_LIMIT = 100;
type Failure = Readonly<{ status: 'unavailable'; reason: string }>;
type Entry = Readonly<{ receiptId: string; inputHash: string; input: SeasonOverviewSourceInput }>;
export type SeasonOverviewManifest = Readonly<{
  version: typeof VERSION; transformationVersion: string;
  mapping: AdministrationSourceMapping; entries: readonly Entry[]; id: string;
}>;
export type SeasonOverviewCursor = Readonly<{ manifestId: string; nextIndex: number }>;

/** Copy through JSON: the retained artifact must survive process restart without object identity. */
function retained<T>(value: T): T {
  const copy: T = JSON.parse(stableJson(value));
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}
const fail = (reason: string): Failure => ({ status: 'unavailable', reason });

/**
 * Freeze exact already-captured roster evidence. This is a bounded comparison
 * artifact, not an accepted head, storage scanner, writer or durable replay job.
 * A current head cannot be substituted after the manifest has been created.
 */
export function createSeasonOverviewManifest(mapping: AdministrationSourceMapping,
  inputs: readonly SeasonOverviewSourceInput[]): Readonly<{ status: 'available'; manifest: SeasonOverviewManifest }> | Failure {
  try {
    if (!isAdministrationSourceMapping(mapping) || !Array.isArray(inputs) || !inputs.length || inputs.length > LIMIT) {
      return fail('invalid_season_overview_inventory');
    }
    const entries: Entry[] = [];
    let transformationVersion: string | null = null;
    for (const input of inputs) {
      if (compatibleRevision(input.mapping) !== compatibleRevision(mapping)) return fail('season_overview_mapping_mismatch');
      const result = projectSeasonOverviewSource(input);
      if (result.status !== 'available') return fail('season_overview_capture_unavailable');
      transformationVersion ??= result.version;
      if (result.version !== transformationVersion) return fail('season_overview_transformation_mismatch');
      entries.push({ receiptId: result.source.receiptId, inputHash: compatibleRevision(input), input });
    }
    entries.sort((a, b) => a.receiptId < b.receiptId ? -1 : a.receiptId > b.receiptId ? 1 : 0);
    if (new Set(entries.map(entry => entry.receiptId)).size !== entries.length) return fail('duplicate_season_overview_capture');
    const body = retained({ version: VERSION, transformationVersion: transformationVersion!, mapping, entries });
    return { status: 'available', manifest: retained({ ...body, id: compatibleRevision(body) }) };
  } catch { return fail('invalid_season_overview_inventory'); }
}

/** Repeat/restart with the same serialized manifest and cursor gives identical results. */
export function compareSeasonOverviewBatch(manifest: SeasonOverviewManifest,
  cursor: SeasonOverviewCursor = { manifestId: manifest.id, nextIndex: 0 }, batchSize = 25) {
  try {
    if (manifest.version !== VERSION || manifest.transformationVersion !== SEASON_OVERVIEW_SOURCE_VERSION
      || !isAdministrationSourceMapping(manifest.mapping)
      || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > LIMIT) {
      return fail('invalid_season_overview_manifest');
    }
    const { id, ...body } = manifest;
    if (id !== compatibleRevision(body)) return fail('season_overview_manifest_changed');
    if (cursor.manifestId !== id || !Number.isSafeInteger(cursor.nextIndex) || cursor.nextIndex < 0
      || cursor.nextIndex > manifest.entries.length || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > BATCH_LIMIT) {
      return fail('invalid_season_overview_cursor_or_batch');
    }
    if (manifest.entries.some((entry, index) => typeof entry.receiptId !== 'string'
      || entry.receiptId !== entry.input.receipt.id || entry.inputHash !== compatibleRevision(entry.input)
      || compatibleRevision(entry.input.mapping) !== compatibleRevision(manifest.mapping)
      || index > 0 && manifest.entries[index - 1].receiptId >= entry.receiptId)) return fail('season_overview_evidence_changed');
    const entries = manifest.entries.slice(cursor.nextIndex, cursor.nextIndex + batchSize).map((entry, offset) => {
      const result = projectSeasonOverviewSource(entry.input);
      return { index: cursor.nextIndex + offset, receiptId: entry.receiptId, inputHash: entry.inputHash,
        result, resultHash: compatibleRevision(result) };
    });
    const nextIndex = cursor.nextIndex + entries.length;
    return retained({ status: nextIndex === manifest.entries.length ? 'complete' as const : 'more' as const,
      manifestId: id, entries, cursor: { manifestId: id, nextIndex },
      processing: 'read-only-comparison' as const, durableReplay: false as const });
  } catch { return fail('invalid_season_overview_manifest'); }
}

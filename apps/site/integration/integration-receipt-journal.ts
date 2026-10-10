import { writeFile } from 'node:fs/promises';
import type { IntegrationRunReceipt } from './disposable-integration';

/** Append immutable snapshots: a slow/aborted older write cannot overwrite a
 * newer failure receipt. A missing or truncated latest snapshot never qualifies.
 * The caller reserves the unique base path before any provisioning attempt. */
export function createIntegrationReceiptJournal(basePath: string,
  write: typeof writeFile = writeFile) {
  let sequence = 0;
  let latestPath = basePath;
  return {
    get latestPath() { return latestPath; },
    async save(receipt: IntegrationRunReceipt, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      const receiptSequence = ++sequence;
      const path = `${basePath.slice(0, -5)}-${String(receiptSequence).padStart(4, '0')}.json`;
      // Serialize before the first await, never keep a mutable receipt reference.
      const snapshot = `${JSON.stringify({ ...receipt, receiptSequence }, null, 2)}\n`;
      await write(path, snapshot, { flag: 'wx', mode: 0o600, signal });
      signal.throwIfAborted();
      latestPath = path;
    },
  };
}

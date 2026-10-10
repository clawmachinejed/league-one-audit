// DATA acquisition resource limits, not Sleeper limits or a coverage guarantee.
// Bytes are the actual response.body bytes after fetch content decoding. Values
// count the parsed root, containers and scalar values (not object member names);
// the root has depth 1. Native JSON.parse has byte-bounded input; the subsequent
// iterative checks bound work entering the existing normalizers and capture seal.
export const PUBLIC_CAPTURE_LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxValues: 250_000, maxDepth: 64 });
export type SleeperResponseLimits = Readonly<{ maxBytes: number; maxValues: number; maxDepth: number }>;



function invalidDatabaseJsonText(value: string): boolean {
  return value.includes('\u0000') || /[\uD800-\uDFFF]/u.test(value);
}

function assertPublicCaptureStructure(payload: unknown, limits: SleeperResponseLimits, rejectNonFinite: boolean): void {
  const pending = [{ value: payload, depth: 1 }];
  let values = 1;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (rejectNonFinite && typeof value === 'number' && (!Number.isFinite(value)
      || Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Invalid DATA JSON number.');
    if (rejectNonFinite && typeof value === 'string' && invalidDatabaseJsonText(value)) throw new Error('Invalid DATA JSON Unicode.');
    if (value === null || typeof value !== 'object') continue;
    const keys = Array.isArray(value) ? null : Object.keys(value);
    if (rejectNonFinite && keys?.some(invalidDatabaseJsonText)) throw new Error('Invalid DATA JSON Unicode.');
    const children = keys ? keys.length : (value as unknown[]).length;
    // Count before pushing children so the traversal's own stack stays bounded.
    if (children > limits.maxValues - values) throw new Error('Public DATA response value limit exceeded.');
    if (children && depth >= limits.maxDepth) throw new Error('Public DATA response depth limit exceeded.');
    values += children;
    for (let index = 0; index < children; index++) {
      pending.push({ value: keys ? (value as Record<string, unknown>)[keys[index]] : (value as unknown[])[index], depth: depth + 1 });
    }
  }
}

export async function readBoundedSleeperJson(response: Response, signal: AbortSignal,
  limits: SleeperResponseLimits = PUBLIC_CAPTURE_LIMITS,
  options: Readonly<{ onRawJson?: (rawJson: string) => void; rejectNonFinite?: boolean }> = {}): Promise<{ payload: unknown; rawJson: string }> {
  const reader = response.body?.getReader();
  // Keep the existing JSON syntax failure for a successful response with no body.
  if (!reader) { signal.throwIfAborted(); return JSON.parse(''); }
  let ended = false, failure: unknown;
  // A single listener closes pending reads without retaining a promise reaction
  // per chunk. Stream cancellation settles reads before its source acknowledges.
  const onAbort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  let bytes = new Uint8Array(16 * 1024), length = 0;
  try {
    signal.throwIfAborted();
    signal.addEventListener('abort', onAbort, { once: true });
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) { ended = true; break; }
      if (chunk.value.byteLength > limits.maxBytes - length) throw new Error('Public DATA response byte limit exceeded.');
      const required = length + chunk.value.byteLength;
      if (required > bytes.byteLength) {
        const grown = new Uint8Array(Math.min(limits.maxBytes, Math.max(required, bytes.byteLength * 2)));
        grown.set(bytes.subarray(0, length));
        bytes = grown;
      }
      bytes.set(chunk.value, length);
      length = required;
    }
    // Decode once after the bounded read: split UTF-8 code points, BOM handling
    // and replacement of malformed bytes retain Response.json() semantics.
    const rawJson = new TextDecoder(undefined, { fatal: options.rejectNonFinite === true }).decode(bytes.subarray(0, length));
    // Replacement of malformed UTF-8 can expand the decoded text; bound the actual
    // UTF-8 text handed to PostgreSQL as well as the original response stream.
    if (options.rejectNonFinite && (new TextEncoder().encode(rawJson).byteLength > limits.maxBytes
      || rawJson.includes('\u0000'))) throw new Error('Invalid DATA decoded JSON text.');
    options.onRawJson?.(rawJson);
    const payload: unknown = JSON.parse(rawJson);
    assertPublicCaptureStructure(payload, limits, options.rejectNonFinite === true);
    return { payload, rawJson };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    // Cancelling closes pending reads immediately; an underlying source may never
    // acknowledge cancellation, so it cannot extend the existing request deadline.
    if (!ended) void reader.cancel(failure).catch(() => undefined);
    reader.releaseLock();
  }
}


export async function readPublicCaptureJson(response: Response, signal: AbortSignal): Promise<unknown> {
  return (await readBoundedSleeperJson(response, signal)).payload;
}

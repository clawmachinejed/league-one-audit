import 'server-only';
import { createOwnedSleeperDispatchSlot } from './owned-dispatch-slot';
import type { SleeperDispatchSlot } from './permit-transport';

/** Fail-fast local capacity, reserved before SQL admission. SQL remains the
 * global, cross-process budget owner. Quarantined slots are not refunded by
 * this pool: only the owned connection's observed closure invokes release. */
export function createSleeperDispatchCapacity(
  makeSlot: (release: () => void) => SleeperDispatchSlot = createOwnedSleeperDispatchSlot,
) {
  let occupied = 0;
  return async (): Promise<SleeperDispatchSlot | null> => {
    if (occupied >= 32) return null;
    occupied += 1;
    let released = false;
    const release = () => { if (!released) { released = true; occupied -= 1; } };
    try { return makeSlot(release); }
    catch { release(); return null; }
  };
}

// Shared across every internal composition in this process, not per request.
export const reserveSleeperDispatchCapacity = createSleeperDispatchCapacity();

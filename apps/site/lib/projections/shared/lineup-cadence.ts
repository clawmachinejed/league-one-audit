export const LINEUP_CADENCE_POLICY_VERSION = 'lineup-cadence-v2' as const;
export const LEGACY_LINEUP_CADENCE_POLICY_VERSION = 'lineup-cadence-v1' as const;
export type LineupCadenceClass = 'current' | 'future' | 'completed';
export type LineupCadenceSchedule = Readonly<{ minutes: number; offset: number }>;

/** The stored policy is also the schedule fingerprint used by observation fences. */
export function parseLineupCadencePolicy(
  version: string, watchClass: LineupCadenceClass, phase: number,
): LineupCadenceSchedule {
  if (!Number.isInteger(phase) || phase < 0 || phase > 2) throw new Error('Lineup phase is invalid.');
  if (version === LEGACY_LINEUP_CADENCE_POLICY_VERSION) {
    return { minutes: watchClass === 'future' ? 3 : 1, offset: watchClass === 'future' ? phase : 0 };
  }
  const match = /^lineup-cadence-v2:(1|15|60|360):(0|[1-9]\d{0,2})$/.exec(version);
  if (!match) throw new Error('Lineup cadence policy is invalid.');
  const minutes = Number(match[1]);
  const offset = Number(match[2]);
  if (offset >= minutes || (watchClass === 'future' ? minutes === 1 : minutes !== 1)) {
    throw new Error('Lineup cadence policy does not match the period.');
  }
  return { minutes, offset };
}

/** Stable scoped identity, not fleet membership/order, determines each minute offset. */
export function lineupCadencePolicy(watchClass: LineupCadenceClass, weekDistance: number, stableHash: string): string {
  if (!Number.isSafeInteger(weekDistance) || (watchClass === 'future' && weekDistance < 1)
    || !/^[0-9a-f]{64}$/.test(stableHash)) throw new Error('Lineup cadence target is invalid.');
  const minutes = watchClass !== 'future' ? 1 : weekDistance === 1 ? 15 : weekDistance <= 4 ? 60 : 360;
  // Thirteen hexadecimal digits remain an exact safe integer.
  const offset = Number.parseInt(stableHash.slice(0, 13), 16) % minutes;
  return `${LINEUP_CADENCE_POLICY_VERSION}:${minutes}:${offset}`;
}

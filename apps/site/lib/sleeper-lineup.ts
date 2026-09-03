/** Preserve the provider's configured starter ordering, excluding roster-only slots. */
export function startingSlots(positions: readonly string[]): string[] {
  return positions.filter((position) => !['BN', 'IR', 'TAXI'].includes(position));
}

/** Sleeper uses the literal ID "0" for an unoccupied starter slot. */
export function sleeperLineupEntryId(rawId: string | null | undefined): string | null {
  return rawId && rawId !== '0' ? String(rawId) : null;
}

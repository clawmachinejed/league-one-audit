/** Presentation only: preserve the official slot value in lineups and snapshots. */
export function rosterSlotLabel(slot: string): string {
  return slot === 'SUPER_FLEX' ? 'SF' : slot;
}

export function rosterSlotName(slot: string): string {
  return slot === 'SUPER_FLEX' ? 'Super flex' : slot;
}

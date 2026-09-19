/** Presentation only, selected by the league's official slot, not the player's position. */
export function rosterSlotDisplay(slot: string): { label: string; name: string; grid: boolean } {
  switch (slot) {
    case 'FLEX':
      return { label: 'WRT', name: 'Wide receiver, running back or tight end', grid: false };
    case 'SUPER_FLEX':
      return { label: 'WRTQ', name: 'Wide receiver, running back, tight end or quarterback', grid: true };
    case 'WRRB_FLEX':
      return { label: 'WRRB', name: 'Wide receiver or running back', grid: true };
    case 'REC_FLEX':
      return { label: 'WRTE', name: 'Wide receiver or tight end', grid: true };
    default:
      return { label: slot, name: slot, grid: false };
  }
}

export function rosterSlotName(slot: string): string {
  return rosterSlotDisplay(slot).name;
}

import { rosterSlotDisplay } from '../lib/roster-slot';
import styles from './roster-slot.module.css';

export function RosterSlot({ slot, className }: { slot: string; className: string }) {
  const { label, name, grid } = rosterSlotDisplay(slot);
  return <span className={className} aria-label={name} title={name} data-roster-slot={slot}>
    {grid ? <span className={styles.grid} aria-hidden="true">
      {[...label].map((letter, index) => <span key={index}>{letter}</span>)}
    </span> : label}
  </span>;
}

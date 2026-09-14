'use client';

import { Icon } from './icon';
import styles from './roster-week-selector.module.css';

type RosterWeekSelectorProps = {
  week: number;
  currentWeek: number;
  maxWeek: number;
  onChange: (week: number) => void;
};

export function RosterWeekSelector({ week, currentWeek, maxWeek, onChange }: RosterWeekSelectorProps) {
  return <div className={styles.controls}>
    {week !== currentWeek && <button
      type="button"
      className={styles.reset}
      onClick={() => onChange(currentWeek)}
      aria-label="Back to current"
      title="Back to current"
    ><Icon name="refresh" /></button>}
    <div className={styles.picker}>
      <button
        type="button"
        className={styles.arrow}
        disabled={week <= 1}
        onClick={() => onChange(Math.max(1, week - 1))}
        aria-label={`Previous week, week ${Math.max(1, week - 1)}`}
      ><Icon name="arrow" /></button>
      <label className={styles.selection}>
        <span className="sr-only">Roster week</span>
        <span className={styles.value} aria-hidden="true">Week {week}<Icon name="chevron" /></span>
        <select value={week} onChange={(event) => onChange(Number(event.target.value))}>
          {Array.from({ length: maxWeek }, (_, index) => <option key={index + 1} value={index + 1}>
            Week {index + 1}{index + 1 === currentWeek ? ' · Current' : ''}
          </option>)}
        </select>
      </label>
      <button
        type="button"
        className={styles.arrow}
        disabled={week >= maxWeek}
        onClick={() => onChange(Math.min(maxWeek, week + 1))}
        aria-label={`Next week, week ${Math.min(maxWeek, week + 1)}`}
      ><Icon name="arrow" className="arrow-forward" /></button>
    </div>
  </div>;
}

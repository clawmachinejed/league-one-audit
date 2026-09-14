'use client';

import Link from 'next/link';
import { Icon } from './icon';
import styles from './week-selector.module.css';

type WeekSelectorProps = {
  label: string;
  week: number;
  currentWeek: number;
  maxWeek: number;
  onChange: (week: number) => void;
  hrefForWeek?: (week: number) => string;
};

export function WeekSelector({ label, week, currentWeek, maxWeek, onChange, hrefForWeek }: WeekSelectorProps) {
  function arrow(target: number, direction: 'Previous' | 'Next', disabled: boolean) {
    const icon = <Icon name="arrow" className={direction === 'Next' ? 'arrow-forward' : undefined} />;
    const name = `${direction} week, week ${target}`;
    return hrefForWeek && !disabled
      ? <Link className={styles.arrow} href={hrefForWeek(target)} aria-label={name}>{icon}</Link>
      : <button type="button" className={styles.arrow} disabled={disabled}
        onClick={() => onChange(target)} aria-label={name}>{icon}</button>;
  }

  return <div className={styles.controls}>
    {week !== currentWeek && (hrefForWeek
      ? <Link className={styles.reset} href={hrefForWeek(currentWeek)} aria-label="Back to current">Current</Link>
      : <button type="button" className={styles.reset} onClick={() => onChange(currentWeek)} aria-label="Back to current">Current</button>)}
    <div className={styles.picker}>
      {arrow(Math.max(1, week - 1), 'Previous', week <= 1)}
      <label className={styles.selection}>
        <span className="sr-only">{label}</span>
        <span className={styles.value} aria-hidden="true">Week {week}<Icon name="chevron" /></span>
        <select value={week} onChange={(event) => onChange(Number(event.target.value))}>
          {Array.from({ length: maxWeek }, (_, index) => <option key={index + 1} value={index + 1}>
            Week {index + 1}{index + 1 === currentWeek ? ' · Current' : ''}
          </option>)}
        </select>
      </label>
      {arrow(Math.min(maxWeek, week + 1), 'Next', week >= maxWeek)}
    </div>
  </div>;
}

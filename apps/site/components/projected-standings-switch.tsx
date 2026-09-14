'use client';

import { useId } from 'react';
import styles from './projected-standings-switch.module.css';

type ProjectedStandingsSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  status: string;
};

export function ProjectedStandingsSwitch({ checked, onChange, status }: ProjectedStandingsSwitchProps) {
  const statusId = useId();
  return <button
    type="button"
    className={styles.control}
    role="switch"
    aria-label="Projected standings"
    aria-checked={checked}
    aria-describedby={statusId}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.copy}>
      <span className={styles.label}>Projected standings</span>
      <span id={statusId} className={styles.status} aria-live="polite" aria-atomic="true">{status}</span>
    </span>
    <span className={styles.track} aria-hidden="true"><span className={styles.thumb} /></span>
  </button>;
}

import type { League } from '../lib/types';
import styles from './matchups.module.css';

export function PageIntro({ title, league }: { title: string; league: League }) {
  return <div className={styles.heading} data-page-intro>
    <h1>{title}</h1>
    <p className={styles.season}>{league.season} season</p>
  </div>;
}

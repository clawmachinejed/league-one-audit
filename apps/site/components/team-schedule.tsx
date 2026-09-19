import type { MyTeamScheduleEntry } from '../lib/my-team-schedule';
import type { Team } from '../lib/types';
import { ManagerName } from './manager-name';
import styles from './my-team-schedule.module.css';

/** Shared schedule cards keep official result and unavailable-state presentation identical. */
export function TeamSchedule({ team, weeks }: { team: Team; weeks: MyTeamScheduleEntry[] }) {
  return <ol className={styles.schedule} aria-label={`${team.name} schedule, Weeks 1–${weeks.length}`}>
    {weeks.map(entry => <li className={styles.week} key={entry.week} data-schedule-week={entry.week}>
      <div className={styles.weekHeader}>
        <h2>Week {entry.week}</h2>
        {entry.result ? <span className={styles.result} data-result={entry.result}>
          Final · {entry.result === 'W' ? 'Win' : entry.result === 'L' ? 'Loss' : 'Tie'}
        </span> : <span>{!entry.opponent ? 'Matchup unavailable' : entry.status === 'final' ? 'Result unavailable'
          : entry.status === 'upcoming' ? 'Upcoming' : 'Not final'}</span>}
      </div>
      <div className={styles.matchup}>
        <div className={styles.team} data-schedule-side="my-team">{team.name}
          <ManagerName team={team} className={styles.manager} />
        </div>
        <div className={entry.result ? styles.score : styles.pending}>
          {entry.result ? `${entry.points!.toFixed(2)} – ${entry.opponentPoints!.toFixed(2)}` : 'vs'}
        </div>
        <div className={`${styles.team} ${styles.opponent}`} data-schedule-side="opponent">
          {entry.opponent?.name ?? 'Opponent unavailable'}
          {entry.opponent && <ManagerName team={entry.opponent} className={styles.manager} />}
        </div>
      </div>
    </li>)}
  </ol>;
}

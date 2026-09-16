'use client';

import { selectMyTeamSchedule, type MyTeamScheduleData } from '../lib/my-team-schedule';
import { EmptyState, Updated, Warning } from './league-primitives';
import { MyTeamTabs } from './my-team-tabs';
import { PageIntro } from './page-intro';
import { useTeamPreference } from './team-preference';
import { useSiteWeekRollover, type SiteWeekRollover } from './use-site-week-rollover';
import matchupStyles from './matchups.module.css';
import styles from './my-team-schedule.module.css';

export function MyTeamScheduleView({ data, week, rollover }: {
  data: MyTeamScheduleData; week?: number; rollover?: SiteWeekRollover | null;
}) {
  useSiteWeekRollover(rollover);
  const { selected } = useTeamPreference(data.teams);
  const schedule = selectMyTeamSchedule(data, selected);
  return <div className={matchupStyles.page}>
    <div className={matchupStyles.toolbar}><PageIntro title="My Team" league={data.league} /></div>
    <MyTeamTabs view="schedule" week={week}>
      <Warning message={data.warning} />
      {schedule.team ? <ol className={styles.schedule} aria-label={`${schedule.team.name} schedule, Weeks 1–15`}>
        {schedule.weeks.map(entry => <li className={styles.week} key={entry.week} data-schedule-week={entry.week}>
          <div className={styles.weekHeader}>
            <h2>Week {entry.week}</h2>
            {entry.result ? <span className={styles.result} data-result={entry.result}>
              Final · {entry.result === 'W' ? 'Win' : entry.result === 'L' ? 'Loss' : 'Tie'}
            </span> : <span>{!entry.opponent ? 'Matchup unavailable' : entry.status === 'final' ? 'Result unavailable'
              : entry.status === 'upcoming' ? 'Upcoming' : 'Not final'}</span>}
          </div>
          <div className={styles.matchup}>
            <div className={styles.team} data-schedule-side="my-team">{schedule.team!.name}
              <span className={styles.manager}>{schedule.team!.managerName}</span>
            </div>
            <div className={entry.result ? styles.score : styles.pending}>
              {entry.result ? `${entry.points!.toFixed(2)} – ${entry.opponentPoints!.toFixed(2)}` : 'vs'}
            </div>
            <div className={`${styles.team} ${styles.opponent}`} data-schedule-side="opponent">
              {entry.opponent?.name ?? 'Opponent unavailable'}
              {entry.opponent && <span className={styles.manager}>{entry.opponent.managerName}</span>}
            </div>
          </div>
        </li>)}
      </ol> : <EmptyState title="No team available">Your schedule will appear when Sleeper publishes the league teams.</EmptyState>}
      <Updated value={data.updatedAt} />
    </MyTeamTabs>
  </div>;
}

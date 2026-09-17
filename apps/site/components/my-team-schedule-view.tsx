'use client';

import { selectMyTeamSchedule, type MyTeamScheduleData } from '../lib/my-team-schedule';
import { EmptyState, Updated, Warning } from './league-primitives';
import { MyTeamTabs } from './my-team-tabs';
import { PageIntro } from './page-intro';
import { TeamSchedule } from './team-schedule';
import { useTeamPreference } from './team-preference';
import { useSiteWeekRollover, type SiteWeekRollover } from './use-site-week-rollover';
import matchupStyles from './matchups.module.css';

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
      {schedule.team ? <TeamSchedule team={schedule.team} weeks={schedule.weeks} />
        : <EmptyState title="No team available">Your schedule will appear when Sleeper publishes the league teams.</EmptyState>}
      <Updated value={data.updatedAt} />
    </MyTeamTabs>
  </div>;
}

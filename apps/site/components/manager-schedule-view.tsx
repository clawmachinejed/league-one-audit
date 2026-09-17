'use client';

import { MANAGER_SCHEDULE_WEEKS, selectTeamSchedule, type MyTeamScheduleData } from '../lib/my-team-schedule';
import type { Team } from '../lib/types';
import { Updated } from './league-primitives';
import { ManagerHeader } from './manager-profile';
import { TeamSchedule } from './team-schedule';
import { useTeamPreference } from './team-preference';
import { useSiteWeekRollover, type SiteWeekRollover } from './use-site-week-rollover';

export function ManagerScheduleView({ data, rollover }: {
  data: MyTeamScheduleData & { team: Team };
  rollover?: SiteWeekRollover | null;
}) {
  useSiteWeekRollover(rollover);
  useTeamPreference(data.teams);
  const schedule = selectTeamSchedule(data, data.team.id, MANAGER_SCHEDULE_WEEKS);
  return <>
    <ManagerHeader data={data} active="schedule" />
    <TeamSchedule team={data.team} weeks={schedule.weeks} />
    <Updated value={data.updatedAt} />
  </>;
}

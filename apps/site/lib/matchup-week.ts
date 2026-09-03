export const FIRST_MATCHUP_WEEK = 1;
export const LAST_MATCHUP_WEEK = 18;

export function parseMatchupWeek(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,2}$/u.test(value)) return null;
  const week = Number(value);
  return Number.isInteger(week) && week >= FIRST_MATCHUP_WEEK && week <= LAST_MATCHUP_WEEK
    ? week
    : null;
}

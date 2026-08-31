// Sleeper IDs exceed JavaScript's safe integer range. Always keep them as strings.
export const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID?.trim() || '1378850182409490432';

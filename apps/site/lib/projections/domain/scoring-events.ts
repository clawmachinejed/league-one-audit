export const OFFENSE_SCORING_EVENTS = [
  'passingYards',
  'passingTouchdowns',
  'passingInterceptions',
  'rushingYards',
  'rushingTouchdowns',
  'receptions',
  'receivingYards',
  'receivingTouchdowns',
  'passingTwoPointConversions',
  'rushingTwoPointConversions',
  'receivingTwoPointConversions',
  'fumblesLost',
] as const;

export const DEFENSE_SCORING_EVENTS = [
  'sacks',
  'defensiveInterceptions',
  'fumbleRecoveries',
  'defensiveTouchdowns',
  'specialTeamsTouchdowns',
  'safeties',
  'blockedKicks',
  'pointsAllowedZero',
  'pointsAllowedOneToSix',
  'pointsAllowedSevenToThirteen',
  'pointsAllowedFourteenToTwenty',
  'pointsAllowedTwentyOneToTwentySeven',
  'pointsAllowedTwentyEightToThirtyFour',
  'pointsAllowedThirtyFivePlus',
] as const;

export const KICKER_SCORING_EVENTS = [
  'fieldGoalsMade',
  'fieldGoalsMissed',
  'extraPointsMade',
  'extraPointsMissed',
] as const;

export const TWO_POINT_SCORING_EVENTS = [
  'passingTwoPointConversions',
  'rushingTwoPointConversions',
  'receivingTwoPointConversions',
] as const;

export const POINTS_ALLOWED_SCORING_EVENTS = [
  'pointsAllowedZero',
  'pointsAllowedOneToSix',
  'pointsAllowedSevenToThirteen',
  'pointsAllowedFourteenToTwenty',
  'pointsAllowedTwentyOneToTwentySeven',
  'pointsAllowedTwentyEightToThirtyFour',
  'pointsAllowedThirtyFivePlus',
] as const;

export const PROJECTION_SCORING_EVENTS = [
  ...OFFENSE_SCORING_EVENTS,
  ...DEFENSE_SCORING_EVENTS,
  ...KICKER_SCORING_EVENTS,
] as const;

export type OffenseScoringEvent = typeof OFFENSE_SCORING_EVENTS[number];
export type DefenseScoringEvent = typeof DEFENSE_SCORING_EVENTS[number];
export type KickerScoringEvent = typeof KICKER_SCORING_EVENTS[number];
export type TwoPointScoringEvent = typeof TWO_POINT_SCORING_EVENTS[number];
export type PointsAllowedScoringEvent = typeof POINTS_ALLOWED_SCORING_EVENTS[number];
export type ProjectionScoringEvent = typeof PROJECTION_SCORING_EVENTS[number];

export type ProjectionScoringRules = Readonly<Partial<
  Record<ProjectionScoringEvent, number | null>
>>;

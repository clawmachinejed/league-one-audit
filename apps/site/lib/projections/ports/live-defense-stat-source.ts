import type { LeaguePeriod, NflTeam } from '../domain/contracts';
import type { LiveDefenseProjectionEvidence } from '../domain/live-defense';

export type DefenseStatMapping = Pick<LiveDefenseProjectionEvidence,
  'supportedActualRuleKeys' | 'pointsAllowedStatKey' | 'pointsAllowedBuckets'>;

export type LiveDefenseStatCapture = Readonly<{
  period: LeaguePeriod;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  sourceRevision: string;
  entries: readonly Readonly<{ team: NflTeam; stats: Readonly<Record<string, number>> }>[];
}>;

export type LiveDefenseStatResult = Readonly<{ mapping: DefenseStatMapping }> & (
  | Readonly<{ status: 'available'; capture: LiveDefenseStatCapture }>
  | Readonly<{ status: 'unavailable'; reason: string }>
);

/** A shared current-period observation; readers and future-period workers never fetch it. */
export type LiveDefenseStatSourcePort = Readonly<{
  load: (input: Readonly<{ period: LeaguePeriod; statisticsRequired: boolean }>) => Promise<LiveDefenseStatResult>;
}>;

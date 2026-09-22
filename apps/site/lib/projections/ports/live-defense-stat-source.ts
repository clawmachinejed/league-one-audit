import type { LeaguePeriod, NflTeam } from '../domain/contracts';
import type { LiveDefenseProjectionEvidence } from '../domain/live-defense';

export type LiveBoxScoreIdentity = Readonly<{
  entityKind: 'player' | 'team_defense';
  providerExternalId: string;
}>;

export type DefenseStatMapping = Pick<LiveDefenseProjectionEvidence,
  'supportedActualRuleKeys' | 'pointsAllowedStatKey' | 'pointsAllowedBuckets'>;

export type LiveDefenseStatCapture = Readonly<{
  period: LeaguePeriod;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  sourceRevision: string;
  /** Present only on a newly validated bulk retrieval; never re-aged by reuse. */
  bodyHash?: string;
  boxScoreRows?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  entries: readonly Readonly<{ team: NflTeam; stats: Readonly<Record<string, number>> }>[];
}>;

export type LiveDefenseStatResult = Readonly<{ mapping: DefenseStatMapping }> & (
  | Readonly<{ status: 'available'; capture: LiveDefenseStatCapture }>
  | Readonly<{ status: 'unavailable'; reason: string }>
);

/** A shared current-period observation; readers and future-period workers never fetch it. */
export type LiveDefenseStatSourcePort = Readonly<{
  load: (input: Readonly<{ period: LeaguePeriod; statisticsRequired: boolean;
    identities?: readonly LiveBoxScoreIdentity[] }>) => Promise<LiveDefenseStatResult>;
}>;

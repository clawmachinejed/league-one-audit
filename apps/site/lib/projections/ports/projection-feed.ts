import type { LeaguePeriod, NflWeekSchedule, ProjectionSlate } from '../domain/contracts';

export type ProjectionSlateAssessment = Readonly<{ complete: boolean }>;

export type ProjectionFeedUnavailableReason =
  | 'invalid-request'
  | 'not-configured'
  | 'provider-error'
  | 'invalid-response';

export type ProjectionFeedResult =
  | Readonly<{ status: 'available'; slate: ProjectionSlate }>
  | Readonly<{
      status: 'unavailable';
      period: LeaguePeriod;
      reason: ProjectionFeedUnavailableReason;
      message: string;
      retryAt?: string;
    }>;

export type ProjectionFeedPort = Readonly<{
  getProjectionSlate: (period: LeaguePeriod) => Promise<ProjectionFeedResult>;
  assessProjectionSlate: (
    slate: ProjectionSlate,
    schedule: NflWeekSchedule,
  ) => ProjectionSlateAssessment;
}>;

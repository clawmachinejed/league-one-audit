import type { GameStateSlate, LeaguePeriod } from '../domain/contracts';

export type GameStateFeedUnavailableReason =
  | 'invalid-request'
  | 'not-configured'
  | 'provider-error'
  | 'invalid-response';

export type GameStateFeedResult =
  | Readonly<{ status: 'available'; slate: GameStateSlate }>
  | Readonly<{
      status: 'unavailable';
      period: LeaguePeriod;
      reason: GameStateFeedUnavailableReason;
      message: string;
    }>;

export type GameStateFeedPort = Readonly<{
  getGameStateSlate: (period: LeaguePeriod) => Promise<GameStateFeedResult>;
}>;

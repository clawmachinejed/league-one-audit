export type NflGamePhase =
  | 'pregame'
  | 'q1'
  | 'q2'
  | 'halftime'
  | 'q3'
  | 'q4'
  | 'overtime'
  | 'final'
  | 'postponed'
  | 'suspended'
  | 'unknown';

export type NflGameStatusCode = 0 | 1 | 2 | 3 | 4;

export type GameTimeInput = Readonly<{
  statusCode: NflGameStatusCode;
  period?: unknown;
  statusText?: unknown;
  clock?: unknown;
}>;

export type ResolvedGameTime = Readonly<{
  phase: NflGamePhase;
  clockSeconds: number | null;
  remainingFraction: number | null;
}>;

const livePhaseAliases: Readonly<Record<string, NflGamePhase>> = {
  '1': 'q1',
  Q1: 'q1',
  '1ST': 'q1',
  '1ST QUARTER': 'q1',
  'FIRST QUARTER': 'q1',
  '2': 'q2',
  Q2: 'q2',
  '2ND': 'q2',
  '2ND QUARTER': 'q2',
  'SECOND QUARTER': 'q2',
  HALF: 'halftime',
  HALFTIME: 'halftime',
  'HALF TIME': 'halftime',
  HT: 'halftime',
  '3': 'q3',
  Q3: 'q3',
  '3RD': 'q3',
  '3RD QUARTER': 'q3',
  'THIRD QUARTER': 'q3',
  '4': 'q4',
  Q4: 'q4',
  '4TH': 'q4',
  '4TH QUARTER': 'q4',
  'FOURTH QUARTER': 'q4',
  '5': 'overtime',
  Q5: 'overtime',
  OT: 'overtime',
  OT1: 'overtime',
  OVERTIME: 'overtime',
};

function normalizedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/gu, ' ').toUpperCase();
  return normalized || null;
}

function livePhase(value: unknown): NflGamePhase | null {
  const normalized = normalizedText(value);
  if (!normalized) return null;
  const direct = livePhaseAliases[normalized];
  if (direct) return direct;
  if (/^OT\d+$/u.test(normalized)) return 'overtime';
  return null;
}

/** Parses a provider clock without guessing at undocumented formats. */
export function parseGameClockSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):([0-5]\d)$/u.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 15 || (minutes === 15 && seconds !== 0)) return null;
  return (minutes * 60) + seconds;
}

/** Status code is authoritative; period/status text are consulted only for a live game. */
export function normalizeGamePhase(
  statusCode: NflGameStatusCode,
  period?: unknown,
  statusText?: unknown,
): NflGamePhase {
  if (statusCode === 0) return 'pregame';
  if (statusCode === 2) return 'final';
  if (statusCode === 3) return 'postponed';
  if (statusCode === 4) return 'suspended';
  return livePhase(period) ?? livePhase(statusText) ?? 'unknown';
}

/**
 * Pure clock-v1 time calculation. Null means callers must retain their last valid
 * projection instead of substituting a fabricated clock value.
 */
export function calculateRemainingFraction(
  statusCode: NflGameStatusCode,
  phase: NflGamePhase,
  clockSeconds: number | null,
): number | null {
  if (statusCode === 0 || statusCode === 3) return 1;
  if (statusCode === 2) return 0;
  if (statusCode === 4) return null;
  if (phase === 'halftime') return 0.5;
  // The baseline projects a 60-minute regulation game. Once overtime starts,
  // none of that regulation baseline remains; live points can still increase.
  if (phase === 'overtime') return 0;
  if (!Number.isInteger(clockSeconds) || clockSeconds === null || clockSeconds < 0 || clockSeconds > 15 * 60) {
    return null;
  }

  if (phase === 'q1') return ((45 * 60) + clockSeconds) / (60 * 60);
  if (phase === 'q2') return ((30 * 60) + clockSeconds) / (60 * 60);
  if (phase === 'q3') return ((15 * 60) + clockSeconds) / (60 * 60);
  if (phase === 'q4') return clockSeconds / (60 * 60);
  return null;
}

export function resolveGameTime(input: GameTimeInput): ResolvedGameTime {
  const phase = normalizeGamePhase(input.statusCode, input.period, input.statusText);
  const clockSeconds = phase === 'halftime' ? null : parseGameClockSeconds(input.clock);
  return {
    phase,
    clockSeconds,
    remainingFraction: calculateRemainingFraction(input.statusCode, phase, clockSeconds),
  };
}

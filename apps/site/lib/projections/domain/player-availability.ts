export type PlayerAvailabilityDesignation = Readonly<{
  kind: 'out' | 'inactive' | 'suspended' | 'ir' | 'doubtful' | 'unavailable';
  participation: 'not-playing' | 'uncertain';
  statusLabel: string;
}>;

const designations: Readonly<Record<string, PlayerAvailabilityDesignation>> = {
  OUT: { kind: 'out', participation: 'not-playing', statusLabel: 'OUT' },
  INACTIVE: { kind: 'inactive', participation: 'not-playing', statusLabel: 'INACTIVE' },
  SUSPENDED: { kind: 'suspended', participation: 'not-playing', statusLabel: 'SUSPENDED' },
  SUS: { kind: 'suspended', participation: 'not-playing', statusLabel: 'SUSPENDED' },
  IR: { kind: 'ir', participation: 'not-playing', statusLabel: 'IR' },
  'INJURED RESERVE': { kind: 'ir', participation: 'not-playing', statusLabel: 'IR' },
  PUP: { kind: 'unavailable', participation: 'not-playing', statusLabel: 'PUP' },
  'PHYSICALLY UNABLE TO PERFORM': { kind: 'unavailable', participation: 'not-playing', statusLabel: 'PUP' },
  NFI: { kind: 'unavailable', participation: 'not-playing', statusLabel: 'NFI' },
  'NON-FOOTBALL INJURY': { kind: 'unavailable', participation: 'not-playing', statusLabel: 'NFI' },
  DOUBTFUL: { kind: 'doubtful', participation: 'uncertain', statusLabel: 'DOUBTFUL' },
};

/** Explicit designations only; never infer participation from a catalog active flag. */
export function classifyPlayerAvailability(value: string | null): PlayerAvailabilityDesignation | 'clear' | 'unknown' {
  if (!value?.trim()) return 'clear';
  const statuses = value.trim().toUpperCase().split(/\s*[/,;|&+]\s*/u);
  const known = statuses.map(status => designations[status]).filter(status => status !== undefined);
  // Multiple flags describe one starting position. A definite designation wins
  // over uncertain participation without classifying arbitrary unknown text.
  const designation = known.find(status => status.participation === 'not-playing') ?? known[0];
  if (designation) return designation;
  return statuses.every(status => status === 'QUESTIONABLE' || status === 'QUES' || status === 'PROBABLE')
    ? 'clear' : 'unknown';
}

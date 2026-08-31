/** Sleeper injury metadata is independent of its general active/inactive status. */
export function normalizeInjuryStatus(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Preserve upstream designations; only Questionable has an abbreviated label. */
export function injuryStatusLabel(value: string | null | undefined): string | null {
  const status = normalizeInjuryStatus(value);
  return status?.toLowerCase() === 'questionable' ? 'QUES' : status;
}

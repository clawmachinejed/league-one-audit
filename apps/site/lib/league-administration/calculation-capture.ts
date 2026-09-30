/** A reservation records the mapping before acquisition without reserving an accepted head. */
export type CalculationSourceCapture = Readonly<{ id: string; reservedAt: string }>;

/** Exact consumed documents, not a claim of historical configuration applicability. */
export type CalculationSourceAssociation = Readonly<{
  captureId: string; leagueInputId: string; matchupInputId: string;
}>;

export function isCalculationSourceCapture(value: unknown): value is CalculationSourceCapture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const capture = value as Record<string, unknown>;
  return typeof capture.id === 'string'
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(capture.id)
    && typeof capture.reservedAt === 'string' && Number.isFinite(Date.parse(capture.reservedAt));
}

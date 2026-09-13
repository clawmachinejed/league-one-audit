/** Dated catalog labels are context, never requested-game eligibility evidence. */
export type AllPlayerProviderContext = Readonly<{
  version: 'catalog-status-context-v1';
  role: 'context-only';
  source: 'official-player-catalog';
  sourceRevision: string;
  observedAt: string;
  effectivePeriod: null;
  players: readonly Readonly<{
    providerExternalId: string;
    nflGameId: string | null;
    currentTeam?: string;
    status?: string;
    active?: boolean;
    injuryStatus?: string;
  }>[];
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 128;
}

export function validateAllPlayerProviderContext(observation: Readonly<{
  providerContext?: AllPlayerProviderContext | null;
  observedAt: string;
  entries: readonly Readonly<{ entityKind: string; providerExternalId: string; nflGameId: string | null }>[];
}>): readonly string[] {
  const context = observation.providerContext;
  if (context === undefined || context === null) return [];
  if (!record(context)
    || Object.keys(context).some((key) => ![
      'version', 'role', 'source', 'sourceRevision', 'observedAt', 'effectivePeriod', 'players',
    ].includes(key))
    || context.version !== 'catalog-status-context-v1' || context.role !== 'context-only'
    || context.source !== 'official-player-catalog' || context.effectivePeriod !== null
    || typeof context.sourceRevision !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(context.sourceRevision)
    || typeof context.observedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(context.observedAt)
    || !Number.isFinite(Date.parse(context.observedAt))
    || new Date(context.observedAt).toISOString() !== context.observedAt
    || Date.parse(context.observedAt) > Date.parse(observation.observedAt)
    || !Array.isArray(context.players) || context.players.length > 10_000) {
    return ['invalid-provider-context'];
  }
  const entries = new Map(observation.entries.filter((entry) => entry.entityKind === 'player')
    .map((entry) => [entry.providerExternalId, entry]));
  const seen = new Set<string>();
  const diagnostics: string[] = [];
  for (const player of context.players) {
    if (!record(player) || Object.keys(player).some((key) => ![
      'providerExternalId', 'nflGameId', 'currentTeam', 'status', 'active', 'injuryStatus',
    ].includes(key)) || !boundedText(player.providerExternalId)
      || seen.has(player.providerExternalId)
      || !entries.has(player.providerExternalId)
      || player.nflGameId !== entries.get(player.providerExternalId)?.nflGameId
      || ['currentTeam', 'status', 'injuryStatus'].some((key) => (
        Object.hasOwn(player, key) && !boundedText(player[key])
      )) || (Object.hasOwn(player, 'active') && typeof player.active !== 'boolean')) {
      diagnostics.push('invalid-provider-context-player');
      continue;
    }
    seen.add(player.providerExternalId);
  }
  // Bound the actual UTF-8 payload, independently of provider response size.
  if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 1_000_000) {
    diagnostics.push('provider-context-too-large');
  }
  return [...new Set(diagnostics)];
}

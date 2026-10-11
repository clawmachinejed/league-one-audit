import type { Decimal } from './contracts';
import type { AdministrationProvenance, JsonValue, NormalizedAdministrationObservation } from '../league-administration/contracts';
import { parsedOfficialDecimal, projectExactMatchups } from './exact-matchups';

export const EXACT_MATCHUP_VALUES_VERSION = 'sleeper-exact-matchup-values-v1' as const;
export type NativeMatchupField<T> = Readonly<{ state: 'missing' | 'null' }>
  | Readonly<{ state: 'supplied'; value: T }>;
export type ExactMatchupTeamValues = Readonly<{
  seasonTeamId: string; externalRosterId: string; sourceOrdinal: number;
  nativeMatchupId: NativeMatchupField<string>;
  players: NativeMatchupField<readonly string[]>;
  starters: NativeMatchupField<readonly string[]>;
  rawPoints: NativeMatchupField<Decimal>;
  customPoints: NativeMatchupField<Decimal>;
  starterPoints: NativeMatchupField<readonly (Decimal | null)[]>;
  playerPoints: NativeMatchupField<Readonly<Record<string, Decimal | null>>>;
  effectivePoints: Readonly<{ value: Decimal | null; source: 'custom-override' | 'raw' | 'unavailable' }>;
}>;
export type ExactMatchupValues = Readonly<{
  nativeWeek: number; season: number; teams: readonly ExactMatchupTeamValues[];
}>;
export type ExactMatchupValuesSelection = Readonly<{ nativeWeek: number; matchupsReceiptId?: string }>;
export type ExactMatchupValuesRead = Readonly<{
  status: 'available'; version: typeof EXACT_MATCHUP_VALUES_VERSION; selection: 'current' | 'receipt';
  contentId: string; matchupsReceiptId: string; acceptanceId: string; acceptedGeneration: number;
  sourceMappingRevisionId: string;
  provenance: AdministrationProvenance; value: ExactMatchupValues;
}> | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

function field<T>(row: Record<string, JsonValue>, key: string, read: (value: JsonValue) => T): NativeMatchupField<T> {
  if (!Object.hasOwn(row, key)) return { state: 'missing' };
  return row[key] === null ? { state: 'null' } : { state: 'supplied', value: read(row[key]) };
}
function points(value: JsonValue): Decimal {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid native official points.');
  return parsedOfficialDecimal(value)!;
}

/** Preserves parsed JSON value and presence, not the source's discarded numeric lexical scale. */
export function projectExactMatchupValues(normalized: NormalizedAdministrationObservation,
  teams: readonly Readonly<{ seasonTeamId: string; externalRosterId: string }>[]): ExactMatchupValues {
  // Reuse the existing raw/v1/canonical identity guard; never change its public convenience output.
  const official = projectExactMatchups(normalized, teams);
  const identities = new Map(official.teams.map(team => [team.externalRosterId, team.seasonTeamId]));
  const rows = normalized.envelope.payload as readonly Record<string, JsonValue>[];
  return { nativeWeek: official.period.nativeWeek, season: official.period.season,
    teams: rows.map((row, sourceOrdinal) => {
      const externalRosterId = String(row.roster_id);
      const rawPoints = field(row, 'points', points), customPoints = field(row, 'custom_points', points);
      return { seasonTeamId: identities.get(externalRosterId)!, externalRosterId, sourceOrdinal,
        nativeMatchupId: field(row, 'matchup_id', value => String(value)),
        players: field(row, 'players', value => [...value as string[]]),
        starters: field(row, 'starters', value => [...value as string[]]), rawPoints, customPoints,
        starterPoints: field(row, 'starters_points', value => (value as JsonValue[]).map(point => point === null ? null : points(point))),
        playerPoints: field(row, 'players_points', value => Object.fromEntries(Object.entries(value as Record<string, JsonValue>)
          .map(([key, point]) => [key, point === null ? null : points(point)]))),
        effectivePoints: customPoints.state === 'supplied' ? { value: customPoints.value, source: 'custom-override' }
          : rawPoints.state === 'supplied' ? { value: rawPoints.value, source: 'raw' } : { value: null, source: 'unavailable' } };
    }) };
}

/** NUMERIC may return redundant scale; normalize decimal text without another floating-point parse. */
export function canonicalStoredOfficialDecimal(value: unknown): Decimal {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid stored official decimal.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const integer = whole.replace(/^0+(?=\d)/, ''), scale = fraction.replace(/0+$/, '');
  const magnitude = `${integer}${scale ? `.${scale}` : ''}`;
  return `${negative && magnitude !== '0' ? '-' : ''}${magnitude}`;
}

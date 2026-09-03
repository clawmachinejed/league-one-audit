import { sleeperLineupEntryId } from '../../../sleeper-lineup';
import type { SleeperMatchup } from '../../../transform';
import type { LeaguePeriod } from '../../domain/contracts';
import {
  validateLineupObservation,
  type LineupObservationResult,
  type LineupShape,
} from '../../domain/lineup-observation';
import {
  externalLineupEntryRef, externalMatchupRef, externalRosterRef,
  type ExternalLeagueRef,
} from '../../shared/provider-identity';
import type { SleeperMatchupShape } from './raw-matchups';

/** Preserve exact authoritative roster membership when adapting the provider's league shape. */
export function sleeperLineupObservationShape(
  leagueRef: ExternalLeagueRef,
  source: Pick<SleeperMatchupShape, 'rosterIds' | 'expectedRosterCount' | 'expectedStarterSlotCount'>,
): LineupShape {
  return {
    expectedRosterCount: source.expectedRosterCount,
    expectedStarterSlotCount: source.expectedStarterSlotCount,
    expectedRosterRefs: source.rosterIds.map((id) => externalRosterRef(leagueRef, String(id))),
  };
}

/** Translate once from validated raw rows, before player or presentation normalization. */
export function translateSleeperLineupObservation(
  leagueRef: ExternalLeagueRef,
  period: LeaguePeriod,
  shape: LineupShape,
  rawRows: readonly SleeperMatchup[],
): LineupObservationResult {
  if (rawRows.some((row) => !Array.isArray(row.starters)
    || row.starters.some((entry) => typeof entry !== 'string' || !entry.trim()))) {
    return { status: 'invalid', reason: 'starter-shape-invalid' };
  }
  try {
    return validateLineupObservation({
      leagueRef,
      period,
      shape,
      rows: rawRows.map((row) => ({
        rosterRef: externalRosterRef(leagueRef, String(row.roster_id)),
        matchupRef: row.matchup_id == null
          ? null : externalMatchupRef(leagueRef, period, String(row.matchup_id)),
        starters: row.starters!.map((entry) => {
          const rawId = sleeperLineupEntryId(entry);
          return rawId === null ? null : externalLineupEntryRef(leagueRef, rawId);
        }),
      })),
    });
  } catch {
    return { status: 'invalid', reason: 'identity-invalid' };
  }
}

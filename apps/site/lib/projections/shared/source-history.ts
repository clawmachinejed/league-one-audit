import type { AdministrationProvenance } from '../../league-administration/contracts';
import type { AdministrationSourceMapping } from '../../league-administration/source-mapping';

/** Internal evidence only: this is not an accepted matchup/analytics compatibility join. */
export type SnapshotSourceHistoryInput = Readonly<{
  snapshotId: string;
  leagueSeasonId: string;
  season: number;
  week: number;
  modelVersion: string;
}>;

export type CalculationCaptureInputHistory = Readonly<{
  id: string;
  family: 'league' | 'matchups';
  observationId: string;
  contentId: string;
  contentHash: string;
  configurationVersionId: string | null;
  /** The document actually consumed, which can differ from a reused v1 observation's provenance. */
  provenance: AdministrationProvenance;
  legacyObservationProvenance: AdministrationProvenance;
  acquisitionSourceEpoch: 'capture_mapping_proved' | 'source_epoch_unproved';
}>;

export type CalculationObservationSourceHistory =
  | Readonly<{ status: 'source_epoch_unproved'; reason: 'legacy_unlinked' | 'missing_observation' | 'invalid_source_capture' }>
  | Readonly<{
    status: 'linked';
    captureId: string;
    reservedAt: string;
    mapping: AdministrationSourceMapping;
    leagueInput: CalculationCaptureInputHistory;
    matchupInput: CalculationCaptureInputHistory;
  }>;

export type SnapshotSourceHistoryRead =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'unavailable'; reason: 'invalid_request' | 'source_history_unavailable' | 'persistence_disabled' }>
  | Readonly<{
    status: 'available';
    purpose: 'calculation-input-source-history';
    scope: SnapshotSourceHistoryInput;
    /** Score, ordered-starter, scoring-profile, historical-slot and model compatibility remain separate gates. */
    analyticsCompatibility: 'not_evaluated';
    original: Readonly<{
      leagueWeekObservationId: string;
      /** Exact stored original IDs; never replaced with verification-time game observations. */
      gameStateObservationIds: readonly string[];
      source: CalculationObservationSourceHistory;
    }>;
    verification: Readonly<{
      status: 'current_snapshot' | 'not_current_snapshot';
      leagueWeekObservationId: string | null;
      source: CalculationObservationSourceHistory | null;
    }>;
  }>;

import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { LeagueAdministrationStore } from '../league-administration/store-contracts';
import type { MatchupPeriodContext } from '../matchup-period';
import type { FantasyPlayerCatalog } from '../sleeper-player-catalog';
import type { AcceptedCurrentRosterRead } from './current-roster';
import type { AcceptedExactMatchupsRead } from './exact-matchups';
import type { ExactMatchupCompatibilityRead, JoinAcceptedExactMatchupDerivedInput } from './exact-matchup-compatibility';
import { assessAcceptedExactMatchupAttention } from './exact-matchup-attention';
import { readAcceptedExactMatchupBoxScores } from './exact-matchup-box-scores';
import type { AllPlayerBoxScoreReadInput, StoredAllPlayerBoxScores } from '../matchup-box-score-types';
import { projectExactMatchupMetadata } from './exact-lineup-applicability';

/** Explicit native scope and optional existing snapshot, never a latest-week lookup. */
export type BundleOneReadInput = Readonly<{
  expectedMapping: AdministrationSourceMapping;
  nativeWeek: number;
  snapshot: Readonly<{ snapshotId: string; modelVersion: string }> | null;
  selectedSeasonTeamId: string | null;
  context: MatchupPeriodContext;
  now: Date;
  playerCatalog?: FantasyPlayerCatalog;
}>;
export type BundleOneReadDependencies = Readonly<{ enabled?: boolean }> & Pick<LeagueAdministrationStore,
  'readAcceptedExactMatchups' | 'readAcceptedCurrentRoster'> & Readonly<{
  readExactMatchupCompatibility: (input: Pick<JoinAcceptedExactMatchupDerivedInput, 'request' | 'expectedMapping' | 'context' | 'now'>) => Promise<ExactMatchupCompatibilityRead>;
  readAllPlayerBoxScores: (input: AllPlayerBoxScoreReadInput) => Promise<StoredAllPlayerBoxScores>;
}>;

function withoutSnapshot(official: AcceptedExactMatchupsRead, reason: string): ExactMatchupCompatibilityRead {
  const unavailable = { status: 'unavailable' as const, reason };
  return { official, sourceHistory: { status: 'unavailable', reason: 'source_history_unavailable' },
    forecast: unavailable, gameState: unavailable, probability: unavailable };
}

/** A composed read over existing paths. Resources retain independent versions and times.
 * The exact accepted capture is shared by every period-dependent join; a current roster
 * is explicitly separate and can never replace a missing historical/future lineup.
 */
export function createBundleOneReadService(dependencies: BundleOneReadDependencies) {
  return {
    async readBundleOne(input: BundleOneReadInput) {
      if (dependencies.enabled === false) return { kind: 'bundle-one-matchup-read' as const,
        status: 'disabled' as const, reason: 'persistence_disabled' };
      let compatibility: ExactMatchupCompatibilityRead;
      try {
        compatibility = input.snapshot
          ? await dependencies.readExactMatchupCompatibility({
            expectedMapping: input.expectedMapping, context: input.context, now: input.now,
            request: { ...input.snapshot, leagueSeasonId: input.expectedMapping.leagueSeasonId,
              season: input.expectedMapping.scope.season, week: input.nativeWeek },
          })
          : withoutSnapshot(await dependencies.readAcceptedExactMatchups(input.expectedMapping, input.nativeWeek),
            'snapshot_reference_missing');
      } catch {
        compatibility = withoutSnapshot({ status: 'unavailable', reason: 'exact_matchup_evidence_unavailable' },
          'stored_reference_read_failed');
      }
      // The real analytics adapter returns unavailable on transport/decoding failure.
      // Re-read official facts through their existing reader, even without a thrown error.
      if (input.snapshot && compatibility.official.status === 'unavailable') {
        let fallback: AcceptedExactMatchupsRead;
        try { fallback = await dependencies.readAcceptedExactMatchups(input.expectedMapping, input.nativeWeek); }
        catch { fallback = { status: 'unavailable', reason: 'exact_matchup_evidence_unavailable' }; }
        compatibility = withoutSnapshot(fallback, compatibility.forecast.status === 'unavailable'
          ? compatibility.forecast.reason : 'stored_reference_read_failed');
      }
      const official = compatibility.official;
      const metadata = projectExactMatchupMetadata(official, input.playerCatalog);
      const [rosterResult, boxesResult] = await Promise.allSettled([
        dependencies.readAcceptedCurrentRoster(input.expectedMapping,
          input.playerCatalog ? { playerCatalog: input.playerCatalog } : undefined),
        readAcceptedExactMatchupBoxScores({ accepted: official, mapping: input.expectedMapping, leagueKey: input.expectedMapping.scope.leagueKey,
          context: input.context }, { readAllPlayerBoxScores: dependencies.readAllPlayerBoxScores }),
      ]);
      const currentRoster: AcceptedCurrentRosterRead = rosterResult.status === 'fulfilled' ? rosterResult.value
        : { status: 'unavailable', reason: 'current_roster_read_failed' };
      const attention = assessAcceptedExactMatchupAttention({ accepted: official, compatibility,
        expectedMapping: input.expectedMapping, selectedSeasonTeamId: input.selectedSeasonTeamId,
        metadata: metadata.status === 'available' ? metadata.currentDisplay : null, context: input.context, now: input.now });
      return {
        kind: 'bundle-one-matchup-read' as const,
        status: 'read' as const,
        official,
        metadata,
        currentRoster: { temporalContext: 'current-display' as const, value: currentRoster },
        sourceHistory: compatibility.sourceHistory,
        forecast: compatibility.forecast,
        gameState: compatibility.gameState,
        probability: compatibility.probability,
        attention,
        boxScores: boxesResult.status === 'fulfilled' ? boxesResult.value
          : { status: 'unavailable' as const, reason: 'box_score_read_failed' },
        selection: official.status === 'available' && input.selectedSeasonTeamId !== null
          && official.value.teams.some(team => team.seasonTeamId === input.selectedSeasonTeamId)
          ? { status: 'available' as const, seasonTeamId: input.selectedSeasonTeamId,
            // UI may put this team first without changing native group or probability identity.
            groups: official.value.groups.filter(group => group.participantTeamIds.includes(input.selectedSeasonTeamId!)) }
          : { status: 'unavailable' as const, reason: 'selected_team_unavailable' },
        dependencies: {
          official: official.status === 'available' ? { contentId: official.accepted.contentId,
            receiptId: official.receipt.id, mappingRevisionId: official.accepted.sourceMappingRevisionId,
            generation: official.accepted.acceptedGeneration, configurationContentId: official.receipt.configurationContentId,
            sourceObservedAt: official.receipt.provenance.sourceObservedAt, verifiedAt: official.accepted.verifiedAt } : null,
          currentRoster: currentRoster.status === 'available' ? { contentId: currentRoster.accepted.contentId,
            receiptId: currentRoster.receipt.id, mappingRevisionId: currentRoster.accepted.sourceMappingRevisionId,
            generation: currentRoster.accepted.acceptedGeneration,
            sourceObservedAt: currentRoster.receipt.provenance.sourceObservedAt } : null,
        },
      };
    },
  };
}
export type BundleOneRead = Awaited<ReturnType<ReturnType<typeof createBundleOneReadService>['readBundleOne']>>;

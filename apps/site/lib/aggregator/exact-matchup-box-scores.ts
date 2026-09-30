import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { MatchupPeriodContext } from '../matchup-period';
import { boxScoreResponseMatchesScope } from '../matchup-box-scores';
import { MATCHUP_BOX_SCORE_STAT_KEYS, type AllPlayerBoxScoreIdentity, type AllPlayerBoxScoreReadInput,
  type StoredAllPlayerBoxScores } from '../matchup-box-score-types';
import { isNflTeam } from '../nfl-teams';
import type { ProviderReference } from './contracts';
import type { AcceptedExactMatchupsRead } from './exact-matchups';
import { exactMatchupReferenceFailure, hasExactNflMapping } from './exact-matchup-reference-scope';

export type ExactMatchupBoxScoresInput = Readonly<{
  accepted: AcceptedExactMatchupsRead; mapping: AdministrationSourceMapping; leagueKey: string;
  context: MatchupPeriodContext;
}>;
export type ExactMatchupBoxScoreStore = Readonly<{
  readAllPlayerBoxScores(input: AllPlayerBoxScoreReadInput): Promise<StoredAllPlayerBoxScores>;
}>;
export type ExactMatchupBoxScoresRead = Readonly<{ status: 'unavailable'; reason: string }> | Readonly<{
  status: 'available';
  reference: Readonly<{ leagueSeasonId: string; sourceMappingRevisionId: string; receiptId: string;
    season: number; week: number; revision: string; observedAt: string }>;
  /** Missing rows and absent statistic keys never become observed zeroes. */
  players: readonly Readonly<{ sourceEntity: ProviderReference; entityKind: AllPlayerBoxScoreIdentity['entityKind'];
    status: 'available' | 'missing'; stats: Readonly<Record<string, number>> | null; gamePhase: string | null }>[];
  coverage: Readonly<{ status: 'complete' | 'partial'; reasons: readonly string[] }>;
}>;

const statKeys = new Set<string>(MATCHUP_BOX_SCORE_STAT_KEYS);
const keyFor = (identity: AllPlayerBoxScoreIdentity) => `${identity.entityKind === 'team_defense' ? 'defense' : 'player'}:${identity.providerExternalId}`;

/** One bounded existing exact-period store read. Never collects provider data, scores or publishes. */
export async function readAcceptedExactMatchupBoxScores(
  input: ExactMatchupBoxScoresInput, store: ExactMatchupBoxScoreStore,
): Promise<ExactMatchupBoxScoresRead> {
  try {
    const { accepted, mapping, context } = input;
    const failure = exactMatchupReferenceFailure(accepted, mapping, context);
    if (failure) return { status: 'unavailable', reason: failure };
    if (accepted.status !== 'available' || input.leagueKey !== mapping.scope.leagueKey) {
      return { status: 'unavailable', reason: 'league_scope_mismatch' };
    }
    if (!hasExactNflMapping(accepted)) return { status: 'unavailable', reason: 'period_mapping_unproved' };
    if (context.temporalState === 'future') return { status: 'unavailable', reason: 'future_actuals_unavailable' };
    const identities = new Map<string, AllPlayerBoxScoreIdentity>();
    const reasons: string[] = [];
    for (const team of accepted.value.teams) {
      if (team.players === null) reasons.push(`player_inventory_missing:${team.seasonTeamId}`);
      const selected = [...(team.players ?? []), ...(team.starters?.flatMap(slot => slot.empty ? [] : [slot.playerExternalId!]) ?? [])];
      for (const id of selected) {
        // Same Sleeper identity distinction as the existing box-score store/HTTP reader.
        const entityKind = isNflTeam(id) ? 'team_defense' : /^[1-9]\d{0,19}$/u.test(id) ? 'player' : null;
        if (entityKind === null) return { status: 'unavailable', reason: 'player_identity_invalid' };
        const identity: AllPlayerBoxScoreIdentity = { entityKind, providerExternalId: id };
        identities.set(keyFor(identity), identity);
      }
    }
    if (identities.size > 512) return { status: 'unavailable', reason: 'player_inventory_exceeded' };
    if (!identities.size) return { status: 'unavailable', reason: reasons.length ? 'player_inventory_missing' : 'player_inventory_empty' };
    const season = accepted.value.period.season, week = accepted.value.period.nativeWeek;
    const ordered = [...identities.values()].sort((a, b) => keyFor(a).localeCompare(keyFor(b)));
    const read = await store.readAllPlayerBoxScores({ leagueKey: input.leagueKey, season, week, identities: ordered });
    if (!boxScoreResponseMatchesScope({ ...read, leagueKey: input.leagueKey, season: String(season), week }, input.leagueKey, String(season), week)
      || read.status === 'available' && (!/^[a-f0-9]{64}$/u.test(read.revision!)
        || Object.keys(read.players).some(key => !identities.has(key)))) {
      return { status: 'unavailable', reason: 'box_score_evidence_invalid' };
    }
    if (read.status !== 'available') return { status: 'unavailable', reason: 'stored_box_scores_unavailable' };
    const players = ordered.map(identity => {
      const row = read.players[keyFor(identity)];
      if (row && row.gamePhase !== null && !['live', 'final', 'unknown'].includes(row.gamePhase)) {
        throw new Error('Invalid stored box-score phase.');
      }
      const stats = row ? Object.fromEntries(Object.entries(row.stats).filter(([key]) => statKeys.has(key))) : null;
      const available = stats !== null && Object.keys(stats).length > 0;
      if (!available) reasons.push(`player_statistics_missing:${keyFor(identity)}`);
      return { sourceEntity: { provider: mapping.scope.provider, resourceKind: 'scoring-entity', nativeNamespace: 'nfl',
        nativeId: identity.providerExternalId }, entityKind: identity.entityKind,
        status: available ? 'available' as const : 'missing' as const,
        stats: available ? stats : null, gamePhase: available ? row.gamePhase : null };
    });
    return { status: 'available', reference: { leagueSeasonId: mapping.leagueSeasonId,
      sourceMappingRevisionId: mapping.revisionId, receiptId: accepted.receipt.id, season, week,
      revision: read.revision!, observedAt: read.observedAt! }, players,
      coverage: { status: reasons.length ? 'partial' : 'complete', reasons } };
  } catch { return { status: 'unavailable', reason: 'box_score_read_failed' }; }
}

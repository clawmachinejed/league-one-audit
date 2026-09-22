import type { MatchupBoxScores } from './matchup-box-score-types';
import { playerBoxScoreKey } from './matchup-box-scores';
import type { Player } from './types';

export type BoxScoreActivity = Readonly<{ key: string; live: boolean; finalKeys: readonly string[] }>;

/** Only meaningful game transitions change this key, never a ticking clock or score. */
export function matchupBoxScoreActivity(players: readonly Player[]): BoxScoreActivity {
  const phases = new Map<string, string>();
  for (const player of players) {
    if (!player.id) continue;
    const phase = player.game?.kind === 'scheduled'
      ? player.game.finalScore ? 'final' : player.game.liveScore ? 'live' : 'scheduled'
      : player.game?.kind === 'bye' ? 'bye' : 'unknown';
    phases.set(playerBoxScoreKey(player), phase);
  }
  const entries = [...phases].sort(([left], [right]) => left.localeCompare(right));
  return { key: JSON.stringify(entries), live: entries.some(([, phase]) => phase === 'live'),
    finalKeys: entries.filter(([, phase]) => phase === 'final').map(([key]) => key) };
}

export function boxScoreFinalCapturePending(data: MatchupBoxScores | null, finalKeys: readonly string[]): boolean {
  return finalKeys.length > 0 && (data?.status !== 'available'
    || finalKeys.some(key => data.players[key]?.gamePhase !== 'final'));
}

import type { Player } from './types';
import type { MatchupBoxScores } from './matchup-box-score-types';

export function playerBoxScoreKey(player: Pick<Player, 'id' | 'position'>): string {
  return `${player.position === 'DEF' ? 'defense' : 'player'}:${player.id}`;
}

/** Use the accepted game state, never current injury metadata or a guessed kickoff. */
export function canExpandPlayerBoxScore(player: Player | undefined): boolean {
  return Boolean(player?.id && player.game?.kind === 'scheduled'
    && (player.game.liveScore || player.game.finalScore));
}

type Stat = Readonly<{ label: string; value: string }>;
export type BoxScoreGroup = Readonly<{ label: string; stats: readonly Stat[] }>;
type Field = readonly [key: string, label: string];
const passing: readonly Field[] = [['pass_cmp', 'Completions'], ['pass_att', 'Attempts'], ['pass_yd', 'Yards'], ['pass_td', 'TD'], ['pass_int', 'INT']];
const rushing: readonly Field[] = [['rush_att', 'Carries'], ['rush_yd', 'Yards'], ['rush_td', 'TD']];
const receiving: readonly Field[] = [['rec', 'Receptions'], ['rec_tgt', 'Targets'], ['rec_yd', 'Yards'], ['rec_td', 'TD']];
const kicking: readonly Field[] = [['fgm', 'FG made'], ['fga', 'FG attempts'], ['xpm', 'XP made'], ['xpa', 'XP attempts'], ['fgm_lng', 'Longest FG']];
const defense: readonly Field[] = [['sack', 'Sacks'], ['int', 'Interceptions'], ['fum_rec', 'Fumble recoveries'], ['def_td', 'Defense TD'], ['def_st_td', 'Special teams TD'], ['pts_allow', 'Points allowed'], ['yds_allow', 'Yards allowed'], ['safe', 'Safeties'], ['blk_kick', 'Blocked kicks']];

/** Display reported statistics only. Missing keys/rows do not become invented zeroes. */
export function boxScoreGroups(position: string, source: Record<string, number>): readonly BoxScoreGroup[] {
  const groups: BoxScoreGroup[] = [];
  function add(label: string, fields: readonly Field[], primary = false) {
    const stats = fields.filter(([key]) => typeof source[key] === 'number' && Number.isFinite(source[key]));
    if (!stats.length || (!primary && !stats.some(([key]) => source[key] !== 0))) return;
    groups.push({ label, stats: stats.map(([key, name]) => ({ label: name, value: String(source[key]) })) });
  }
  if (position === 'DEF') {
    add('Defense / special teams', defense, true);
  } else {
    if (position === 'K') add('Kicking', kicking, true);
    add('Passing', passing, position === 'QB');
    add('Rushing', rushing, ['QB', 'RB', 'FB'].includes(position));
    add('Receiving', receiving, ['RB', 'FB', 'WR', 'TE'].includes(position));
    add('Fumbles', [['fum', 'Fumbles'], ['fum_lost', 'Lost']]);
    add('Returns', [['kr_yd', 'Kick return yards'], ['kr_td', 'Kick return TD'], ['pr_yd', 'Punt return yards'], ['pr_td', 'Punt return TD']]);
    add('Conversions', [['pass_2pt', 'Passing 2PT'], ['rush_2pt', 'Rushing 2PT'], ['rec_2pt', 'Receiving 2PT']]);
  }
  return groups;
}

export function boxScoreObservedLabel(value: string | null): string | null {
  const date = value === null ? null : new Date(value);
  if (!date || !Number.isFinite(date.getTime())) return null;
  return `Stats as of ${date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  })} ET`;
}

export function boxScoreResponseMatchesScope(value: unknown, leagueKey: string, season: string, week: number): value is MatchupBoxScores {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as MatchupBoxScores;
  if (data.leagueKey !== leagueKey || data.season !== season || data.week !== week
    || !['available', 'unavailable'].includes(data.status)
    || !data.players || typeof data.players !== 'object' || Array.isArray(data.players)
    || Object.keys(data.players).length > 512) return false;
  if (data.status === 'unavailable') return data.observedAt === null && data.revision === null
    && Object.keys(data.players).length === 0;
  if (typeof data.observedAt !== 'string' || !Number.isFinite(Date.parse(data.observedAt))
    || typeof data.revision !== 'string' || !data.revision.length || data.revision.length > 200) return false;
  return Object.entries(data.players).every(([key, player]) => /^(?:player|defense):[A-Za-z0-9_-]{1,100}$/u.test(key)
    && player && typeof player === 'object' && !Array.isArray(player)
    && (player.gamePhase === null || typeof player.gamePhase === 'string')
    && player.stats && typeof player.stats === 'object' && !Array.isArray(player.stats)
    && Object.keys(player.stats).length <= 80
    && Object.values(player.stats).every(stat => typeof stat === 'number' && Number.isFinite(stat)));
}

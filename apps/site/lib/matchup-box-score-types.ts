export type MatchupBoxScorePlayer = {
  stats: Record<string, number>;
  gamePhase: string | null;
};

/** Independent source data; never part of the immutable Matchups snapshot revision. */
export type MatchupBoxScores = {
  leagueKey: string;
  season: string;
  week: number;
  status: 'available' | 'unavailable';
  observedAt: string | null;
  revision: string | null;
  players: Record<string, MatchupBoxScorePlayer>;
};

export type AllPlayerBoxScoreIdentity = Readonly<{
  entityKind: 'player' | 'team_defense';
  providerExternalId: string;
}>;

export type AllPlayerBoxScoreReadInput = Readonly<{
  leagueKey: string;
  season: number;
  week: number;
  identities: readonly AllPlayerBoxScoreIdentity[];
}>;

export type StoredAllPlayerBoxScores = Pick<MatchupBoxScores,
  'status' | 'observedAt' | 'revision' | 'players'>;

/** Box-score values only: provider fantasy-point/rank and participation fields stay private. */
export const MATCHUP_BOX_SCORE_STAT_KEYS = [
  'pass_cmp', 'pass_att', 'pass_yd', 'pass_td', 'pass_int',
  'rush_att', 'rush_yd', 'rush_td', 'rec', 'rec_tgt', 'rec_yd', 'rec_td',
  'fum', 'fum_lost', 'pass_2pt', 'rush_2pt', 'rec_2pt',
  'kr_yd', 'kr_td', 'pr_yd', 'pr_td',
  'fgm', 'fga', 'fgmiss', 'xpm', 'xpa', 'xpmiss', 'fgm_lng',
  'fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50p',
  'sack', 'int', 'fum_rec', 'def_st_fum_rec', 'def_td', 'def_st_td',
  'safe', 'blk_kick', 'pts_allow', 'yds_allow',
] as const;

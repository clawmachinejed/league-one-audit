import calibration from './supplemental-projection-calibration.json';
import type { ProjectionScoringEvent } from '../../domain/scoring-events';

// Tank01 forecasts aggregate interceptions, recoveries, receptions and made FGs,
// not these individual outcomes. Use observed prior-season NFL rates to compile
// the league's exact weights into the SAME canonical scorer. These are estimates,
// never invented provider statistics or substitutes for official actual points.
const { offense, defense, kickers } = calibration;
export const SUPPLEMENTAL_PROJECTION_MODEL = calibration.version;
export const SUPPLEMENTAL_PROJECTION_RULES = [
  ['pass_int_td', 'passingInterceptions', offense.totals.pass_int_td / offense.totals.pass_int],
  ['st_fum_rec', 'receptions', offense.totals.st_fum_rec / offense.totals.rec],
  ['st_ff', 'receptions', offense.totals.st_ff / offense.totals.rec],
  ['ff', 'fumbleRecoveries', defense.totals.ff / defense.totals.fum_rec],
  ['def_st_ff', 'fumbleRecoveries', defense.totals.def_st_ff / defense.totals.fum_rec],
  ...(['fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50_59', 'fgm_60p'] as const)
    .map(key => [key, 'fieldGoalsMade', kickers.totals[key] / kickers.totals.fgm] as const),
] as const satisfies ReadonlyArray<readonly [string, ProjectionScoringEvent, number]>;

import { describe, expect, it } from 'vitest';
import { buildLiveBoxScoreEvidence, parseLiveBoxScoreEvidence, type LiveBoxScoreEvidenceInput } from './live-box-score-evidence';
import { compatibleRevision } from './revision-compatibility';
import { prepareLeagueWeekObservation } from '../adapters/neon/observations';
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

const period = { season: 2026, seasonType: 'regular', week: 2 } as const;
const at = '2026-09-22T01:01:33.614Z';
const input: LiveBoxScoreEvidenceInput = {
  period, sourceRevision: 'captured-week-2', bodyHash: `sha256:${'a'.repeat(64)}`,
  requestStartedAt: at, requestCompletedAt: at, observedAt: at,
  entries: [{ entityKind: 'player', providerExternalId: '11586', gamePhase: 'live',
    stats: { rush_att: 3, rush_yd: 19, rush_td: 0 } }],
};
function rehash(value: Record<string, unknown>) {
  const material = { ...value };
  delete material.revision;
  return { ...material, revision: compatibleRevision(material) };
}

describe('compact live box-score evidence', () => {
  it('keeps exact source period, retrieval times, sparse zero/negative stats and canonical identity kinds', () => {
    const evidence = buildLiveBoxScoreEvidence({ ...input, entries: [
      ...input.entries, { entityKind: 'team_defense', providerExternalId: 'NE', gamePhase: 'final', stats: { pts_allow: 0 } },
      { entityKind: 'player', providerExternalId: '5859', gamePhase: 'final', stats: { rush_yd: -2 } },
    ] });
    expect(parseLiveBoxScoreEvidence(evidence, period, Date.parse(at))).toEqual(evidence);
    expect(evidence.entries).toHaveLength(3);
    expect(evidence.entries.find(row => row.providerExternalId === '11586')?.stats).toEqual(input.entries[0].stats);
    expect(buildLiveBoxScoreEvidence({ ...input, entries: [...evidence.entries].reverse() })).toEqual(evidence);
  });

  it('retains capture age and revision on exact reuse, while a correction changes its revision', () => {
    const evidence = buildLiveBoxScoreEvidence(input);
    expect(buildLiveBoxScoreEvidence(input)).toEqual(evidence);
    expect(parseLiveBoxScoreEvidence(evidence, period, Date.parse(at) + 60_000)?.observedAt).toBe(at);
    const corrected = buildLiveBoxScoreEvidence({ ...input, entries: [{ ...input.entries[0], stats: { rush_att: 4, rush_yd: 22 } }] });
    expect(corrected.revision).not.toBe(evidence.revision);
    expect(parseLiveBoxScoreEvidence({ ...evidence, entries: corrected.entries }, period)).toBeNull();
  });

  it.each([
    { period: { ...period, week: 1 } }, { period: { ...period, seasonType: 'post' } },
    { bodyHash: 'not-a-source-hash' }, { sourceRevision: '' },
    { observedAt: '2026-09-22T01:02:33.614Z' }, { requestStartedAt: '2026-09-22T01:01:34.614Z' },
    { observedAt: '2026-02-30T01:01:33.614Z' }, { extra: 'private' },
    { entries: [{ ...input.entries[0], stats: { pts_ppr: 1 } }] },
    { entries: [{ ...input.entries[0], stats: { rush_yd: '19' } }] },
    { entries: [{ ...input.entries[0], gamePhase: 'pregame' }] },
    { entries: [{ ...input.entries[0], providerExternalId: '011586' }] },
    { entries: [{ ...input.entries[0], entityKind: 'team_defense' }] },
    { entries: [input.entries[0], input.entries[0]] },
    { entries: Array.from({ length: 513 }, (_, index) => ({ ...input.entries[0], providerExternalId: String(index + 1) })) },
  ])('rejects invalid, wrong-period, ambiguous or private persisted evidence (%j)', (change) => {
    const evidence = buildLiveBoxScoreEvidence(input);
    expect(parseLiveBoxScoreEvidence(rehash({ ...evidence, ...change }), period)).toBeNull();
  });

  it('rejects future source time, nonfinite values and oversized compact data', () => {
    expect(parseLiveBoxScoreEvidence(buildLiveBoxScoreEvidence(input), period, Date.parse(at) - 1)).toBeNull();
    expect(() => buildLiveBoxScoreEvidence({ ...input, entries: [{ ...input.entries[0], stats: { rush_yd: Infinity } }] })).toThrow();
    const stats = Object.fromEntries(['pass_cmp', 'pass_att', 'pass_yd', 'pass_td', 'pass_int', 'rush_att', 'rush_yd', 'rush_td',
      'rec', 'rec_tgt', 'rec_yd', 'rec_td', 'fum', 'fum_lost', 'pass_2pt', 'rush_2pt', 'rec_2pt', 'kr_yd', 'kr_td',
      'pr_yd', 'pr_td', 'fgm', 'fga', 'fgmiss', 'xpm', 'xpa', 'xpmiss', 'fgm_lng', 'sack', 'int', 'fum_rec',
      'def_st_fum_rec', 'def_td', 'def_st_td', 'safe', 'blk_kick', 'pts_allow', 'yds_allow'].map(key => [key, 123456789.12345678]));
    expect(() => buildLiveBoxScoreEvidence({ ...input, entries: Array.from({ length: 512 }, (_, index) => ({
      ...input.entries[0], providerExternalId: String(index + 1), stats,
    })) })).toThrow();
  });

  it('allows old source observations and rejects forged new evidence before serialization or SQL', () => {
    const observation = { leagueSeasonId: '00000000-0000-0000-0000-000000000001', week: 2,
      sourceRevision: 'official', requestStartedAt: at, requestCompletedAt: at, observedAt: at,
      quality: 'complete' as const, sourceData: { season: '2026' }, expectedTank01GameIds: [],
      playerPoints: [], rosterPoints: [] };
    expect(prepareLeagueWeekObservation(observation).sourceData).toMatchObject({ season: '2026' });
    const evidence = buildLiveBoxScoreEvidence(input);
    expect(prepareLeagueWeekObservation({ ...observation, sourceData: { ...observation.sourceData, liveBoxScores: evidence } }).sourceData)
      .toMatchObject({ liveBoxScores: evidence });
    expect(() => prepareLeagueWeekObservation({ ...observation, sourceData: { ...observation.sourceData,
      liveBoxScores: { ...evidence, revision: 'f'.repeat(64) } } })).toThrow('live-box-scores-invalid');
  });
});

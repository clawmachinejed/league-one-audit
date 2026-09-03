import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  externalLeagueRef, externalLineupEntryRef, externalMatchupRef,
  externalPlayerRef, externalReferenceKey, externalRosterRef,
  externalTeamDefenseRef,
} from '../shared/provider-identity';
import { validateLineupObservation, type LineupObservationInput } from './lineup-observation';
import { calculateLineupRevision, canonicalLineupRevisionInput } from './lineup-revision';

const league = externalLeagueRef('official-test-provider', 'league-A');
const period = { season: 2026, seasonType: 'regular' as const, week: 5 };
const matchup = externalMatchupRef(league, period, '1');

function observation(): LineupObservationInput {
  return {
    leagueRef: league,
    period,
    shape: { expectedRosterCount: 2, expectedStarterSlotCount: 3 },
    rows: [1, 2].map((roster) => ({
      rosterRef: externalRosterRef(league, String(roster)),
      matchupRef: matchup,
      starters: [
        externalLineupEntryRef(league, `starter-${roster}-A`),
        externalLineupEntryRef(league, `starter-${roster}-B`),
        null,
      ],
    })),
  };
}

describe('canonical lineup observation', () => {
  it('accepts a complete matchup with empty starter slots', () => {
    const input = observation();
    expect(validateLineupObservation(input)).toEqual({ status: 'complete', observation: input });
  });

  it('treats empty future rows as healthy not-ready but rejects partial nonempty populations', () => {
    const input = observation();
    expect(validateLineupObservation({ ...input, rows: [] })).toEqual({ status: 'not-ready', reason: 'empty' });
    expect(validateLineupObservation({ ...input, rows: input.rows.slice(0, 1) })).toEqual({
      status: 'invalid', reason: 'roster-population-incomplete',
    });
  });

  it('requires known authoritative shape even when the provider returns no rows', () => {
    expect(validateLineupObservation({ ...observation(), shape: { expectedRosterCount: 0, expectedStarterSlotCount: 3 }, rows: [] }))
      .toEqual({ status: 'invalid', reason: 'shape-unavailable' });
  });

  it('treats a structurally complete unpublished pairing as not-ready', () => {
    const input = observation();
    expect(validateLineupObservation({ ...input, rows: input.rows.map((row) => ({ ...row, matchupRef: null })) }))
      .toEqual({ status: 'not-ready', reason: 'unpaired' });
  });

  it('does not disguise a broken nonempty pairing as not-ready', () => {
    const input = observation();
    expect(validateLineupObservation({ ...input, rows: [input.rows[0], { ...input.rows[1], matchupRef: null }] }))
      .toEqual({ status: 'invalid', reason: 'matchup-pairing-invalid' });
  });

  it('rejects duplicate rosters and starter assignments', () => {
    const input = observation();
    expect(validateLineupObservation({ ...input, rows: [input.rows[0], input.rows[0]] }))
      .toEqual({ status: 'invalid', reason: 'duplicate-roster' });
    expect(validateLineupObservation({ ...input, rows: [input.rows[0], { ...input.rows[1], starters: input.rows[0].starters }] }))
      .toEqual({ status: 'invalid', reason: 'duplicate-starter' });
  });

  it('rejects the wrong starter-slot population', () => {
    const input = observation();
    expect(validateLineupObservation({ ...input, rows: [{ ...input.rows[0], starters: [] }, input.rows[1]] }))
      .toEqual({ status: 'invalid', reason: 'starter-shape-invalid' });
  });

  it('rejects mismatched league and week scopes before creating a revision', async () => {
    const input = observation();
    const wrongLeague = externalLeagueRef('official-test-provider', 'league-B');
    for (const matchupRef of [externalMatchupRef(wrongLeague, period, '1'), externalMatchupRef(league, { ...period, week: 6 }, '1')]) {
      const invalid = { ...input, rows: input.rows.map((row) => ({ ...row, matchupRef })) };
      expect(validateLineupObservation(invalid)).toEqual({ status: 'invalid', reason: 'identity-invalid' });
      await expect(calculateLineupRevision(invalid)).rejects.toThrow('complete lineup observation');
    }
  });

  it('preserves opaque IDs without guessing player or defense from their format', async () => {
    const input = observation();
    const opaque = {
      ...input,
      rows: [
        { ...input.rows[0], starters: [externalLineupEntryRef(league, 'NYG'), externalLineupEntryRef(league, '123456'), null] },
        input.rows[1],
      ],
    };
    expect(validateLineupObservation(opaque).status).toBe('complete');
    expect((await calculateLineupRevision(opaque)).lineupRevision).toMatch(/^[0-9a-f]{64}$/u);
    expect(externalReferenceKey(externalLineupEntryRef(league, 'NYG'))).not.toBe(externalReferenceKey(externalTeamDefenseRef(league.provider, 'NYG')));
    expect(externalReferenceKey(externalLineupEntryRef(league, '123456'))).not.toBe(externalReferenceKey(externalPlayerRef(league.provider, '123456')));
  });

  it('resource-scopes matchup keys by league and every period dimension', () => {
    const refs = [
      matchup,
      externalMatchupRef(externalLeagueRef(league.provider, 'another-league'), period, '1'),
      externalMatchupRef(league, { ...period, season: 2027 }, '1'),
      externalMatchupRef(league, { ...period, seasonType: 'postseason' }, '1'),
      externalMatchupRef(league, { ...period, week: 6 }, '1'),
    ];
    expect(new Set(refs.map(externalReferenceKey)).size).toBe(refs.length);
    expect(() => externalMatchupRef(league, { ...period, week: 0 }, '1')).toThrow('period scope');
  });
});

describe('lineup-v1 revision semantics', () => {
  it('hashes exact canonical UTF-8 with SHA-256 and agrees with an independent Node digest', async () => {
    const input = observation();
    const actual = await calculateLineupRevision(input);
    expect(actual).toEqual({
      revisionVersion: 'lineup-v1',
      lineupRevision: createHash('sha256').update(canonicalLineupRevisionInput(input), 'utf8').digest('hex'),
    });
  });

  it('ignores roster input ordering', async () => {
    const input = observation();
    expect(await calculateLineupRevision({ ...input, rows: [...input.rows].reverse() })).toEqual(await calculateLineupRevision(input));
  });

  it('ignores fantasy scores, timestamps, names, injuries, and arbitrary presentation data', async () => {
    const input = observation();
    const decorated = {
      ...input,
      requestStartedAt: '2030-01-01T00:00:00Z',
      points: 345.2,
      projectedPoints: 398.71,
      managerName: 'Different name',
      rows: input.rows.map((row) => ({ ...row, injury: 'OUT', points: -8, playerName: 'A Different Name' })),
    };
    expect(await calculateLineupRevision(decorated)).toEqual(await calculateLineupRevision(input));
  });

  it('changes on slot order, replacement, and empty-slot changes', async () => {
    const input = observation();
    const original = await calculateLineupRevision(input);
    const variations = [
      [input.rows[0].starters[1], input.rows[0].starters[0], null],
      [externalLineupEntryRef(league, 'replacement'), input.rows[0].starters[1], null],
      [input.rows[0].starters[0], input.rows[0].starters[1], externalLineupEntryRef(league, 'new-filled-slot')],
    ];
    for (const starters of variations) {
      const changed = { ...input, rows: [{ ...input.rows[0], starters }, input.rows[1]] };
      expect(await calculateLineupRevision(changed)).not.toEqual(original);
    }
  });

  it('changes when the matchup pairing changes', async () => {
    const input = observation();
    const changed = { ...input, rows: input.rows.map((row) => ({ ...row, matchupRef: externalMatchupRef(league, period, 'new-pair') })) };
    expect(await calculateLineupRevision(changed)).not.toEqual(await calculateLineupRevision(input));
  });

  it('does not create a revision for empty, unpaired, or invalid observations', async () => {
    const input = observation();
    for (const rows of [[], [input.rows[0]], input.rows.map((row) => ({ ...row, matchupRef: null }))]) {
      await expect(calculateLineupRevision({ ...input, rows })).rejects.toThrow('complete lineup observation');
    }
  });

  it('rejects a digest that does not meet the versioned representation', async () => {
    await expect(calculateLineupRevision(observation(), async () => 'opaque')).rejects.toThrow('digest is invalid');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { b2Capture } from './b2-acceptance.fixtures';
import { b1Uuid } from './b1-acceptance.fixtures';
import { compareSeasonOverviewBatch, createSeasonOverviewManifest } from './season-overview-retained';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

vi.mock('server-only', () => ({}));
describe('retained season overview comparison', () => {
  it('pins exact inputs and resumes from JSON with stable values, source dates and hashes', async () => {
    const first = await b2Capture(), second = await b2Capture(rows => { rows[0] = { ...rows[0], settings: { wins: 0, losses: 2, ties: 0, fpts: 0, fpts_against: 105 } }; });
    second.input = { ...second.input, accepted: { ...second.input.accepted, observationIds: [b1Uuid(71)], contentId: b1Uuid(74) },
      receipt: { ...second.input.receipt, id: b1Uuid(71), legacyObservationId: b1Uuid(73) } };
    const prepared = createSeasonOverviewManifest(first.mapping, [second.input, first.input]);
    expect(prepared.status).toBe('available');
    if (prepared.status !== 'available') throw new Error('Manifest unavailable.');
    const one = compareSeasonOverviewBatch(prepared.manifest, undefined, 1);
    expect(one.status).toBe('more');
    if (one.status !== 'more') throw new Error('Batch unavailable.');
    const resumed = compareSeasonOverviewBatch(JSON.parse(JSON.stringify(prepared.manifest)), JSON.parse(JSON.stringify(one.cursor)), 1);
    expect(resumed.status).toBe('complete');
    expect(resumed).toEqual(compareSeasonOverviewBatch(prepared.manifest, one.cursor, 1));
    if (resumed.status !== 'complete') throw new Error('Batch incomplete.');
    expect(resumed.durableReplay).toBe(false);
    expect(resumed.entries[0].result).toMatchObject({ teams: [{ record: { wins: { value: 0 } }, pointsFor: { value: '0' } }, {}] });
    expect(compareSeasonOverviewBatch(prepared.manifest, resumed.cursor, 1)).toMatchObject({ status: 'complete', entries: [] });
    expect(compareSeasonOverviewBatch(prepared.manifest, undefined, 1)).toEqual(one);
  });

  it('rejects different mapping, duplicate receipt, wrong cursor and changed frozen input', async () => {
    const fixture = await b2Capture();
    expect(createSeasonOverviewManifest({ ...fixture.mapping, generation: 2 }, [fixture.input]).status).toBe('unavailable');
    expect(createSeasonOverviewManifest(fixture.mapping, [fixture.input, fixture.input]).status).toBe('unavailable');
    const result = createSeasonOverviewManifest(fixture.mapping, [fixture.input]);
    if (result.status !== 'available') throw new Error('Manifest unavailable.');
    expect(compareSeasonOverviewBatch(result.manifest, { manifestId: 'different', nextIndex: 0 }).status).toBe('unavailable');
    expect(compareSeasonOverviewBatch(result.manifest, undefined, 101).status).toBe('unavailable');
    const changed = JSON.parse(JSON.stringify(result.manifest));
    changed.entries[0].input.normalized.envelope.payload[0].settings.wins = 99;
    expect(compareSeasonOverviewBatch(changed).status).toBe('unavailable');
    const body = { ...changed };
    delete body.id;
    changed.id = compatibleRevision(body);
    expect(compareSeasonOverviewBatch(changed).status).toBe('unavailable');
  });

  it('rejects missing inventories and invalid versions and does not retain caller mutation', async () => {
    const fixture = await b2Capture();
    expect(createSeasonOverviewManifest(fixture.mapping, []).status).toBe('unavailable');
    const result = createSeasonOverviewManifest(fixture.mapping, [fixture.input]);
    if (result.status !== 'available') throw new Error('Manifest unavailable.');
    const before = compareSeasonOverviewBatch(result.manifest);
    fixture.input = { ...fixture.input, mapping: { ...fixture.mapping, scope: { ...fixture.mapping.scope, season: 2027 } } };
    expect(compareSeasonOverviewBatch(result.manifest)).toEqual(before);
    expect(compareSeasonOverviewBatch({ ...result.manifest, transformationVersion: 'unknown' }).status).toBe('unavailable');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { gameStates, NOW, source } from '../live-projection-worker.fixtures';
import { snapshotContentHash } from '../projections/adapters/neon/snapshot-codec';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { buildSnapshot, type BuildSnapshotInput } from '../projections/worker/snapshot-builder';

vi.mock('server-only', () => ({}));

function input(): BuildSnapshotInput {
  const state = source('league1');
  return {
    source: state,
    games: gameStates(),
    scored: { status: 'available', projections: state.rosteredEntities.map((entity) => ({ entityRef: entity.externalRef, points: 10, quality: 'complete' })) },
    latest: [], frozen: [], prior: null, calculatedAt: NOW.toISOString(),
  };
}

describe('administration lineage and the existing snapshot content identity', () => {
  it('keeps fresh observation lineage out of snapshot material content', () => {
    const before = input();
    const context = { observationId: 'new-observation', configurationVersionId: 'same-configuration', generation: 2 };
    const after = { ...before, source: { ...before.source, administrationContext: context,
      sourceRevision: compatibleRevision({ sourceRevision: before.source.sourceRevision, administration: context }) },
    calculatedAt: new Date(NOW.getTime() + 1_000).toISOString() };
    const original = buildSnapshot(before);
    const checked = buildSnapshot(after);
    expect(after.source.sourceRevision).not.toBe(before.source.sourceRevision);
    expect(checked.matchups).toEqual(original.matchups);
    expect(snapshotContentHash(checked, [])).toBe(snapshotContentHash(original, []));
    expect(checked).not.toHaveProperty('administrationContext');
  });

  it('does not recalculate scores or change stored matchup content for league branding alone', () => {
    const before = input();
    const renamed = { ...before, source: { ...before.source, leagueName: 'A different league title',
      configuration: { ...before.source.configuration, displayName: 'A different site title' },
      administrationContext: { observationId: 'branding-observation', configurationVersionId: 'branding-configuration', generation: 3 } } };
    const original = buildSnapshot(before);
    const updated = buildSnapshot(renamed);
    expect(updated.matchups).toEqual(original.matchups);
    expect(snapshotContentHash(updated, [])).toBe(snapshotContentHash(original, []));
  });

  it('still changes presentation content when a displayed team name changes without changing its scores', () => {
    const before = input();
    const renamed = { ...before, source: { ...before.source,
      participants: before.source.participants.map((participant, index) => index === 0 ? { ...participant, teamName: 'New team title' } : participant) } };
    const original = buildSnapshot(before);
    const updated = buildSnapshot(renamed);
    expect(updated.matchups[0].sides.map((side) => side.projectedPoints)).toEqual(original.matchups[0].sides.map((side) => side.projectedPoints));
    expect(updated.teams[0].name).toBe('New team title');
    expect(snapshotContentHash(updated, [])).not.toBe(snapshotContentHash(original, []));
  });
});

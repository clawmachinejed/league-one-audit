import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import { NFL_TEAMS } from '../lib/nfl-teams';
import { createNeonProjectionRepository } from '../lib/projections/adapters/neon/repository';
import { joinNormalizedProjectionSlate } from '../lib/projections/adapters/tank01/projection-feed';
import {
  normalizeCrosswalk,
  normalizeProjectionSlate,
} from '../lib/projections/adapters/tank01/projection-normalization';
import type { LeaguePeriod, ProjectionSlate } from '../lib/projections/domain/contracts';
import { providerKey } from '../lib/projections/shared/provider-identity';
import { stored } from './lineup-lineage-fixture';
import { createIndependentDatabase, type IndependentDatabase } from './neon-integration-harness';

const period: LeaguePeriod = { season: 2026, seasonType: 'regular', week: 2 };
const provider = providerKey('tank01');
const officialProvider = providerKey('sleeper');
const captureTime = Date.parse('2026-09-22T02:17:18.313Z');
const positions = ['QB', 'RB', 'WR', 'TE'] as const;

/**
 * Synthetic provider-shaped evidence, not a production capture. The 446-player,
 * 32-defense cardinality matches the retained outage observation. Numeric strings,
 * the nested provider schema, and identities pass through the real normalizer,
 * canonical join, repository adapter, serializer, and guarded runtime-role SQL.
 * No player identity, score, or eligibility claim is copied from production.
 */
function sourceFixture() {
  const players = Array.from({ length: 446 }, (_, index) => ({
    playerID: `synthetic-slate-player-${index}`,
    sleeperBotID: `synthetic-official-player-${index}`,
    team: NFL_TEAMS[Math.floor(index / positions.length) % NFL_TEAMS.length],
    position: positions[index % positions.length],
  }));
  return {
    crosswalk: players.map(({ playerID, sleeperBotID }) => ({ playerID, sleeperBotID })),
    projections: {
      statusCode: 200,
      body: {
        playerProjections: Object.fromEntries(players.map(({ playerID, team, position }) => [
          playerID,
          {
            playerID, team, pos: position,
            Passing: { passAttempts: '34.5', passCompletions: '22.1', passYds: '275.25', passTD: '2.1', int: '0.6' },
            Rushing: { carries: '4', rushYds: '12', rushTD: '0.2' },
            Receiving: { targets: '4', receptions: '3', recYds: '30', recTD: '0.2' },
            twoPointConversion: '.05', fumblesLost: '0.10',
          },
        ])),
        teamDefenseProjections: Object.fromEntries(NFL_TEAMS.map((teamAbv) => [
          teamAbv,
          {
            teamAbv, returnTD: '0.10', defTD: '0.20', safeties: '0.05',
            fumbleRecoveries: '0.8', ptsAgainst: '20.5', interceptions: '1.25',
            sacks: '2.75', blockKick: '0.1',
          },
        ])),
      },
    },
  };
}

function canonicalCapture(fixture: ReturnType<typeof sourceFixture>, at = captureTime): ProjectionSlate {
  const result = joinNormalizedProjectionSlate(
    period,
    normalizeProjectionSlate(fixture.projections, at),
    normalizeCrosswalk({ statusCode: 200, body: fixture.crosswalk }),
    provider,
    officialProvider,
  );
  if (result.status !== 'available') throw new Error('Synthetic complete source was unavailable.');
  expect(result.slate.quality).toBe('complete');
  expect(result.slate.projections).toHaveLength(478);
  expect(result.slate.coverage).toMatchObject({ playerRows: 446, matchedPlayers: 446, usableDefenses: 32 });
  return result.slate;
}

type DatabaseState = {
  contents: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  observations: Record<string, unknown>[];
  pointer: Record<string, unknown>;
};

describe.sequential('normalized projection capture recovery preserves installed SQL guards', () => {
  let database: IndependentDatabase;
  let repository: ReturnType<typeof createNeonProjectionRepository>;
  let normalizerVersion: string;

  beforeEach(() => {
    database = createIndependentDatabase();
    // Isolate these fixtures from every other suite without changing real provider or period semantics.
    normalizerVersion = `isolated-slate-recovery-${randomUUID()}`;
    repository = createNeonProjectionRepository(createProjectionStore(database.database), {
      officialProvider, projectionProvider: provider, gameStateProvider: provider, normalizerVersion,
    });
  });

  afterEach(async () => { await database.close(); });

  async function state(): Promise<DatabaseState> {
    const rows = await database.database.query<DatabaseState>(`
      WITH contents AS (
        SELECT * FROM projection_slate_contents WHERE provider = $1 AND season = $2
          AND season_type = 'reg' AND week = $3 AND normalizer_version = $4
      ), observations AS (
        SELECT * FROM projection_slate_observations WHERE provider = $1 AND season = $2
          AND season_type = 'reg' AND week = $3 AND normalizer_version = $4
      )
      SELECT
        COALESCE((SELECT jsonb_agg(to_jsonb(content) ORDER BY id) FROM contents content), '[]'::jsonb) AS contents,
        COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY projection_slate_content_id, ordinal)
          FROM projection_slate_entries entry JOIN contents content
            ON content.id = entry.projection_slate_content_id), '[]'::jsonb) AS entries,
        COALESCE((SELECT jsonb_agg(to_jsonb(observation) ORDER BY id)
          FROM observations observation), '[]'::jsonb) AS observations,
        (SELECT to_jsonb(pointer) FROM current_projection_slates pointer
          WHERE provider = $1 AND season = $2 AND season_type = 'reg' AND week = $3
            AND normalizer_version = $4) AS pointer`,
    [String(provider), period.season, period.week, normalizerVersion]);
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  function expectPhysicalCounts(value: DatabaseState, contents: number, observations: number) {
    expect(value.contents).toHaveLength(contents);
    expect(value.entries).toHaveLength(contents * 478);
    expect(value.observations).toHaveLength(observations);
  }

  it('exactly replays a complete normalized capture without appending immutable history', async () => {
    const capture = canonicalCapture(sourceFixture());
    const first = stored(await repository.recordProjectionSlate(capture));
    expect(first).toMatchObject({ entryCount: 478, entriesStored: 478, pointerOutcome: 'advanced' });
    const before = await state();
    const replay = stored(await repository.recordProjectionSlate(capture));
    expect(replay).toEqual({ ...first, entriesStored: 0, pointerOutcome: 'verified' });
    const after = await state();
    expectPhysicalCounts(after, 1, 1);
    expect(after.contents).toEqual(before.contents);
    expect(after.entries).toEqual(before.entries);
    expect(after.observations).toEqual(before.observations);
    expect(after.pointer).toEqual({ ...before.pointer, verified_at: after.pointer.verified_at });
    expect(Date.parse(String(after.pointer.verified_at)))
      .toBeGreaterThanOrEqual(Date.parse(String(before.pointer.verified_at)));
  });

  it.each(['alias', 'coverage'] as const)(
    'rejects a legacy-style %s change at the same capture time with no history append or pointer movement',
    async (change) => {
      const fixture = sourceFixture();
      const capture = canonicalCapture(fixture);
      const first = stored(await repository.recordProjectionSlate(capture));
      const before = await state();
      if (change === 'alias') fixture.crosswalk[0].sleeperBotID = 'synthetic-new-official-player';
      else fixture.crosswalk.push({ playerID: 'synthetic-unprojected-player', sleeperBotID: 'synthetic-unprojected-official' });
      // Intentionally recreate the prior independently joined-cache input. The repaired
      // feed prevents this input; the installed SQL guard must still reject old callers.
      const incompatible = canonicalCapture(fixture);
      expect(incompatible.observedAt).toBe(capture.observedAt);
      expect(incompatible.sourceRevision).not.toBe(capture.sourceRevision);
      if (change === 'alias') expect(incompatible.coverage).toEqual(capture.coverage);
      else expect(incompatible.projections).toEqual(capture.projections);
      await expect(repository.recordProjectionSlate(incompatible)).rejects.toMatchObject({
        code: 'P0001',
        message: 'projection slate conflict: equal observation time has different semantic content',
      });
      // Check committed database state after the rejected atomic SQL statement. No
      // surrounding test rollback can hide an accidental ancillary history write.
      expect(await state()).toEqual(before);
      const current = await repository.readCurrentProjectionSlate(provider, period);
      expect(current).toMatchObject({ observationId: first.observationId, contentId: first.contentId });
    },
  );

  it('accepts changed normalized content only with a genuinely newer capture and retains the old history', async () => {
    const fixture = sourceFixture();
    const original = canonicalCapture(fixture);
    const first = stored(await repository.recordProjectionSlate(original));
    const before = await state();
    fixture.crosswalk[0].sleeperBotID = 'synthetic-new-official-player';
    fixture.projections.body.playerProjections['synthetic-slate-player-0'].Passing.passYds = '281.75';
    const next = canonicalCapture(fixture, captureTime + 3_600_000);
    const accepted = stored(await repository.recordProjectionSlate(next));
    expect(accepted).toMatchObject({ entryCount: 478, entriesStored: 478, pointerOutcome: 'advanced' });
    expect(accepted.contentId).not.toBe(first.contentId);
    expect(accepted.observationId).not.toBe(first.observationId);
    const after = await state();
    expectPhysicalCounts(after, 2, 2);
    expect(after.contents.filter((row) => row.id === first.contentId)).toEqual(before.contents);
    expect(after.entries.filter((row) => row.projection_slate_content_id === first.contentId)).toEqual(before.entries);
    expect(after.observations.filter((row) => row.id === first.observationId)).toEqual(before.observations);
    const current = await repository.readCurrentProjectionSlate(provider, period);
    expect(current).toMatchObject({ observationId: accepted.observationId, contentId: accepted.contentId });
    expect(Date.parse(current!.slate.observedAt)).toBe(captureTime + 3_600_000);
    expect(current!.slate.projections.find((projection) =>
      projection.identity.primary.externalId === 'synthetic-slate-player-0'))
      .toMatchObject({ identity: { aliases: [{ externalId: 'synthetic-new-official-player' }] },
        scoringStats: { passingYards: 281.75 } });
    expect(stored(await repository.recordProjectionSlate(original)))
      .toMatchObject({ observationId: first.observationId, entriesStored: 0, pointerOutcome: 'superseded' });
    expect(await state()).toEqual(after);
  });

  it('retains a later unchanged capture as an observation while reusing physical content and entries', async () => {
    const fixture = sourceFixture();
    const first = stored(await repository.recordProjectionSlate(canonicalCapture(fixture)));
    const before = await state();
    const later = stored(await repository.recordProjectionSlate(canonicalCapture(fixture, captureTime + 3_600_000)));
    expect(later).toMatchObject({ contentId: first.contentId, entriesStored: 0, pointerOutcome: 'verified' });
    expect(later.observationId).not.toBe(first.observationId);
    const after = await state();
    expectPhysicalCounts(after, 1, 2);
    expect(after.contents).toEqual(before.contents);
    expect(after.entries).toEqual(before.entries);
    expect(after.observations.filter((row) => row.id === first.observationId)).toEqual(before.observations);
    expect(after.pointer).toMatchObject({
      projection_slate_content_id: first.contentId,
      projection_slate_observation_id: later.observationId,
      material_changed_at: before.pointer.material_changed_at,
    });
  });
});

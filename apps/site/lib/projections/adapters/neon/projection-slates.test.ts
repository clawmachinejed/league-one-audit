import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import type { ProjectionSlateInput } from './contracts';
import {
  createProjectionSlateMethods,
  PROJECTION_SLATE_NORMALIZER_VERSION,
  projectionSlateSemanticHash,
} from './projection-slates';

const input: ProjectionSlateInput = {
  provider: 'Tank01',
  season: 2026,
  seasonType: 'reg',
  week: 2,
  normalizerVersion: PROJECTION_SLATE_NORMALIZER_VERSION,
  sourceRevision: 'fetch-revision-one',
  requestStartedAt: '2026-09-14T10:00:00.000Z',
  requestCompletedAt: '2026-09-14T10:00:01.000Z',
  observedAt: '2026-09-14T10:00:01.000Z',
  quality: 'complete',
  coverage: { matchedPlayers: 1, unmatchedPlayers: 1 },
  warnings: ['Unmatched row retained.'],
  entries: [{
    entityKind: 'player',
    providerExternalId: 'tank-unmatched',
    aliases: [],
    nflTeam: 'LAC',
    position: 'QB',
    stats: { Passing: { passYds: 250 } },
    scoringStats: { kind: 'offense', passingYards: 250 },
    missingFields: [],
  }, {
    entityKind: 'player',
    providerExternalId: 'tank-matched',
    aliases: [{ provider: 'Sleeper', externalId: 'sleeper-player' }],
    nflTeam: 'PHI',
    position: 'WR',
    stats: { Receiving: { recYds: 80 } },
    scoringStats: { kind: 'offense', receivingYards: 80 },
    missingFields: ['Receiving.targets'],
  }],
};

describe('durable provider projection slates', () => {
  it('hashes semantic content independently of fetch time and stable input ordering', () => {
    const hash = projectionSlateSemanticHash(input);
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(projectionSlateSemanticHash({
      ...input,
      sourceRevision: 'different-fetch-revision',
      requestStartedAt: '2026-09-14T11:00:00.000Z',
      requestCompletedAt: '2026-09-14T11:00:02.000Z',
      observedAt: '2026-09-14T11:00:02.000Z',
      warnings: [...input.warnings].reverse(),
      entries: [...input.entries].reverse(),
    })).toBe(hash);
    expect(projectionSlateSemanticHash({
      ...input,
      entries: input.entries.map((entry, index) => index === 0
        ? { ...entry, scoringStats: { kind: 'offense', passingYards: 251 } }
        : entry),
    })).not.toBe(hash);
  });

  it('persists matched and unmatched provider rows in one atomic operation', async () => {
    const fake = createFakeProjectionDatabase(({ statement, parameters }) => {
      if (!statement.includes('record-projection-slate')) return [];
      return [{
        observation_id: parameters[12],
        content_id: parameters[0],
        semantic_hash: parameters[6],
        entries_stored: 2,
        entry_count: 2,
        pointer_outcome: 'advanced',
        persisted_entry_count: 2,
      }];
    });
    const methods = createProjectionSlateMethods(fake.database);
    const result = await methods.recordProjectionSlate(input);

    expect(result).toMatchObject({
      kind: 'stored',
      value: { entryCount: 2, entriesStored: 2, pointerOutcome: 'advanced' },
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toHaveLength(17);
    expect(fake.calls[0].parameters.slice(1, 6)).toEqual([
      'tank01', 2026, 'reg', 2, PROJECTION_SLATE_NORMALIZER_VERSION,
    ]);
    const entries = JSON.parse(String(fake.calls[0].parameters[11])) as Array<{
      provider_external_id: string;
      aliases: readonly unknown[];
      ordinal: number;
    }>;
    expect(entries.map((entry) => entry.provider_external_id)).toEqual([
      'tank-matched', 'tank-unmatched',
    ]);
    expect(entries.find((entry) => entry.provider_external_id === 'tank-unmatched')?.aliases)
      .toEqual([]);
    expect(entries.map((entry) => entry.ordinal)).toEqual([0, 1]);
  });

  it('contains immutable history, a guarded current pointer, provenance, and pointer-safe retention', () => {
    const migration = readFileSync(join(
      process.cwd(),
      'migrations',
      '004_durable_projection_slates.sql',
    ), 'utf8');
    expect(migration).toContain('projection_slate_contents');
    expect(migration).toContain('projection_slate_entries');
    expect(migration).toContain('projection_slate_observations');
    expect(migration).toContain('current_projection_slates');
    expect(migration).toContain('projection_slate_pointer_may_advance');
    expect(migration).toContain('projection_slate_observation_id uuid');
    expect(migration).toContain('current_pregame_projection_candidates');
    expect(migration).toContain('run.fetched_at <= game.kickoff_at');
    expect(migration.match(/prevent_projection_slate_history_update/gu)?.length).toBeGreaterThan(3);
  });
});

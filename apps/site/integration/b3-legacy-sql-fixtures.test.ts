import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const baseCommit = 'ed7a60074254d3d73df6c59901648f61ff1ae9ea';
const fixtures = [
  ['register-league-season.sql', 'identities.ts', 'd5f2f22f53558ba0c6dcab16c1d5777e230cd004',
    'd920895b3f182cb26c961041b8de7a9732e1dcee32eff951d4c9f9d2c1f3415b'],
  ['record-game-states.sql', 'observations.ts', '7a46b99d98bdf9326a52c7c3fdd822a2eaf01baf',
    'f3005f9e833b1241a75689eb529eb6060afe8cced1a561449e8cd8d81579b651'],
  ['record-projection-candidates.sql', 'projections.ts', 'fbdef0196d5ea989dbc345395fa25a7e901e3bbe',
    '4a02570f99bd50d4075643373d8827b84370b5f139d5ff392446751c88d19de7'],
] as const;

describe('exact pre-B3 SQL fixture provenance', () => {
  it.each(fixtures)('keeps %s identical to the complete tagged SQL from the pinned base', async (
    fixture, sourceFile, sourceGitBlob, querySha256,
  ) => {
    const directory = new URL('./fixtures/b3-legacy-sql/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8'));
    const sql = await readFile(new URL(fixture, directory), 'utf8');
    expect(manifest.baseCommit).toBe(baseCommit);
    expect(manifest.statements).toContainEqual({
      fixture, source: `apps/site/lib/projections/adapters/neon/${sourceFile}`,
      sourceGitBlob, querySha256, startLine: expect.any(Number), endLine: expect.any(Number),
    });
    expect(createHash('sha256').update(sql).digest('hex')).toBe(querySha256);
    expect(sql).not.toMatch(/get_or_create_|record_game_state_observations/u);
  });
});

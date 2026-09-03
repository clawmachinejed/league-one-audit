import { describe, expect, it } from 'vitest';
import { calculateLineupRevision } from '../domain/lineup-revision';
import { observeLineupClaims } from './lineup-observation-stage';
import { synchronizeLineupWatches } from './lineup-watch-context';
import { lineupAuthority, lineupAuthorityResult, lineupHarness, lineupNow } from './lineup-observation.fixtures';

async function harness() {
  const h = lineupHarness();
  await synchronizeLineupWatches(h.lineupRepository, h.configurations,
    h.configurations.map((configuration) => lineupAuthorityResult(lineupAuthority(configuration))), lineupNow);
  const [claim] = await h.lineupRepository.claimDueLineupObservations({ limit: 1, futureLimit: 1, materializationLane: 'future' });
  return { ...h, claim, options: { periodAnchorWeeks: new Map(h.configurations.map((configuration) => [configuration.key, 1])) } };
}

describe('shared fenced lineup observation stage', () => {
  it('does not wake materialization for an unchanged complete revision', async () => {
    const h = await harness();
    const raw = await h.lineupSource.getLineup({ configuration: h.claim.configuration, period: h.claim.period, shape: h.claim.shape });
    const revision = await calculateLineupRevision(raw.observation);
    const claim = { ...h.claim, latestLineupRevision: revision.lineupRevision };
    h.lineupSource.getLineup.mockClear();
    expect(await observeLineupClaims(h.dependencies, [claim], 'run-1', h.options)).toMatchObject({ checked: 1, unchanged: 1, changed: 0 });
    expect(h.lineupRepository.wakeFutureProjectionAndMaterialization).not.toHaveBeenCalled();
  });
  it('rejects a valid but wrong-period source before recording a revision', async () => {
    const h = await harness();
    const raw = await h.lineupSource.getLineup({ configuration: h.claim.configuration, period: { ...h.claim.period, week: 9 }, shape: h.claim.shape });
    h.lineupSource.getLineup.mockResolvedValue(raw);
    expect(await observeLineupClaims(h.dependencies, [h.claim], 'run-1', h.options)).toMatchObject({ failed: 1, changed: 0 });
    expect(h.lineupRepository.completeLineupObservation).not.toHaveBeenCalled();
    expect(h.lineupRepository.failLineupObservation).toHaveBeenCalledWith(expect.objectContaining({ failureCode: 'lineup-response-invalid' }));
  });
  it('does not treat a superseded claim as an accepted change', async () => {
    const h = await harness(); h.lineupRepository.completeLineupObservation.mockResolvedValue({ kind: 'stale' } as never);
    expect(await observeLineupClaims(h.dependencies, [h.claim], 'run-1', h.options)).toMatchObject({ skipped: 1, changed: 0, failed: 0 });
    expect(h.lineupRepository.wakeFutureProjectionAndMaterialization).not.toHaveBeenCalled();
  });
  it('refuses an oversized claim batch before any provider call', async () => {
    const h = await harness();
    await expect(observeLineupClaims(h.dependencies, Array.from({ length: 9 }, () => h.claim), 'run-1', h.options)).rejects.toThrow('concurrency bound');
    expect(h.lineupSource.getLineup).not.toHaveBeenCalled();
  });
});

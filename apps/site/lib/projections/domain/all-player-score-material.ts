/** Retrieval/parity observation lineage belongs to immutable score verifications.
 * Material scoring, inventory and parity point fingerprints remain part of the
 * score identity, so corrections still produce new score rows. */
export function allPlayerScoreMaterialCoverage(
  coverage: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const transient = new Set([
    'all_player_source_revision', 'score_batch_fingerprint', 'parity_observation_ids',
    'parity_observation_evidence', 'parity_fingerprint',
  ]);
  return Object.fromEntries(Object.entries(coverage).filter(([key]) => !transient.has(key)));
}

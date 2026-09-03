import type {
  CanonicalScoringProfile,
  ProjectionObservation,
  ProjectionSlate,
  SourceScoringSettings,
} from '../domain/contracts';
import { scoreProjection } from '../domain/scoring';
import { compatibleScoringRulesHash } from '../shared/revision-compatibility';
import type {
  LiveProjectionWorkerDependencies,
  ScoringProfileNormalization,
} from './contracts';

type CachedProjectionScore = Readonly<{
  available: boolean;
  points: number | null;
}>;

export type ScoredProjectionSlate = ReadonlyMap<ProjectionObservation, CachedProjectionScore>;

export type ProviderGroupScoringResult =
  | Extract<ScoringProfileNormalization, { status: 'unavailable' }>
  | Readonly<{
      status: 'available';
      profile: CanonicalScoringProfile;
      profileHash: string;
      scores: ScoredProjectionSlate;
    }>;

export type ProviderGroupScoringCache = Readonly<{
  resolve: (settings: SourceScoringSettings) => ProviderGroupScoringResult;
}>;

/**
 * Scores one trusted provider slate per compatible raw scoring-profile hash.
 * The cache belongs to one provider group so observations from different weeks
 * or provider loads can never share scoring results.
 */
export function createProviderGroupScoringCache(
  slate: ProjectionSlate,
  normalizeScoringProfile: LiveProjectionWorkerDependencies['normalizeScoringProfile'],
): ProviderGroupScoringCache {
  const scoresByProfileHash = new Map<string, ScoredProjectionSlate>();

  return {
    resolve(settings) {
      const normalized = normalizeScoringProfile(settings);
      if (normalized.status !== 'available') return normalized;

      const profileHash = compatibleScoringRulesHash(normalized.profile.provenance.rawRules);
      let scores = scoresByProfileHash.get(profileHash);
      if (!scores) {
        const calculated = new Map<ProjectionObservation, CachedProjectionScore>();
        if (slate.quality === 'complete') {
          for (const observation of slate.projections) {
            const { available, points } = scoreProjection(
              observation.scoringStats,
              normalized.profile.rules,
            );
            calculated.set(observation, { available, points });
          }
        }
        scores = calculated;
        scoresByProfileHash.set(profileHash, scores);
      }

      return {
        status: 'available',
        profile: normalized.profile,
        profileHash,
        scores,
      };
    },
  };
}

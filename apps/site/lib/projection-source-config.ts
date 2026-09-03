import { providerKey } from './projections/shared/provider-identity';
import {
  LIVE_PROJECTION_MODEL_VERSION,
  PROJECTION_SLATE_NORMALIZER_VERSION,
} from './projections/shared/projection-versions';

/** The one active projection lineage used by production workers and readers. */
export const ACTIVE_PROJECTION_SOURCE = Object.freeze({
  provider: providerKey('tank01'),
  normalizerVersion: PROJECTION_SLATE_NORMALIZER_VERSION,
  modelVersion: LIVE_PROJECTION_MODEL_VERSION,
});

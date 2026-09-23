/** Settings compatibility is evidence about features, never league enrollment or access. */
export type CapabilityStatus = 'supported' | 'limited' | 'unsupported' | 'unverified';
export type LeagueCapabilityFeature = {
  id: 'roster' | 'actual_scoring' | 'projections' | 'standings' | 'schedule_history' | 'substitutions';
  label: string;
  status: CapabilityStatus;
  reasons: string[];
  ruleKeys?: string[];
};
export type LeagueCapabilityReport = {
  version: 'league-capabilities-v1';
  configurationRevision: string | null;
  scoringRulesHash: string | null;
  assessedAt: string;
  status: CapabilityStatus;
  features: LeagueCapabilityFeature[];
};

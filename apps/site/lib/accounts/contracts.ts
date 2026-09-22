import type { LeagueKey } from '../leagues';

export type AccountProfile = { id: string; displayName: string; revision: number };
export type ProviderAccount = { id: string; provider: 'sleeper'; externalId: string; displayName: string; username: string | null };
export type AccountLink = { id: string; sourceManagerAccountId: string; displayName: string; provider: 'sleeper'; assurance: 'user_asserted'; revision: number };
export type SavedLeague = { favorite: boolean; sortPosition: number; preferredSeasonTeamId: string | null; revision: number };
export type TeamParticipation = {
  id: string;
  rosterId: string;
  roles: ('owner' | 'co_owner')[];
  sourceManagerAccountIds: string[];
  assurance: 'user_asserted';
  freshness: 'current' | 'stale';
  observedAt: string;
};
export type LibraryLeague = {
  id: string;
  key: LeagueKey;
  name: string;
  season: number | null;
  url: string;
  logo: string;
  saved: SavedLeague | null;
  teams: TeamParticipation[];
  affiliations: { id: string; name: string }[];
  linkedFromLeagueIds: string[];
  sourceState: 'current' | 'stale' | 'unavailable';
  sourceObservedAt: string | null;
};
export type LibraryView = { leagues: LibraryLeague[]; availableProviderAccounts: ProviderAccount[] };
export type AccountView = { profile: AccountProfile; links: AccountLink[]; library: LibraryView };
export type AccountTeam = TeamParticipation & { leagueId: string; leagueKey: LeagueKey; leagueName: string; season: number };

/** These are accepted source observations, not proof that a website user controls a provider account. */
export type SourceLeague = {
  id: string;
  key: string;
  name: string;
  season: number | null;
  valid: boolean;
  checkedAt: string | null;
  verifiedAt: string | null;
  observedAt: string | null;
  memberships: { teamId: string; rosterId: string; sourceManagerAccountId: string; role: 'owner' | 'co_owner' }[];
};
export type AccountLibraryInput = {
  profile: AccountProfile;
  links: AccountLink[];
  saved: ({ leagueId: string } & SavedLeague)[];
  sources: SourceLeague[];
  providerAccounts: ProviderAccount[];
  groups: { id: string; name: string; leagueIds: string[] }[];
};

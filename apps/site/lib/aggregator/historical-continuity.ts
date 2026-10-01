import 'server-only';

import type { AdministrationFamily, AdministrationProvenance, NormalizedAdministrationObservation } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { LeagueAdministrationStoreRead } from '../league-administration/store-contracts';
import { buildManagerHistory, type ManagerHistoryEntry, type ManagerHistorySeason } from '../manager-history';
import { displayedManagerOwnerId } from '../manager-display';
import { assertManagerHistoryPreviousSeasonIdentity, MANAGER_HISTORY_MAX_SEASONS, managerHistoryFirstSeason,
  managerHistoryPreviousLeagueId, managerHistoryRegularEnd, managerHistoryUnsupported } from '../manager-history-policy';
import { buildCompletedStandingsBasis } from '../projected-standings';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { assertSleeperCoreCompleteness, isSleeperLeague, isSleeperRoster, isSleeperUser,
  parseSleeperRows } from '../sleeper-history-validation';
import { normalizeTeams, type SleeperLeague, type SleeperMatchup, type SleeperRoster, type SleeperUser } from '../transform';
import type { ProviderReference } from './contracts';

export const HISTORICAL_CONTINUITY_VERSION = 'historical-continuity-v1' as const;

export type HistoricalContinuitySeasonInput = Readonly<{
  mapping: AdministrationSourceMapping;
  league: LeagueAdministrationStoreRead;
  rosters: LeagueAdministrationStoreRead;
  users: LeagueAdministrationStoreRead;
  /** Supplied by the existing calendar / completed-season guard, never derived from scores. */
  throughWeek: number | null;
  /** Position is the exact week minus one, including unavailable entries. */
  matchups: readonly LeagueAdministrationStoreRead[];
  unavailableReason?: string;
}>;
export type HistoricalContinuityInput = Readonly<{
  leagueKey: string;
  currentSeason: number;
  seasons: readonly HistoricalContinuitySeasonInput[];
  chainWarning?: string;
}>;

export type HistoricalContinuitySource = Readonly<{
  family: AdministrationFamily; week: number | null;
  observationId: string; versionId: string | null; generation: number;
  rawContentHash: string; semanticHash: string | null;
  /** Legacy reads put the head check in provenance.checkedAt; do not relabel it as an immutable observation check. */
  provenance: AdministrationProvenance; checkedAt: string; verifiedAt: string | null;
  acceptedHeadCheckedAt: string; observationCheckedAt: string | null;
}>;
export type HistoricalCurationEvidence = Readonly<{
  authority: 'owner-confirmed'; approvedOn: '2026-09-19' | '2026-09-20';
  version: 'league-two-co-owner-attribution-2026-09-20' | 'league-two-legacy-attribution-2026-09-19'
    | 'manager-championships-2026-09-19';
  reference: 'docs/manager-history.md#source-and-identity' | 'apps/site/lib/manager-championships.ts';
}>;
export type HistoricalContinuityTeam = Readonly<{
  seasonTeamId: string | null;
  identity: 'retained-bridge' | 'unavailable';
  identityEvidence: Readonly<{ sourceMappingRevisionId: string | null;
    mappingProof: 'original-observation' | 'not-captured'; reasons: readonly string[] }> | null;
  sourceTeam: ProviderReference;
  providerAttribution: Readonly<{
    owner: ProviderReference | null; coOwners: readonly ProviderReference[];
    sourceRef: string; effectiveFrom: null; effectiveTo: null;
    temporalEvidence: 'season-capture-only';
  }>;
  effectiveAttribution: Readonly<{
    manager: ProviderReference | null;
    authority: 'provider-primary-owner' | 'league-one-curated' | 'unavailable';
    policy: 'existing-manager-display'; sourceRef: string;
    curation: HistoricalCurationEvidence | null;
  }>;
}>;
export type HistoricalContinuityScore = Readonly<{
  sourceTeam: ProviderReference; seasonTeamId: string | null;
  externalMatchupId: string | null;
  rawPoints: number | null; customPoints: number | null; effectivePoints: number | null;
  authority: 'provider-official'; sourceRef: string;
  /** Existing completed-result calculator, including its presentation precision policy. */
  compatibilityResult: 'win' | 'loss' | 'tie' | null;
}>;
export type HistoricalContinuitySeason = Readonly<{
  mapping: AdministrationSourceMapping;
  previousExternalLeagueId: string | null;
  predecessor: Readonly<{ status: 'verified' | 'outside-range' | 'unavailable'; leagueSeasonId: string | null }>;
  throughWeek: number | null;
  sources: readonly HistoricalContinuitySource[];
  teams: readonly HistoricalContinuityTeam[];
  weeks: readonly Readonly<{
    week: number; completeness: 'complete' | 'unavailable';
    scores: readonly HistoricalContinuityScore[];
  }>[];
  reasons: readonly string[];
}>;
export type HistoricalContinuityRead = Readonly<{
  status: 'available'; kind: 'retained-historical-continuity'; version: typeof HISTORICAL_CONTINUITY_VERSION;
  revision: string; leagueKey: string; provider: 'sleeper';
  range: Readonly<{ firstSeason: number; currentSeason: number; firstWeek: 1; lastWeek: 14 }>;
  historyCompleteness: 'complete' | 'partial'; identityCompleteness: 'complete' | 'partial';
  /** This projection is internal; it is not a v2 accepted head or a durable replay receipt. */
  acceptance: 'legacy-retained-projection';
  seasons: readonly HistoricalContinuitySeason[];
  managers: readonly Readonly<{
    sourceManager: ProviderReference;
    record: Readonly<{ wins: number | null; losses: number | null; ties: number | null;
      authority: 'league-one-derived'; calculator: 'buildManagerHistory' }>;
    seasons: readonly number[];
    curatedHonors: readonly Readonly<{ leagueKey: 'league1' | 'league2'; season: number;
      title: 'Trophy Bowl' | 'Promotion Bowl'; authority: 'league-one-curated';
      policy: 'existing-manager-championships'; curation: HistoricalCurationEvidence }>[];
  }>[];
  compatibility: Readonly<{ managers: readonly ManagerHistoryEntry[]; warning?: string }>;
  reasons: readonly string[];
  comparison: Readonly<{ kind: 'same-retained-source'; calculator: 'buildManagerHistory';
    fields: readonly ['annual-connections', 'owner-attribution', 'official-scores', 'manager-records', 'curated-honors'] }>;
}> | Readonly<{ status: 'unavailable'; reason: string }>;

type AvailableRead = Extract<LeagueAdministrationStoreRead, { status: 'available' }>;
type ValidRead = { read: AvailableRead; normalized: NormalizedAdministrationObservation; source: HistoricalContinuitySource };
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0;
const instant = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) && Number.isFinite(Date.parse(value));
const managerRef = (nativeId: string): ProviderReference => ({ provider: 'sleeper', resourceKind: 'manager', nativeNamespace: 'sleeper', nativeId });
const honorEvidence: HistoricalCurationEvidence = { authority: 'owner-confirmed', approvedOn: '2026-09-19',
  version: 'manager-championships-2026-09-19', reference: 'apps/site/lib/manager-championships.ts' };
function teamRef(mapping: AdministrationSourceMapping, nativeId: string): ProviderReference {
  return { provider: 'sleeper', resourceKind: 'team', nativeNamespace: JSON.stringify(['nfl', mapping.scope.season, mapping.scope.externalLeagueId]), nativeId };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Repeat normalization and scope checks even when the caller used the existing page-source guard. */
function sourceRead(read: LeagueAdministrationStoreRead, mapping: AdministrationSourceMapping,
  family: AdministrationFamily, week: number | null, reasons: string[]): ValidRead | null {
  const label = `${family}${week === null ? '' : `:${week}`}`;
  if (read.status !== 'available') { reasons.push(`${label}:${read.status}`); return null; }
  try {
    const { envelope } = read;
    if (envelope.family !== family || envelope.week !== week || envelope.completeness !== 'complete'
      || compatibleRevision(envelope.scope) !== compatibleRevision(mapping.scope)
      || !uuid(read.observationId) || (read.versionId !== null && !uuid(read.versionId))
      || !Number.isSafeInteger(read.generation) || read.generation < 1 || !instant(read.checkedAt)
      || Date.parse(read.checkedAt) < Date.parse(envelope.provenance.checkedAt)
      || (read.verifiedAt !== null && (!instant(read.verifiedAt) || Date.parse(read.verifiedAt) > Date.parse(read.checkedAt)))) {
      throw new Error('Invalid retained source.');
    }
    const normalized = normalizeAdministrationObservation(envelope);
    if (normalized.status !== 'accepted' || normalized.value?.family !== family) throw new Error('Invalid normalized source.');
    return { read, normalized, source: { family, week, observationId: read.observationId,
      versionId: read.versionId, generation: read.generation, rawContentHash: normalized.contentHash,
      semanticHash: normalized.semanticHash, provenance: envelope.provenance,
      checkedAt: read.checkedAt, acceptedHeadCheckedAt: read.checkedAt, observationCheckedAt: null,
      verifiedAt: read.verifiedAt } };
  } catch { reasons.push(`${label}:invalid-source`); return null; }
}

function seasonIdentities(rosters: ValidRead | null, mapping: AdministrationSourceMapping,
  reasons: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const bridge = rosters?.read.commonRoster;
  if (!rosters || rosters.normalized.value?.family !== 'rosters' || bridge?.status !== 'available') {
    reasons.push('season-team-identity:unavailable'); return result;
  }
  const { lineage } = bridge;
  if (bridge.kind !== 'legacy-retained-roster' || bridge.schemaVersion !== 'aggregator-roster-v1'
    || bridge.normalizerVersion !== 'sleeper-roster-bridge-v1'
    || compatibleRevision(bridge.scope) !== compatibleRevision({ ...mapping.scope, leagueSeasonId: mapping.leagueSeasonId })
    || lineage.observationId !== rosters.read.observationId || lineage.generation !== rosters.read.generation
    || lineage.rawContentHash !== rosters.normalized.contentHash || !uuid(lineage.rawContentRef)
    || lineage.legacyNormalizerVersion !== rosters.read.envelope.normalizerVersion
    || lineage.verifiedAt !== rosters.read.verifiedAt
    || (lineage.sourceMappingRevisionId !== null && (lineage.sourceMappingRevisionId !== mapping.revisionId
      || lineage.sourceConnectionId !== mapping.connectionId || lineage.mappingGeneration !== mapping.generation))
    || bridge.source.sourceObservedAt !== rosters.read.envelope.provenance.sourceObservedAt
    || bridge.source.requestStartedAt !== rosters.read.envelope.provenance.requestStartedAt
    || bridge.source.requestCompletedAt !== rosters.read.envelope.provenance.requestCompletedAt
    || bridge.source.origin !== rosters.read.envelope.provenance.origin
    || !instant(bridge.source.checkedAt) || Date.parse(bridge.source.checkedAt) > Date.parse(rosters.read.checkedAt)
    || bridge.teams.length !== rosters.normalized.value.teams.length) {
    reasons.push('season-team-identity:invalid-bridge'); return result;
  }
  const internal = new Set<string>();
  for (const team of bridge.teams) {
    if (!uuid(team.seasonTeamId) || internal.has(team.seasonTeamId) || result.has(team.sourceTeam.nativeId)
      || compatibleRevision(team.sourceTeam) !== compatibleRevision(teamRef(mapping, team.sourceTeam.nativeId))
      || !rosters.normalized.value.teams.some(value => value.externalRosterId === team.sourceTeam.nativeId)) {
      reasons.push('season-team-identity:invalid-bridge'); return new Map();
    }
    internal.add(team.seasonTeamId); result.set(team.sourceTeam.nativeId, team.seasonTeamId);
  }
  return result;
}

/** Pure projection of bounded captures. No provider requests, accepted-head selection, writes or clock reads. */
export function projectHistoricalContinuity(input: HistoricalContinuityInput): HistoricalContinuityRead {
  try {
    const firstSeason = managerHistoryFirstSeason(input.leagueKey);
    if (!text(input.leagueKey) || !Number.isInteger(input.currentSeason) || input.currentSeason < firstSeason
      || input.currentSeason > 2200 || !Array.isArray(input.seasons) || input.seasons.length === 0
      || input.seasons.length > MANAGER_HISTORY_MAX_SEASONS
      || input.seasons.some(value => !isAdministrationSourceMapping(value.mapping)
        || value.mapping.scope.leagueKey !== input.leagueKey || value.mapping.scope.season < firstSeason
        || value.mapping.scope.season > input.currentSeason || !Array.isArray(value.matchups) || value.matchups.length > 14)
      || new Set(input.seasons.map(value => value.mapping.scope.season)).size !== input.seasons.length
      || new Set(input.seasons.map(value => value.mapping.scope.externalLeagueId)).size !== input.seasons.length
      || new Set(input.seasons.map(value => value.mapping.leagueSeasonId)).size !== input.seasons.length) {
      return { status: 'unavailable', reason: 'historical_continuity_scope_invalid' };
    }
    const ordered = [...input.seasons].sort((left, right) => right.mapping.scope.season - left.mapping.scope.season);
    if (ordered[0].mapping.scope.season !== input.currentSeason) return { status: 'unavailable', reason: 'historical_continuity_current_season_missing' };
    const seasons: HistoricalContinuitySeason[] = [];
    const historySources: ManagerHistorySeason[] = [];
    const reasons: string[] = [];
    const historyWarnings: string[] = input.chainWarning ? [input.chainWarning] : [];
    const seen = new Set<string>();
    let previous: SleeperLeague | null = null;
    for (const annual of ordered) {
      const { mapping } = annual; const season = mapping.scope.season;
      const annualReasons: string[] = []; const sources: HistoricalContinuitySource[] = [];
      const league = sourceRead(annual.league, mapping, 'league', null, annualReasons);
      const sourceLeague = league && isSleeperLeague(league.read.envelope.payload) ? league.read.envelope.payload : null;
      if (season !== input.currentSeason) {
        try {
          const expectedSeason = input.currentSeason - seasons.length;
          const expectedId = managerHistoryPreviousLeagueId(previous?.previous_league_id, seen);
          if (season !== expectedSeason || expectedId !== mapping.scope.externalLeagueId || !sourceLeague) throw new Error('Unverified annual connection.');
          assertManagerHistoryPreviousSeasonIdentity(sourceLeague, expectedId, season);
        } catch {
          historyWarnings.push(`${season} history: the annual source connection or completed status is unverified.`);
          break; // Never expose another season's participants by accepting an unlinked capture.
        }
      }
      seen.add(mapping.scope.externalLeagueId);
      previous = sourceLeague;
      if (league) sources.push(league.source);
      if (!sourceLeague) annualReasons.push('league:invalid-history-configuration');
      const rosters = sourceRead(annual.rosters, mapping, 'rosters', null, annualReasons);
      const users = sourceRead(annual.users, mapping, 'users', null, annualReasons);
      if (rosters) sources.push(rosters.source);
      if (users) sources.push(users.source);
      let sourceRosters: SleeperRoster[] = []; let sourceUsers: SleeperUser[] = [];
      if (rosters) {
        try { sourceRosters = parseSleeperRows(rosters.read.envelope.payload, 'historical rosters', isSleeperRoster, row => String(row.roster_id)); }
        catch { annualReasons.push('rosters:invalid-history-presentation'); }
      }
      if (users) {
        try { sourceUsers = parseSleeperRows(users.read.envelope.payload, 'historical users', isSleeperUser, row => row.user_id); }
        catch { annualReasons.push('users:invalid-history-presentation'); }
      }
      if (sourceLeague) {
        try { assertSleeperCoreCompleteness(sourceLeague, sourceRosters, sourceUsers); }
        catch { annualReasons.push('managers:incomplete-source-coverage'); }
      }
      const teams = normalizeTeams(sourceRosters, sourceUsers);
      // Identity mapping is a separate coverage claim; legacy provider history does not require a v2 bridge.
      const identityReasons: string[] = [];
      const identities = seasonIdentities(rosters, mapping, identityReasons);
      if (rosters && identities.size > 0 && rosters.read.commonRoster?.status === 'available') {
        const sourceIndex = sources.findIndex(source => source.family === 'rosters');
        sources[sourceIndex] = { ...rosters.source, observationCheckedAt: rosters.read.commonRoster.source.checkedAt };
      }
      const typedTeams: HistoricalContinuityTeam[] = rosters?.normalized.value?.family === 'rosters'
        ? rosters.normalized.value.teams.map(team => {
          const effectiveOwner = displayedManagerOwnerId(mapping.scope.externalLeagueId, Number(team.externalRosterId),
            team.primaryOwnerExternalId, team.coOwnerExternalIds, input.leagueKey);
          const manager = effectiveOwner ? managerRef(effectiveOwner) : null;
          return { seasonTeamId: identities.get(team.externalRosterId) ?? null,
            identity: identities.has(team.externalRosterId) ? 'retained-bridge' : 'unavailable',
            identityEvidence: identities.has(team.externalRosterId) && rosters.read.commonRoster?.status === 'available'
              ? { sourceMappingRevisionId: rosters.read.commonRoster.lineage.sourceMappingRevisionId,
                mappingProof: rosters.read.commonRoster.lineage.sourceMappingRevisionId === null ? 'not-captured' : 'original-observation',
                reasons: rosters.read.commonRoster.lineage.reasons } : null,
            sourceTeam: teamRef(mapping, team.externalRosterId),
            providerAttribution: { owner: team.primaryOwnerExternalId ? managerRef(team.primaryOwnerExternalId) : null,
              coOwners: team.coOwnerExternalIds.map(managerRef), sourceRef: rosters.read.observationId,
              effectiveFrom: null, effectiveTo: null, temporalEvidence: 'season-capture-only' },
            effectiveAttribution: { manager, authority: manager === null ? 'unavailable'
              : effectiveOwner === team.primaryOwnerExternalId ? 'provider-primary-owner' : 'league-one-curated',
              policy: 'existing-manager-display', sourceRef: rosters.read.observationId,
              curation: manager !== null && effectiveOwner !== team.primaryOwnerExternalId
                ? { authority: 'owner-confirmed', approvedOn: team.coOwnerExternalIds.includes(effectiveOwner!) ? '2026-09-20' : '2026-09-19',
                  version: team.coOwnerExternalIds.includes(effectiveOwner!) ? 'league-two-co-owner-attribution-2026-09-20' : 'league-two-legacy-attribution-2026-09-19',
                  reference: 'docs/manager-history.md#source-and-identity' } : null } };
        }) : [];
      const throughWeek = annual.throughWeek;
      const validBoundary = throughWeek !== null && Number.isInteger(throughWeek) && throughWeek >= 0
        && throughWeek <= (sourceLeague ? managerHistoryRegularEnd(sourceLeague) : 14)
        && (season === input.currentSeason || throughWeek === managerHistoryRegularEnd(sourceLeague!));
      if (!validBoundary) annualReasons.push('completed-week-boundary:unverified');
      if (sourceLeague && managerHistoryUnsupported(sourceLeague)) annualReasons.push(`${season} uses unsupported extra-match or season settings.`);
      if (annual.unavailableReason) annualReasons.push(annual.unavailableReason);
      const rows: (readonly SleeperMatchup[] | null)[] = [];
      const weeks: HistoricalContinuitySeason['weeks'][number][] = [];
      const expectedRosterIds = new Set(typedTeams.map(team => team.sourceTeam.nativeId));
      for (let week = 1; validBoundary && week <= throughWeek!; week += 1) {
        const matchups = sourceRead(annual.matchups[week - 1] ?? { status: 'missing' }, mapping, 'matchups', week, annualReasons);
        if (matchups) sources.push(matchups.source);
        const values = matchups?.normalized.value?.family === 'matchups' ? matchups.normalized.value.matchups : null;
        const scopeComplete = values !== null && expectedRosterIds.size >= 2 && values.length === expectedRosterIds.size
          && values.every(value => expectedRosterIds.has(value.externalRosterId));
        const rawRows = scopeComplete ? matchups!.read.envelope.payload as unknown as readonly SleeperMatchup[] : null;
        rows.push(rawRows);
        const basis = rawRows === null ? null : buildCompletedStandingsBasis(teams.map(team => ({ ...team,
          wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, waiverOrder: null, waiverBudgetRemaining: null })), 2, [rawRows]);
        const complete = basis?.kind === 'ready';
        if (!complete) annualReasons.push(`matchups:${week}:incomplete-results`);
        weeks.push({ week, completeness: complete ? 'complete' : 'unavailable',
          scores: scopeComplete ? values!.map(value => {
            const result = basis?.kind === 'ready' && !(sourceLeague && managerHistoryUnsupported(sourceLeague))
              ? basis.teams.find(team => String(team.id) === value.externalRosterId) : undefined;
            return { sourceTeam: teamRef(mapping, value.externalRosterId), seasonTeamId: identities.get(value.externalRosterId) ?? null,
              externalMatchupId: value.externalMatchupId, rawPoints: value.points, customPoints: value.customPoints,
              effectivePoints: value.customPoints ?? value.points, authority: 'provider-official', sourceRef: matchups!.read.observationId,
              compatibilityResult: result ? result.wins ? 'win' : result.losses ? 'loss' : 'tie' : null };
          }) : [] });
      }
      historySources.push({ season, externalLeagueId: mapping.scope.externalLeagueId, teams, rosters: sourceRosters,
        throughWeek: validBoundary ? throughWeek : null, rows,
        ...(annualReasons.length ? { unavailableReason: annualReasons.join(' ') } : {}) });
      seasons.push({ mapping, previousExternalLeagueId: sourceLeague?.previous_league_id ?? null,
        predecessor: { status: season === firstSeason ? 'outside-range' : 'unavailable', leagueSeasonId: null },
        throughWeek: validBoundary ? throughWeek : null, sources, teams: typedTeams, weeks,
        reasons: [...annualReasons, ...identityReasons] });
    }
    if (seasons.at(-1)?.mapping.scope.season !== firstSeason) historyWarnings.push(`History is incomplete before ${seasons.at(-1)?.mapping.scope.season ?? input.currentSeason}; the ${firstSeason} boundary is not verified.`);
    for (let index = 0; index < seasons.length - 1; index += 1) {
      seasons[index] = { ...seasons[index], predecessor: { status: 'verified', leagueSeasonId: seasons[index + 1].mapping.leagueSeasonId } };
    }
    let compatibility = buildManagerHistory(historySources, input.currentSeason, input.leagueKey);
    if (historyWarnings.length) compatibility = { managers: compatibility.managers.map(manager => ({ ...manager, wins: null, losses: null, ties: null })),
      warning: [compatibility.warning, ...historyWarnings].filter(Boolean).join(' ') };
    reasons.push(...seasons.flatMap(season => season.reasons.map(reason => `${season.mapping.scope.season}:${reason}`)), ...historyWarnings);
    const result = { status: 'available' as const, kind: 'retained-historical-continuity' as const,
      version: HISTORICAL_CONTINUITY_VERSION, leagueKey: input.leagueKey, provider: 'sleeper' as const,
      range: { firstSeason, currentSeason: input.currentSeason, firstWeek: 1 as const, lastWeek: 14 as const },
      historyCompleteness: compatibility.warning ? 'partial' as const : 'complete' as const,
      identityCompleteness: seasons.every(season => season.teams.length > 0 && season.teams.every(team => team.seasonTeamId !== null)) ? 'complete' as const : 'partial' as const,
      acceptance: 'legacy-retained-projection' as const, seasons,
      managers: compatibility.managers.map(manager => ({ sourceManager: managerRef(manager.ownerId),
        record: { wins: manager.wins, losses: manager.losses, ties: manager.ties,
          authority: 'league-one-derived' as const, calculator: 'buildManagerHistory' as const }, seasons: manager.seasons,
        curatedHonors: [...manager.championshipYears.map(season => ({ leagueKey: 'league1' as const, season,
          title: 'Trophy Bowl' as const, authority: 'league-one-curated' as const, policy: 'existing-manager-championships' as const, curation: honorEvidence })),
        ...manager.promotionChampionshipYears.map(season => ({ leagueKey: 'league2' as const, season,
          title: 'Promotion Bowl' as const, authority: 'league-one-curated' as const, policy: 'existing-manager-championships' as const, curation: honorEvidence }))] })),
      compatibility, reasons,
      comparison: { kind: 'same-retained-source' as const, calculator: 'buildManagerHistory' as const,
        fields: ['annual-connections', 'owner-attribution', 'official-scores', 'manager-records', 'curated-honors'] as const } };
    return freeze(structuredClone({ ...result, revision: compatibleRevision(result) }));
  } catch { return { status: 'unavailable', reason: 'historical_continuity_source_invalid' }; }
}

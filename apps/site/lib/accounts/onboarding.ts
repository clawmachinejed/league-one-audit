import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSleeperUserIdentity, getSleeperUserLeagues, getSleeperDiscoverySeason,
  getOfficialLeagueAdministration } from '../sleeper';
import { getDatabase, withDatabaseAbortSignal } from '../database';
import { createProjectionStore } from '../projection-store';
import { createAccountEnrollmentStore, getLeagueAdministrationStore } from '../league-administration/store';
import { recordCapturedAdministration } from '../league-administration/runtime';
import { assessSleeperLeagueCapabilities } from '../league-capabilities';
import { sleeperLeagueLogo } from '../leagues';
import { matchingRoster } from './sleeper-link-preview';
import { AccountInputError } from './validation';

export type OnboardingPreview = {
  userId: string; username: string; displayName: string; avatarUrl: string | null; season: string;
  teams: { leagueId: string; leagueName: string; logo: string | null; rosterId: number | null;
    teamName: string | null; status: 'ready' | 'unsupported' | 'unavailable'; reason: string | null }[];
};

export async function previewSleeperUsername(username: string, signal: AbortSignal): Promise<OnboardingPreview> {
  const [identity, season] = await Promise.all([getSleeperUserIdentity(username, signal), getSleeperDiscoverySeason(signal)]);
  const leagues = await getSleeperUserLeagues(identity.userId, season, signal);
  // Bound work explicitly; never quietly present a truncated list as complete.
  if (leagues.length > 20) throw new AccountInputError('This account has more than 20 current-season leagues.');
  const teams: OnboardingPreview['teams'] = [];
  for (let start = 0; start < leagues.length; start += 4) {
    teams.push(...await Promise.all(leagues.slice(start, start + 4).map(async league => {
      const match = await matchingRoster(league, identity.userId, signal).catch(() => null);
      const status = !match ? 'unavailable' : ['supported', 'limited'].includes(league.capabilities?.status ?? '')
        ? 'ready' : 'unsupported';
      return { leagueId: league.id, leagueName: league.name, logo: sleeperLeagueLogo(league.avatar),
        rosterId: match?.rosterId ?? null, teamName: match?.teamName ?? null, status,
        reason: !match ? 'Team membership could not be confirmed. Try again later.'
          : status === 'unsupported' ? 'These league settings need support before this league can be imported.' : null } as OnboardingPreview['teams'][number];
    })));
    signal.throwIfAborted();
  }
  return { ...identity, season, teams };
}

/** One explicit import, using the existing registration, normalizer and writer.
 * Ordinary page reads never enroll leagues or start projection work. */
export async function importSleeperTeam(userId: string, leagueId: string, rosterId: number, signal: AbortSignal): Promise<void> {
  const season = await getSleeperDiscoverySeason(signal);
  const leagues = await getSleeperUserLeagues(userId, season, signal);
  const league = leagues.find(candidate => candidate.id === leagueId);
  if (!league) throw new AccountInputError('This league is no longer in the current Sleeper season.');
  const match = await matchingRoster(league, userId, signal);
  if (!match || match.rosterId !== rosterId) throw new AccountInputError('Team membership changed. Search again.');
  const existing = await getLeagueAdministrationStore().readEnrollment({ provider: 'sleeper', externalLeagueId: leagueId });
  if (existing.status === 'unavailable') throw new Error('League registration is unavailable.');
  if (existing.status === 'ready') {
    if (existing.enrollment.season !== Number(season)) throw new Error('League season changed.');
    return;
  }
  const database = withDatabaseAbortSignal(getDatabase(), signal);
  if (!database.enabled) throw new Error('Enrollment storage is unavailable.');
  const projection = createProjectionStore(database);
  const enrollment = createAccountEnrollmentStore(database);
  const workerId = randomUUID();
  const jobKey = `account-enrollment:${leagueId}`;
  const claim = await projection.acquireJob({ jobKey, jobType: 'account-enrollment', workerId,
    scheduledFor: new Date().toISOString(), leaseSeconds: 55, payload: { leagueId, season } });
  if (claim.kind !== 'acquired') throw new AccountInputError('This league is being imported. Try again shortly.');
  try {
    const documents = await getOfficialLeagueAdministration(leagueId, { revalidate: 0, signal });
    const raw = documents.find(document => document.family === 'league')?.payload;
    const report = assessSleeperLeagueCapabilities(raw);
    if (!['supported', 'limited'].includes(report.status)) throw new AccountInputError('These league settings are not supported for import.');
    const settings = raw as { league_id: string; season: string; name: string; scoring_settings: Record<string, number> };
    if (settings.league_id !== leagueId || settings.season !== season) throw new Error('League identity changed.');
    const rosters = documents.find(document => document.family === 'rosters')?.payload;
    if (!Array.isArray(rosters) || !rosters.some(row => row?.roster_id === rosterId
      && (row.owner_id === userId || Array.isArray(row.co_owners) && row.co_owners.includes(userId)))) {
      throw new AccountInputError('Team membership changed. Search again.');
    }
    const key = `sleeper-${leagueId}`;
    await enrollment.assertSourceIdentity(key, leagueId);
    {
      const registered = await projection.registerLeagueSeason({ leagueKey: key, leagueName: settings.name,
        season: Number(season), sleeperLeagueId: leagueId, scoringRules: settings.scoring_settings });
      if (registered.kind !== 'stored') throw new Error('League registration is unavailable.');
      try { await enrollment.prepare(registered.value.leagueId, Number(season), leagueId); }
      catch (error) {
        if (error instanceof Error && error.message.includes('account enrollment capacity reached')) {
          throw new AccountInputError('This invitation-only pilot has reached its league limit. Contact League One to add another league.');
        }
        throw error;
      }
    }
    const captured = await recordCapturedAdministration({ leagueKey: key, provider: 'sleeper',
      externalLeagueId: leagueId, season: Number(season) }, documents, { signal,
      fence: { jobKey, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 45_000).toISOString() } });
    if (captured.status !== 'stored') throw new Error('League evidence could not be saved.');
    await enrollment.activate(key, Number(season), leagueId);
    if (!await projection.completeJob(jobKey, workerId)) throw new Error('Enrollment ownership expired.');
  } catch (error) {
    await projection.failJob(jobKey, workerId, 'Account enrollment incomplete').catch(() => undefined);
    throw error;
  }
}

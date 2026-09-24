'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACCOUNT_SESSION_EVENT, readAccount, readSleeperLeagues } from './account-client';
import type { AccountView, SleeperLeagueDiscovery } from '../lib/accounts/contracts';
import { currentMatchupWeek } from '../lib/matchup-period';
import { displayedMatchupManagers } from '../lib/manager-display';
import { getMyFantasyLeagueSummary, myFantasyStandingsEvidence } from '../lib/my-fantasy';
import { currentMyFantasyMemberships, type MyFantasyMembership } from '../lib/my-fantasy-membership';
import type { MyFantasyLeague } from '../lib/my-fantasy-source';
import type { LeagueKey } from '../lib/leagues';
import { LeagueSiteProvider } from './league-context';
import { TeamPreferenceProvider, useTeamPreference } from './team-preference';
import { ManagerHonorsProvider, ManagerHonorsSeason } from './manager-honors';
import { MatchupsWithBoxScores } from './matchups-view';
import { useMatchupSnapshot } from './use-matchup-snapshot';
import { useSiteWeekRollover } from './use-site-week-rollover';
import { useMyFantasyStandingsRefresh } from './use-my-fantasy-standings-refresh';
import { Icon } from './icon';
import styles from './my-fantasy.module.css';

type AvailableLeague = Extract<MyFantasyLeague, { status: 'available' }>;
type Summary = ReturnType<typeof getMyFantasyLeagueSummary>;
type Report = { entry: AvailableLeague; summary: Summary; week: number; season: string };
type ReportHandler = (key: LeagueKey, report: Report) => void;

function place(value: number | null) {
  if (value === null) return '—';
  const suffix = value % 100 >= 11 && value % 100 <= 13 ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th');
  return `${value}${suffix}`;
}

function FantasyLeagueCard({ entry, teamIds, evaluatedAt, onReport, expanded, onToggle }: {
  entry: AvailableLeague; teamIds: number[]; evaluatedAt: string; onReport: ReportHandler;
  expanded: boolean; onToggle: () => void;
}) {
  const { site, source } = entry;
  const snapshot = useMatchupSnapshot({ leagueKey: site.key, ...source });
  const data = useMemo(() => displayedMatchupManagers(site.key, snapshot.data), [site.key, snapshot.data]);
  const { selected } = useTeamPreference(data.teams);
  const accountTeam = selected !== null && teamIds.includes(selected) ? selected : teamIds[0];
  const summary = useMemo(() => getMyFantasyLeagueSummary(data, snapshot.periodContext, entry.standingsData,
    accountTeam, new Date(evaluatedAt), true),
    [data, snapshot.periodContext, entry.standingsData, accountTeam, evaluatedAt]);
  useEffect(() => { onReport(site.key, { entry, summary, week: data.week, season: data.league.season }); },
    [site.key, entry, summary, data.week, data.league.season, onReport]);
  const router = useRouter();
  const refreshed = useRef<string | null>(null);
  useMyFantasyStandingsRefresh(myFantasyStandingsEvidence(data));
  const currentWeek = currentMatchupWeek(snapshot.periodContext);
  const basis = entry.standingsData?.projectionBasis;
  const wrongPeriod = data.week !== currentWeek || (basis?.kind === 'ready' && basis.week !== currentWeek)
    || (entry.standingsData !== null && entry.standingsData.league.season !== data.league.season);
  useEffect(() => {
    if (!wrongPeriod) return;
    const key = `${snapshot.periodContext.defaultSeason}:${currentWeek}`;
    if (refreshed.current === key) return;
    refreshed.current = key;
    router.refresh();
  }, [currentWeek, router, snapshot.periodContext.defaultSeason, wrongPeriod]);

  const issues = summary.attention.issues;
  return <ManagerHonorsSeason season={data.league.season}>
    <section id={`fantasy-${site.key}`} className={styles.leagueCard} data-my-fantasy-league={site.key} aria-label={site.name}>
      <div className={styles.leagueHeader}>
        <Image src={site.logo} width={30} height={30} alt="" />
        <div><h2>{site.name}</h2><p>Sleeper <span>· Week {data.week}</span></p></div>
        {issues.length > 0 && <span className={styles.attentionBadge}>{issues.length} need{issues.length === 1 ? 's' : ''} attention</span>}
        {summary.attention.status === 'unknown' && issues.length === 0 && <span className={styles.statusBadge}>Lineup unverified</span>}
      </div>
      {summary.matchup ? <MatchupsWithBoxScores key={`${site.key}:${data.league.season}:${data.week}:${summary.team?.id}`}
        matchups={[summary.matchup]} selected={summary.team?.id ?? null} leagueKey={site.key} season={data.league.season}
        week={data.week} refreshAutomatically={snapshot.periodContext.temporalState === 'active'} showBench benchExpandable
        showManagerTrophies={false} expandedOverride={expanded} onToggle={onToggle} singleColumn
        standings={source.standings?.season === data.league.season ? source.standings : null} observedAt={data.updatedAt}
      />
        : <div className={styles.unavailable}><strong>{summary.team?.name ?? 'Your team is temporarily unavailable'}</strong>
          <p>{summary.team ? `No matchup posted for Week ${data.week}.` : 'We could not match your account team to this week’s league data.'}</p></div>}
      {summary.team && <p className={styles.rankSummary} title={summary.projectedRankReason ?? undefined}>
        <span className="sr-only">Current rank </span><strong>{place(summary.currentRank)}</strong><span aria-hidden="true">→</span>
        <span className="sr-only"> to </span><strong>{place(summary.projectedRank)}</strong><span>projected</span>
        <span className="sr-only">{summary.projectedRank === null ? '. Projected rank unavailable.' : ''}</span>
      </p>}
      {data.warning && <p className={styles.notice}>{data.warning}</p>}
      <div className={styles.cardFooter}>
        <span>{summary.matchup?.status === 'final' ? 'Final' : summary.matchup?.status === 'live' ? 'In progress'
          : summary.matchup?.status === 'upcoming' ? 'Upcoming' : 'Matchup status unavailable'}</span>
        <Link href={`${site.prefix}/my-team`} aria-label={`Enter ${site.name}`}>Enter league <span aria-hidden="true">↗</span></Link>
      </div>
    </section>
  </ManagerHonorsSeason>;
}

function MyFantasyAccountView({ memberships, evaluatedAt, partialDiscovery }: {
  memberships: MyFantasyMembership[]; evaluatedAt: string; partialDiscovery: boolean;
}) {
  const leagues = memberships.map(membership => membership.entry);
  const router = useRouter();
  const [reports, setReports] = useState<Partial<Record<LeagueKey, Report>>>({});
  const [expandedLeague, setExpandedLeague] = useState<LeagueKey | null>(null);
  const [now, setNow] = useState(evaluatedAt);
  const report = useCallback<ReportHandler>((key, value) => { setReports(previous => ({ ...previous, [key]: value })); }, []);
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') setNow(new Date().toISOString()); };
    update();
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  const available = leagues.filter((entry): entry is AvailableLeague => entry.status === 'available');
  const rollover = available.map(entry => entry.source.rollover).filter(entry => entry !== null)
    .sort((a, b) => (a.nextRolloverAt ?? 'z').localeCompare(b.nextRolloverAt ?? 'z'))[0];
  useSiteWeekRollover(rollover);
  const currentReports = available.flatMap(entry => reports[entry.site.key]?.entry === entry ? [reports[entry.site.key]!] : []);
  const ready = currentReports.length === available.length;
  const periods = new Set(currentReports.map(entry => `${entry.season}:${entry.week}`));
  const samePeriod = ready && periods.size === 1;
  const projected = currentReports.filter(entry => entry.summary.projectedOutcome !== 'unavailable');
  const wins = projected.filter(entry => entry.summary.projectedOutcome === 'win').length;
  const losses = projected.filter(entry => entry.summary.projectedOutcome === 'loss').length;
  const ties = projected.filter(entry => entry.summary.projectedOutcome === 'tie').length;
  const attention = currentReports.filter(entry => entry.summary.attention.issues.length > 0);
  const unverified = leagues.length - currentReports.filter(entry => entry.summary.attention.status !== 'unknown').length;
  const completed = currentReports.filter(entry => entry.summary.attention.status === 'completed').length;
  const finalMatchups = currentReports.filter(entry => entry.summary.matchup?.status === 'final').length;
  const allClear = ready && unverified === 0 && attention.length === 0 && completed === 0 && leagues.length > 0;

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <h1>My Fantasy</h1>
      <p className={styles.overview} aria-live="polite">
        <span>{samePeriod ? `Week ${currentReports[0].week}` : 'Current matchups'}</span><span>{leagues.length} Leagues</span>
        {samePeriod && projected.length > 0 && <span>{wins}–{losses}{ties > 0 ? `–${ties}` : ''} projected{projected.length < leagues.length ? ` · ${projected.length} of ${leagues.length}` : ''}</span>}
        {attention.length > 0 && <span className={styles.attentionText}>{attention.length} need attention</span>}
      </p>
    </header>
    {partialDiscovery && <p className={styles.status}>Some associated Sleeper profiles could not be checked.</p>}
    {attention.length > 0 && <section className={styles.attention} aria-labelledby="fantasy-attention-heading">
      <h2 id="fantasy-attention-heading">Needs attention</h2>
      <ul>{attention.flatMap(({ entry, summary }) => summary.attention.issues.map((issue, index) => <li key={`${entry.site.key}:${issue.slot}:${index}`}>
        <Link href={`#fantasy-${entry.site.key}`}><strong>{entry.site.name}</strong><span>{issue.message}</span></Link>
      </li>))}</ul>
    </section>}
    {allClear && <p className={styles.clear}><Icon name="check" />All {leagues.length} lineups clear</p>}
    {ready && unverified > 0 && <p className={styles.status}>{unverified} lineup{unverified === 1 ? '' : 's'} could not be verified.</p>}
    {ready && finalMatchups === leagues.length && leagues.length > 0 && <p className={styles.clear}><Icon name="check" />All matchups complete</p>}
    {!ready && <p className={styles.status}>Checking your team selections…</p>}
    <div className={styles.leagues}>
      {memberships.map(({ entry, teamIds }) => entry.status === 'available'
        ? <LeagueSiteProvider key={entry.site.key} site={entry.site} leagueId={entry.leagueId}>
          <TeamPreferenceProvider key={entry.leagueId} leagueId={entry.leagueId}>
            <ManagerHonorsProvider data={entry.honors} season={entry.source.data.league.season}>
              <FantasyLeagueCard entry={entry} teamIds={teamIds} evaluatedAt={now} onReport={report}
                expanded={expandedLeague === entry.site.key}
                onToggle={() => setExpandedLeague(current => current === entry.site.key ? null : entry.site.key)} />
            </ManagerHonorsProvider>
          </TeamPreferenceProvider>
        </LeagueSiteProvider>
        : <section key={entry.site.key} className={styles.leagueCard} data-my-fantasy-league={entry.site.key} aria-label={entry.site.name}>
          <div className={styles.leagueHeader}><Image src={entry.site.logo} width={30} height={30} alt="" />
            <div><h2>{entry.site.name}</h2><p>Sleeper</p></div></div>
          <div className={styles.unavailable}><strong>League data temporarily unavailable</strong><p>Your other leagues are still available.</p></div>
          <div className={styles.cardFooter}><button type="button" onClick={() => router.refresh()} aria-label={`Retry ${entry.site.name}`}>Try again</button><Link href={`${entry.site.prefix}/my-team`} aria-label={`Enter ${entry.site.name}`}>Enter league ↗</Link></div>
        </section>)}
    </div>
    <p className={styles.footnote}>Current Sleeper league membership confirms the cards; the latest stored roster link selects your team. If you have more than one linked team in a league, your saved My Team choice applies. Matchups check for updates every minute while visible.</p>
  </div>;
}

type FantasyAccountState = { status: 'loading' | 'guest' | 'denied' | 'disabled' | 'unavailable' }
  | { status: 'ready'; account: AccountView; discovery: SleeperLeagueDiscovery | null };

export function MyFantasyView({ leagues, evaluatedAt, preview = false }: {
  leagues: MyFantasyLeague[]; evaluatedAt: string; preview?: boolean;
}) {
  const [state, setState] = useState<FantasyAccountState>({ status: 'loading' });
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => { setState({ status: 'loading' }); setRefresh(value => value + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const account = await readAccount(controller.signal);
        if (controller.signal.aborted) return;
        if (account.status !== 'ready') { setState(account); return; }
        if (!account.data.links.length) { setState({ status: 'ready', account: account.data, discovery: null }); return; }
        const discovered = await readSleeperLeagues(account.data.profile.id, controller.signal);
        if (controller.signal.aborted) return;
        setState(discovered.status === 'ready'
          ? { status: 'ready', account: account.data, discovery: discovered.data }
          : { status: 'unavailable' });
      } catch { if (!controller.signal.aborted) setState({ status: 'unavailable' }); }
    })();
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    const onRestore = (event: PageTransitionEvent) => { if (event.persisted) reload(); };
    let channel: BroadcastChannel | null = null;
    try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(ACCOUNT_SESSION_EVENT); }
    catch { /* Focus and visibility checks still refresh the account. */ }
    if (channel) channel.onmessage = reload;
    window.addEventListener(ACCOUNT_SESSION_EVENT, reload);
    window.addEventListener('focus', reload);
    window.addEventListener('pageshow', onRestore);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      channel?.close();
      window.removeEventListener(ACCOUNT_SESSION_EVENT, reload);
      window.removeEventListener('focus', reload);
      window.removeEventListener('pageshow', onRestore);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  if (state.status === 'loading') return <div className={styles.page}><h1>My Fantasy</h1><p role="status">Checking your leagues…</p></div>;
  if (state.status !== 'ready') {
    const signInNeeded = state.status === 'guest' || state.status === 'denied';
    const message = signInNeeded
      ? 'Sign in to see the leagues where your associated Sleeper profile manages a team.'
      : state.status === 'disabled'
        ? preview
          ? 'Accounts are intentionally disabled in this preview. Your personal league cards cannot be shown here.'
          : 'Accounts are disabled for this deployment. Your personal league cards cannot be shown here.'
        : 'Your league participation is temporarily unavailable.';
    return <div className={styles.page}><h1>My Fantasy</h1>
    <section className={styles.unavailable} role="status"><p>{message}</p>
      {signInNeeded
        ? <Link href="/sign-in" prefetch={false}>Sign in</Link>
        : state.status === 'unavailable' && <button type="button" onClick={reload}>Try again</button>}
    </section></div>;
  }

  const memberships = state.discovery ? currentMyFantasyMemberships(leagues, state.account, state.discovery) : [];
  if (!memberships.length) return <div className={styles.page}><h1>My Fantasy</h1>
    <section className={styles.unavailable} role="status"><p>{state.account.links.length
      ? 'No current team participation could be confirmed in the supported leagues. Check your associated Sleeper profiles or try again.'
      : 'Associate a Sleeper profile with your website account to see your leagues here.'}</p>
      <Link href="/account" prefetch={false}>Manage Sleeper profiles</Link>
      {state.account.links.length > 0 && <button type="button" onClick={reload}>Try again</button>}
    </section></div>;
  return <MyFantasyAccountView key={state.account.profile.id} memberships={memberships} evaluatedAt={evaluatedAt}
    partialDiscovery={state.discovery?.status === 'partial'} />;
}

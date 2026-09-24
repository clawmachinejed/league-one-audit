'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentMatchupWeek } from '../lib/matchup-period';
import { displayedMatchupManagers } from '../lib/manager-display';
import { getMyFantasyLeagueSummary, myFantasyStandingsEvidence } from '../lib/my-fantasy';
import { selectedBrowserMyFantasyMemberships,
  type MyFantasyMembership } from '../lib/my-fantasy-membership';
import type { MyFantasyLeague } from '../lib/my-fantasy-source';
import type { LeagueKey } from '../lib/leagues';
import { LeagueSiteProvider } from './league-context';
import { TeamPreferenceProvider, useBrowserTeamSelections, useTeamPreference } from './team-preference';
import { ManagerHonorsProvider, ManagerHonorsSeason } from './manager-honors';
import { MatchupsWithBoxScores } from './matchups-view';
import { useMatchupSnapshot } from './use-matchup-snapshot';
import { useSiteWeekRollover } from './use-site-week-rollover';
import { useMyFantasyStandingsRefresh } from './use-my-fantasy-standings-refresh';
import { Icon } from './icon';
import { relativeRankBand } from '../lib/relative-rank';
import styles from './my-fantasy.module.css';

type AvailableLeague = Extract<MyFantasyLeague, { status: 'available' }>;
type Summary = ReturnType<typeof getMyFantasyLeagueSummary>;
type Report = { entry: AvailableLeague; summary: Summary; week: number; season: string; updatedAt: string };
type ReportHandler = (key: LeagueKey, report: Report) => void;

function place(value: number | null) {
  if (value === null) return '—';
  const suffix = value % 100 >= 11 && value % 100 <= 13 ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th');
  return `${value}${suffix}`;
}

function ageLabel(value: string, now: string) {
  const minutes = Math.floor((Date.parse(now) - Date.parse(value)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < -1) return 'Update time unavailable';
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `Updated ${hours} hr ago` : `Updated ${Math.floor(hours / 24)} days ago`;
}

function LeagueHeader({ entry, week, attention }: { entry: MyFantasyLeague; week?: number; attention?: Summary['attention'] }) {
  const issue = (attention?.issues.length ?? 0) > 0;
  const state = issue ? 'alert' : attention?.status === 'verified' ? 'clear' : 'unknown';
  const description = issue ? `${attention!.issues.length} starting position${attention!.issues.length === 1 ? '' : 's'} need attention`
    : state === 'clear' ? 'Starting lineup verified clear'
      : attention?.status === 'completed' ? 'Matchup complete' : 'Starting lineup unverified';
  return <header className={styles.leagueHeader} data-fantasy-header>
    <Image className={styles.leagueLogo} src={entry.site.logo} width={40} height={40} alt="" />
    <h2>{entry.site.name}</h2>
    <p className={styles.leagueMetadata} data-fantasy-metadata>Sleeper{week !== undefined && <> · Week {week}</>}</p>
    <Link className={styles.enterLeague} data-fantasy-enter href={`${entry.site.prefix}/my-team`}
      aria-label={`Enter ${entry.site.name}`}>Enter League <span aria-hidden="true">›</span></Link>
    <span className={`${styles.statusDot} ${styles[state]}`} data-fantasy-status={state}
      role="img" aria-label={description} />
  </header>;
}

function FantasyLeagueCard({ entry, teamIds, evaluatedAt, onReport, expanded, onToggle }: {
  entry: AvailableLeague; teamIds: number[]; evaluatedAt: string; onReport: ReportHandler;
  expanded: boolean; onToggle: () => void;
}) {
  const { site, source } = entry;
  const snapshot = useMatchupSnapshot({ leagueKey: site.key, ...source });
  const data = useMemo(() => displayedMatchupManagers(site.key, snapshot.data), [site.key, snapshot.data]);
  const { selected } = useTeamPreference(data.teams);
  const selectedTeam = selected !== null && teamIds.includes(selected) ? selected : teamIds[0];
  const summary = useMemo(() => getMyFantasyLeagueSummary(data, snapshot.periodContext, entry.standingsData,
    selectedTeam, new Date(evaluatedAt), true),
    [data, snapshot.periodContext, entry.standingsData, selectedTeam, evaluatedAt]);
  useEffect(() => { onReport(site.key, { entry, summary, week: data.week, season: data.league.season, updatedAt: snapshot.updatedAt }); },
    [site.key, entry, summary, data.week, data.league.season, snapshot.updatedAt, onReport]);
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

  const ranks = summary.team ? <span className={styles.rankSummary} data-fantasy-rank title={summary.projectedRankReason ?? undefined} aria-hidden="true">
    <strong data-rank-band={relativeRankBand(summary.currentRank, data.teams.length)}>{place(summary.currentRank)}</strong>
    <span>→</span><strong data-rank-band={relativeRankBand(summary.projectedRank, data.teams.length)}>{place(summary.projectedRank)}</strong>
  </span> : null;
  const rankDescription = `Current rank ${summary.currentRank === null ? 'unavailable' : place(summary.currentRank)}; projected rank ${summary.projectedRank === null ? 'unavailable' : place(summary.projectedRank)}.`;
  return <ManagerHonorsSeason season={data.league.season}>
    <section id={`fantasy-${site.key}`} className={styles.leagueCard} data-my-fantasy-league={site.key} aria-label={site.name}>
      <LeagueHeader entry={entry} week={data.week} attention={summary.attention} />
      {summary.matchup ? <MatchupsWithBoxScores key={`${site.key}:${data.league.season}:${data.week}:${summary.team?.id}`}
        matchups={[summary.matchup]} selected={summary.team?.id ?? null} leagueKey={site.key} season={data.league.season}
        week={data.week} refreshAutomatically={snapshot.periodContext.temporalState === 'active'} showBench benchExpandable
        showManagerTrophies={false} expandedOverride={expanded} onToggle={onToggle} singleColumn
        presentation="fantasy" leagueSize={data.teams.length} summaryFooter={ranks} summaryDescription={rankDescription}
        standings={source.standings?.season === data.league.season ? source.standings : null} observedAt={data.updatedAt}
      />
        : <div className={styles.unavailable}><strong>{summary.team?.name ?? 'Your team is temporarily unavailable'}</strong>
          <p>{summary.team ? `No matchup posted for Week ${data.week}.` : 'We could not match your selected team to this week’s league data.'}</p></div>}
      {data.warning && <p className={styles.notice}>{data.warning}</p>}
    </section>
  </ManagerHonorsSeason>;
}

function MyFantasyLeaguesView({ memberships, evaluatedAt }: {
  memberships: MyFantasyMembership[]; evaluatedAt: string;
}) {
  const leagues = memberships.map(membership => membership.entry);
  const router = useRouter();
  const [reports, setReports] = useState<Partial<Record<LeagueKey, Report>>>({});
  const [expandedLeagues, setExpandedLeagues] = useState<Partial<Record<LeagueKey, boolean>>>({});
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
  const issueCount = attention.reduce((total, entry) => total + entry.summary.attention.issues.length, 0);
  const finalMatchups = currentReports.filter(entry => entry.summary.matchup?.status === 'final').length;
  const noIssues = ready && attention.length === 0 && leagues.length > 0;
  // The oldest successful source/snapshot update bounds the cross-league claim.
  const updateTimes = currentReports.map(entry => Date.parse(entry.updatedAt));
  const oldestUpdate = ready && currentReports.length === leagues.length && updateTimes.length > 0
    && updateTimes.every(time => Number.isFinite(time) && time <= Date.parse(now) + 60_000)
    ? new Date(Math.min(...updateTimes)).toISOString() : null;

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <h1>My Fantasy</h1>
      <p className={styles.freshness} title={oldestUpdate ? `Oldest successful matchup update across these leagues: ${oldestUpdate}` : undefined}>
        {oldestUpdate ? ageLabel(oldestUpdate, now) : 'Update time unavailable'}
      </p>
      <p className={styles.overview} aria-live="polite">
        <span>{samePeriod ? `Week ${currentReports[0].week}` : 'Current matchups'}</span><span>{leagues.length} {leagues.length === 1 ? 'League' : 'Leagues'}</span>
        {samePeriod && projected.length > 0 && <span>{wins}–{losses}{ties > 0 ? `–${ties}` : ''} projected{projected.length < leagues.length ? ` · ${projected.length} of ${leagues.length}` : ''}</span>}
      </p>
    </header>
    {attention.length > 0 && <section className={styles.attention} aria-labelledby="fantasy-attention-heading">
      <h2 id="fantasy-attention-heading"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.5a2 2 0 0 1 3.4 0l8 14A2 2 0 0 1 20 20.5H4a2 2 0 0 1-1.7-3z" fill="currentColor" /><path d="M12 8v5m0 3v.2" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" /></svg>
        {issueCount} starting position{issueCount === 1 ? '' : 's'} need{issueCount === 1 ? 's' : ''} attention</h2>
      <ul>{attention.flatMap(({ entry, summary }) => summary.attention.issues.map((issue, index) => <li key={`${entry.site.key}:${issue.slot}:${index}`}>
        <Link className={styles.attentionRow} href={`#fantasy-${entry.site.key}`} aria-label={`${issue.message} ${entry.site.name}.`}>
          <span className={`${styles.statusDot} ${issue.severity === 'caution' ? styles.caution : styles.alert}`} aria-hidden="true" />
          <strong className={styles.attentionPlayer}>{issue.kind === 'empty' ? `Empty ${issue.slot}` : issue.playerName}</strong>
          <span className={issue.severity === 'caution' ? styles.cautionText : styles.alertText}>{issue.statusLabel}</span>
          <span className={styles.startingContext}>Starting</span><span className={styles.attentionLeague}>{entry.site.name}</span>
        </Link>
      </li>))}</ul>
    </section>}
    {noIssues && <section className={styles.noIssues} data-fantasy-no-issues aria-label="Lineup attention">
      <span className={styles.clearIcon} data-fantasy-clear-icon aria-hidden="true"><Icon name="check" /></span>
      <strong>No lineup issues</strong>
    </section>}
    {ready && finalMatchups === leagues.length && leagues.length > 0 && <p className={styles.clear}><Icon name="check" />All matchups complete</p>}
    {!ready && <p className={styles.status}>Checking your team selections…</p>}
    <div className={styles.leagues}>
      {memberships.map(({ entry, teamIds }) => entry.status === 'available'
        ? <LeagueSiteProvider key={entry.site.key} site={entry.site} leagueId={entry.leagueId}>
          <TeamPreferenceProvider key={entry.leagueId} leagueId={entry.leagueId}>
            <ManagerHonorsProvider data={entry.honors} season={entry.source.data.league.season}>
              <FantasyLeagueCard entry={entry} teamIds={teamIds} evaluatedAt={now} onReport={report}
                expanded={expandedLeagues[entry.site.key] ?? false}
                onToggle={() => setExpandedLeagues(current => ({ ...current, [entry.site.key]: !current[entry.site.key] }))} />
            </ManagerHonorsProvider>
          </TeamPreferenceProvider>
        </LeagueSiteProvider>
        : <section key={entry.site.key} className={styles.leagueCard} data-my-fantasy-league={entry.site.key} aria-label={entry.site.name}>
          <LeagueHeader entry={entry} />
          <div className={styles.unavailable}><strong>League data temporarily unavailable</strong><p>Your other leagues are still available.</p></div>
          <div className={styles.cardFooter}><button type="button" onClick={() => router.refresh()} aria-label={`Retry ${entry.site.name}`}>Try again</button></div>
        </section>)}
    </div>
    <p className={styles.footnote}>Showing My Team choices saved on each league’s manager page in this browser.</p>
  </div>;
}

/** Temporary public-team selection, explicitly chosen by the user for every environment.
 * Account/provider membership will replace this rule in a later phase. */
export function MyFantasyView({ leagues, evaluatedAt }: { leagues: MyFantasyLeague[]; evaluatedAt: string }) {
  const leagueIds = useMemo(() => leagues.map(entry => entry.leagueId ?? ''), [leagues]);
  const selections = useBrowserTeamSelections(leagueIds);
  const memberships = useMemo(() => selectedBrowserMyFantasyMemberships(leagues, selections), [leagues, selections]);
  if (!memberships.length) return <div className={styles.page}><h1>My Fantasy</h1>
    <section className={styles.unavailable} role="status">
      <p>Select My Team on a league’s manager page to show that team here.</p>
      {leagues.map(entry => <Link key={entry.site.key} href={`${entry.site.prefix}/managers`}>{entry.site.name} managers</Link>)}
    </section></div>;
  return <MyFantasyLeaguesView memberships={memberships} evaluatedAt={evaluatedAt} />;
}

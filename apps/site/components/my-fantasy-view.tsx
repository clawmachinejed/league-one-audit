'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { currentMatchupWeek } from '../lib/matchup-period';
import { displayedMatchupManagers } from '../lib/manager-display';
import { getMyFantasyLeagueSummary, myFantasyStandingsEvidence } from '../lib/my-fantasy';
import { selectedBrowserMyFantasyMemberships,
  type MyFantasyMembership } from '../lib/my-fantasy-membership';
import type { MyFantasyLeague } from '../lib/my-fantasy-source';
import { LEAGUE_SITES, type LeagueKey } from '../lib/leagues';
import { PageIntro } from './page-intro';
import { WeekSelector } from './week-selector';
import matchupStyles from './matchups.module.css';
import { LeagueSiteProvider } from './league-context';
import { TeamPreferenceProvider, useBrowserTeamSelections, useTeamPreference } from './team-preference';
import { ManagerHonorsProvider, ManagerHonorsSeason } from './manager-honors';
import { MatchupsWithBoxScores } from './matchups-view';
import { useMatchupSnapshot } from './use-matchup-snapshot';
import { useSiteWeekRollover } from './use-site-week-rollover';
import { useMyFantasyStandingsRefresh } from './use-my-fantasy-standings-refresh';
import { Icon } from './icon';
import { relativeRankBand } from '../lib/relative-rank';
import { compactPlayerName } from '../lib/player-name';
import { rosterSlotName } from '../lib/roster-slot';
import { RosterSlot } from './roster-slot';
import styles from './my-fantasy.module.css';

type AvailableLeague = Extract<MyFantasyLeague, { status: 'available' }>;
type Summary = ReturnType<typeof getMyFantasyLeagueSummary>;
type Report = { entry: AvailableLeague; summary: Summary; week: number; currentWeek: number; season: string; updatedAt: string };
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

function AttentionPlayerName({ name, slot }: { name: string; slot: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const label = ref.current;
    if (!label) return;
    let active = true;
    // Matchups also measures the full name before using compactPlayerName.
    // Allow a long compact surname to wrap rather than hiding part of it.
    const fit = () => {
      if (!active || !label.clientWidth) return;
      label.removeAttribute('data-compact');
      if (label.scrollWidth > label.clientWidth) label.dataset.compact = 'true';
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(label);
    void document.fonts.ready.then(fit);
    return () => { active = false; observer.disconnect(); };
  }, [name, slot]);
  return <strong ref={ref} className={styles.attentionPlayer} data-fantasy-attention-player title={name}>
    <span className="sr-only">{name}</span>
    <span className={styles.fullPlayerName} aria-hidden="true">{name}</span>
    <span className={styles.shortPlayerName} aria-hidden="true">{compactPlayerName(name, slot)}</span>
  </strong>;
}

function LeagueHeader({ entry, week, requestedWeek, attention }: { entry: MyFantasyLeague; week?: number; requestedWeek?: number; attention?: Summary['attention'] }) {
  const issue = (attention?.issues.length ?? 0) > 0;
  const state = issue ? 'alert' : attention?.status === 'verified' ? 'clear' : 'unknown';
  const description = issue ? `${attention!.issues.length} starting position${attention!.issues.length === 1 ? '' : 's'} need attention`
    : state === 'clear' ? 'Starting lineup verified clear'
      : attention?.status === 'completed' ? 'Matchup complete' : 'Starting lineup unverified';
  return <header className={styles.leagueHeader} data-fantasy-header>
    <Image className={styles.leagueLogo} src={entry.site.logo} width={40} height={40} alt="" />
    <h2>{entry.site.name}</h2>
    <p className={styles.leagueMetadata} data-fantasy-metadata>Sleeper{week !== undefined && <> · Week {week}</>}</p>
    <Link className={styles.enterLeague} data-fantasy-enter href={`${entry.site.prefix}/my-team${requestedWeek === undefined ? '' : `?week=${requestedWeek}`}`}
      aria-label={`Enter ${entry.site.name}`}>Enter League <span aria-hidden="true">›</span></Link>
    <span className={`${styles.statusDot} ${styles[state]}`} data-fantasy-status={state}
      role="img" aria-label={description} />
  </header>;
}

function FantasyLeagueCard({ entry, teamIds, evaluatedAt, onReport, expanded, onToggle, requestedWeek }: {
  entry: AvailableLeague; teamIds: number[]; evaluatedAt: string; onReport: ReportHandler;
  expanded: boolean; onToggle: () => void; requestedWeek?: number;
}) {
  const { site, source } = entry;
  const snapshot = useMatchupSnapshot({ leagueKey: site.key, ...source });
  const data = useMemo(() => displayedMatchupManagers(site.key, snapshot.data), [site.key, snapshot.data]);
  const { selected } = useTeamPreference(data.teams);
  const selectedTeam = selected !== null && teamIds.includes(selected) ? selected : teamIds[0];
  const summary = useMemo(() => getMyFantasyLeagueSummary(data, snapshot.periodContext, entry.standingsData,
    selectedTeam, new Date(evaluatedAt), true),
    [data, snapshot.periodContext, entry.standingsData, selectedTeam, evaluatedAt]);
  const currentWeek = currentMatchupWeek(snapshot.periodContext);
  useEffect(() => { onReport(site.key, { entry, summary, week: data.week, currentWeek, season: data.league.season, updatedAt: snapshot.updatedAt }); },
    [site.key, entry, summary, data.week, currentWeek, data.league.season, snapshot.updatedAt, onReport]);
  const router = useRouter();
  const refreshed = useRef<string | null>(null);
  useMyFantasyStandingsRefresh(myFantasyStandingsEvidence(data));
  const basis = entry.standingsData?.projectionBasis;
  const wrongPeriod = data.week !== currentWeek || (basis?.kind === 'ready' && basis.week !== currentWeek)
    || (entry.standingsData !== null && entry.standingsData.league.season !== data.league.season);
  useEffect(() => {
    if (requestedWeek !== undefined || !wrongPeriod) return;
    const key = `${snapshot.periodContext.defaultSeason}:${currentWeek}`;
    if (refreshed.current === key) return;
    refreshed.current = key;
    router.refresh();
  }, [currentWeek, requestedWeek, router, snapshot.periodContext.defaultSeason, wrongPeriod]);

  const ranks = summary.team ? <span className={styles.rankSummary} data-fantasy-rank title={summary.projectedRankReason ?? undefined} aria-hidden="true">
    <strong data-rank-band={relativeRankBand(summary.currentRank, data.teams.length)}>{place(summary.currentRank)}</strong>
    <span>→</span><strong data-rank-band={relativeRankBand(summary.projectedRank, data.teams.length)}>{place(summary.projectedRank)}</strong>
  </span> : null;
  const rankDescription = `Current rank ${summary.currentRank === null ? 'unavailable' : place(summary.currentRank)}; projected rank ${summary.projectedRank === null ? 'unavailable' : place(summary.projectedRank)}.`;
  return <ManagerHonorsSeason season={data.league.season}>
    <section id={`fantasy-${site.key}`} className={styles.leagueCard} data-my-fantasy-league={site.key} aria-label={site.name}>
      <LeagueHeader entry={entry} week={data.week} requestedWeek={requestedWeek} attention={summary.attention} />
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

function MyFantasyLeaguesView({ memberships, evaluatedAt, requestedWeek, fallbackLeague }: {
  memberships: MyFantasyMembership[]; evaluatedAt: string; requestedWeek?: number; fallbackLeague?: AvailableLeague;
}) {
  const leagues = memberships.map(membership => membership.entry);
  const router = useRouter();
  const [reports, setReports] = useState<Partial<Record<LeagueKey, Report>>>({});
  const [expandedLeagues, setExpandedLeagues] = useState<Partial<Record<LeagueKey, boolean>>>({});
  const [attentionExpanded, setAttentionExpanded] = useState(true);
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
  const calendarLeagues = available.length ? available : fallbackLeague ? [fallbackLeague] : [];
  const rollover = calendarLeagues.map(entry => entry.source.rollover).filter(entry => entry !== null)
    .sort((a, b) => (a.nextRolloverAt ?? 'z').localeCompare(b.nextRolloverAt ?? 'z'))[0];
  useSiteWeekRollover(rollover);
  const currentReports = available.flatMap(entry => reports[entry.site.key]?.entry === entry ? [reports[entry.site.key]!] : []);
  const ready = currentReports.length === available.length;
  const headerLeague = available[0] ?? fallbackLeague;
  const headerReport = currentReports.find(report => report.entry === headerLeague);
  const season = headerReport?.season ?? headerLeague?.source.data.league.season
    ?? String(new Date(evaluatedAt).getUTCFullYear());
  const selectedWeek = requestedWeek ?? headerReport?.week ?? headerLeague?.source.data.week;
  const currentWeek = headerLeague ? headerLeague.source.rollover?.week ?? headerReport?.currentWeek
    ?? currentMatchupWeek(headerLeague.source.periodContext) : undefined;
  const periods = new Set(currentReports.map(entry => `${entry.season}:${entry.week}`));
  const samePeriod = ready && periods.size === 1;
  const overviewWeek = samePeriod ? currentReports[0].week : requestedWeek ?? (leagues.length === 0 ? selectedWeek : undefined);
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
      <div className={matchupStyles.toolbar} data-fantasy-toolbar>
        <PageIntro title="My Fantasy" league={{ season }} />
        {headerLeague && selectedWeek !== undefined && currentWeek !== undefined && <WeekSelector
          label="Matchup week" week={selectedWeek} currentWeek={currentWeek} maxWeek={headerLeague.source.data.league.maxWeek}
          onChange={week => router.push(week === currentWeek ? '/my-fantasy' : `/my-fantasy?week=${week}`)}
          hrefForWeek={week => `/my-fantasy?week=${week}`} currentHref="/my-fantasy" />}
      </div>
      <div className={styles.summaryRow} data-fantasy-overview>
        <p className={styles.overview} aria-live="polite">
          <span>{overviewWeek === undefined ? 'Current matchups' : `Week ${overviewWeek}`}</span><span>{leagues.length} {leagues.length === 1 ? 'League' : 'Leagues'}</span>
          {samePeriod && projected.length > 0 && <span>{wins}–{losses}{ties > 0 ? `–${ties}` : ''} projected{projected.length < leagues.length ? ` · ${projected.length} of ${leagues.length}` : ''}</span>}
        </p>
        {leagues.length > 0 && <p className={styles.freshness} title={oldestUpdate ? `Oldest successful matchup update across these leagues: ${oldestUpdate}` : undefined}>
          {oldestUpdate ? ageLabel(oldestUpdate, now) : 'Update time unavailable'}
        </p>}
      </div>
    </header>
    {leagues.length === 0 && <section className={styles.unavailable} role="status">
      <p>Select My Team on a league’s manager page to show that team here.</p>
      {Object.values(LEAGUE_SITES).map(site => <Link key={site.key} href={`${site.prefix}/managers`}>{site.name} managers</Link>)}
    </section>}
    {attention.length > 0 && <section className={styles.attention} aria-labelledby="fantasy-attention-heading">
      <h2 id="fantasy-attention-heading"><button type="button" className={styles.attentionToggle} data-fantasy-attention-toggle
        aria-expanded={attentionExpanded} aria-controls="fantasy-attention-list" onClick={() => setAttentionExpanded(value => !value)}>
        <span className={`${styles.statusDot} ${styles.attentionIcon}`} data-fantasy-attention-icon aria-hidden="true">!</span>
        <span>{issueCount} Starter{issueCount === 1 ? '' : 's'} need{issueCount === 1 ? 's' : ''} attention</span>
        <span className={styles.attentionChevron} aria-hidden="true">{attentionExpanded ? '−' : '+'}</span>
      </button></h2>
      <ul id="fantasy-attention-list" data-fantasy-attention-list hidden={!attentionExpanded}>{attention.flatMap(({ entry, summary }) => summary.attention.issues.map((issue, index) => <li key={`${entry.site.key}:${issue.slot}:${index}`}>
        <Link className={styles.attentionRow} data-fantasy-attention-row href={`#fantasy-${entry.site.key}`} aria-label={`Starting ${rosterSlotName(issue.slot)}. ${issue.message} ${entry.site.name}.`}>
          <span className={styles.attentionPosition} data-fantasy-attention-slot><RosterSlot slot={issue.slot} className={styles.rosterSlot} /></span>
          <AttentionPlayerName name={issue.kind === 'empty' ? 'EMPTY' : issue.playerName} slot={issue.slot} />
          <span className={`${styles.attentionDesignation} ${issue.severity === 'caution' ? styles.cautionText : styles.alertText}`} data-fantasy-attention-designation>
            {issue.kind === 'empty' ? 'No Player' : issue.kind === 'bye' ? 'Bye' : issue.statusLabel}</span>
          <span className={styles.attentionLeague} data-fantasy-attention-league>{entry.site.name}</span>
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
              <FantasyLeagueCard key={`${entry.source.data.league.season}:${entry.source.data.week}`} entry={entry} teamIds={teamIds} evaluatedAt={now} onReport={report} requestedWeek={requestedWeek}
                expanded={expandedLeagues[entry.site.key] ?? false}
                onToggle={() => setExpandedLeagues(current => ({ ...current, [entry.site.key]: !current[entry.site.key] }))} />
            </ManagerHonorsProvider>
          </TeamPreferenceProvider>
        </LeagueSiteProvider>
        : <section key={entry.site.key} className={styles.leagueCard} data-my-fantasy-league={entry.site.key} aria-label={entry.site.name}>
          <LeagueHeader entry={entry} week={requestedWeek} requestedWeek={requestedWeek} />
          <div className={styles.unavailable}><strong>League data temporarily unavailable</strong><p>Your other leagues are still available.</p></div>
          <div className={styles.cardFooter}><button type="button" onClick={() => router.refresh()} aria-label={`Retry ${entry.site.name}`}>Try again</button></div>
        </section>)}
    </div>
  </div>;
}

/** Temporary public-team selection, explicitly chosen by the user for every environment.
 * Account/provider membership will replace this rule in a later phase. */
export function MyFantasyView({ leagues, evaluatedAt, requestedWeek }: { leagues: MyFantasyLeague[]; evaluatedAt: string; requestedWeek?: number }) {
  const leagueIds = useMemo(() => leagues.map(entry => entry.leagueId ?? ''), [leagues]);
  const selections = useBrowserTeamSelections(leagueIds);
  const memberships = useMemo(() => selectedBrowserMyFantasyMemberships(leagues, selections), [leagues, selections]);
  const fallbackLeague = leagues.find((entry): entry is AvailableLeague => entry.status === 'available');
  return <MyFantasyLeaguesView memberships={memberships} evaluatedAt={evaluatedAt} requestedWeek={requestedWeek} fallbackLeague={fallbackLeague} />;
}

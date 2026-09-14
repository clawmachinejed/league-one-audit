'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nextAllPlayerRefreshAt } from '../lib/all-player-refresh-schedule';
import { injuryStatusLabel } from '../lib/injury-status';
import { formatNflGame } from '../lib/nfl-schedule';
import { orderRosterTeams } from '../lib/roster-metrics';
import type { League, RosterPlayer, RosterSection, RosterTeam, RostersData } from '../lib/types';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, Updated, Warning } from './league-primitives';
import { RosterWeekSelector } from './roster-week-selector';
import styles from './rosters.module.css';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type RosterRefreshWeek = number | null | 'unknown';
type CachedRosters = Readonly<{ data: RostersData; refreshAt: number; provisionalWeek: RosterRefreshWeek }>;
const REFRESH_SETTLE_MS = 3 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

export function nextRosterRefreshAt(now: number): number {
  return nextAllPlayerRefreshAt(new Date(now - REFRESH_SETTLE_MS)).getTime() + REFRESH_SETTLE_MS;
}

export function rosterResponseMatchesSelection(data: RostersData, responseLeague: string | null,
  leagueKey: string, season: string, week: number): boolean {
  return responseLeague === leagueKey && data.league?.season === season && data.week === week
    && Array.isArray(data.teams) && Number.isInteger(data.currentWeek)
    && data.currentWeek >= 1 && data.currentWeek <= 18 && data.league.week === data.currentWeek;
}

export function rosterMetricsRegressed(previous: RostersData, next: RostersData): boolean {
  const before = Date.parse(previous.playerMetrics.observedAt ?? '');
  if (!Number.isFinite(before) || previous.playerMetrics.status === 'unavailable') return false;
  const after = Date.parse(next.playerMetrics.observedAt ?? '');
  return next.playerMetrics.status === 'unavailable' || !Number.isFinite(after) || after < before;
}

/** The active scoring week included by this selected-week response, if any. */
export function rosterProvisionalWeek(value: string | null, data: RostersData): RosterRefreshWeek | undefined {
  if (value === 'unknown') return 'unknown';
  if (value === 'none') return null;
  if (value === null || !/^(?:[1-9]|1[0-8])$/u.test(value)) return undefined;
  const week = Number(value);
  return week <= data.week ? week : undefined;
}

function PlayerStatsUpdated({ data }: { data: RostersData }) {
  const observedAt = data.playerMetrics.observedAt;
  const date = observedAt === null ? null : new Date(observedAt);
  const label = date && Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) : null;
  return <p className="updated" data-player-stats-updated aria-live="polite">{label
    ? <>Player stats saved {label} ET{data.playerMetrics.status === 'provisional' ? ' · Partial statistics' : ''}</>
    : 'Player statistics unavailable'}</p>;
}

function number(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(1);
}

function playerPpg(value: number | null): string {
  return value === null || !Number.isFinite(value) || value === 0 ? '—' : value.toFixed(1);
}

function positionRank(player: RosterPlayer): string {
  return player.positionRank !== null && Number.isInteger(player.positionRank)
    && player.positionRank > 0 && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(player.position)
    ? `${player.position}${player.positionRank}` : '—';
}

function record(team: RosterTeam): string {
  if (![team.wins, team.losses, team.ties].every((value) => value !== null && Number.isInteger(value) && value >= 0)) return '—';
  return `${team.wins!}–${team.losses!}${team.ties ? `–${team.ties}` : ''}`;
}

export function ordinal(value: number | null): string {
  if (value === null || !Number.isInteger(value) || value < 1) return '—';
  const lastTwo = value % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th'
    : value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

function PlayerRow({ player }: { player: RosterPlayer }) {
  const injury = injuryStatusLabel(player.injuryStatus);
  const details = [player.position === '—' ? null : player.position, player.nflTeam, injury].filter(Boolean).join(' · ');
  const rank = positionRank(player);
  const ppg = playerPpg(player.ppg);
  return <div className={styles.playerRow} data-roster-player>
    <span className={styles.slot}>{player.slot}</span>
    <span className={styles.playerInfo}>
      <span className={styles.playerName}>{player.name}</span>
      <span className={styles.playerDetails}>{details || '—'}</span>
      <span className={styles.game} data-roster-game>{player.game ? formatNflGame(player.game) : '—'}</span>
    </span>
    <span className={styles.rank} data-position-rank aria-label={`Position rank ${rank === '—' ? 'unavailable' : rank}`}>{rank}</span>
    <span className={styles.ppg} data-player-ppg aria-label={`Points per game ${ppg === '—' ? 'unavailable' : ppg}`}>{ppg}</span>
    <span className={styles.bye} aria-label={`Bye week ${player.byeWeek ?? 'unavailable'}`}>{player.byeWeek ?? '—'}</span>
  </div>;
}

function RosterGroup({ section }: { section: RosterSection }) {
  return <section className={styles.section} data-roster-section aria-label={`${section.name} roster`}>
    <div className={styles.sectionHeading}><h3>{section.name}</h3><span>POS. RANK</span><span>PPG</span><span>BYE</span></div>
    {section.players.length
      ? <div>{section.players.map((player, index) => <PlayerRow key={`${player.id}-${player.slot}-${index}`} player={player} />)}</div>
      : <p className={styles.emptySection}>No players reported in this group.</p>}
  </section>;
}

function TeamCard({ team, selected, expanded, showStandingsPosition, onToggle }: {
  team: RosterTeam;
  selected: boolean;
  expanded: boolean;
  showStandingsPosition: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();
  const teamRecord = record(team);
  const standingsRank = showStandingsPosition ? team.standingsRank : null;
  return <article className={`${styles.card} ${selected ? styles.myTeam : ''}`} data-roster-card data-team-id={team.id} data-standings-rank={standingsRank ?? ''} data-average-rank={team.averagePpgRank ?? ''}>
    <button
      type="button"
      className={styles.summary}
      data-roster-toggle
      aria-expanded={expanded}
      aria-controls={panelId}
      aria-label={`${team.name}, managed by ${team.managerName}, record ${teamRecord}, standings ${ordinal(standingsRank)}, average ${number(team.averagePpg)} points per game, average position ${ordinal(team.averagePpgRank)}${selected ? ', My Team' : ''}. ${expanded ? 'Collapse' : 'Expand'} roster.`}
      onClick={onToggle}
    >
      <span className={styles.identity}>
        <strong className={styles.teamName}>{team.name}</strong>
        <span className={styles.managerMeta}><Avatar team={team} />{selected && <small>MY TEAM</small>}<span className={styles.managerName}>{team.managerName}</span></span>
      </span>
      <span className={styles.teamMetric} aria-hidden="true"><strong>{teamRecord}</strong><small>{ordinal(standingsRank)}</small></span>
      <span className={styles.teamMetric} aria-hidden="true"><strong>{number(team.averagePpg)}</strong><small>{ordinal(team.averagePpgRank)}</small></span>
      <svg className={`${styles.chevron} ${expanded ? styles.rotated : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div id={panelId} className={styles.roster} hidden={!expanded} data-roster-content>
      {team.rosterAvailable
        ? team.sections.map((section) => <RosterGroup key={section.name} section={section} />)
        : <p className={styles.unavailable}>Sleeper has not published an authoritative roster for this team and week.</p>}
    </div>
  </article>;
}

export function RosterContent({ data, selected }: { data: RostersData; selected: number | null }) {
  const teams = useMemo(() => orderRosterTeams(data.teams, selected), [data.teams, selected]);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<number>>(() => new Set());
  const showStandingsPosition = useMemo(() => data.teams.some(team => [team.wins, team.losses, team.ties]
    .some(value => typeof value === 'number' && Number.isFinite(value) && value > 0)), [data.teams]);

  function toggleTeam(teamId: number) {
    setExpandedIds(current => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
      return next;
    });
  }

  return <>
    <Warning message={data.warning} />
    {!data.rostersAvailable
      ? <EmptyState title={`Week ${data.week} rosters unavailable`}>Sleeper has not published authoritative roster membership for this week.</EmptyState>
      : <>
        <div className={styles.teamHeadings} data-team-headings aria-hidden="true"><span>TEAM</span><span>RECORD</span><span>AVG PPG</span></div>
        <div className={styles.board}>{teams.map((team) => <TeamCard
          key={`${data.week}-${team.id}`}
          team={team}
          selected={team.id === selected}
          expanded={expandedIds.has(team.id)}
          showStandingsPosition={showStandingsPosition}
          onToggle={() => toggleTeam(team.id)}
        />)}</div>
      </>}
    <PlayerStatsUpdated data={data} />
    <Updated value={data.updatedAt} />
  </>;
}

export function rosterCacheKey(leagueKey: string, season: string, week: number): string {
  return `${leagueKey}:${season}:${week}`;
}

export function RostersView({ active, league, selected, controlsTarget }: {
  active: boolean; league: League; selected: number | null; controlsTarget: HTMLDivElement | null;
}) {
  const site = useLeagueSite();
  const [week, setWeek] = useState(league.week);
  const [state, setState] = useState<LoadState>('idle');
  const [loaded, setLoaded] = useState<Readonly<{ key: string; data: RostersData; provisionalWeek: RosterRefreshWeek }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const authorityScope = `${site.key}:${league.season}`;
  const [currentAuthority, setCurrentAuthority] = useState({ scope: authorityScope, week: league.week });
  const currentWeek = currentAuthority.scope === authorityScope
    ? Math.max(league.week, currentAuthority.week) : league.week;
  const cache = useRef(new Map<string, CachedRosters>());
  const requestGeneration = useRef(0);
  const previousPeriod = useRef({ scope: authorityScope, week: currentWeek });
  const key = rosterCacheKey(site.key, league.season, week);
  const data = loaded?.key === key ? loaded.data : null;
  const provisionalWeek = loaded?.key === key ? loaded.provisionalWeek : undefined;
  const shouldRefresh = week === currentWeek && provisionalWeek !== null || provisionalWeek === week;

  useEffect(() => {
    const previous = previousPeriod.current;
    previousPeriod.current = { scope: authorityScope, week: currentWeek };
    if (previous.scope !== authorityScope || (previous.week !== currentWeek && week === previous.week)) {
      setWeek(currentWeek);
    }
  }, [authorityScope, currentWeek, week]);

  useEffect(() => {
    if (!active) return;
    const current = shouldRefresh;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let nextAttemptAt = 0;
    const cached = cache.current.get(key);
    if (cached) {
      setLoaded({ key, data: cached.data, provisionalWeek: cached.provisionalWeek });
      setState('ready');
      setError(null);
    } else {
      setState('loading');
      setError(null);
    }

    function schedule() {
      if (stopped || !current || document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      const dueAt = cache.current.get(key)?.refreshAt ?? nextAttemptAt;
      if (dueAt > 0) timer = setTimeout(loadIfDue, Math.max(1, dueAt - Date.now()));
    }

    function loadIfDue() {
      if (stopped || controller || document.visibilityState !== 'visible') return;
      const retained = cache.current.get(key);
      if (retained && (!current || Date.now() < retained.refreshAt)) { schedule(); return; }
      if (!retained && Date.now() < nextAttemptAt) { schedule(); return; }
      const generation = ++requestGeneration.current;
      const startedAt = Date.now();
      const request = new AbortController();
      let responseProvisionalWeek: RosterRefreshWeek | undefined;
      controller = request;
      requestTimer = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
      setState(retained ? 'ready' : 'loading');
      setError(null);
      void fetch(`/api/rosters/${site.key}?week=${week}`, {
        headers: { Accept: 'application/json' }, signal: request.signal, cache: 'no-store',
      }).then(async (response) => {
        const payload = await response.json() as RostersData | { error?: string };
        if (!response.ok || !('teams' in payload)) throw new Error('error' in payload && payload.error ? payload.error : 'League rosters are temporarily unavailable.');
        if (!rosterResponseMatchesSelection(payload, response.headers.get('X-Roster-League'), site.key, league.season, week)) {
          throw new Error('The roster response did not match this league, season, and week.');
        }
        const provisionalWeek = rosterProvisionalWeek(response.headers.get('X-Roster-Provisional-Week'), payload);
        if (provisionalWeek === undefined) throw new Error('The roster response contained an invalid scoring week.');
        if (stopped || generation !== requestGeneration.current) return;
        if (request.signal.aborted) throw new Error('The roster refresh timed out.');
        if (payload.currentWeek < currentWeek) throw new Error('The roster response contained an older current week.');
        if (typeof provisionalWeek === 'number' && typeof retained?.provisionalWeek === 'number'
          && provisionalWeek < retained.provisionalWeek) throw new Error('The roster response contained an older scoring week.');
        responseProvisionalWeek = provisionalWeek === 'unknown' && retained ? retained.provisionalWeek : provisionalWeek;
        // Fresh roster authority can advance even when saved scoring is unavailable.
        // Otherwise the old week's missing score publication could prevent rollover.
        if (payload.currentWeek > currentWeek) setCurrentAuthority({ scope: authorityScope, week: payload.currentWeek });
        if (retained && rosterMetricsRegressed(retained.data, payload)) {
          throw new Error('Updated player statistics are temporarily unavailable.');
        }
        cache.current.set(key, { data: payload, refreshAt: nextRosterRefreshAt(startedAt), provisionalWeek: responseProvisionalWeek });
        setLoaded({ key, data: payload, provisionalWeek: responseProvisionalWeek });
        setState('ready');
      }).catch((fetchError: unknown) => {
        if (stopped || generation !== requestGeneration.current) return;
        nextAttemptAt = nextRosterRefreshAt(Date.now());
        if (retained) {
          const provisionalWeek = responseProvisionalWeek === undefined ? retained.provisionalWeek : responseProvisionalWeek;
          cache.current.set(key, { ...retained, refreshAt: nextAttemptAt, provisionalWeek });
          setLoaded({ key, data: retained.data, provisionalWeek });
        }
        setError(request.signal.aborted ? 'The roster refresh timed out.'
          : fetchError instanceof Error ? fetchError.message : 'League rosters are temporarily unavailable.');
        setState(retained ? 'ready' : 'error');
      }).finally(() => {
        if (generation !== requestGeneration.current) return;
        clearTimeout(requestTimer);
        controller = null;
        schedule();
      });
    }

    function cancel() {
      ++requestGeneration.current;
      clearTimeout(timer);
      clearTimeout(requestTimer);
      controller?.abort();
      controller = null;
    }
    function visibilityChanged() {
      if (document.visibilityState === 'visible') loadIfDue(); else cancel();
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    loadIfDue();
    return () => {
      stopped = true;
      cancel();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [active, retry, key, site.key, league.season, authorityScope, currentWeek, shouldRefresh, week]);

  return <div className={styles.view}>
    {active && controlsTarget && createPortal(
      <RosterWeekSelector week={week} currentWeek={currentWeek} maxWeek={league.maxWeek} onChange={setWeek} />,
      controlsTarget,
    )}
    {data && error && <Warning message={`${error} Showing the last saved roster.`} />}
    {data ? <RosterContent key={key} data={data} selected={selected} />
      : state === 'error' ? <div className={styles.inlineState}><div><strong>League rosters unavailable</strong><p>{error}</p><button type="button" onClick={() => { cache.current.delete(key); setRetry((value) => value + 1); }}>Try again</button></div></div>
        : <div className={styles.inlineState} role="status">Loading rosters for Week {week}…</div>}
  </div>;
}

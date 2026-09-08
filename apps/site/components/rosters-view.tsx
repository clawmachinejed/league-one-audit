'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatNflGame } from '../lib/nfl-schedule';
import { injuryStatusLabel } from '../lib/injury-status';
import { orderRosterTeams } from '../lib/roster-metrics';
import type { League, RosterPlayer, RosterSection, RosterTeam, RostersData } from '../lib/types';
import { Icon } from './icon';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, Updated, Warning } from './league-primitives';
import matchupStyles from './matchups.module.css';
import styles from './rosters.module.css';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function number(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function record(team: RosterTeam): string {
  if (![team.wins, team.losses, team.ties].every(value => value !== null && Number.isInteger(value) && value >= 0)) return '—';
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
  const game = player.game ? formatNflGame(player.game) : '—';
  const positionRank = player.positionRank === null || player.position === '—'
    ? '—' : `${player.position}${player.positionRank}`;
  return <div className={styles.playerRow} data-roster-player>
    <span className={styles.slot}>{player.slot}</span>
    <span className={styles.playerInfo}>
      <span className={styles.playerName}>{player.name}</span>
      <span className={styles.playerDetails}>{details || '—'}</span>
      <span className={styles.game} data-roster-game>{game}</span>
    </span>
    <span className={styles.metrics} data-roster-metrics aria-label={`${positionRank}, ${number(player.ppg)} points per game, bye week ${player.byeWeek ?? 'unavailable'}`}>
      <span>{positionRank}</span><span>{number(player.ppg)}</span><span>{player.byeWeek ?? '—'}</span>
    </span>
  </div>;
}

function RosterGroup({ section }: { section: RosterSection }) {
  return <section className={styles.section} data-roster-section aria-label={`${section.name} roster`}>
    <div className={styles.sectionHeading}>
      <h3>{section.name}</h3>
      <span className={styles.metricHeadings} data-metric-headings aria-hidden="true"><span>POS</span><span>PPG</span><span>BYE</span></span>
    </div>
    {section.players.length
      ? <div className={styles.players}>{section.players.map((player, index) => <PlayerRow key={`${player.id}-${player.slot}-${index}`} player={player} />)}</div>
      : <p className={styles.emptySection}>No players reported in this group.</p>}
  </section>;
}

function TeamCard({ team, selected }: { team: RosterTeam; selected: boolean }) {
  const [expanded, setExpanded] = useState(selected);
  const panelId = useId();
  const teamRecord = record(team);
  return <article className={`${styles.card} ${selected ? styles.myTeam : ''}`} data-roster-card data-team-id={team.id} data-standings-rank={team.standingsRank ?? ''} data-average-rank={team.averagePpgRank ?? ''}>
    <button
      type="button"
      className={styles.summary}
      data-roster-toggle
      aria-expanded={expanded}
      aria-controls={panelId}
      aria-label={`${team.name}, managed by ${team.managerName}, record ${teamRecord}, standings ${ordinal(team.standingsRank)}, average ${number(team.averagePpg)} points per game, average position ${ordinal(team.averagePpgRank)}${selected ? ', My Team' : ''}. ${expanded ? 'Collapse' : 'Expand'} roster.`}
      onClick={() => setExpanded(value => !value)}
    >
      <span className={styles.identity}>
        <Avatar team={team} />
        <span className={styles.names}><strong>{team.name}</strong><span>{team.managerName}</span>{selected && <small>MY TEAM</small>}</span>
      </span>
      <span className={styles.teamMetric} aria-hidden="true"><strong>{teamRecord}</strong><small>{ordinal(team.standingsRank)}</small></span>
      <span className={styles.teamMetric} aria-hidden="true"><strong>{number(team.averagePpg)}</strong><small>{ordinal(team.averagePpgRank)}</small></span>
      <svg className={`${styles.chevron} ${expanded ? styles.rotated : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div id={panelId} className={styles.roster} hidden={!expanded}>
      {team.sections.map(section => <RosterGroup key={section.name} section={section} />)}
    </div>
  </article>;
}

export function RosterContent({ data, selected }: { data: RostersData; selected: number | null }) {
  const teams = useMemo(() => orderRosterTeams(data.teams, selected), [data.teams, selected]);
  return <>
    <Warning message={data.warning} />
    {teams.length ? <>
      <div className={styles.teamHeadings} data-team-headings aria-hidden="true"><span>TEAM</span><span>RECORD</span><span>AVG PPG</span></div>
      <div className={styles.board}>{teams.map(team => <TeamCard key={`${data.week}-${team.id}-${team.id === selected ? 'selected' : 'other'}`} team={team} selected={team.id === selected} />)}</div>
    </> : <EmptyState title="League rosters are on their way">Teams will appear when Sleeper publishes the selected week.</EmptyState>}
    <Updated value={data.updatedAt} />
  </>;
}

export function RostersView({ active, league, selected }: { active: boolean; league: League; selected: number | null }) {
  const site = useLeagueSite();
  const [week, setWeek] = useState(league.week);
  const [state, setState] = useState<LoadState>('idle');
  const [data, setData] = useState<RostersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<number, RostersData>());
  const requestGeneration = useRef(0);

  useEffect(() => {
    if (!active) return;
    const cached = cache.current.get(week);
    if (cached) {
      setData(cached);
      setState('ready');
      setError(null);
      return;
    }
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    setState('loading');
    setError(null);
    void fetch(`/api/rosters/${site.key}?week=${week}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).then(async response => {
      const payload = await response.json() as RostersData | { error?: string };
      if (!response.ok || !('teams' in payload)) throw new Error('error' in payload && payload.error ? payload.error : 'League rosters are temporarily unavailable.');
      if (generation !== requestGeneration.current) return;
      cache.current.set(week, payload);
      setData(payload);
      setState('ready');
    }).catch(fetchError => {
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      setError(fetchError instanceof Error ? fetchError.message : 'League rosters are temporarily unavailable.');
      setState('error');
    });
    return () => controller.abort();
  }, [active, retry, site.key, week]);

  return <div className={styles.view}>
    <div className={styles.weekToolbar}>
      {week !== league.week && <button type="button" className={styles.currentWeek} onClick={() => setWeek(league.week)}>Back to current</button>}
      <div className={matchupStyles.weekControl}>
        <button type="button" className={matchupStyles.weekArrow} disabled={week <= 1} onClick={() => setWeek(value => Math.max(1, value - 1))} aria-label={`Previous week, week ${week - 1}`}><Icon name="arrow" /></button>
        <label className={matchupStyles.weekSelect}><span className="sr-only">Roster week</span><select value={week} onChange={event => setWeek(Number(event.target.value))}>{Array.from({ length: league.maxWeek }, (_, index) => <option key={index + 1} value={index + 1}>Week {index + 1}{index + 1 === league.week ? ' · Current' : ''}</option>)}</select><Icon name="chevron" /></label>
        <button type="button" className={matchupStyles.weekArrow} disabled={week >= league.maxWeek} onClick={() => setWeek(value => Math.min(league.maxWeek, value + 1))} aria-label={`Next week, week ${week + 1}`}><Icon name="arrow" className="arrow-forward" /></button>
      </div>
    </div>
    {state === 'loading' || state === 'idle' ? <div className={styles.inlineState} role="status">Loading rosters for Week {week}…</div>
      : state === 'error' ? <div className={styles.inlineState}><div><strong>League rosters unavailable</strong><p>{error}</p><button type="button" onClick={() => { cache.current.delete(week); setRetry(value => value + 1); }}>Try again</button></div></div>
        : data ? <RosterContent data={data} selected={selected} /> : null}
  </div>;
}

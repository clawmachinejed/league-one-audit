'use client';

import Link from 'next/link';
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { injuryStatusLabel } from '../lib/injury-status';
import type { CurrentStandings } from '../lib/current-standings';
import type { MatchupBoxScores } from '../lib/matchup-box-score-types';
import { boxScoreSummary, boxScoreObservedLabel, canExpandPlayerBoxScore, playerBoxScoreKey } from '../lib/matchup-box-scores';
import { formatNflGame } from '../lib/nfl-schedule';
import { compactPlayerName } from '../lib/player-name';
import { rosterSlotLabel, rosterSlotName } from '../lib/roster-slot';
import type { Matchup, Player, Team } from '../lib/types';
import { useLeagueSite } from './league-context';
import { matchupWinChance } from './matchup-win-chance';
import styles from './matchups.module.css';

type AvatarRenderer = (team: Team) => ReactNode;
type BoxScoreProps = {
  boxScores?: MatchupBoxScores | null;
  boxScoresLoading?: boolean;
  onBoxScoreOpen?: () => void;
};

function statusLabel(status: Matchup['status']) {
  return { upcoming: 'Upcoming', live: 'In progress', final: 'Final', unknown: 'Week matchups' }[status];
}

function points(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

function record(team: Team) {
  return `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`;
}

function spokenRecord(team: Team) {
  return `${team.wins} wins, ${team.losses} losses${team.ties ? `, ${team.ties} ties` : ''}`;
}

function spokenScore(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${points(value)} points` : 'unavailable';
}

function spokenProjection(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `projected score ${points(value)} points`
    : 'projected score unavailable';
}

function placeLabel(place: number) {
  const suffix = place % 100 >= 11 && place % 100 <= 13 ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[place % 10] ?? 'th';
  return `${place}${suffix}`;
}

function teamPlace(team: Team, standings?: CurrentStandings | null) {
  const place = standings?.places[team.id];
  return typeof place === 'number' && Number.isInteger(place) && place > 0 ? place : null;
}

function TeamMeta({ team, opposite, avatar, standings }: {
  team: Team; opposite?: boolean; avatar: AvatarRenderer; standings?: CurrentStandings | null;
}) {
  const site = useLeagueSite();
  const place = teamPlace(team, standings);
  const tone = place === null ? 'neutral' : site.key === 'league1'
    ? place <= 6 ? 'playoff' : place <= 10 ? 'middle' : place <= 12 ? 'relegation' : 'neutral'
    : site.key === 'league2' && standings?.playoffTeams != null && place <= standings.playoffTeams ? 'playoff' : 'neutral';
  return <span className={`${styles.teamMeta} ${opposite ? styles.oppositeMeta : ''}`} data-team-meta={opposite ? 'right' : 'left'}>
    {avatar(team)}<span className={styles.manager}>{team.managerName}</span>
    <span className={styles.recordGroup}>
      {place !== null && <strong className={styles.place} data-team-place={team.id} data-place-tone={tone}
        title={`${placeLabel(place)} in actual standings`} aria-label={`${placeLabel(place)} in actual standings`}>{placeLabel(place)}</strong>}
      <span className={styles.record} data-team-record aria-label={spokenRecord(team)}>{record(team)}</span>
    </span>
  </span>;
}

function Starter({ player, opposite, high, pending, unavailable, bench, blank }: {
  player?: Player; opposite?: boolean; high?: boolean; pending?: boolean; unavailable?: boolean;
  bench?: boolean; blank?: boolean;
}) {
  if (blank) return <div className={`${styles.player} ${opposite ? styles.rightPlayer : ''}`} aria-hidden="true" />;
  const name = player?.name || (unavailable ? bench ? 'Bench unavailable' : 'Lineup unavailable' : pending ? 'Not posted' : 'Empty slot');
  const injury = injuryStatusLabel(player?.injuryStatus);
  const game = player?.game ? formatNflGame(player.game) : null;
  return <div className={`${styles.player} ${opposite ? styles.rightPlayer : ''}`}>
    <div className={styles.playerInfo}>
      <span className={styles.playerName} data-player-name>
        <span className="sr-only">{name}</span>
        <span className={styles.fullName} aria-hidden="true">{name}</span>
        <span className={styles.shortName} aria-hidden="true">{compactPlayerName(name, player?.position)}</span>
      </span>
      <small className={styles.playerMeta} data-player-meta>
        <span className={styles.playerDetails} data-player-details>
          <span>{player ? [player.position, player.nflTeam].filter(Boolean).join(' · ') || 'No NFL team' : unavailable ? 'Awaiting Sleeper' : pending ? 'Opponent pending' : 'Empty slot'}</span>
          {injury && <span className={`${styles.injury} ${injury === 'QUES' ? styles.questionable : ''}`} aria-label={`Current injury designation: ${player?.injuryStatus}`}>{injury}</span>}
        </span>
        {game && <span className={styles.game} data-player-game>{game}</span>}
      </small>
    </div>
    <span className={`${styles.playerPoints} ${high ? styles.higherScore : ''}`} data-player-score-side={opposite ? 'right' : 'left'} role="group" aria-label={`Official score ${spokenScore(player?.points)}; ${spokenProjection(player?.projectedPoints)}`}>
      <span className={styles.playerOfficial} data-player-score-number aria-hidden="true">{points(player?.points)}</span>
      <span className={styles.playerProjection} data-player-projection-number aria-hidden="true">{points(player?.projectedPoints)}</span>
    </span>
  </div>;
}

function PlayerBoxScore({ player, panelId, expanded, opposite, boxScores, boxScoresLoading = false }: {
  player: Player; panelId: string; expanded: boolean; opposite?: boolean;
} & Pick<BoxScoreProps, 'boxScores' | 'boxScoresLoading'>) {
  const entry = boxScores?.status === 'available' ? boxScores.players[playerBoxScoreKey(player)] : undefined;
  const summary = expanded && entry ? boxScoreSummary(player.position, entry.stats) : [];
  return <section id={panelId} className={`${styles.boxScorePanel} ${opposite ? styles.rightBoxScore : ''}`}
    data-player-box-score data-box-score-key={playerBoxScoreKey(player)} data-player-side={opposite ? 'right' : 'left'}
    aria-label={`${player.name} game statistics`} aria-busy={expanded && boxScoresLoading} hidden={!expanded}>
    {expanded && (summary.length ? <p className={styles.boxScoreSummary} data-box-score-summary
      role="group" aria-label={summary.map(stat => stat.description).join('; ')}>
      {summary.map((stat, index) => <Fragment key={stat.description}>
        {index > 0 && ' '}<span aria-hidden="true">{stat.text}{index < summary.length - 1 ? ',' : ''}</span>
      </Fragment>)}
    </p> : <p className={styles.boxScoreMessage} role="status">{boxScoresLoading ? 'Loading statistics…' : 'Statistics not available yet.'}</p>)}
  </section>;
}

function MatchupCard({ matchup, selected, avatar, boxScores, boxScoresLoading, onBoxScoreOpen, showBench = false, standings }: {
  matchup: Matchup; selected: number | null; avatar: AvatarRenderer; showBench?: boolean; standings?: CurrentStandings | null;
} & BoxScoreProps) {
  const site = useLeagueSite();
  const [expanded, setExpanded] = useState(false);
  const [expandedSlots, setExpandedSlots] = useState<ReadonlySet<string>>(() => new Set());
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const left = matchup.sides[0];
  const right = matchup.sides[1];
  const mine = matchup.sides.some(side => side.team.id === selected);
  const count = Math.max(left?.starters.length || 0, right?.starters.length || 0);

  function toggleSlot(key: string) {
    const opening = !expandedSlots.has(key);
    setExpandedSlots((current) => {
      const next = new Set(current);
      if (opening) next.add(key);
      else next.delete(key);
      return next;
    });
    if (opening) onBoxScoreOpen?.();
  }

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!expanded || !panel) return;
    let active = true;
    let lastWidth = -1;
    const fit = () => {
      if (!active || panel.hidden || !panel.clientWidth) return;
      const names = [...panel.querySelectorAll<HTMLElement>('[data-player-name]')];
      panel.removeAttribute('data-roomy-names');
      const shorten = () => {
        for (const name of names) {
          name.removeAttribute('data-compact');
          if (name.scrollWidth > name.clientWidth) name.dataset.compact = 'true';
        }
      };
      shorten();
      const metadataNeedsRoom = [...panel.querySelectorAll<HTMLElement>('[data-player-meta]')].some((meta) => {
        const details = meta.querySelector<HTMLElement>('[data-player-details]');
        const game = meta.querySelector<HTMLElement>('[data-player-game]');
        return (details?.scrollWidth ?? 0) > meta.clientWidth || (game?.scrollWidth ?? 0) > meta.clientWidth;
      });
      // On narrow screens, keep the surname intact by moving both sides' points
      // to their name line, consistently across the entire lineup.
      if (metadataNeedsRoom || names.some(name => name.scrollWidth > name.clientWidth)) {
        panel.dataset.roomyNames = 'true';
        shorten();
      }
    };
    fit();
    const observer = new ResizeObserver(() => {
      if (panel.clientWidth !== lastWidth) { lastWidth = panel.clientWidth; fit(); }
    });
    observer.observe(panel);
    void document.fonts.ready.then(fit);
    return () => { active = false; observer.disconnect(); };
  }, [expanded, matchup]);

  if (!left) return null;
  const label = right ? statusLabel(matchup.status) : 'Opponent pending';
  const placeSummary = (team: Team) => {
    const place = teamPlace(team, standings);
    return place === null ? '' : `, ${placeLabel(place)} in actual standings`;
  };
  const leftSummary = `${left.team.name}, managed by ${left.team.managerName}, record ${spokenRecord(left.team)}${placeSummary(left.team)}, official score ${spokenScore(left.points)}, ${spokenProjection(left.projectedPoints)}`;
  const rightSummary = right
    ? `${right.team.name}, managed by ${right.team.managerName}, record ${spokenRecord(right.team)}${placeSummary(right.team)}, official score ${spokenScore(right.points)}, ${spokenProjection(right.projectedPoints)}`
    : 'opponent not posted, official score unavailable, projected score unavailable';
  const winChance = matchupWinChance(matchup);
  const accessibleLabel = `${leftSummary}; versus ${rightSummary}. ${label}${mine ? '. My matchup' : ''}. ${winChance.description} ${expanded ? 'Collapse' : 'Expand'} ${showBench ? 'starting lineups and benches' : 'starting lineups'}.`;
  const benchCount = Math.max(left.bench?.length ?? 0, right?.bench?.length ?? 0,
    left.bench == null || (right && right.bench == null) ? 1 : 0);

  function renderPlayerRow(index: number, section: 'starter' | 'bench') {
    const bench = section === 'bench';
    const a = (bench ? left.bench : left.starters)?.[index];
    const b = (bench ? right?.bench : right?.starters)?.[index];
    const comparable = typeof a?.points === 'number' && typeof b?.points === 'number';
    const slot = bench ? 'BN' : a?.slot || b?.slot || '—';
    const slotKey = `${section}-${index}-${slot}`;
    const aEligible = canExpandPlayerBoxScore(a);
    const bEligible = canExpandPlayerBoxScore(b);
    const expandable = aEligible || bEligible;
    const rowExpanded = expandable && expandedSlots.has(slotKey);
    const rowPanelId = `${panelId}-${section}-${index}`;
    const aUnavailable = bench ? left.bench == null && index === 0 : left.starters.length === 0;
    const bUnavailable = bench ? Boolean(right && right.bench == null && index === 0) : right?.starters.length === 0;
    return <Fragment key={slotKey}>
      <div className={styles.playerRow} data-bench-row={bench || undefined}>
        <Starter player={a} bench={bench} unavailable={aUnavailable} blank={bench && !a && !aUnavailable}
          high={comparable && a!.points! > b!.points!} />
        <span className={styles.slot} aria-label={rosterSlotName(slot)} title={rosterSlotName(slot)}>{rosterSlotLabel(slot)}</span>
        <Starter player={b} opposite bench={bench} pending={!right} unavailable={bUnavailable}
          blank={bench && !b && !bUnavailable} high={comparable && b!.points! > a!.points!} />
        {expandable && <button type="button" className={styles.starterDisclosure}
          data-starter-box-score-toggle={!bench || undefined} data-starter-index={bench ? undefined : index}
          data-bench-box-score-toggle={bench || undefined} data-bench-index={bench ? index : undefined}
          aria-label={`${bench ? 'Bench' : rosterSlotName(slot)} row ${index + 1} game statistics for both teams`}
          aria-expanded={rowExpanded} aria-controls={rowPanelId} onClick={() => toggleSlot(slotKey)} />}
      </div>
      {expandable && <div id={rowPanelId} className={styles.boxScoreRow}
        data-starter-box-score-row={!bench || undefined} data-starter-index={bench ? undefined : index}
        data-bench-box-score-row={bench || undefined} data-bench-index={bench ? index : undefined} hidden={!rowExpanded}>
        {aEligible && a && <PlayerBoxScore player={a} panelId={`${rowPanelId}-left`} expanded={rowExpanded}
          boxScores={boxScores} boxScoresLoading={boxScoresLoading} />}
        {bEligible && b && <PlayerBoxScore player={b} panelId={`${rowPanelId}-right`} expanded={rowExpanded} opposite
          boxScores={boxScores} boxScoresLoading={boxScoresLoading} />}
      </div>}
    </Fragment>;
  }
  return <article className={`${styles.card} ${mine ? styles.myMatchup : ''}`} aria-label={`${left.team.name}${right ? ` versus ${right.team.name}` : ', opponent pending'}`}>
    <button className={styles.toggle} type="button" data-matchup-toggle aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)} aria-label={accessibleLabel}>
      <span className={styles.teamName} data-team-name>{left.team.name}</span>
      <span className={styles.scorePair} aria-hidden="true">
        <span className={styles.score} data-score-side="left"><span className={styles.teamOfficial} data-score-number>{points(left.points)}</span><span className={styles.teamProjection} data-team-projection-number aria-hidden="true">{points(left.projectedPoints)}</span></span>
        <span className={styles.scoreDivider} aria-hidden="true" />
        <span className={styles.score} data-score-side="right"><span className={styles.teamOfficial} data-score-number>{points(right?.points)}</span><span className={styles.teamProjection} data-team-projection-number aria-hidden="true">{points(right?.projectedPoints)}</span></span>
      </span>
      <span className={`${styles.teamName} ${styles.rightName}`} data-team-name>{right?.team.name || 'Opponent pending'}</span>
      <TeamMeta team={left.team} avatar={avatar} standings={standings} />
      <span className={styles.expandControl}>
        <svg className={`${styles.chevron} ${expanded ? styles.rotated : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        <span className="sr-only">{label}{mine ? ' · My matchup' : ''}</span>
      </span>
      {right ? <TeamMeta team={right.team} opposite avatar={avatar} standings={standings} /> : <span className={`${styles.teamMeta} ${styles.oppositeMeta}`}>Not posted</span>}
      <span className={styles.winChance} data-win-chance={winChance.status} aria-hidden="true">
        {(['left', 'right'] as const).map((side, index) => {
          const probability = winChance.probabilities[index];
          const tone = probability === null ? 'neutral' : probability >= 0.5 ? 'favored' : 'underdog';
          return <span key={side} className={styles.winChanceHalf} data-win-chance-half={side} data-win-chance-tone={tone}>
            <span className={styles.winChanceTrack} data-win-chance-track>
              <span className={styles.winChanceFill} data-win-chance-fill style={{ width: `${(probability ?? 0) * 100}%` }} />
            </span>
            <span className={styles.winChanceValue} data-win-chance-side={side}
              data-win-chance-team={index === 0 ? left.team.id : right?.team.id}>{winChance.values[index]}</span>
          </span>;
        })}
      </span>
    </button>
    <div id={panelId} ref={panelRef} className={styles.lineup} hidden={!expanded}>
      {count ? <>
        {Array.from({ length: count }, (_, index) => renderPlayerRow(index, 'starter'))}
        <p className={styles.lineupNote}>{matchup.status === 'upcoming' ? 'Lineups may change before kickoff.' : 'Scores reported by Sleeper.'}</p>
      </> : <p className={styles.unavailable}>Starting lineups are unavailable from Sleeper for this week.</p>}
      {showBench && <section aria-label="Bench players" className={styles.bench}>
        <h2 className={styles.benchHeading}>Bench</h2>
        {benchCount ? Array.from({ length: benchCount }, (_, index) => renderPlayerRow(index, 'bench'))
          : <p className={styles.lineupNote}>No bench players.</p>}
      </section>}
      <div className={styles.profileLinks}><Link href={`${site.prefix}/managers/${left.team.id}`} aria-label={`View ${left.team.name} profile`}>Team profile</Link>{right && <Link href={`${site.prefix}/managers/${right.team.id}`} aria-label={`View ${right.team.name} profile`}>Team profile</Link>}</div>
    </div>
  </article>;
}

export function MatchupBoard({ matchups, selected, avatar, boxScores, boxScoresLoading, onBoxScoreOpen, showBench = false, standings }: {
  matchups: Matchup[]; selected: number | null; avatar: AvatarRenderer; showBench?: boolean; standings?: CurrentStandings | null;
} & BoxScoreProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let active = true;
    let lastWidth = -1;
    const align = () => {
      if (!active || !board.clientWidth) return;
      const names = [...board.querySelectorAll<HTMLElement>('[data-team-name]')];
      const metadata = [...board.querySelectorAll<HTMLElement>(`.${styles.teamMeta}`)];
      const scores = [...board.querySelectorAll<HTMLElement>('[data-score-number]')];
      const scoreWidth = Math.max(112, ...scores.map(score => Math.ceil(score.getBoundingClientRect().width) * 2 + 24));
      board.style.setProperty('--score-width', `${scoreWidth}px`);
      board.style.setProperty('--name-height', `${Math.max(36, ...names.map(name => Math.ceil(name.getBoundingClientRect().height)))}px`);
      board.style.setProperty('--meta-height', `${Math.max(16, ...metadata.map(meta => Math.ceil(meta.getBoundingClientRect().height)))}px`);
    };
    align();
    const observer = new ResizeObserver(() => {
      if (board.clientWidth !== lastWidth) { lastWidth = board.clientWidth; align(); }
    });
    observer.observe(board);
    void document.fonts.ready.then(align);
    return () => { active = false; observer.disconnect(); };
  }, [matchups, standings]);
  const observed = boxScores?.status === 'available' ? boxScoreObservedLabel(boxScores.observedAt) : null;
  return <><div ref={boardRef} className={styles.board}>{matchups.map(matchup => <MatchupCard key={matchup.id}
    matchup={matchup} selected={selected} avatar={avatar} boxScores={boxScores} standings={standings}
    boxScoresLoading={boxScoresLoading} onBoxScoreOpen={onBoxScoreOpen} showBench={showBench} />)}</div>
    {observed && <p className={styles.boxScoreObserved} data-box-score-source>{observed}<span>Sleeper · hourly collection</span></p>}
  </>;
}

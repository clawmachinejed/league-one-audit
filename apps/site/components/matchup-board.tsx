'use client';

import Link from 'next/link';
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { injuryStatusLabel } from '../lib/injury-status';
import type { MatchupBoxScores } from '../lib/matchup-box-score-types';
import { boxScoreSummary, boxScoreObservedLabel, canExpandPlayerBoxScore, playerBoxScoreKey } from '../lib/matchup-box-scores';
import { formatNflGame } from '../lib/nfl-schedule';
import { compactPlayerName } from '../lib/player-name';
import type { Matchup, Player, Team } from '../lib/types';
import { useLeagueSite } from './league-context';
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

function TeamMeta({ team, opposite, avatar }: { team: Team; opposite?: boolean; avatar: AvatarRenderer }) {
  return <span className={`${styles.teamMeta} ${opposite ? styles.oppositeMeta : ''}`}>
    {avatar(team)}<span className={styles.manager}>{team.managerName}</span><span className={styles.record} aria-label={`${team.wins} wins, ${team.losses} losses${team.ties ? `, ${team.ties} ties` : ''}`}>{record(team)}</span>
  </span>;
}

function Starter({ player, opposite, high, pending, boxScoreExpanded = false, boxScorePanelId, onBoxScoreToggle }: {
  player?: Player; opposite?: boolean; high?: boolean; pending?: boolean;
  boxScoreExpanded?: boolean; boxScorePanelId?: string; onBoxScoreToggle?: () => void;
}) {
  const scoreId = useId();
  const name = player?.name || (pending ? 'Not posted' : 'Empty slot');
  const injury = injuryStatusLabel(player?.injuryStatus);
  const game = player?.game ? formatNflGame(player.game) : null;
  const expandable = player && canExpandPlayerBoxScore(player) && boxScorePanelId && onBoxScoreToggle;
  return <div className={`${styles.player} ${opposite ? styles.rightPlayer : ''}`}>
    <div className={styles.playerInfo}>
      <span className={styles.playerName} data-player-name>
        <span className="sr-only">{name}</span>
        <span className={styles.fullName} aria-hidden="true">{name}</span>
        <span className={styles.shortName} aria-hidden="true">{compactPlayerName(name, player?.position)}</span>
        {expandable && <svg className={`${styles.playerChevron} ${boxScoreExpanded ? styles.rotated : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>}
      </span>
      <small className={styles.playerMeta} data-player-meta>
        <span className={styles.playerDetails} data-player-details>
          <span>{player ? [player.position, player.nflTeam].filter(Boolean).join(' · ') || 'No NFL team' : pending ? 'Opponent pending' : 'Empty slot'}</span>
          {injury && <span className={`${styles.injury} ${injury === 'QUES' ? styles.questionable : ''}`} aria-label={`Current injury designation: ${player?.injuryStatus}`}>{injury}</span>}
        </span>
        {game && <span className={styles.game} data-player-game>{game}</span>}
      </small>
    </div>
    <span id={scoreId} className={`${styles.playerPoints} ${high ? styles.higherScore : ''}`} data-player-score-side={opposite ? 'right' : 'left'} role="group" aria-label={`Official score ${spokenScore(player?.points)}; ${spokenProjection(player?.projectedPoints)}`}>
      <span className={styles.playerOfficial} data-player-score-number aria-hidden="true">{points(player?.points)}</span>
      <span className={styles.playerProjection} data-player-projection-number aria-hidden="true">{points(player?.projectedPoints)}</span>
    </span>
    {expandable && <button type="button" className={styles.playerDisclosure}
      data-player-box-score-toggle data-box-score-key={playerBoxScoreKey(player)} data-player-side={opposite ? 'right' : 'left'}
      aria-label={`${name} game statistics`} aria-expanded={boxScoreExpanded} aria-controls={boxScorePanelId}
      aria-describedby={scoreId} onClick={onBoxScoreToggle} />}
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

function MatchupCard({ matchup, selected, avatar, boxScores, boxScoresLoading, onBoxScoreOpen }: {
  matchup: Matchup; selected: number | null; avatar: AvatarRenderer;
} & BoxScoreProps) {
  const site = useLeagueSite();
  const [expanded, setExpanded] = useState(false);
  const [expandedPlayers, setExpandedPlayers] = useState<ReadonlySet<string>>(() => new Set());
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const left = matchup.sides[0];
  const right = matchup.sides[1];
  const mine = matchup.sides.some(side => side.team.id === selected);
  const count = Math.max(left?.starters.length || 0, right?.starters.length || 0);

  function togglePlayer(key: string) {
    const opening = !expandedPlayers.has(key);
    setExpandedPlayers((current) => {
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
  const leftSummary = `${left.team.name}, managed by ${left.team.managerName}, record ${spokenRecord(left.team)}, official score ${spokenScore(left.points)}, ${spokenProjection(left.projectedPoints)}`;
  const rightSummary = right
    ? `${right.team.name}, managed by ${right.team.managerName}, record ${spokenRecord(right.team)}, official score ${spokenScore(right.points)}, ${spokenProjection(right.projectedPoints)}`
    : 'opponent not posted, official score unavailable, projected score unavailable';
  const accessibleLabel = `${leftSummary}; versus ${rightSummary}. ${label}${mine ? '. My matchup' : ''}. ${expanded ? 'Collapse' : 'Expand'} starting lineups.`;
  return <article className={`${styles.card} ${mine ? styles.myMatchup : ''}`} aria-label={`${left.team.name}${right ? ` versus ${right.team.name}` : ', opponent pending'}`}>
    <button className={styles.toggle} type="button" data-matchup-toggle aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)} aria-label={accessibleLabel}>
      <span className={styles.teamName} data-team-name>{left.team.name}</span>
      <span className={styles.scorePair} aria-hidden="true">
        <span className={styles.score} data-score-side="left"><span className={styles.teamOfficial} data-score-number>{points(left.points)}</span><span className={styles.teamProjection} data-team-projection-number aria-hidden="true">{points(left.projectedPoints)}</span></span>
        <span className={styles.scoreDivider} aria-hidden="true" />
        <span className={styles.score} data-score-side="right"><span className={styles.teamOfficial} data-score-number>{points(right?.points)}</span><span className={styles.teamProjection} data-team-projection-number aria-hidden="true">{points(right?.projectedPoints)}</span></span>
      </span>
      <span className={`${styles.teamName} ${styles.rightName}`} data-team-name>{right?.team.name || 'Opponent pending'}</span>
      <TeamMeta team={left.team} avatar={avatar} />
      <span className={styles.expandControl}>
        <svg className={`${styles.chevron} ${expanded ? styles.rotated : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        <span className="sr-only">{label}{mine ? ' · My matchup' : ''}</span>
      </span>
      {right ? <TeamMeta team={right.team} opposite avatar={avatar} /> : <span className={`${styles.teamMeta} ${styles.oppositeMeta}`}>Not posted</span>}
    </button>
    <div id={panelId} ref={panelRef} className={styles.lineup} hidden={!expanded}>
      {count ? <>
        {Array.from({ length: count }, (_, index) => {
          const a = left.starters[index];
          const b = right?.starters[index];
          const comparable = typeof a?.points === 'number' && typeof b?.points === 'number';
          const aKey = a ? `${left.team.id}:${playerBoxScoreKey(a)}` : '';
          const bKey = b && right ? `${right.team.id}:${playerBoxScoreKey(b)}` : '';
          const aEligible = canExpandPlayerBoxScore(a);
          const bEligible = canExpandPlayerBoxScore(b);
          const aExpanded = aEligible && expandedPlayers.has(aKey);
          const bExpanded = bEligible && expandedPlayers.has(bKey);
          const aPanelId = `${panelId}-player-${index}-left`;
          const bPanelId = `${panelId}-player-${index}-right`;
          return <Fragment key={`${index}-${a?.slot || b?.slot || 'slot'}`}>
            <div className={styles.playerRow}>
              <Starter player={a} high={comparable && a!.points! > b!.points!}
                boxScoreExpanded={aExpanded} boxScorePanelId={aPanelId} onBoxScoreToggle={() => togglePlayer(aKey)} />
              <span className={styles.slot}>{a?.slot || b?.slot || '—'}</span>
              <Starter player={b} opposite pending={!right} high={comparable && b!.points! > a!.points!}
                boxScoreExpanded={bExpanded} boxScorePanelId={bPanelId} onBoxScoreToggle={() => togglePlayer(bKey)} />
            </div>
            {(aEligible || bEligible) && <div className={styles.boxScoreRow} hidden={!aExpanded && !bExpanded}>
              {aEligible && a && <PlayerBoxScore player={a} panelId={aPanelId} expanded={aExpanded}
                boxScores={boxScores} boxScoresLoading={boxScoresLoading} />}
              {bEligible && b && <PlayerBoxScore player={b} panelId={bPanelId} expanded={bExpanded} opposite
                boxScores={boxScores} boxScoresLoading={boxScoresLoading} />}
            </div>}
          </Fragment>;
        })}
        <p className={styles.lineupNote}>{matchup.status === 'upcoming' ? 'Lineups may change before kickoff.' : 'Scores reported by Sleeper.'}</p>
      </> : <p className={styles.unavailable}>Starting lineups have not been posted for this week.</p>}
      <div className={styles.profileLinks}><Link href={`${site.prefix}/managers/${left.team.id}`} aria-label={`View ${left.team.name} profile`}>Team profile</Link>{right && <Link href={`${site.prefix}/managers/${right.team.id}`} aria-label={`View ${right.team.name} profile`}>Team profile</Link>}</div>
    </div>
  </article>;
}

export function MatchupBoard({ matchups, selected, avatar, boxScores, boxScoresLoading, onBoxScoreOpen }: {
  matchups: Matchup[]; selected: number | null; avatar: AvatarRenderer;
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
  }, [matchups]);
  const observed = boxScores?.status === 'available' ? boxScoreObservedLabel(boxScores.observedAt) : null;
  return <><div ref={boardRef} className={styles.board}>{matchups.map(matchup => <MatchupCard key={matchup.id}
    matchup={matchup} selected={selected} avatar={avatar} boxScores={boxScores}
    boxScoresLoading={boxScoresLoading} onBoxScoreOpen={onBoxScoreOpen} />)}</div>
    {observed && <p className={styles.boxScoreObserved} data-box-score-source>{observed}<span>Sleeper · hourly collection</span></p>}
  </>;
}

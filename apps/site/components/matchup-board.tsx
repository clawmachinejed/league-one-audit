'use client';

import Link from 'next/link';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { injuryStatusLabel } from '../lib/injury-status';
import { formatNflGame } from '../lib/nfl-schedule';
import { compactPlayerName } from '../lib/player-name';
import type { Matchup, Player, Team } from '../lib/types';
import styles from './matchups.module.css';

type AvatarRenderer = (team: Team) => ReactNode;

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
  return typeof value === 'number' && Number.isFinite(value) ? `${points(value)} points` : 'score unavailable';
}

function TeamMeta({ team, opposite, avatar }: { team: Team; opposite?: boolean; avatar: AvatarRenderer }) {
  return <span className={`${styles.teamMeta} ${opposite ? styles.oppositeMeta : ''}`}>
    {avatar(team)}<span className={styles.owner}>{team.ownerName}</span><span className={styles.record} aria-label={`${team.wins} wins, ${team.losses} losses${team.ties ? `, ${team.ties} ties` : ''}`}>{record(team)}</span>
  </span>;
}

function Starter({ player, opposite, high, pending }: { player?: Player; opposite?: boolean; high?: boolean; pending?: boolean }) {
  const name = player?.name || (pending ? 'Not posted' : 'Empty slot');
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
          <span>{player ? [player.position, player.nflTeam].filter(Boolean).join(' · ') || 'No NFL team' : pending ? 'Opponent pending' : 'Empty slot'}</span>
          {injury && <span className={`${styles.injury} ${injury === 'QUES' ? styles.questionable : ''}`} aria-label={`Current injury designation: ${player?.injuryStatus}`}>{injury}</span>}
        </span>
        {game && <span className={styles.game} data-player-game>{game}</span>}
      </small>
    </div>
    <span className={`${styles.playerPoints} ${high ? styles.higherScore : ''}`}>{points(player?.points)}</span>
  </div>;
}

function MatchupCard({ matchup, selected, avatar }: { matchup: Matchup; selected: number | null; avatar: AvatarRenderer }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const left = matchup.sides[0];
  const right = matchup.sides[1];
  const mine = matchup.sides.some(side => side.team.id === selected);
  const count = Math.max(left?.starters.length || 0, right?.starters.length || 0);

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
  const leftSummary = `${left.team.name}, owned by ${left.team.ownerName}, record ${spokenRecord(left.team)}, ${spokenScore(left.points)}`;
  const rightSummary = right
    ? `${right.team.name}, owned by ${right.team.ownerName}, record ${spokenRecord(right.team)}, ${spokenScore(right.points)}`
    : 'opponent not posted, score unavailable';
  const accessibleLabel = `${leftSummary}; versus ${rightSummary}. ${label}${mine ? '. My matchup' : ''}. ${expanded ? 'Collapse' : 'Expand'} starting lineups.`;
  return <article className={`${styles.card} ${mine ? styles.myMatchup : ''}`} aria-label={`${left.team.name}${right ? ` versus ${right.team.name}` : ', opponent pending'}`}>
    <button className={styles.toggle} type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)} aria-label={accessibleLabel}>
      <span className={styles.teamName} data-team-name>{left.team.name}</span>
      <span className={styles.scorePair} aria-label={`${points(left.points)} to ${points(right?.points)}`}>
        <span className={styles.score}><span data-score-number>{points(left.points)}</span></span>
        <span className={styles.scoreDivider} aria-hidden="true" />
        <span className={styles.score}><span data-score-number>{points(right?.points)}</span></span>
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
          return <div className={styles.playerRow} key={`${index}-${a?.slot || b?.slot || 'slot'}`}>
            <Starter player={a} high={comparable && a!.points! > b!.points!} />
            <span className={styles.slot}>{a?.slot || b?.slot || '—'}</span>
            <Starter player={b} opposite pending={!right} high={comparable && b!.points! > a!.points!} />
          </div>;
        })}
        <p className={styles.lineupNote}>{matchup.status === 'upcoming' ? 'Lineups may change before kickoff.' : 'Scores reported by Sleeper.'}</p>
      </> : <p className={styles.unavailable}>Starting lineups have not been posted for this week.</p>}
      <div className={styles.profileLinks}><Link href={`/owners/${left.team.id}`} aria-label={`View ${left.team.name} profile`}>Team profile</Link>{right && <Link href={`/owners/${right.team.id}`} aria-label={`View ${right.team.name} profile`}>Team profile</Link>}</div>
    </div>
  </article>;
}

export function MatchupBoard({ matchups, selected, avatar }: { matchups: Matchup[]; selected: number | null; avatar: AvatarRenderer }) {
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
  return <div ref={boardRef} className={styles.board}>{matchups.map(matchup => <MatchupCard key={matchup.id} matchup={matchup} selected={selected} avatar={avatar} />)}</div>;
}

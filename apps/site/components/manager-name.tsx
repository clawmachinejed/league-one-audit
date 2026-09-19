'use client';

import Image from 'next/image';
import { Fragment } from 'react';
import type { Team } from '../lib/types';
import { useManagerChampionshipYears } from './manager-honors';

type ManagerIdentity = Pick<Team, 'id' | 'managerName'>;
const noManager: ManagerIdentity = { id: 0, managerName: '' };

type ChampionshipLeague = 'league1' | 'league2';

function championshipLabel(years: readonly number[], league: ChampionshipLeague): string {
  return `${years.length} League ${league === 'league1' ? 'One' : 'Two'} championship${years.length === 1 ? '' : 's'}: ${years.join(', ')}`;
}

function ChampionshipTrophies({ years, league }: { years: readonly number[]; league: ChampionshipLeague }) {
  if (!years.length) return null;
  const promotion = league === 'league2';
  return <span className="manager-championships" data-championship-league={league} role="img"
    aria-label={championshipLabel(years, league)}
    title={`${promotion ? 'League Two Promotion' : 'League One Trophy'} Bowl champion: ${years.join(', ')}`}>
    {years.map((year, index) => <Fragment key={year}>{index > 0 && ' '}<Image
      src={promotion ? '/league-two-champion-v1.png' : '/league-one-champion-v1.png'}
      alt="" width={promotion ? 1123 : 1145} height={promotion ? 1401 : 1373}
      sizes={promotion ? '12px' : '17px'} className="manager-championship-trophy" /></Fragment>)}
  </span>;
}

/** Outer button/link labels replace descendant text in the accessibility tree. */
export function useManagerNameLabel(team?: ManagerIdentity): string {
  const years = useManagerChampionshipYears(team ?? noManager);
  const promotionYears = useManagerChampionshipYears(team ?? noManager, 'league2');
  if (!team) return '';
  return [team.managerName, years.length ? championshipLabel(years, 'league1') : null,
    promotionYears.length ? championshipLabel(promotionYears, 'league2') : null].filter(Boolean).join(', ');
}

export function ManagerName({ team, className, championshipYears, promotionChampionshipYears, trophiesBefore = false }: {
  team: ManagerIdentity;
  className?: string;
  /** Mirror awards toward the center when this is the right-hand manager. */
  trophiesBefore?: boolean;
  /** The directory already carries the same verified honors in its view data. */
  championshipYears?: readonly number[];
  promotionChampionshipYears?: readonly number[];
}) {
  const contextYears = useManagerChampionshipYears(team);
  const contextPromotionYears = useManagerChampionshipYears(team, 'league2');
  const years = championshipYears ?? contextYears;
  const promotionYears = promotionChampionshipYears ?? contextPromotionYears;
  const trophies = (years.length > 0 || promotionYears.length > 0) && <>
    <ChampionshipTrophies years={years} league="league1" />
    {years.length > 0 && promotionYears.length > 0 && ' '}
    <ChampionshipTrophies years={promotionYears} league="league2" />
  </>;
  return <span className={['manager-name-with-honors', className].filter(Boolean).join(' ')} data-manager-name>
    {trophiesBefore && trophies && <>{trophies} </>}
    <span data-manager-name-text>{team.managerName}</span>
    {!trophiesBefore && trophies && <> {trophies}</>}
  </span>;
}

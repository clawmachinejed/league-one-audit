'use client';

import Image from 'next/image';
import { Fragment } from 'react';
import type { Team } from '../lib/types';
import { useManagerChampionshipYears } from './manager-honors';

type ManagerIdentity = Pick<Team, 'id' | 'managerName'>;
const noManager: ManagerIdentity = { id: 0, managerName: '' };

function championshipLabel(years: readonly number[]): string {
  return `${years.length} League One championship${years.length === 1 ? '' : 's'}: ${years.join(', ')}`;
}

/** Outer button/link labels replace descendant text in the accessibility tree. */
export function useManagerNameLabel(team?: ManagerIdentity): string {
  const years = useManagerChampionshipYears(team ?? noManager);
  if (!team) return '';
  return years.length ? `${team.managerName}, ${championshipLabel(years)}` : team.managerName;
}

export function ManagerName({ team, className, championshipYears }: {
  team: ManagerIdentity;
  className?: string;
  /** The directory already carries the same verified honors in its view data. */
  championshipYears?: readonly number[];
}) {
  const contextYears = useManagerChampionshipYears(team);
  const years = championshipYears ?? contextYears;
  return <span className={['manager-name-with-honors', className].filter(Boolean).join(' ')} data-manager-name>
    {team.managerName}{years.length > 0 && <> <span className="manager-championships" role="img"
      aria-label={championshipLabel(years)} title={`League One Trophy Bowl champion: ${years.join(', ')}`}>
      {years.map((year, index) => <Fragment key={year}>{index > 0 && ' '}<Image src="/league-one-champion-v1.png"
        alt="" width={1145} height={1373} sizes="12px" className="manager-championship-trophy" /></Fragment>)}
    </span></>}
  </span>;
}

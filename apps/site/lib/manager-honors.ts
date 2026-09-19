/** Page presentation only; never added to official teams or stored snapshots. */
export interface ManagerHonors {
  leagueId: string;
  season: string;
  managers: Readonly<Record<number, {
    managerName: string;
    championshipYears: readonly number[];
    promotionChampionshipYears?: readonly number[];
  }>>;
}

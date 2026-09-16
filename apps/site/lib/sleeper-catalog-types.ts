/** Raw official catalog structure shared by classification and presentation. */
export interface SleeperPlayer {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
  active?: boolean;
  status?: string;
  fantasy_positions?: string[];
  injury_status?: unknown;
}

export type PlayerCatalog = Record<string, SleeperPlayer>;

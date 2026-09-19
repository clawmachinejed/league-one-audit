import 'server-only';

// Owner-supplied Trophy Bowl history and manager mappings, September 19, 2026.
// These are League One titles, independent of the manager's current league.
// Sleeper's public league users/rosters verified these user IDs on that date.
// Display names, team names and league-local roster numbers are not identities.
// Finchum's 2020 title remains unassigned pending confirmation of its account.
const championships = new Map<string, readonly number[]>([
  ['1119176673112563712', [2008, 2009, 2014, 2025]], // Baute.J / jwbaute
  ['95628446075863040', [2010, 2012, 2017]], // Greene.R / eneerg
  ['79628519873069056', [2013, 2016]], // Harris / DannyPak (Danny Pack)
  ['862413572871917568', [2011, 2024]], // Woodruff.S / SWoodruff
  ['1118641954104934400', [2022]], // Greene.D / dgreene4223 (Old School)
  ['862775527184920576', [2015]], // Hrebec / whrebec
  ['869668648841846784', [2023]], // Baute.T / tbaute69
  ['862417088369782784', [2019]], // Franklin / trellfrank
  ['862413379120263168', [2018]], // Metcalf / bmetcalf21
  ['862429971266834432', [2021]], // Williams / swilliams24
]);
const noChampionships: readonly number[] = [];

export function leagueOneChampionshipYears(ownerId: string | null | undefined): readonly number[] {
  return ownerId ? championships.get(ownerId) ?? noChampionships : noChampionships;
}

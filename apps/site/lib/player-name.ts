const defenseNicknames: Readonly<Record<string, string>> = {
  'arizona cardinals': 'Cardinals',
  'atlanta falcons': 'Falcons',
  'baltimore ravens': 'Ravens',
  'buffalo bills': 'Bills',
  'carolina panthers': 'Panthers',
  'chicago bears': 'Bears',
  'cincinnati bengals': 'Bengals',
  'cleveland browns': 'Browns',
  'dallas cowboys': 'Cowboys',
  'denver broncos': 'Broncos',
  'detroit lions': 'Lions',
  'green bay packers': 'Packers',
  'houston texans': 'Texans',
  'indianapolis colts': 'Colts',
  'jacksonville jaguars': 'Jaguars',
  'kansas city chiefs': 'Chiefs',
  'las vegas raiders': 'Raiders',
  'los angeles chargers': 'Chargers',
  'los angeles rams': 'Rams',
  'miami dolphins': 'Dolphins',
  'minnesota vikings': 'Vikings',
  'new england patriots': 'Patriots',
  'new orleans saints': 'Saints',
  'new york giants': 'Giants',
  'new york jets': 'Jets',
  'philadelphia eagles': 'Eagles',
  'pittsburgh steelers': 'Steelers',
  'san francisco 49ers': '49ers',
  'seattle seahawks': 'Seahawks',
  'tampa bay buccaneers': 'Buccaneers',
  'tennessee titans': 'Titans',
  'washington commanders': 'Commanders',
};

/** A shorter display label; callers decide whether the full name fits first. */
export function compactPlayerName(name: string, position?: string): string {
  const normalized = name.trim().replace(/\s+/gu, ' ');

  if (position?.trim().toUpperCase() === 'DEF') {
    const teamLabel = normalized.toLowerCase().replace(/\s+(?:defense|d\/st)$/u, '');
    return defenseNicknames[teamLabel] ?? normalized;
  }

  // Preserve the missing-slot and unavailable-catalog labels from playerFromId.
  if (/^(?:empty slot|player \S+|unknown(?: player)?)$/iu.test(normalized)) {
    return normalized;
  }

  const space = normalized.indexOf(' ');
  if (space === -1) return normalized;

  // Keep the entire remainder so compound surnames and suffixes stay intact.
  const initial = Array.from(normalized)[0];
  return `${initial}. ${normalized.slice(space + 1)}`;
}

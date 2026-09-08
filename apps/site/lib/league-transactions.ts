import type { LeagueKey } from './leagues';
import type {
  LeagueMoveActivity,
  LeagueTradeActivity,
  LeagueTradeAsset,
  LeagueTransactionActivity,
  LeagueTransactionClaim,
  LeagueWaiverActivity,
  LeagueWaiverWinner,
  Team,
  TransactionPlayer,
} from './types';
import {
  dedupeTransactions,
  numberOrNull,
  playerFromId,
  transactionResult,
  transactionTimestamp,
  waiverBid,
  type PlayerCatalog,
  type SleeperTransaction,
} from './transform';
import { transactionCalendarDay } from './transaction-time';

const PENDING_STATUSES = new Set(['pending', 'processing', 'queued']);

function validRosterId(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validTimestamp(value: unknown): number {
  const timestamp = numberOrNull(value);
  return timestamp !== null && timestamp > 0 && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : 0;
}

function iso(timestamp: number): string | null {
  return timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

function transactionType(type: string | undefined): string {
  if (type === 'free_agent') return 'Free agent';
  if (!type) return 'Transaction';
  return type.replace(/_/gu, ' ').replace(/^./u, letter => letter.toUpperCase());
}

function playerSummary(id: string, catalog: PlayerCatalog): TransactionPlayer {
  const player = playerFromId(id, '', catalog);
  return { id: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam };
}

function describePlayer(id: string, catalog: PlayerCatalog): string {
  const player = playerSummary(id, catalog);
  const details = [player.position === '—' ? null : player.position, player.nflTeam].filter(Boolean).join(' · ');
  return `${player.name}${details ? ` (${details})` : ''}`;
}

function rosterIds(row: SleeperTransaction): number[] {
  return [
    ...(row.roster_ids ?? []),
    ...(row.consenter_ids ?? []),
    ...Object.values(row.adds ?? {}),
    ...Object.values(row.drops ?? {}),
    ...(row.draft_picks ?? []).flatMap(pick => [pick.previous_owner_id, pick.owner_id]),
    ...(row.waiver_budget ?? []).flatMap(move => [move.sender, move.receiver]),
  ].map(validRosterId).filter((id): id is number => id !== null);
}

function noteFor(row: SleeperTransaction): string | null {
  for (const value of [row.metadata?.notes, row.metadata?.note, row.metadata?.reason, row.metadata?.failure_reason]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizeMove(row: SleeperTransaction, teamName: (id: unknown) => string, catalog: PlayerCatalog): LeagueMoveActivity {
  const directRosterIds = [
    ...(row.roster_ids ?? []), ...Object.values(row.adds ?? {}), ...Object.values(row.drops ?? {}),
  ].map(validRosterId).filter((id): id is number => id !== null);
  const teams = [...new Set(directRosterIds.length ? directRosterIds : (row.consenter_ids ?? []))]
    .map(teamName).sort((a, b) => a.localeCompare(b));
  const lines: LeagueMoveActivity['lines'] = [];
  const adds = Object.keys(row.adds ?? {}).map(playerId => describePlayer(playerId, catalog));
  const drops = Object.keys(row.drops ?? {}).map(playerId => describePlayer(playerId, catalog));
  if (adds.length) lines.push({ label: adds.length === 1 ? 'Added' : 'Added', text: adds.join(', ') });
  if (drops.length) lines.push({ label: drops.length === 1 ? 'Dropped' : 'Dropped', text: drops.join(', ') });
  const note = noteFor(row);
  if (note) lines.push({ label: 'Note', text: note });
  if (!lines.length) lines.push({ label: 'Details', text: 'Sleeper did not provide asset details for this transaction.' });
  return {
    kind: 'add_drop',
    id: row.transaction_id,
    timestamp: iso(transactionTimestamp(row)),
    title: teams.join(', ') || 'Unknown team',
    type: transactionType(row.type),
    result: transactionResult(row),
    lines,
  };
}

function normalizeTrade(row: SleeperTransaction, teamName: (id: unknown) => string, catalog: PlayerCatalog): LeagueTradeActivity {
  const participants = [...new Set(rosterIds(row))].sort((a, b) => teamName(a).localeCompare(teamName(b)) || a - b);
  const received = new Map<number, LeagueTradeAsset[]>();
  const unassigned: LeagueTradeAsset[] = [];
  const legacyReceived = new Map<number, string[]>();
  const legacySent = new Map<number, string[]>();
  const addAsset = (idValue: unknown, asset: LeagueTradeAsset) => {
    const id = validRosterId(idValue);
    if (id === null) {
      unassigned.push(asset);
      return;
    }
    received.set(id, [...(received.get(id) ?? []), asset]);
  };
  const addLegacyAsset = (map: Map<number, string[]>, idValue: unknown, asset: string) => {
    const id = validRosterId(idValue);
    if (id === null) return;
    map.set(id, [...(map.get(id) ?? []), asset]);
  };
  const assignedPlayerIds = new Set(Object.keys(row.adds ?? {}));
  for (const [playerId, receiver] of Object.entries(row.adds ?? {})) {
    const player = describePlayer(playerId, catalog);
    addAsset(receiver, { type: 'Player', text: player });
    addLegacyAsset(legacyReceived, receiver, player);
  }
  for (const [playerId, sender] of Object.entries(row.drops ?? {})) {
    const player = describePlayer(playerId, catalog);
    addLegacyAsset(legacySent, sender, player);
    if (!assignedPlayerIds.has(playerId)) unassigned.push({ type: 'Player', text: player });
  }
  for (const pick of row.draft_picks ?? []) {
    const legacyAsset = `${pick.season} round ${pick.round} (${teamName(pick.roster_id)} original pick)`;
    addAsset(pick.owner_id, {
      type: 'Pick',
      text: `${pick.season} Round ${pick.round} (${teamName(pick.roster_id)} original pick)`,
    });
    addLegacyAsset(legacyReceived, pick.owner_id, legacyAsset);
    addLegacyAsset(legacySent, pick.previous_owner_id, legacyAsset);
  }
  for (const move of row.waiver_budget ?? []) {
    const amount = numberOrNull(move.amount);
    addAsset(move.receiver, { type: 'FAAB', text: amount === null ? 'Unknown amount' : `$${amount}` });
    const legacyAsset = `${amount === null ? 'Unknown amount' : `$${amount}`} FAAB`;
    addLegacyAsset(legacyReceived, move.receiver, legacyAsset);
    addLegacyAsset(legacySent, move.sender, legacyAsset);
  }
  const normalizedParticipants = participants.map(id => ({
    id,
    team: teamName(id),
    receives: received.get(id) ?? [{ type: 'Details' as const, text: 'No received assets reported by Sleeper.' }],
  }));
  const lines: LeagueTradeActivity['lines'] = [];
  for (const id of participants) {
    const incoming = legacyReceived.get(id) ?? [];
    const outgoing = legacySent.get(id) ?? [];
    if (incoming.length) lines.push({ label: `${teamName(id)} received`, text: incoming.join(', ') });
    if (outgoing.length) lines.push({ label: `${teamName(id)} sent`, text: outgoing.join(', ') });
    if (!incoming.length && !outgoing.length) lines.push({ label: teamName(id), text: 'No asset details reported by Sleeper.' });
  }
  if (!lines.length) lines.push({ label: 'Details', text: 'Sleeper did not provide participant or asset details for this trade.' });
  return {
    kind: 'trade',
    id: row.transaction_id,
    timestamp: iso(transactionTimestamp(row)),
    title: participants.map(teamName).join(' ↔ ') || 'Trade',
    result: transactionResult(row),
    lines,
    participants: normalizedParticipants,
    unassigned,
  };
}

function waiverPlayerId(row: SleeperTransaction): string | null {
  const ids = Object.keys(row.adds ?? {}).filter(id => id.trim());
  return ids.length === 1 ? ids[0] : null;
}

function waiverRosterId(row: SleeperTransaction, playerId: string | null): number | null {
  return validRosterId(playerId ? row.adds?.[playerId] : null)
    ?? (row.roster_ids ?? []).map(validRosterId).find((id): id is number => id !== null)
    ?? (row.consenter_ids ?? []).map(validRosterId).find((id): id is number => id !== null)
    ?? Object.values(row.drops ?? {}).map(validRosterId).find((id): id is number => id !== null)
    ?? null;
}

function compareClaims(a: LeagueTransactionClaim, b: LeagueTransactionClaim): number {
  const winnerDifference = Number(b.result === 'Won') - Number(a.result === 'Won');
  if (winnerDifference) return winnerDifference;
  const missingDifference = Number(a.bid === null) - Number(b.bid === null);
  if (missingDifference) return missingDifference;
  const bidDifference = (b.bid ?? 0) - (a.bid ?? 0);
  return bidDifference || a.team.localeCompare(b.team) || a.id.localeCompare(b.id);
}

function normalizeWaiverGroup(
  key: string,
  rows: SleeperTransaction[],
  playerId: string | null,
  day: string | null,
  teamName: (id: unknown) => string,
  catalog: PlayerCatalog,
): LeagueWaiverActivity {
  const newestTimestamp = Math.max(0, ...rows.map(transactionTimestamp));
  const winningStatusTimestamp = Math.max(0, ...rows
    .filter(row => transactionResult(row) === 'Won')
    .map(row => validTimestamp(row.status_updated)));
  const claims = rows.map((row): LeagueTransactionClaim => ({
    id: row.transaction_id,
    team: teamName(waiverRosterId(row, playerId)),
    bid: waiverBid(row),
    result: transactionResult(row),
  })).sort(compareClaims);
  const winners = rows.filter(row => transactionResult(row) === 'Won').map((row): LeagueWaiverWinner => ({
    id: row.transaction_id,
    team: teamName(waiverRosterId(row, playerId)),
    added: Object.keys(row.adds ?? {}).map(id => playerSummary(id, catalog)),
    dropped: Object.keys(row.drops ?? {}).map(id => playerSummary(id, catalog)),
  })).sort((a, b) => a.team.localeCompare(b.team) || a.id.localeCompare(b.id));
  return {
    kind: 'waiver',
    id: key,
    timestamp: iso(newestTimestamp),
    processedAt: iso(winningStatusTimestamp || newestTimestamp),
    day,
    player: playerId ? playerSummary(playerId, catalog) : null,
    claims,
    winners,
  };
}

/**
 * Finalized waivers are deliberately presented by league, claimed player and New York calendar
 * day. Sleeper supplies no processing-event identifier, so this grouping must never be described
 * as a provider-defined event. Unknown-player or invalid-date claims remain separate by transaction.
 */
export function normalizeLeagueTransactions(
  rows: SleeperTransaction[],
  leagueKey: LeagueKey,
  teams: Team[],
  catalog: PlayerCatalog,
): LeagueTransactionActivity[] {
  const teamNames = new Map(teams.map(team => [team.id, team.name]));
  const teamName = (idValue: unknown) => {
    const id = validRosterId(idValue);
    return id === null ? 'Unknown team' : teamNames.get(id) ?? `Team ${id}`;
  };
  const finalized = dedupeTransactions(rows).filter(row => !PENDING_STATUSES.has(row.status?.toLowerCase() ?? ''));
  const waiverGroups = new Map<string, { rows: SleeperTransaction[]; playerId: string | null; day: string | null }>();
  const activities: LeagueTransactionActivity[] = [];
  for (const row of finalized) {
    if (row.type === 'waiver') {
      const playerId = waiverPlayerId(row);
      const day = transactionCalendarDay(transactionTimestamp(row));
      const key = playerId && day
        ? `${leagueKey}:waiver:${playerId}:${day}`
        : `${leagueKey}:waiver:unknown:${row.transaction_id}`;
      const group = waiverGroups.get(key) ?? { rows: [], playerId, day };
      group.rows.push(row);
      waiverGroups.set(key, group);
    } else if (row.type === 'trade') {
      activities.push(normalizeTrade(row, teamName, catalog));
    } else {
      activities.push(normalizeMove(row, teamName, catalog));
    }
  }
  for (const [key, group] of waiverGroups) {
    activities.push(normalizeWaiverGroup(key, group.rows, group.playerId, group.day, teamName, catalog));
  }
  return activities.sort((a, b) => {
    const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return bTime - aTime || b.id.localeCompare(a.id);
  });
}

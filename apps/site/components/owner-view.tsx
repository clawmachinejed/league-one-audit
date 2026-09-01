'use client';

import type { OwnerData, Player } from '../lib/types';
import { Updated } from './league-primitives';
import { OwnerHeader } from './owner-profile';
import { useTeamPreference } from './team-preference';

function RosterSection({ title, players }: { title: string; players: Player[] }) {
  return <section className="roster-section"><div className="section-label"><h2>{title}</h2><span>{players.length} {players.length === 1 ? 'player' : 'players'}</span></div><div className="roster-list">{players.length ? players.map((player, index) => <div className="roster-player" key={`${player.id}-${index}`}><span className="roster-slot">{player.slot || player.position || '—'}</span><div className="roster-player-name"><span>{player.name}</span><small>{player.position || 'Position unavailable'}</small></div><span className="roster-nfl-team">{player.nflTeam || '—'}</span></div>) : <p className="roster-empty">No players assigned.</p>}</div></section>;
}

export function OwnerView({ data }: { data: OwnerData }) {
  useTeamPreference(data.teams);
  return <><OwnerHeader data={data} active="roster" /><div className="roster-layout"><RosterSection title="Starting lineup" players={data.starters} /><div><RosterSection title="Bench" players={data.bench} />{data.reserve.length > 0 && <RosterSection title="Reserve" players={data.reserve} />}</div></div><Updated value={data.updatedAt} /><p className="refresh-note">Current roster and lineup from Sleeper.</p></>;
}

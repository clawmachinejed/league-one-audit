'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from 'react';
import type {
  League,
  MatchupsData,
  OverviewData,
  OwnerData,
  Player,
  Team,
  Transaction,
  TransactionsData,
} from '../lib/types';
import { MatchupBoard } from './matchup-board';
import matchupStyles from './matchups.module.css';

type IconName = 'matchups' | 'standings' | 'owners' | 'chevron' | 'arrow' | 'refresh' | 'check' | 'star';

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    matchups: <><path d="M5 4v16M19 4v16M3 7h6m6 10h6M9 4v6m6 4v6M9 7h6m-6 10h6" /></>,
    standings: <><path d="M4 20V10h4v10m2 0V4h4v16m2 0v-7h4v7M2 20h20" /></>,
    owners: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2m2-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
    arrow: <path d="m14 6-6 6 6 6" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    star: <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3.2 9.6l6.3-.9L12 3Z" />,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

interface TeamPreference {
  selected: number | null;
  ready: boolean;
  select: (id: number | null) => void;
  validate: (ids: number[]) => void;
  storageWarning: string;
}

const MyTeamContext = createContext<TeamPreference>({ selected: null, ready: false, select: () => undefined, validate: () => undefined, storageWarning: '' });
const preferenceMemory = new Map<string, number | null>();
const memoryOnlyPreferences = new Set<string>();
const preferenceEvent = 'league-one:my-team-change';

function parsePreference(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function AppShell({ children, leagueId }: { children: ReactNode; leagueId: string }) {
  const pathname = usePathname();
  const compactMatchups = pathname === '/matchups';
  const storageKey = `league-one:my-team:${leagueId}`;
  const [announcement, setAnnouncement] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) notify(); };
    const onPreference = (event: Event) => { if ((event as CustomEvent<string>).detail === storageKey) notify(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(preferenceEvent, onPreference);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(preferenceEvent, onPreference);
    };
  }, [storageKey]);
  const getSnapshot = useCallback(() => {
    if (memoryOnlyPreferences.has(storageKey)) return preferenceMemory.get(storageKey) ?? null;
    try { return parsePreference(window.localStorage.getItem(storageKey)); }
    catch { return preferenceMemory.get(storageKey) ?? null; }
  }, [storageKey]);
  const selected = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);

  const select = useCallback((id: number | null) => {
    preferenceMemory.set(storageKey, id);
    try {
      if (id === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, String(id));
      memoryOnlyPreferences.delete(storageKey);
      setStorageWarning('');
      setAnnouncement(id === null ? 'My Team selection cleared.' : 'My Team saved on this device.');
    } catch {
      memoryOnlyPreferences.add(storageKey);
      setStorageWarning('This preference applies to this visit only. Browser storage is unavailable, so the change cannot be saved for next time.');
      setAnnouncement('Your selection works for this visit. Browser storage is unavailable, so it cannot be saved for next time.');
    }
    window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: storageKey }));
  }, [storageKey]);

  const validate = useCallback((ids: number[]) => {
    if (ready && selected !== null && ids.length > 0 && !ids.includes(selected)) select(null);
  }, [ready, selected, select]);
  const preference = useMemo(() => ({ selected, ready, select, validate, storageWarning }), [selected, ready, select, validate, storageWarning]);
  const nav: { href: string; label: string; icon: IconName }[] = [
    { href: '/matchups', label: 'Matchups', icon: 'matchups' },
    { href: '/standings', label: 'Standings', icon: 'standings' },
    { href: '/owners', label: 'Owners', icon: 'owners' },
  ];

  return <MyTeamContext.Provider value={preference}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/matchups" aria-label="League One home">
          <Image src="/logo.png" width={42} height={42} alt="" className="brand-mark" priority />
          <span><span className="brand-name">LEAGUE ONE<span className="brand-period">.</span></span><span className="brand-caption">FANTASY FOOTBALL</span></span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {nav.map(item => <Link key={item.href} href={item.href} aria-current={pathname.startsWith(item.href) ? 'page' : undefined}><Icon name={item.icon} />{item.label}</Link>)}
        </nav>
      </div>
    </header>
    <main id="main-content" className={`main-content ${compactMatchups ? 'matchups-main' : ''}`} tabIndex={-1}>{children}</main>
    <nav className={`mobile-nav ${compactMatchups ? 'matchups-mobile-nav' : ''}`} aria-label="Mobile navigation">
      {nav.map(item => <Link key={item.href} href={item.href} aria-current={pathname.startsWith(item.href) ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span></Link>)}
    </nav>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </MyTeamContext.Provider>;
}

function useTeamPreference(teams: Team[]) {
  const preference = useContext(MyTeamContext);
  const { validate } = preference;
  const ids = teams.map(team => team.id).join(',');
  useEffect(() => { validate(ids ? ids.split(',').map(Number) : []); }, [ids, validate]);
  return preference;
}

function number(value: number | null | undefined, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
}

function record(team: Team) {
  return `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`;
}

function Avatar({ team, large = false }: { team: Team; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === team.avatar;
  const initials = (team.ownerName || team.name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return <span className={`avatar ${large ? 'avatar-large' : ''}`} aria-hidden="true">
    {team.avatar && !failed ? <Image src={team.avatar} alt="" width={large ? 64 : 40} height={large ? 64 : 40} unoptimized onError={() => setFailedUrl(team.avatar)} /> : <span>{initials || 'L1'}</span>}
  </span>;
}

function LeagueMeta({ league }: { league: League }) {
  return <p className="eyebrow">{league.season} season</p>;
}

function PageHeading({ title, description, league, action }: { title: string; description: string; league: League; action?: ReactNode }) {
  return <div className="page-heading"><LeagueMeta league={league} /><div className="heading-row"><div><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</div></div>;
}

function Warning({ message }: { message?: string }) {
  return message ? <div className="data-warning" role="status"><span className="warning-symbol" aria-hidden="true">!</span><p>{message}</p></div> : null;
}

function Updated({ value, refreshing = false }: { value: string; refreshing?: boolean }) {
  const date = new Date(value);
  const time = Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return <p className="updated" aria-live="polite">{refreshing ? 'Refreshing scores…' : time ? <>Sleeper data · Updated {time} ET</> : 'Data from Sleeper'}</p>;
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true"><Icon name="matchups" /></span><h2>{title}</h2><p>{children}</p></div>;
}

function MyTeamButton({ team, compact = false }: { team: Team; compact?: boolean }) {
  const { selected, select } = useContext(MyTeamContext);
  const active = selected === team.id;
  return <button type="button" className={`my-team-button ${active ? 'is-selected' : ''} ${compact ? 'compact' : ''}`} onClick={() => select(active ? null : team.id)} aria-pressed={active} aria-label={active ? `Clear ${team.name} as My Team` : `Select ${team.name} as My Team`}><Icon name={active ? 'check' : 'star'} />{active ? 'My Team' : 'Select my team'}</button>;
}

export function StandingsView({ data }: { data: OverviewData }) {
  const { selected } = useTeamPreference(data.teams);
  return <>
    <PageHeading title="Standings" description="The league, at a glance." league={data.league} />
    <Warning message={data.warning} />
    <div className="section-label"><h2>League table</h2><span>{data.teams.length} teams</span></div>
    {data.teams.length ? <div className="standings-wrap"><table className="standings-table">
      <caption className="sr-only">League standings, ordered by record and points scored. Points against is available on wider screens.</caption>
      <thead><tr><th scope="col" className="rank-cell">#</th><th scope="col">Team</th><th scope="col" className="number-cell"><abbr title="Wins, losses, and ties">W–L</abbr></th><th scope="col" className="number-cell"><abbr title="Points for">PF</abbr></th><th scope="col" className="number-cell standings-extra"><abbr title="Points against">PA</abbr></th></tr></thead>
      <tbody>{data.teams.map((team, index) => <tr key={team.id} className={selected === team.id ? 'selected-row' : ''}>
        <td className="rank-cell"><span className={index < 3 ? 'rank-top' : ''}>{index + 1}</span></td>
        <th scope="row"><Link href={`/owners/${team.id}`} className="standings-team"><Avatar team={team} /><span className="team-text"><span className="team-name">{team.name}</span><span className="owner-name">{selected === team.id && <span className="my-team-label">MY TEAM<span aria-hidden="true"> · </span></span>}{team.ownerName}</span></span></Link></th>
        <td className="number-cell record-cell">{record(team)}</td><td className="number-cell points-cell">{number(team.pointsFor, 2)}</td><td className="number-cell standings-extra points-cell">{number(team.pointsAgainst, 2)}</td>
      </tr>)}</tbody>
    </table></div> : <EmptyState title="The league table is on its way">Teams will appear when Sleeper has league rosters available.</EmptyState>}
    <p className="table-note">Ordered by record, then points for. <span>PF = points for<span className="standings-extra-inline"> · PA = points against</span>.</span></p>
    <Updated value={data.updatedAt} />
  </>;
}

export function MatchupsView({ data }: { data: MatchupsData }) {
  const { selected } = useTeamPreference(data.teams);
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const currentWeek = data.week === data.league.week;
  useEffect(() => {
    if (!currentWeek) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
    return () => window.clearInterval(timer);
  }, [currentWeek, refresh]);
  const matchups = useMemo(() => [...data.matchups].sort((a, b) => Number(b.sides.some(side => side.team.id === selected)) - Number(a.sides.some(side => side.team.id === selected))), [data.matchups, selected]);
  return <div className={matchupStyles.page}>
    <div className={matchupStyles.toolbar}>
      <div className={matchupStyles.heading}><h1>Matchups</h1><p className={matchupStyles.season}>{data.league.season} season</p></div>
      <div className={matchupStyles.weekControl}>
        {data.week > 1 ? <Link className={matchupStyles.weekArrow} href={`/matchups?week=${data.week - 1}`} aria-label={`Previous week, week ${data.week - 1}`}><Icon name="arrow" /></Link> : <span className={`${matchupStyles.weekArrow} disabled`} aria-hidden="true"><Icon name="arrow" /></span>}
        <label className={matchupStyles.weekSelect}><span className="sr-only">Matchup week</span><select value={data.week} onChange={event => router.push(`/matchups?week=${event.target.value}`)}>{Array.from({ length: data.league.maxWeek }, (_, index) => <option key={index + 1} value={index + 1}>Week {index + 1}</option>)}</select><Icon name="chevron" /></label>
        {data.week < data.league.maxWeek ? <Link className={matchupStyles.weekArrow} href={`/matchups?week=${data.week + 1}`} aria-label={`Next week, week ${data.week + 1}`}><Icon name="arrow" className="arrow-forward" /></Link> : <span className={`${matchupStyles.weekArrow} disabled`} aria-hidden="true"><Icon name="arrow" /></span>}
      </div>
      <button className={matchupStyles.refresh} type="button" onClick={refresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing matchups' : 'Refresh matchups'}><Icon name="refresh" className={refreshing ? 'spinning' : ''} /></button>
    </div>
    {!currentWeek && <Link className={matchupStyles.backToCurrent} href={`/matchups?week=${data.league.week}`}>Back to current</Link>}
    <Warning message={data.warning} />
    {matchups.length ? <MatchupBoard key={data.week} matchups={matchups} selected={selected} avatar={team => <Avatar team={team} />} /> : <EmptyState title="No matchups posted yet">Week {data.week} matchups will appear when Sleeper publishes the schedule. You can still browse teams and standings.</EmptyState>}
    <Updated value={data.updatedAt} refreshing={refreshing} />
    {currentWeek && <p className="refresh-note">Refreshes every minute while this page is open.</p>}
  </div>;
}

export function OwnersView({ data }: { data: OverviewData }) {
  const { selected, select, storageWarning } = useTeamPreference(data.teams);
  const myTeam = data.teams.find(team => team.id === selected);
  const teams = [...data.teams].sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  return <>
    <PageHeading title="Owners" description="The people and teams of League One." league={data.league} />
    <Warning message={data.warning} />
    <Warning message={storageWarning} />
    <div className={`preference-banner ${myTeam ? 'has-preference' : ''}`}><span className="preference-icon"><Icon name={myTeam ? 'check' : 'star'} /></span><div><h2>{myTeam ? `${myTeam.name} is your team` : 'Choose your team.'}</h2><p>{myTeam ? 'Saved on this browser. Highlighted across the league.' : 'Select your team below. We’ll remember it on this browser.'}</p></div>{myTeam && <button type="button" className="text-button" onClick={() => select(null)}>Clear</button>}</div>
    <div className="section-label"><h2>The owners</h2><span>{teams.length} teams</span></div>
    {teams.length ? <div className="owners-grid">{teams.map(team => <article key={team.id} className={`owner-card ${selected === team.id ? 'selected-owner' : ''}`}><Link href={`/owners/${team.id}`} className="owner-card-link"><div className="owner-card-top"><Avatar team={team} /><span className="owner-card-record">{record(team)}<small>RECORD</small></span></div><h2>{team.name}</h2><p>{team.ownerName}</p><span className="owner-profile-cta">Roster & transactions<Icon name="arrow" className="arrow-forward" /></span></Link><div className="owner-card-bottom"><MyTeamButton team={team} compact /><span className="owner-pf">{number(team.pointsFor, 2)} <abbr title="Points for">PF</abbr></span></div></article>)}</div> : <EmptyState title="Owners are on their way">The directory will populate when league rosters are available from Sleeper.</EmptyState>}
    <Updated value={data.updatedAt} />
  </>;
}

function OwnerHeader({ data, active }: { data: OwnerData | TransactionsData; active: 'roster' | 'transactions' }) {
  const { storageWarning } = useContext(MyTeamContext);
  return <>
    <Link className="back-link" href="/owners"><Icon name="arrow" />All owners</Link>
    <div className="owner-heading"><LeagueMeta league={data.league} /><div className="profile-identity"><Avatar team={data.team} large /><div><h1>{data.team.name}</h1><p>{data.team.ownerName}</p></div></div><MyTeamButton team={data.team} /></div>
    <Warning message={data.warning} />
    <Warning message={storageWarning} />
    <dl className="team-summary"><div><dt>Record</dt><dd>{record(data.team)}</dd></div><div><dt>Points for</dt><dd>{number(data.team.pointsFor, 2)}</dd></div><div><dt>Points against</dt><dd>{number(data.team.pointsAgainst, 2)}</dd></div></dl>
    <nav className="profile-tabs" aria-label="Team pages"><Link href={`/owners/${data.team.id}`} aria-current={active === 'roster' ? 'page' : undefined}>Roster</Link><Link href={`/owners/${data.team.id}/transactions`} aria-current={active === 'transactions' ? 'page' : undefined}>Transactions</Link></nav>
  </>;
}

function RosterSection({ title, players }: { title: string; players: Player[] }) {
  return <section className="roster-section"><div className="section-label"><h2>{title}</h2><span>{players.length} {players.length === 1 ? 'player' : 'players'}</span></div><div className="roster-list">{players.length ? players.map((player, index) => <div className="roster-player" key={`${player.id}-${index}`}><span className="roster-slot">{player.slot || player.position || '—'}</span><div className="roster-player-name"><span>{player.name}</span><small>{player.position || 'Position unavailable'}</small></div><span className="roster-nfl-team">{player.nflTeam || '—'}</span></div>) : <p className="roster-empty">No players assigned.</p>}</div></section>;
}

export function OwnerView({ data }: { data: OwnerData }) {
  useTeamPreference(data.teams);
  return <><OwnerHeader data={data} active="roster" /><div className="roster-layout"><RosterSection title="Starting lineup" players={data.starters} /><div><RosterSection title="Bench" players={data.bench} />{data.reserve.length > 0 && <RosterSection title="Reserve" players={data.reserve} />}</div></div><Updated value={data.updatedAt} /><p className="refresh-note">Current roster and lineup from Sleeper.</p></>;
}

function typeLabel(value: string) {
  const normalized = value.replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function transactionDate(value: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

function TransactionCard({ transaction }: { transaction: Transaction }) {
  const resultClass = transaction.result === 'Won' || transaction.result === 'Complete' ? 'positive' : transaction.result === 'Lost' || transaction.result === 'Failed' ? 'negative' : 'neutral';
  return <article className={`transaction-card result-${resultClass}`}>
    <div className="transaction-header"><div><p className="transaction-type">{typeLabel(transaction.type)}</p><p className="transaction-date">{transactionDate(transaction.date)}</p></div><span className={`result-badge ${resultClass}`}>{transaction.result === 'Won' && <Icon name="check" />}{transaction.result}</span></div>
    <div className="transaction-body">{transaction.lines.length ? <dl className="transaction-lines">{transaction.lines.map((line, index) => <div key={`${index}-${line.label}`} className={/^(added|received|add)$/i.test(line.label) ? 'movement-add' : /^(dropped|sent|drop)$/i.test(line.label) ? 'movement-drop' : ''}><dt>{line.label}</dt><dd>{line.text}</dd></div>)}</dl> : <p className="transaction-no-details">Sleeper has not supplied player movement details.</p>}{transaction.bid !== null && <div className="faab-bid"><span>FAAB bid</span><strong>${number(transaction.bid, 0)}</strong></div>}</div>
  </article>;
}

export function TransactionsView({ data }: { data: TransactionsData }) {
  useTeamPreference(data.teams);
  const [filter, setFilter] = useState('all');
  const types = [...new Set(data.transactions.map(transaction => transaction.type))].sort();
  const filtered = filter === 'all' ? data.transactions : data.transactions.filter(transaction => transaction.type === filter);
  return <><OwnerHeader data={data} active="transactions" />
    {data.partial && !data.warning && <Warning message="Some transaction history could not be loaded. The activity below may be incomplete; try refreshing shortly." />}
    <div className="transactions-heading"><div className="section-label"><h2>Team activity</h2><span>{filtered.length} {filtered.length === 1 ? 'move' : 'moves'}</span></div>{types.length > 1 && <label className="transaction-filter"><span className="sr-only">Filter transaction type</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All moves</option>{types.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}</select><Icon name="chevron" /></label>}</div>
    {filtered.length ? <div className="transactions-list">{filtered.map(transaction => <TransactionCard key={transaction.id} transaction={transaction} />)}</div> : <EmptyState title={filter === 'all' ? 'A fresh season. A clean slate.' : 'No moves of this type'}>{filter === 'all' ? 'Waivers, free agents, and trades will appear here when Sleeper reports them.' : 'Choose All moves to see the rest of this team’s activity.'}</EmptyState>}
    <Updated value={data.updatedAt} /><p className="refresh-note">Results and FAAB bids are reported by Sleeper.</p>
  </>;
}

export function LoadingView() {
  return <div className="loading-view" aria-busy="true" role="status"><span className="eyebrow">LEAGUE ONE</span><h1>Loading the league<span className="loading-dots">…</span></h1><p className="page-description">Getting the latest from Sleeper.</p><div className="loading-skeleton"><span /><span /><span /></div><span className="sr-only">League data is loading.</span></div>;
}

export function ErrorView({ message, retry }: { message?: string; retry?: () => void }) {
  const router = useRouter();
  return <div className="error-view"><p className="eyebrow">A QUICK TIMEOUT</p><h1>We couldn’t load the league.</h1><p>{message || 'Sleeper may be taking a moment. League One and your saved team selection are still here.'}</p><button className="primary-button" type="button" onClick={retry || (() => router.refresh())}><Icon name="refresh" />Try again</button><Link href="/matchups" className="text-button">Back to matchups</Link></div>;
}

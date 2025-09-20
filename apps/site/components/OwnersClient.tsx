"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const MY_TEAM_KEYS = ["l1.myTeamRosterId", "myTeam"] as const;

function readMyTeam(): number | null {
  try {
    for (const k of MY_TEAM_KEYS) {
      const v = localStorage.getItem(k);
      if (v != null && v !== "") {
        const n = Number(v);
        if (!Number.isNaN(n)) return n;
      }
    }
  } catch {}
  return null;
}

function migrateToBothKeys(value: number | null) {
  try {
    for (const k of MY_TEAM_KEYS) {
      if (value == null) localStorage.removeItem(k);
      else localStorage.setItem(k, String(value));
    }
  } catch {}
}

type OwnerVM = {
  roster_id: number;
  owner_id: string;
  display_name: string;
  avatar_url?: string;
  team_name?: string | null; // NEW
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
};

export default function OwnersClient({ owners }: { owners: OwnerVM[] }) {
  const [myTeam, setMyTeam] = useState<number | null>(null);

  useEffect(() => {
    const v = readMyTeam();
    migrateToBothKeys(v);
    setMyTeam(v);

    const onStorage = (ev: StorageEvent) => {
      if (!ev.key || MY_TEAM_KEYS.includes(ev.key as any))
        setMyTeam(readMyTeam());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") setMyTeam(readMyTeam());
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const displayOwners = useMemo(() => {
    if (myTeam == null) return owners;
    const mine = owners.find((o) => o.roster_id === myTeam);
    if (!mine) return owners;
    const rest = owners.filter((o) => o.roster_id !== myTeam);
    return [mine, ...rest];
  }, [owners, myTeam]);

  return (
    <ul
      style={{
        display: "grid",
        gap: 12,
        listStyle: "none",
        padding: 0,
        margin: 0,
      }}
    >
      {displayOwners.map((o) => {
        const isMine = myTeam != null && o.roster_id === myTeam;
        return (
          <li
            key={o.roster_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              border: "1px solid",
              borderColor: isMine ? "#bfdbfe" : "#e5e7eb",
              borderRadius: 10,
              background: isMine ? "#e7f0ff" : "white",
            }}
          >
            <Image
              src={o.avatar_url || "/avatar-placeholder.png"}
              alt=""
              width={40}
              height={40}
              style={{ borderRadius: "50%", objectFit: "cover" }}
            />
            <div style={{ display: "grid", gap: 2 }}>
              <Link
                href={`/owners/${o.roster_id}`}
                style={{ fontWeight: 600, textDecoration: "none" }}
              >
                {o.display_name}
              </Link>

              {/* Always show a line: either team name or em dash */}
              <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.95 }}>
                {o.team_name ?? "—"}
              </div>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {o.wins}-{o.losses} • PF {o.points_for.toFixed(1)} • PA{" "}
                {o.points_against.toFixed(1)}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

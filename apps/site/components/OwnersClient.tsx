"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";

export type OwnerCard = {
  roster_id: number;
  owner_id: string;
  display_name: string;
  avatar_url?: string;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
};

function readMyTeam(): number | null {
  // Be tolerant of past keys
  const raw =
    typeof window !== "undefined"
      ? (window.localStorage.getItem("l1:myTeam") ??
        window.localStorage.getItem("myTeamRosterId") ??
        window.localStorage.getItem("myTeam"))
      : null;

  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function OwnersClient({ owners }: { owners: OwnerCard[] }) {
  const [myTeam, setMyTeam] = useState<number | null>(null);

  // initial read
  useEffect(() => {
    setMyTeam(readMyTeam());
  }, []);

  // react to storage changes (e.g., clicking “My Team / Clear” on a detail page)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (["l1:myTeam", "myTeamRosterId", "myTeam"].includes(e.key)) {
        setMyTeam(readMyTeam());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Reorder: put myTeam first (if set)
  const ordered = useMemo(() => {
    if (myTeam == null) return owners;
    const mine = owners.find((o) => o.roster_id === myTeam);
    if (!mine) return owners;
    const rest = owners.filter((o) => o.roster_id !== myTeam);
    return [mine, ...rest];
  }, [owners, myTeam]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {ordered.map((o) => {
        const isMine = myTeam != null && o.roster_id === myTeam;
        return (
          <div
            key={o.roster_id}
            style={{
              border: "1px solid var(--gray-200, #e5e7eb)",
              borderRadius: 12,
              padding: 16,
              background: isMine ? "#eef6ff" : "white", // pale blue
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Image
                src={o.avatar_url || "/avatar-placeholder.png"}
                alt=""
                width={36}
                height={36}
                style={{ borderRadius: "50%", objectFit: "cover" }}
              />
              <div style={{ fontWeight: 600 }}>{o.display_name}</div>
            </div>

            <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
              {`Record ${o.wins}-${o.losses} • PF ${o.points_for.toFixed(1)} • PA ${o.points_against.toFixed(1)}`}
            </div>

            <div style={{ marginTop: 8 }}>
              <Link href={`/owners/${o.roster_id}`}>View roster →</Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// apps/site/app/owners/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type OwnerVM = {
  roster_id: number;
  owner_id: string;
  display_name: string;
  avatar_url?: string;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
};

const MY_TEAM_KEY = "myTeam";

export default function OwnersPage() {
  const [owners, setOwners] = useState<OwnerVM[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myTeam, setMyTeam] = useState<number | null>(null);

  // --- Fetch owners (no change) ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/owners", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as OwnerVM[];
        if (!cancelled) setOwners(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load owners");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Read & keep myTeam from localStorage; update on storage/visibility ---
  useEffect(() => {
    const read = () => {
      try {
        const v = localStorage.getItem(MY_TEAM_KEY);
        setMyTeam(v ? Number(v) : null);
      } catch {
        setMyTeam(null);
      }
    };
    read();

    const onStorage = (ev: StorageEvent) => {
      if (ev.key === MY_TEAM_KEY) read();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };

    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // --- Sort: if myTeam is set, pin that owner to the top; otherwise keep API order ---
  const displayOwners = useMemo(() => {
    if (!owners) return null;
    if (myTeam == null) return owners;
    const mine = owners.find((o) => o.roster_id === myTeam);
    if (!mine) return owners;
    const rest = owners.filter((o) => o.roster_id !== myTeam);
    return [mine, ...rest];
  }, [owners, myTeam]);

  return (
    <main className="page owners" style={{ display: "grid", gap: 16 }}>
      <h1>Owners</h1>

      {owners === null && !error && <p>Loading owners…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {displayOwners && displayOwners.length === 0 && (
        <p style={{ opacity: 0.8 }}>No owners available yet.</p>
      )}

      {displayOwners && displayOwners.length > 0 && (
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
                  borderColor: isMine ? "#bfdbfe" : "#e5e7eb", // pale blue border for my team
                  borderRadius: 10,
                  background: isMine ? "#e7f0ff" : "white", // pale blue highlight
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
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {o.wins}-{o.losses} • PF {o.points_for.toFixed(1)} • PA{" "}
                    {o.points_against.toFixed(1)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

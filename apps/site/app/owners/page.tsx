// apps/site/app/owners/page.tsx
"use client";

import { useEffect, useState } from "react";
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

export default function OwnersPage() {
  const [owners, setOwners] = useState<OwnerVM[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="page owners" style={{ display: "grid", gap: 16 }}>
      <h1>Owners</h1>

      {owners === null && !error && <p>Loading owners…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {owners && owners.length === 0 && (
        <p style={{ opacity: 0.8 }}>No owners available yet.</p>
      )}

      {owners && owners.length > 0 && (
        <ul
          style={{
            display: "grid",
            gap: 12,
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {owners.map((o) => (
            <li
              key={o.roster_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
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
                  style={{ fontWeight: 600 }}
                >
                  {o.display_name}
                </Link>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {o.wins}-{o.losses} • PF {o.points_for.toFixed(1)} • PA{" "}
                  {o.points_against.toFixed(1)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

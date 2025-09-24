"use client";

import { useEffect, useState } from "react";

/** Same pair of keys used previously (localStorage + cookie) */
const MY_TEAM_KEYS = ["l1.myTeamRosterId", "myTeam"] as const;

/** One year in seconds */
const YEAR = 60 * 60 * 24 * 365;

function readMyTeamLS(): number | null {
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

function writeMyTeamLS(value: number | null) {
  try {
    for (const k of MY_TEAM_KEYS) {
      if (value == null) localStorage.removeItem(k);
      else localStorage.setItem(k, String(value));
    }
  } catch {}
}

function writeMyTeamCookie(value: number | null) {
  try {
    // Support both cookie names for compatibility
    const names = ["l1.myTeamRosterId", "myTeam"];
    if (value == null) {
      for (const n of names) {
        document.cookie = `${n}=; Max-Age=0; Path=/; SameSite=Lax`;
      }
      return;
    }
    const secure =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "; Secure"
        : "";
    for (const n of names) {
      document.cookie = `${n}=${encodeURIComponent(String(value))}; Max-Age=${YEAR}; Path=/; SameSite=Lax${secure}`;
    }
  } catch {}
}

export default function MyTeamClient({ rosterId }: { rosterId: number }) {
  const [mine, setMine] = useState(false);

  useEffect(() => {
    const v = readMyTeamLS();
    setMine(v === rosterId);

    const onStorage = (ev: StorageEvent) => {
      if (!ev.key || (MY_TEAM_KEYS as readonly string[]).includes(ev.key)) {
        const now = readMyTeamLS();
        setMine(now === rosterId);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [rosterId]);

  const markMine = () => {
    writeMyTeamLS(rosterId);
    writeMyTeamCookie(rosterId);
    setMine(true);
  };

  const clearMine = () => {
    writeMyTeamLS(null);
    writeMyTeamCookie(null);
    setMine(false);
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        onClick={markMine}
        disabled={mine}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #d1d5db",
          background: mine ? "#e7f0ff" : "white",
          cursor: mine ? "default" : "pointer",
        }}
        aria-pressed={mine}
      >
        {mine ? "✓ My Team" : "My Team"}
      </button>
      <button
        type="button"
        onClick={clearMine}
        disabled={!mine}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #d1d5db",
          background: "white",
          cursor: mine ? "pointer" : "default",
        }}
      >
        Clear
      </button>
    </div>
  );
}

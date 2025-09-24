"use client";

import { useEffect, useState } from "react";

/** Same pair of keys used by OwnersClient */
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

function writeMyTeam(value: number | null) {
  try {
    for (const k of MY_TEAM_KEYS) {
      if (value == null) localStorage.removeItem(k);
      else localStorage.setItem(k, String(value));
    }
  } catch {}
  // 🔵 also persist for server-side highlighting (readable on first load)
  try {
    if (value == null) {
      document.cookie = "l1_my_roster=; Path=/; Max-Age=0; SameSite=Lax";
    } else {
      document.cookie = `l1_my_roster=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
  } catch {}
}

export default function MyTeamClient({ rosterId }: { rosterId: number }) {
  const [mine, setMine] = useState(false);

  useEffect(() => {
    const v = readMyTeam();
    setMine(v === rosterId);

    const onStorage = (ev: StorageEvent) => {
      if (!ev.key || MY_TEAM_KEYS.includes(ev.key as any)) {
        const now = readMyTeam();
        setMine(now === rosterId);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [rosterId]);

  const markMine = () => {
    writeMyTeam(rosterId);
    setMine(true);
  };

  const clearMine = () => {
    writeMyTeam(null);
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

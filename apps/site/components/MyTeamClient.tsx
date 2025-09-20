"use client";

import { useCallback, useEffect, useState } from "react";

/** Single source of truth for the localStorage key */
const KEY = "l1.myTeamRosterId";

export default function MyTeamClient({ rosterId }: { rosterId: number }) {
  const [hydrated, setHydrated] = useState(false);
  const [myTeam, setMyTeam] = useState<number | null>(null);

  // Read once on mount (client only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      setMyTeam(raw ? Number(raw) : null);
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  const save = useCallback(() => {
    try {
      localStorage.setItem(KEY, String(rosterId));
      setMyTeam(rosterId);
    } catch {
      // ignore
    }
  }, [rosterId]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
      setMyTeam(null);
    } catch {
      // ignore
    }
  }, []);

  // Avoid server/client mismatch blips
  if (!hydrated) return null;

  const isMine = myTeam === rosterId;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {isMine ? (
        <>
          <span style={{ fontSize: 12, opacity: 0.8 }}>This is your team</span>
          <button
            type="button"
            onClick={clear}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid currentColor",
              fontSize: 13,
            }}
          >
            Clear
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={save}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid currentColor",
            fontSize: 13,
          }}
        >
          Make this my team
        </button>
      )}
    </div>
  );
}

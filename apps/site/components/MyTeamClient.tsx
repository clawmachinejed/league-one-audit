// apps/site/components/MyTeamClient.tsx
"use client";

import { useEffect, useState } from "react";

export default function MyTeamClient({ rosterId }: { rosterId: number }) {
  const [mine, setMine] = useState<number | null>(null);

  useEffect(() => {
    const v = localStorage.getItem("myTeam");
    setMine(v ? Number(v) : null);
  }, []);

  function setAsMine() {
    localStorage.setItem("myTeam", String(rosterId));
    setMine(rosterId);
  }

  function clearMine() {
    localStorage.removeItem("myTeam");
    setMine(null);
  }

  const isMine = mine === rosterId;

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button onClick={setAsMine} aria-pressed={isMine} title="Mark as My Team">
        ✓ My Team
      </button>
      <button onClick={clearMine} disabled={!mine}>
        Clear
      </button>
    </div>
  );
}

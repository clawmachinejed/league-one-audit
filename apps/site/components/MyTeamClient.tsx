// apps/site/components/MyTeamClient.tsx
"use client";

import { useEffect, useState } from "react";

const KEY = "my-team";

export function MyTeamMark({ rosterId }: { rosterId: number }) {
  const [mine, setMine] = useState<number | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v != null) setMine(Number(v));
    } catch {}
  }, []);

  if (mine === rosterId) {
    return (
      <span
        aria-label="My Team"
        title="This is your saved team on this device"
        className="select-none"
      >
        ★
      </span>
    );
  }
  return <span aria-hidden="true" />;
}

export function MyTeamControls({ rosterId }: { rosterId: number }) {
  const [mine, setMine] = useState<number | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v != null) setMine(Number(v));
    } catch {}
  }, []);

  const setAsMine = () => {
    try {
      localStorage.setItem(KEY, String(rosterId));
      setMine(rosterId);
    } catch {}
  };

  const clearMine = () => {
    try {
      localStorage.removeItem(KEY);
      setMine(null);
    } catch {}
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={setAsMine}
        className="text-xs px-2 py-1 rounded border"
        aria-pressed={mine === rosterId}
      >
        {mine === rosterId ? "✓ My Team" : "Set as My Team"}
      </button>
      {mine === rosterId && (
        <button
          type="button"
          onClick={clearMine}
          className="text-xs px-2 py-1 rounded border"
        >
          Clear
        </button>
      )}
    </div>
  );
}

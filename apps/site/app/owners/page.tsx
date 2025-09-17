// apps/site/app/owners/page.tsx
"use client";

import React from "react";
import Link from "next/link";
import { seedTeams } from "@l1/contracts";

function getMyTeamId(): string | null {
  try {
    return localStorage.getItem("myTeam");
  } catch {
    return null;
  }
}

function setMyTeamId(id: string) {
  try {
    localStorage.setItem("myTeam", id);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "myTeam", newValue: id }),
    );
  } catch {}
}

function clearMyTeam() {
  try {
    localStorage.removeItem("myTeam");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "myTeam", newValue: null as any }),
    );
  } catch {}
}

export default function OwnersPage() {
  const [myTeamId, setMyTeam] = React.useState<string | null>(null);

  // Read once on mount + stay in sync across tabs
  React.useEffect(() => {
    setMyTeam(getMyTeamId());
    const onStorage = (e: StorageEvent) => {
      if (e.key === "myTeam") setMyTeam(getMyTeamId());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const myTeam = seedTeams.find((t) => t.id === myTeamId) || null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Owners</h1>

      {/* My Team summary (persisted) */}
      <section className="mb-6">
        {myTeam ? (
          <div
            className="flex items-center justify-between rounded border p-3 bg-white/50"
            role="status"
            aria-live="polite"
          >
            <div>
              <div className="text-sm text-gray-600">Your team</div>
              <div className="font-semibold">
                {myTeam.owner ?? "Unknown"} — {myTeam.name}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link className="underline text-sm" href={`/owners/${myTeam.id}`}>
                View
              </Link>
              <button
                type="button"
                className="text-sm underline"
                onClick={() => clearMyTeam()}
                aria-label="Clear My Team selection"
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-600">
            Tip: choose your favorite team with{" "}
            <span className="font-medium">“Set as My Team”</span> — it’ll be
            highlighted here and across pages.
          </p>
        )}
      </section>

      {/* Owners list (selected row highlighted) */}
      <ul className="space-y-2">
        {seedTeams.map((t) => {
          const isMine = t.id === myTeamId;
          return (
            <li
              key={t.id}
              data-my-team={isMine || undefined}
              className={[
                "flex items-center justify-between border p-3 rounded gap-4 transition-shadow",
                isMine ? "ring-2 ring-accent/70 bg-paper" : "bg-white",
              ].join(" ")}
              aria-current={isMine ? "true" : undefined}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {t.owner ?? "Unknown"} — {t.name}
                </div>
                {isMine && (
                  <div className="mt-1 inline-flex items-center gap-2 text-xs uppercase tracking-wide">
                    <span
                      aria-label="This is your selected team"
                      className="px-2 py-0.5 rounded bg-accent/10 text-accent"
                    >
                      My Team
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {isMine ? (
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => clearMyTeam()}
                    aria-label={`Clear ${t.name} as My Team`}
                  >
                    Clear
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => {
                      setMyTeamId(t.id);
                      setMyTeam(t.id);
                    }}
                    aria-pressed={isMine ? "true" : "false"}
                    aria-label={`Set ${t.name} as My Team`}
                  >
                    Set as My Team
                  </button>
                )}
                <Link className="underline text-sm" href={`/owners/${t.id}`}>
                  View
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

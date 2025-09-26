// apps/site/app/owners/[id]/owners-tabs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function OwnersTabs({ rosterId }: { rosterId: string }) {
  const pathname = usePathname();

  const base = `/owners/${rosterId}`;
  const tabs = [
    { href: base, label: "Roster", isActive: (p: string) => p === base },
    {
      href: `${base}/schedule`,
      label: "Schedule",
      isActive: (p: string) => p.startsWith(`${base}/schedule`),
    },
    {
      href: `${base}/stats`,
      label: "Statistics",
      isActive: (p: string) => p.startsWith(`${base}/stats`),
    },
  ];

  return (
    <nav
      aria-label="Owner tabs"
      style={{
        display: "flex",
        gap: 16,
        borderBottom: "1px solid #e5e7eb",
        marginBottom: 16,
      }}
    >
      {tabs.map((t) => {
        const active = t.isActive(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            style={{
              padding: "10px 2px",
              marginBottom: -1,
              borderBottom: active
                ? "2px solid #2563eb"
                : "2px solid transparent",
              color: active ? "#1d4ed8" : "inherit",
              fontWeight: active ? 600 : 500,
              textDecoration: "none",
              lineHeight: 1.2,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

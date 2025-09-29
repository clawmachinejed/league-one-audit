// apps/site/app/owners/[id]/owners-tabs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = { rosterId: string };

/**
 * Owner profile tabs:
 * Roster | Schedule | Transactions | Statistics
 * - Active tab is bold with an underline.
 * - Statistics tab considers both /statistics and /stats as active for compatibility.
 */
export default function OwnersTabs({ rosterId }: Props) {
  const pathname = usePathname();
  const base = `/owners/${rosterId}`;

  const tabs = [
    {
      href: base,
      label: "Roster",
      active: pathname === base || pathname === `${base}/`,
    },
    {
      href: `${base}/schedule`,
      label: "Schedule",
      active: pathname.startsWith(`${base}/schedule`),
    },
    {
      href: `${base}/transactions`,
      label: "Transactions",
      active: pathname.startsWith(`${base}/transactions`),
    },
    {
      // If your route is /owners/[id]/stats, this still highlights correctly.
      href: `${base}/statistics`,
      label: "Statistics",
      active:
        pathname.startsWith(`${base}/statistics`) ||
        pathname.startsWith(`${base}/stats`),
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
        paddingBottom: 6,
      }}
    >
      {tabs.map((t) => {
        const isActive = t.active;
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              textDecoration: "none",
              padding: "6px 0",
              fontWeight: isActive ? 700 : 500,
              color: isActive ? "#111827" : "#4b5563",
              borderBottom: isActive
                ? "2px solid #111827"
                : "2px solid transparent",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

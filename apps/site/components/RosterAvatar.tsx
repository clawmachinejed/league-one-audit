// apps/site/components/RosterAvatar.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type Owner = {
  roster_id: number;
  avatar_url?: string;
};

export default function RosterAvatar({
  rosterId,
  size = 20,
  className,
}: {
  rosterId: number;
  size?: number;
  className?: string;
}) {
  const [owners, setOwners] = useState<Owner[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/owners", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Owner[];
        if (!cancelled) setOwners(data);
      } catch {
        // ignore – we'll just show nothing
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const avatar = useMemo(() => {
    if (!owners) return undefined;
    return owners.find((o) => o.roster_id === rosterId)?.avatar_url;
  }, [owners, rosterId]);

  if (!avatar) return null;

  return (
    <Image
      src={avatar}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: "50%", objectFit: "cover" }}
    />
  );
}

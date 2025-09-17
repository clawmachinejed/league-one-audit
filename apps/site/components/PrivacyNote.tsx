// apps/site/components/PrivacyNote.tsx
"use client";

import React from "react";

function dntEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const w: any = window;
  const n: any = navigator;
  const flags = [w.doNotTrack, n.doNotTrack, n.msDoNotTrack].map((v: any) =>
    v == null ? "" : String(v).toLowerCase(),
  );
  return flags.includes("1") || flags.includes("yes");
}

function analyticsConfigured(): boolean {
  const id = process.env.NEXT_PUBLIC_ANALYTICS_ID || "";
  const vercel = process.env.NEXT_PUBLIC_VERCEL_ANALYTICS || "";
  return Boolean(id || vercel);
}

export default function PrivacyNote() {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    const on = analyticsConfigured() && !dntEnabled();
    setShow(on);
  }, []);

  if (!show) return null;

  return (
    <div className="mt-2 text-xs text-gray-500">
      Analytics are enabled. We respect Do Not Track and disable analytics when
      DNT is on.
    </div>
  );
}

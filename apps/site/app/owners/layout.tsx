// apps/site/app/owners/[id]/layout.tsx
import React from "react";
import OwnersTabs from "./owners-tabs";

export const metadata = { title: "Owners • League One" };

export default function OwnersLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  return (
    <>
      <OwnersTabs rosterId={params.id} />
      {children}
    </>
  );
}

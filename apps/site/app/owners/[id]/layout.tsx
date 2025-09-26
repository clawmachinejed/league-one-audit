// apps/site/app/owners/[id]/layout.tsx
import OwnersTabs from "./owners-tabs";

// Next 15 layouts can receive async params; support both to be safe.
export default async function OwnerIdLayout(props: {
  children: React.ReactNode;
  params: { id: string } | Promise<{ id: string }>;
}) {
  const p = await props.params;
  const id = typeof p === "object" ? p.id : undefined;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {id ? <OwnersTabs rosterId={id} /> : null}
      {props.children}
    </div>
  );
}

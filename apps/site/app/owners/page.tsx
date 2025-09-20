// apps/site/app/owners/page.tsx
import OwnersClient from "../../components/OwnersClient";
import { getOwners } from "../../lib/owners";

// Server component: fetch owners once on the server, render a client component for UI/localStorage
export default async function OwnersPage() {
  const owners = await getOwners(); // server-only fetch
  return <OwnersClient owners={owners} />;
}

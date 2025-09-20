// apps/site/app/owners/page.tsx
import Link from "next/link";
import Image from "next/image";
import { getOwners } from "../../lib/owners";

export const revalidate = 3600;

export default async function OwnersPage() {
  const owners = await getOwners();

  return (
    <main className="page owners">
      <h1>Owners</h1>

      <ul className="owners-list" style={{ display: "grid", gap: 12, padding: 0 }}>
        {owners.map((o) => (
          <li key={o.roster_id} style={{ listStyle: "none" }}>
            <Link href={`/owners/${o.roster_id}`} style={{ textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Image
                  src={o.avatar_url || "/avatar-placeholder.png"}
                  alt=""
                  width={48}
                  height={48}
                  style={{ borderRadius: "50%" }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>{o.display_name}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    Record {o.wins}-{o.losses} • PF {o.points_for.toFixed(1)} • PA{" "}
                    {o.points_against.toFixed(1)}
                  </div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

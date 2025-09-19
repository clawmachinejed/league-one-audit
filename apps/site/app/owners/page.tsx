// apps/site/app/owners/page.tsx
import Link from "next/link";
// Use RELATIVE imports to avoid alias resolution issues
import { getOwners, type OwnerVM } from "../../lib/owners";
import { MyTeamMark } from "../../components/MyTeamClient";

// Revalidate every 5 minutes; you can still manual-revalidate via /api/admin/revalidate
export const revalidate = 300;

export default async function OwnersPage() {
  try {
    const owners = await getOwners();

    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Owners</h1>
        <ul className="divide-y">
          {owners.map((o: OwnerVM) => {
            const name = o.team_name || o.display_name;
            return (
              <li
                key={o.roster_id}
                className="py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  {o.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      src={o.avatar_url}
                      className="w-8 h-8 rounded-full border"
                      width={32}
                      height={32}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-200 border" />
                  )}
                  <Link
                    className="underline underline-offset-2"
                    href={`/owners/${o.roster_id}`}
                  >
                    {name}
                  </Link>
                </div>
                <MyTeamMark rosterId={o.roster_id} />
              </li>
            );
          })}
        </ul>
      </main>
    );
  } catch {
    // Friendly fallback if env is missing or Sleeper is down
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Owners</h1>
        <p className="text-sm opacity-80">
          Could not load owners. Check SLEEPER_LEAGUE_ID and the Sleeper API.
        </p>
      </main>
    );
  }
}

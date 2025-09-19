// apps/site/app/owners/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
// Use RELATIVE imports to avoid alias resolution issues
import { getOwner } from "../../../lib/owners";
import { MyTeamControls } from "../../../components/MyTeamClient";

type Props = {
  params: { id: string };
};

export const revalidate = 300;

export default async function OwnerDetailPage({ params }: Props) {
  const rosterId = Number(params.id);
  if (!Number.isFinite(rosterId)) notFound();

  let owner = null;
  try {
    owner = await getOwner(rosterId);
  } catch {
    owner = null;
  }
  if (!owner) notFound();

  const name = owner.team_name || owner.display_name;

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{name}</h1>
        <MyTeamControls rosterId={owner.roster_id} />
      </div>

      <div className="flex items-center gap-4 mb-6">
        {owner.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            src={owner.avatar_url}
            className="w-16 h-16 rounded-full border"
            width={64}
            height={64}
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-200 border" />
        )}
        <div className="text-sm opacity-80">
          <div>
            <span className="font-semibold">Owner:</span> {owner.display_name}
          </div>
          {(owner.wins != null || owner.losses != null) && (
            <div>
              <span className="font-semibold">Record:</span> {owner.wins ?? 0}-
              {owner.losses ?? 0}
            </div>
          )}
          {(owner.points_for != null || owner.points_against != null) && (
            <div>
              <span className="font-semibold">PF/PA:</span>{" "}
              {owner.points_for ?? 0} / {owner.points_against ?? 0}
            </div>
          )}
        </div>
      </div>

      <Link href="/owners" className="underline underline-offset-2">
        ← Back to Owners
      </Link>
    </main>
  );
}

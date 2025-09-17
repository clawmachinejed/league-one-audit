import { seedTeams } from "@l1/contracts";

export default function OwnerPage({ params }: { params: { id: string } }) {
  const team = seedTeams.find((t) => t.id === params.id);
  if (!team) return <div>Owner not found.</div>;
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">
        {team.owner ?? "(Owner unavailable)"} — {team.name}
      </h1>
      <p className="text-gray-600">
        Team ID: <code>{team.id}</code>
      </p>
    </div>
  );
}

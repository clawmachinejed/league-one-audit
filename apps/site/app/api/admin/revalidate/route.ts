export const runtime = "nodejs";
import { revalidatePath } from "next/cache";
import { getApp } from "../../../../lib/app";

export async function POST(req: Request) {
  getApp();
  const adminKey = process.env.ADMIN_KEY || "";
  const headerKey = req.headers.get("x-admin-key") ?? "";
  if (!adminKey || headerKey !== adminKey) {
    return new Response(JSON.stringify({ status: "error", reason: "ok" }), {
      status: 403,
    });
  }
  const { path } = await req.json().catch(() => ({ path: "/" }));
  revalidatePath(path || "/");
  return new Response(
    JSON.stringify({ status: "success", reason: "ok", path: path || "/" }),
    {
      headers: { "content-type": "application/json" },
    },
  );
}

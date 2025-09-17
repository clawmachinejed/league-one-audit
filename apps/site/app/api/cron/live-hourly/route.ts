export const runtime = "nodejs";
import { NextRequest } from "next/server";
import { getApp } from "../../../../lib/app";

export async function GET(req: NextRequest) {
  const app = getApp();
  const secret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const adminKey = req.headers.get("x-admin-key") ?? "";
  const result = await app.cronLiveHourly(
    secret ?? undefined,
    adminKey || undefined,
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
}

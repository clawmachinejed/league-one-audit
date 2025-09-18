// apps/site/app/api/admin/revalidate/route.ts
// apps/site/app/api/admin/revalidate/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getApp } from "../../../../lib/app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  getApp();

  const adminKey = process.env.ADMIN_KEY || "";
  const headerKey = req.headers.get("x-admin-key") ?? "";
  if (!adminKey || headerKey !== adminKey) {
    return json({ status: "error", reason: "not_enabled" }, 403);
  }

  const url = new URL(req.url);
  const qsPath = url.searchParams.get("path") ?? undefined;
  let bodyPath: string | undefined;
  try {
    const body = await req.json();
    bodyPath = typeof body?.path === "string" ? body.path : undefined;
  } catch {
    // no body is fine
  }
  const raw = bodyPath ?? qsPath ?? "/";
  const path = (raw.startsWith("/") ? raw : `/${raw}`).replace(/\/{2,}/g, "/");

  revalidatePath(path);
  return json({ status: "success", reason: "ok", path }, 200);
}

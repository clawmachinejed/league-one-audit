// apps/site/app/api/admin/awards/route.ts
import { getApp } from "../../../../lib/app";

// Unauthorized MUST return 403 + {"status":"error","reason":"not_enabled"}
// No direct process.env usage — read via Config adapter wired in getApp()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const app = getApp();

  // Access admin key from Config adapter (composition root wiring).
  // Fallback shape allows either app.config.ADMIN_KEY or app.config().ADMIN_KEY.
  const cfgAny: any =
    (app as any).config ||
    (typeof (app as any).config === "function" ? (app as any).config() : {});
  const configuredKey: string = String(cfgAny?.ADMIN_KEY || "");

  // Prefer header; allow ?key= for UX but don't count on it server-side.
  const url = new URL(request.url);
  const providedKey =
    request.headers.get("x-admin-key") || url.searchParams.get("key") || "";

  if (!configuredKey || providedKey !== configuredKey) {
    return json({ status: "error", reason: "not_enabled" }, 403);
  }

  try {
    const season = new Date().getFullYear();
    const week = cfgAny?.CURRENT_WEEK || undefined;

    // Go through `any` so we don't rely on a typed `awards` facet.
    const result = await (app as any)?.awards?.compute?.(season, week);

    return json(
      { status: "success", reason: "ok", awards: result ?? null },
      200,
    );
  } catch (err: any) {
    return json(
      { status: "error", reason: "ok", error: String(err?.message || err) },
      500,
    );
  }
}

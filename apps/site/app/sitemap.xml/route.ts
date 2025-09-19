// apps/site/app/sitemap.xml/route.ts
export const runtime = "nodejs";
// Don't prerender; generate at request time so we don't need build-time env
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";

function xml(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

function originFrom(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "localhost";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const base = originFrom(req);

  // Keep this list static so it never needs league/env to build.
  const urls = [
    "/",
    "/standings",
    "/history",
    "/rivalries",
    "/owners",
    "/privacy",
  ];

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join("") +
    `</urlset>`;

  return xml(body);
}

import { getApp } from "../../lib/app";
export async function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const xml = await getApp().rss(base);
  return new Response(xml, { headers: { "content-type": "application/xml" } });
}

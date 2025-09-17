export const runtime = "nodejs";
import { getApp } from "../../../../lib/app";

export async function GET() {
  const app = getApp();
  const res = await app.generateOg("League One — Power Rankings");
  if (res instanceof Response) return res;
  const headers = { "content-type": res.contentType, ...(res.headers || {}) };
  return new Response(res.body, { headers });
}

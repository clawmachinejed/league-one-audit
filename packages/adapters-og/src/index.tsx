/** @jsxImportSource react */
import type { OgRendererPort } from "@l1/ports";
import { ImageResponse } from "@vercel/og";

export function createOgRenderer(): OgRendererPort {
  return {
    async render(params) {
      const el = (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            fontSize: 64,
            fontWeight: 700,
            background: "#FAFAFA",
          }}
        >
          {params.logoUrl ? (
            <img
              src={params.logoUrl}
              width={128}
              height={128}
              style={{ position: "absolute", top: 40, left: 40 }}
            />
          ) : null}
          <div>{params.title}</div>
          {params.subtitle ? (
            <div style={{ fontSize: 32, marginTop: 8 }}>{params.subtitle}</div>
          ) : null}
        </div>
      );
      const res = new ImageResponse(el, { width: 1200, height: 630 });
      res.headers.set(
        "Cache-Control",
        "public, max-age=60, s-maxage=600, stale-while-revalidate=86400",
      );
      return res;
    },
  };
}

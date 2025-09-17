import { OgParams } from "@l1/contracts";
export interface OgRendererPort {
  render(params: OgParams): Promise<
    | Response
    | {
        body: ArrayBuffer;
        contentType: string;
        headers?: Record<string, string>;
      }
  >;
}

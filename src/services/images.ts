import sharp from "sharp";
import { safeFetch, SsrfError, type SafeFetchOptions } from "../security/safe-fetch.js";

export const MAX_IMAGE_EDGE = 1280;
export const MAX_IMAGE_BYTES = 1_000_000;
const MAX_INPUT_BYTES = 8_000_000;

export interface ProxiedImage {
  data: string; // base64
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

export type ImageResult = { image: ProxiedImage } | { note: string };

type Fetcher = (url: string, opts: SafeFetchOptions) => ReturnType<typeof safeFetch>;

/** Fetch under the SSRF policy, then resize to <= 1280 px on the long edge and <= 1 MB. */
export async function fetchAndResizeImage(
  url: string,
  allowedHosts: readonly string[],
  signal: AbortSignal,
  fetcher: Fetcher = safeFetch,
): Promise<ImageResult> {
  if (allowedHosts.length === 0) return { note: "Image not returned: no image hosts are configured for this source." };
  try {
    const res = await fetcher(url, { allowedHosts, maxBytes: MAX_INPUT_BYTES, timeoutMs: 5_000, signal, headers: { Accept: "image/*" } });
    if (res.status !== 200) return { note: "Image not returned: the image host did not serve the file." };
    const type = String(Array.isArray(res.headers["content-type"]) ? res.headers["content-type"][0] : res.headers["content-type"] ?? "");
    if (!/^image\/(png|jpe?g|webp|gif|avif)/i.test(type)) return { note: "Image not returned: the file is not a supported image type." };

    const base = sharp(res.body, { failOn: "error", limitInputPixels: 50_000_000 }).rotate().flatten({ background: "#ffffff" });
    for (const edge of [MAX_IMAGE_EDGE, 960, 720, 480]) {
      for (const quality of [82, 68, 54, 40]) {
        const { data, info } = await base
          .clone()
          .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        if (data.length <= MAX_IMAGE_BYTES) {
          return { image: { data: data.toString("base64"), mimeType: "image/jpeg", width: info.width, height: info.height } };
        }
      }
    }
    return { note: "Image not returned: it could not be reduced below 1 MB." };
  } catch (err) {
    if (err instanceof SsrfError) return { note: "Image not returned: the image URL was blocked by the outbound request policy." };
    return { note: "Image not returned: it could not be fetched or processed." };
  }
}

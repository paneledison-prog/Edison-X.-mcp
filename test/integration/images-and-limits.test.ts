import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { App } from "../../src/app.js";
import { fetchAndResizeImage, MAX_IMAGE_BYTES, MAX_IMAGE_EDGE } from "../../src/services/images.js";
import { safeFetch, type RawResponse } from "../../src/security/safe-fetch.js";
import { connect, testApp, type TestClient } from "../helpers/app.js";
import { entryMarkdown, fakeAdapter, makeDesign } from "../helpers/fixtures.js";

let app: App;
let c: TestClient;
afterEach(async () => {
  await c.close();
  app.close();
});

async function bigNoisyPng(): Promise<Buffer> {
  const w = 3000;
  const h = 2000;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24; // deterministic pseudo-noise: incompressible
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

const respond = (body: Buffer, type = "image/png", status = 200): RawResponse => ({
  status,
  headers: { "content-type": type },
  body,
});

describe("get_design include_image", () => {
  it("proxies an owner image resized to at most 1280px and 1 MB, as an MCP image block", async () => {
    const png = await bigNoisyPng();
    expect(png.length).toBeGreaterThan(5_000_000);
    const calls: string[] = [];
    app = testApp({
      seed: false,
      env: { LIBRARY_IMAGE_HOSTS: "img.example.com" },
      overrides: {
        imageFetcher: (url, hosts, signal) =>
          fetchAndResizeImage(url, hosts, signal, (u, o) => {
            calls.push(u);
            expect(o.allowedHosts).toEqual(["img.example.com"]);
            return Promise.resolve(respond(png));
          }),
      },
    });
    app.repo.upsertDesign(makeDesign({ sourceId: "pic", imageUrl: "https://img.example.com/a.png" }));
    c = await connect(app);
    const r = await c.call("get_design", { id: "library:pic", include_image: true });
    expect(r.isError).toBeFalsy();
    const image = (r.content as Array<{ type: string; data?: string; mimeType?: string }>).find(
      (b) => b.type === "image",
    );
    expect(image?.mimeType).toBe("image/jpeg");
    const bytes = Buffer.from(image?.data ?? "", "base64");
    expect(bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    const meta = await sharp(bytes).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(MAX_IMAGE_EDGE);
    expect(calls).toEqual(["https://img.example.com/a.png"]);
    expect(JSON.stringify(r.structuredContent)).not.toContain(image?.data ?? "unreachable");
  });

  it("falls back to a note when the host is not allowed, the type is wrong, or nothing is configured", async () => {
    app = testApp({ seed: false });
    app.repo.upsertDesign(makeDesign({ sourceId: "p1", imageUrl: "https://img.example.com/a.png" }));
    c = await connect(app);
    const none = await c.data<{ notes?: string }>("get_design", { id: "library:p1", include_image: true });
    expect(none.notes).toMatch(/no image hosts are configured/);

    const html = await fetchAndResizeImage(
      "https://img.example.com/a.png",
      ["img.example.com"],
      new AbortController().signal,
      () => Promise.resolve(respond(Buffer.from("<html>"), "text/html")),
    );
    expect(html).toEqual({ note: expect.stringMatching(/not a supported image type/) });
    const notFound = await fetchAndResizeImage(
      "https://img.example.com/a.png",
      ["img.example.com"],
      new AbortController().signal,
      () => Promise.resolve(respond(Buffer.alloc(0), "image/png", 404)),
    );
    expect(notFound).toEqual({ note: expect.stringMatching(/did not serve/) });
    const corrupt = await fetchAndResizeImage(
      "https://img.example.com/a.png",
      ["img.example.com"],
      new AbortController().signal,
      () => Promise.resolve(respond(Buffer.from("not really a png"))),
    );
    expect(corrupt).toEqual({ note: expect.stringMatching(/could not be fetched or processed/) });
  });

  it("never fetches an image URL that fails the SSRF checks", async () => {
    const lookup = (
      host: string,
      _o: unknown,
      cb: (e: null, a: Array<{ address: string; family: number }>) => void,
    ) => cb(null, [{ address: host === "evil.example.com" ? "10.0.0.8" : "93.184.216.34", family: 4 }]);
    const hosts = ["img.example.com", "evil.example.com"];
    const run = (url: string) =>
      fetchAndResizeImage(url, hosts, new AbortController().signal, (u, o) =>
        safeFetch(u, {
          ...o,
          lookup: lookup,
          transport: () => Promise.reject(new Error("must not connect")),
        }),
      );
    for (const url of [
      "https://127.0.0.1/a.png",
      "http://img.example.com/a.png",
      "https://evil.example.com/a.png",
      "https://169.254.169.254/x",
      "https://other.example.org/a.png",
    ]) {
      expect(await run(url), url).toEqual({ note: expect.stringMatching(/not returned/) });
    }
  });

  it("does not proxy when the register's terms do not allow it", async () => {
    const ext = fakeAdapter(
      "ext",
      {
        getById: () =>
          Promise.resolve({
            sourceId: "x1",
            sourceUrl: "https://example.com/x1",
            title: "t",
            imageUrl: "https://img.example.com/a.png",
          }),
      },
      { canProxyImage: true },
    );
    const md = entryMarkdown("ext", {
      Capabilities:
        "canSearch=true, canGetById=true, canStoreMetadata=true, canAnalyze=false, canHotlink=true, canProxyImage=false, cacheTtlSeconds=3600",
    });
    app = testApp({ seed: false, adapters: [ext], registerMarkdown: md });
    c = await connect(app);
    const out = await c.data<{ notes?: string; image_url?: string }>("get_design", {
      id: "ext:x1",
      include_image: true,
    });
    expect(out.notes).toMatch(/do not allow image proxying/);
  });
});

describe("tool timeout", () => {
  it("answers with a short error when a tool takes longer than the overall limit", async () => {
    const hang = fakeAdapter("hang", { search: () => new Promise(() => undefined) });
    app = testApp({
      seed: false,
      adapters: [hang],
      registerMarkdown: entryMarkdown("hang"),
      env: { TOOL_TIMEOUT_MS: "300", SOURCE_TIMEOUT_MS: "5000" },
    });
    c = await connect(app);
    const started = Date.now();
    const r = await c.call("search_inspiration", { query: "dashboard" });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/took too long/);
  });
});

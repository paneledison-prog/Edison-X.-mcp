/* Load test: runs the real HTTP server in-process and hammers it with concurrent MCP calls.
   Usage: pnpm load:test [--seconds 10] [--concurrency 32] */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/observability/logger.js";
import { runHttp } from "../src/transport/http.js";
import { randomBytes } from "node:crypto";

const { values } = parseArgs({
  options: { seconds: { type: "string", default: "10" }, concurrency: { type: "string", default: "32" } },
});
const seconds = Number(values.seconds);
const concurrency = Number(values.concurrency);

const dir = mkdtempSync(join(tmpdir(), "edison-load-"));
const today = new Date().toISOString().slice(0, 10);
const registerPath = join(dir, "SOURCES.md");
(await import("node:fs")).writeFileSync(
  registerPath,
  `## library
- Status: OWN_LIBRARY
- Access method: owned data
- Terms URL: https://example.com/terms
- Terms reviewed on: ${today}   by: load-test
- Terms summary: owned data
- AI/ML usage rule: none found
- Capabilities: canSearch=true, canGetById=true, canStoreMetadata=true, canAnalyze=true, canHotlink=true, canProxyImage=false, cacheTtlSeconds=0
- Attribution requirement: Via Edison X library - {creator}
- Rate limits: none
- Owner approval: load-test, ${today}
- Notes / risks: none
`,
);
const app = createApp(
  loadConfig({
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    DATABASE_PATH: join(dir, "load.db"),
    SOURCES_REGISTER_PATH: registerPath,
    LOG_LEVEL: "silent",
    RATE_LIMIT_PER_MIN: "1000000",
    RATE_LIMIT_PER_DAY: "100000000",
  }),
  { logger: createLogger({ level: "silent" }) },
);
const http = await runHttp(app, 0);
const { key } = app.keys.create({ name: "load", ratePerMin: 1_000_000, ratePerDay: 100_000_000 });
const url = `http://127.0.0.1:${http.port}/mcp`;

const queries = [
  "dark fitness dashboard",
  "landing page hero",
  "mobile onboarding",
  "pricing table",
  "settings page toggles",
  "checkout form",
  "calendar week view",
  "map list",
  "kanban board",
  "profile feed",
];
const ids = [
  "library:fitness-dashboard-dark",
  "library:saas-landing-hero",
  "library:calendar-week-view",
  "library:map-with-list",
];

let n = 0;
const call = async (name: string, args: unknown): Promise<{ ok: boolean; ms: number }> => {
  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++n,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as { result?: { isError?: boolean } };
  return {
    ok: res.status === 200 && body.result !== undefined && !body.result.isError,
    ms: performance.now() - started,
  };
};

const latencies: number[] = [];
let failures = 0;
const deadline = Date.now() + seconds * 1000;
const worker = async (w: number): Promise<void> => {
  let i = w;
  while (Date.now() < deadline) {
    i += 1;
    const r =
      i % 3 === 0
        ? await call("get_design", { id: ids[i % ids.length] })
        : i % 7 === 0
          ? await call("get_inspiration_brief", { goal: queries[i % queries.length] })
          : await call("search_inspiration", { query: queries[i % queries.length], limit: 8 });
    latencies.push(r.ms);
    if (!r.ok) failures += 1;
  }
};
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, (_, w) => worker(w)));
const elapsed = (performance.now() - started) / 1000;
latencies.sort((a, b) => a - b);
const pct = (p: number): number =>
  latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
console.log(
  JSON.stringify(
    {
      seconds: Number(elapsed.toFixed(1)),
      concurrency,
      requests: latencies.length,
      failures,
      throughputPerSec: Math.round(latencies.length / elapsed),
      latencyMs: {
        p50: Number(pct(50).toFixed(1)),
        p95: Number(pct(95).toFixed(1)),
        p99: Number(pct(99).toFixed(1)),
        max: Number(pct(100).toFixed(1)),
      },
    },
    null,
    2,
  ),
);
await http.close();
app.close();
rmSync(dir, { recursive: true, force: true });
if (failures > 0) process.exitCode = 1;

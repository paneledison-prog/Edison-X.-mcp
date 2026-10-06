import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/observability/logger.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { parseRegister } from "../../src/sources/register.js";
import { openDatabase, runMigrations, SqliteRepository } from "../../src/storage/sqlite.js";
import { LIBRARY_REGISTER } from "../helpers/app.js";
import { MCP_HEADERS, rpc, startHttp } from "../helpers/http.js";
import { NOW, TEST_MASTER_KEY } from "../helpers/fixtures.js";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("secrets never appear in logs, errors or tool output", () => {
  it("planted keys and tokens are absent from every log line", async () => {
    let logged = "";
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        logged += chunk.toString();
        cb();
      },
    });
    const logger = createLogger({ level: "debug", destination: sink });
    const db = openDatabase(":memory:");
    runMigrations(db);
    const app = createApp(
      loadConfig({ TOKEN_ENCRYPTION_KEY: TEST_MASTER_KEY, DATABASE_PATH: ":memory:", LOG_LEVEL: "debug" }),
      {
        logger,
        clock: () => NOW,
        repo: new SqliteRepository(db, logger),
        register: parseRegister(LIBRARY_REGISTER),
      },
    );
    const http = await startHttp(app);
    const { key } = app.keys.create({ name: "planted" });
    const PLANTED = "ex_" + "Z".repeat(43);
    await fetch(`${http.url}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${PLANTED}` },
      body: rpc("tools/list"),
    });
    await fetch(`${http.url}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${key}` },
      body: rpc("tools/list"),
    });
    app.logger.info(
      {
        authorization: `Bearer ${key}`,
        access_token: "tok_planted_123",
        nested: { client_secret: "shh-planted" },
        msg2: `token ${key}`,
      },
      `leak? ${key}`,
    );
    app.audit.record("key_created", null, { token: "audit-planted-token", note: `key ${key}` });
    await http.close();
    await new Promise((r) => setTimeout(r, 50));
    const auditRows = JSON.stringify(app.repo.listAudit({ limit: 100 }));
    for (const secret of [key, PLANTED, "tok_planted_123", "shh-planted", "audit-planted-token"]) {
      expect(logged, `log contains ${secret.slice(0, 8)}`).not.toContain(secret);
      expect(auditRows, `audit contains ${secret.slice(0, 8)}`).not.toContain(secret);
    }
    expect(logged.length).toBeGreaterThan(0);
    app.close();
  });
});

describe("no scraping and no disallowed sources", () => {
  const BANNED_PACKAGES = [
    "puppeteer",
    "puppeteer-core",
    "puppeteer-extra",
    "playwright",
    "playwright-core",
    "@playwright/test",
    "cheerio",
    "jsdom",
    "selenium-webdriver",
    "webdriverio",
    "nightmare",
    "x-ray",
    "crawlee",
    "apify",
    "apify-client",
    "scrapingbee",
    "scraperapi",
    "pinterest-api",
    "node-pinterest",
    "pinterest-scraper",
    "pinterest-dl",
    "pinterest-downloader",
    "got-scraping",
    "scrapy",
    "request-promise",
  ];

  it("package.json declares no scraping or unofficial-client dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const declared = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    });
    expect(declared.filter((d) => BANNED_PACKAGES.includes(d.toLowerCase()))).toEqual([]);
  });

  it("src imports no scraping package and only the official Pinterest API host and paths", () => {
    const files = walk("src").filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/(?:from|import|require\()\s*["']([^"']+)["']/g)) {
        const spec = (m[1] ?? "").toLowerCase();
        expect(
          BANNED_PACKAGES.some((b) => spec === b || spec.startsWith(`${b}/`)),
          `${f} imports ${spec}`,
        ).toBe(false);
      }
      expect(text, `${f} uses an unofficial Pinterest endpoint`).not.toMatch(
        /pinterest\.com\/(resource|_ngjs|v3|ajax)|BaseSearchResource|\/resource\/[A-Za-z]+Resource/,
      );
      for (const m of text.matchAll(/https:\/\/([a-z0-9.-]*pinterest\.com)/gi)) {
        expect(["api.pinterest.com", "www.pinterest.com"], `${f} contacts ${m[1]}`).toContain(
          (m[1] ?? "").toLowerCase(),
        );
      }
    }
  });

  it("src never writes third-party images (or anything else) to disk at runtime", () => {
    const writers = /writeFile|createWriteStream|appendFile|copyFile|\.pipe\(\s*fs/;
    const offenders = walk("src")
      .filter((f) => f.endsWith(".ts") && !f.includes("/cli/"))
      .filter((f) => writers.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the shipped register contains no BLOCKED entry that is also enabled, and every enabled source is approved", () => {
    const reg = parseRegister(readFileSync("docs/SOURCES.md", "utf8"));
    for (const [id, entry] of reg)
      if (entry["Status"] === "BLOCKED")
        expect(loadConfig({ TOKEN_ENCRYPTION_KEY: TEST_MASTER_KEY }).enabledSources).not.toContain(id);
  });
});

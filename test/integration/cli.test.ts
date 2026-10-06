import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { cliEnv, runCli } from "../helpers/cli.js";

const ce = cliEnv();
afterAll(() => rmSync(ce.dir, { recursive: true, force: true }));
const run = (script: string, ...args: string[]) => runCli(`src/cli/${script}.ts`, args, ce.env);
/** Opens, queries and closes: a lingering handle would leave -wal files behind and (correctly) block db:restore. */
function q<T>(sql: string, ...params: unknown[]): T {
  const handle = new Database(ce.env.DATABASE_PATH, { readonly: true });
  try {
    return handle.prepare(sql).get(...params) as T;
  } finally {
    handle.close();
  }
}

describe("command-line tools", () => {
  it("keys:create shows the key once; keys:list never shows it; keys:revoke takes effect", async () => {
    const created = await run(
      "keys",
      "create",
      "--name",
      "claude desktop",
      "--scopes",
      "curator",
      "--rate-per-min",
      "30",
    );
    expect(created.code).toBe(0);
    const key = /(ex_[A-Za-z0-9_-]{43})/.exec(created.stdout)?.[1] ?? "";
    expect(key).not.toBe("");
    expect(created.stdout).toMatch(/Scopes:\s+read:search, read:design, write:library/);
    const keyId = /Key id:\s+(k_[0-9a-f]+)/.exec(created.stdout)?.[1] ?? "";

    const listed = await run("keys", "list");
    expect(listed.stdout).toContain(keyId);
    expect(listed.stdout).toContain("claude desktop");
    expect(listed.stdout).not.toContain(key);
    expect(listed.stdout).toMatch(/active/);
    const row = q<{ key_hash: string; rate_per_min: number }>(
      "SELECT key_hash, rate_per_min FROM api_keys WHERE id = ?",
      keyId,
    );
    expect(row.rate_per_min).toBe(30);
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);

    const revoked = await run("keys", "revoke", keyId);
    expect(revoked.code).toBe(0);
    expect((await run("keys", "list")).stdout).toMatch(/revoked/);
    expect((await run("keys", "revoke", "k_missing")).code).not.toBe(0);
    expect(
      q<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE event = 'key_created'").n,
    ).toBeGreaterThan(0);
    expect(
      q<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE event = 'key_revoked'").n,
    ).toBeGreaterThan(0);
  });

  it("keys:create defaults to read-only scopes and rejects unknown scopes and missing names", async () => {
    const d = await run("keys", "create", "--name", "reader");
    expect(d.stdout).toMatch(/Scopes:\s+read:search, read:design\n/);
    expect((await run("keys", "create", "--name", "x", "--scopes", "root")).code).not.toBe(0);
    expect((await run("keys", "create")).code).not.toBe(0);
    expect((await run("keys", "create", "--name", "x", "--rate-per-min", "0")).code).not.toBe(0);
  });

  it("library:import loads designs, rejects missing licenses, and design:remove purges every copy", async () => {
    const file = join(ce.dir, "import.json");
    writeFileSync(
      file,
      JSON.stringify({
        designs: [
          {
            sourceId: "imp1",
            title: "Imported pricing page",
            sourceUrl: "https://example.com/imp1",
            license: "owned",
            category: "pricing",
            tags: ["pricing-table"],
          },
          { sourceId: "imp2", title: "No license here", sourceUrl: "https://example.com/imp2" },
        ],
      }),
    );
    const res = await run("library-import", file);
    expect(res.code).toBe(2);
    expect(res.stdout).toMatch(/Imported 1 design/);
    expect(res.stdout).toMatch(/rejected imp2: missing_license/);
    expect(q<{ n: number }>("SELECT COUNT(*) n FROM designs WHERE id = 'library:imp1'").n).toBe(1);

    const rm = await run("design-remove", "library:imp1");
    expect(rm.code).toBe(0);
    expect(q<{ n: number }>("SELECT COUNT(*) n FROM designs WHERE id = 'library:imp1'").n).toBe(0);
    expect(q<{ n: number }>("SELECT COUNT(*) n FROM designs_fts WHERE designs_fts MATCH 'imported'").n).toBe(
      0,
    );
    expect((await run("design-remove", "library:imp1")).code).not.toBe(0);
    expect(q<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE event = 'design_removed'").n).toBe(1);
  });

  it("db:backup writes a verified copy and db:restore brings the data back (and refuses bad files)", async () => {
    const backup = join(ce.dir, "backup.db");
    expect((await run("db", "backup", backup)).code).toBe(0);
    const before = q<{ n: number }>("SELECT COUNT(*) n FROM designs").n;
    expect(before).toBeGreaterThan(0);
    const purge = await run("design-remove", "--source", "library");
    expect(purge.code).toBe(0);
    expect(q<{ n: number }>("SELECT COUNT(*) n FROM designs").n).toBe(0);
    const bad = join(ce.dir, "not-a-db.db");
    writeFileSync(bad, "this is not sqlite");
    expect((await run("db", "restore", bad)).code).not.toBe(0);
    const restore = await runCli("src/cli/db.ts", ["restore", backup], { ...ce.env });
    expect(restore.code, restore.stderr).toBe(0);
    expect(q<{ n: number }>("SELECT COUNT(*) n FROM designs").n).toBe(before);
    expect(existsSync(backup)).toBe(true);
  });

  it("analysis:backfill --dry-run lists work without any model call, and refuses a real run while disabled", async () => {
    const file = join(ce.dir, "noanalysis.json");
    writeFileSync(
      file,
      JSON.stringify({
        designs: [
          {
            sourceId: "na1",
            title: "Needs analysis",
            sourceUrl: "https://example.com/na1",
            license: "owned",
          },
        ],
      }),
    );
    await run("library-import", file);
    const dry = await run("analysis-backfill", "--dry-run", "--limit", "5");
    expect(dry.code).toBe(0);
    const report = JSON.parse(dry.stdout) as {
      dryRun: boolean;
      considered: number;
      ids: string[];
      analyzed: number;
    };
    expect(report).toMatchObject({ dryRun: true, analyzed: 0 });
    expect(report.ids).toContain("library:na1");
    const real = await run("analysis-backfill");
    expect(real.code).not.toBe(0);
    expect(real.stderr).toMatch(/Analysis is disabled/);
    expect((await run("analysis-backfill", "--limit", "0")).code).not.toBe(0);
  });
});

describe("db:restore safety", () => {
  it("refuses while another process still has the database open, and works once it is closed", async () => {
    const backup = join(ce.dir, "safety.db");
    expect((await run("db", "backup", backup)).code).toBe(0);
    const live = new Database(ce.env.DATABASE_PATH);
    live.pragma("journal_mode = WAL");
    live.prepare("SELECT COUNT(*) FROM designs").get();
    const refused = await run("db", "restore", backup);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toMatch(/in use by another process/);
    live.close();
    expect((await run("db", "restore", backup)).code).toBe(0);
  });
});

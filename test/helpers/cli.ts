import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryMarkdown, TEST_MASTER_KEY } from "./fixtures.js";

export interface CliEnv {
  dir: string;
  env: Record<string, string>;
}

/** A throwaway database and a register whose library review is dated today, so tests never expire. */
export function cliEnv(extra: Record<string, string> = {}): CliEnv {
  const dir = mkdtempSync(join(tmpdir(), "edison-cli-"));
  const today = new Date().toISOString().slice(0, 10);
  const register = join(dir, "SOURCES.md");
  writeFileSync(
    register,
    entryMarkdown("library", {
      Status: "OWN_LIBRARY",
      "Terms reviewed on": `${today}   by: Tester`,
      "Owner approval": `Owner, ${today}`,
      Capabilities:
        "canSearch=true, canGetById=true, canStoreMetadata=true, canAnalyze=true, canHotlink=true, canProxyImage=true, cacheTtlSeconds=0",
    }),
  );
  return {
    dir,
    env: {
      PATH: process.env.PATH ?? "",
      TOKEN_ENCRYPTION_KEY: TEST_MASTER_KEY,
      DATABASE_PATH: join(dir, "edison.db"),
      SOURCES_REGISTER_PATH: register,
      ENABLED_SOURCES: "library",
      LOG_LEVEL: "error",
      ...extra,
    },
  };
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCli(script: string, args: string[], env: Record<string, string>): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", script, ...args],
      { env, cwd: process.cwd(), timeout: 60_000 },
      (err, stdout, stderr) => {
        resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
      },
    );
  });
}

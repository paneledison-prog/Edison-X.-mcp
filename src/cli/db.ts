import { copyFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import { fail, openCli } from "./context.js";

const USAGE = `Usage:
  db:backup <file>     consistent online backup of the database (safe while the server runs)
  db:restore <file>    verify <file>, then replace the database with it. STOP THE SERVER FIRST.`;

const [command, file] = process.argv.slice(2);
if (!command || !file) fail(USAGE);

if (command === "backup") {
  const ctx = openCli();
  try {
    await ctx.repo.backupTo(file);
    console.log(`Backup written to ${file}.`);
  } finally {
    ctx.repo.close();
  }
} else if (command === "restore") {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file.
  }
  const target = process.env.DATABASE_PATH ?? "./data/edison-x.db";
  if (!existsSync(file)) fail(`No such file: ${file}`);
  const probe = new Database(file, { readonly: true });
  try {
    const check = probe.pragma("integrity_check", { simple: true });
    if (check !== "ok") fail(`The backup failed its integrity check (${String(check)}). Nothing was changed.`);
    probe.prepare("SELECT COUNT(*) FROM designs").get();
  } catch (err) {
    fail(`That file is not a valid Edison X database: ${err instanceof Error ? err.message : "unknown error"}`);
  } finally {
    probe.close();
  }
  for (const suffix of ["-wal", "-shm"]) if (existsSync(target + suffix)) fail(`${target}${suffix} exists: the server may still be running. Stop it first.`);
  copyFileSync(file, target);
  console.log(`Restored ${file} to ${target}. Start the server again.`);
} else {
  fail(USAGE);
}

import { copyFileSync, existsSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { fail, openCli } from "./context.js";

const USAGE = `Usage:
  db:backup <file>     consistent online backup of the database (safe while the server runs)
  db:restore <file>    verify <file>, then replace the database with it. STOP THE SERVER FIRST.`;

/**
 * Refuse to replace a database another process still has open. Exclusive locking mode, set before
 * the first WAL access, fails with SQLITE_BUSY if anyone else is connected. A leftover WAL from a
 * process that exited abruptly is folded into the file first, then removed.
 */
function assertNoOtherConnections(target: string): void {
  if (!existsSync(target)) return;
  const probe = new Database(target);
  try {
    probe.pragma("busy_timeout = 300");
    probe.pragma("locking_mode = EXCLUSIVE");
    probe.prepare("SELECT COUNT(*) FROM sqlite_master").get();
    probe.exec("BEGIN IMMEDIATE");
    probe.exec("ROLLBACK");
    probe.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    fail("The database is in use by another process (is the server still running?). Stop it first.");
  } finally {
    probe.close();
  }
}

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
    if (check !== "ok")
      fail(`The backup failed its integrity check (${String(check)}). Nothing was changed.`);
    probe.prepare("SELECT COUNT(*) FROM designs").get();
  } catch (err) {
    fail(
      `That file is not a valid Edison X database: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  } finally {
    probe.close();
  }
  assertNoOtherConnections(target);
  for (const suffix of ["-wal", "-shm"]) rmSync(target + suffix, { force: true });
  copyFileSync(file, target);
  console.log(`Restored ${file} to ${target}. Start the server again.`);
} else {
  fail(USAGE);
}

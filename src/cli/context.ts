import { loadConfig, type Config } from "../config.js";
import { ConfigError } from "../errors.js";
import { AuditLog } from "../observability/audit.js";
import { createLogger, type Logger } from "../observability/logger.js";
import { Metrics } from "../observability/metrics.js";
import { SqliteRepository } from "../storage/sqlite.js";

export interface CliContext {
  config: Config;
  logger: Logger;
  repo: SqliteRepository;
  audit: AuditLog;
}

/** Shared bootstrap for the command-line tools: loads .env, validates config, opens the database. */
export function openCli(): CliContext {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: use the real environment.
  }
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const logger = createLogger({ level: "warn" });
  const repo = SqliteRepository.open(config.databasePath, logger);
  return { config, logger, repo, audit: new AuditLog(repo, logger, new Metrics()) };
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Thrown inside a command so `finally` blocks (closing the database) still run; the caller prints it and sets the exit code. */
export class CliError extends Error {}

export function reportAndSetExit(err: unknown): void {
  console.error(err instanceof Error ? err.message : "Command failed.");
  process.exitCode = 1;
}

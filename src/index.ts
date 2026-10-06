#!/usr/bin/env node
import { startAnalysisJob } from "./analysis/job.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import { runHttp } from "./transport/http.js";
import { runStdio } from "./transport/stdio.js";

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: configuration comes from the real environment.
  }
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\nSee .env.example for every variable.\n`);
      process.exit(1);
    }
    throw err;
  }
  const app = createApp(config);
  startAnalysisJob(app);
  if (config.transport === "stdio") {
    await runStdio(app);
    process.stdin.on("close", () => {
      app.close();
      process.exit(0);
    });
    return;
  }
  const http = await runHttp(app);
  const shutdown = (): void => {
    void http.close().then(() => {
      app.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : "unknown error"}\n`);
  process.exit(1);
});

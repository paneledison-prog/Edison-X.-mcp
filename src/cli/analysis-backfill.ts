import { parseArgs } from "node:util";
import { createAnalysisRunner } from "../analysis/job.js";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { fail } from "./context.js";

const USAGE = `Usage: analysis:backfill [--limit N] [--dry-run]
  --dry-run   list what would be analysed and the worst-case cost; no model calls, nothing written
  --limit N   process at most N designs (default 25)
Real runs need ANALYSIS_ENABLED=true, ANALYSIS_DAILY_COST_CAP and ANTHROPIC_API_KEY. Spending never passes the daily cap.`;

const { values } = parseArgs({
  options: { limit: { type: "string" }, "dry-run": { type: "boolean" }, help: { type: "boolean" } },
});
if (values.help) fail(USAGE);
const limit = values.limit ? Number(values.limit) : 25;
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail("--limit must be an integer from 1 to 1000.");

try {
  process.loadEnvFile();
} catch {
  // No .env file.
}
const app = createApp(loadConfig());
try {
  const dryRun = values["dry-run"] === true;
  if (!dryRun && !app.config.analysis.enabled)
    fail(
      "Analysis is disabled. Set ANALYSIS_ENABLED=true (and the cost cap and API key) to run it, or use --dry-run.",
    );
  const report = await createAnalysisRunner(app).run({ limit, dryRun });
  console.log(JSON.stringify(report, null, 2));
  if (report.stoppedReason === "budget")
    console.log("Stopped: the daily cost cap would be exceeded by another call.");
} finally {
  app.close();
}

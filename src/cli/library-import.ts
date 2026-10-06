import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { importLibraryFile } from "../sources/library/import.js";
import { LIBRARY_ID } from "../sources/library/index.js";
import { fail } from "./context.js";

const file = process.argv[2];
if (!file) fail("Usage: library:import <designs.json>\nThe file looks like library/seed-designs.json: { \"designs\": [ ... ] }.");
try {
  process.loadEnvFile();
} catch {
  // No .env file.
}
const app = createApp(loadConfig());
try {
  const lib = app.registry.get(LIBRARY_ID);
  if (!lib) fail("The library source is not loaded. Check ENABLED_SOURCES and its entry in docs/SOURCES.md.");
  const result = importLibraryFile(file, {
    repo: app.repo,
    adapter: { id: lib.adapter.id, attributionTemplate: lib.adapter.attributionTemplate, capabilities: lib.capabilities, ownerContent: true },
    now: new Date(),
    onFlag: (e) => app.audit.record("sanitizer_flag", null, { source: "library", field: e.field, rule: e.rule }),
  });
  app.audit.record("library_submission", null, { via: "cli", imported: result.imported, rejected: result.rejected.length });
  console.log(`Imported ${result.imported} design(s).`);
  for (const r of result.rejected) console.log(`  rejected ${r.sourceId}: ${r.reason}`);
  if (result.rejected.length > 0) process.exitCode = 2;
} finally {
  app.close();
}

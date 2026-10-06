import { parseArgs } from "node:util";
import { CliError, openCli, reportAndSetExit } from "./context.js";

const USAGE = `Usage:
  design:remove <design-id>         remove one design, its analysis, collection entries and cached copies
  source:purge <source-id>          remove EVERY design, cache entry and analysis from one source`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { source: { type: "string" } },
});
const ctx = openCli();
try {
  if (values.source) {
    const n = ctx.repo.purgeSource(values.source);
    ctx.audit.record("source_purged", null, { source: values.source, removed: n });
    console.log(
      `Purged ${n} design(s) from source '${values.source}'. Also remove it from ENABLED_SOURCES to stop it loading.`,
    );
  } else if (positionals[0]) {
    const ok = ctx.repo.deleteDesign(positionals[0]);
    if (!ok) throw new CliError(`No design with id ${positionals[0]}.`);
    ctx.audit.record("design_removed", null, { id: positionals[0] });
    console.log(`Removed ${positionals[0]}.`);
  } else {
    throw new CliError(USAGE);
  }
} catch (err) {
  reportAndSetExit(err);
} finally {
  ctx.repo.close();
}

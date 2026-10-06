import { parseArgs } from "node:util";
import { KeyService } from "../auth/keys.js";
import { parseScopes } from "../auth/scopes.js";
import { CliError, openCli, reportAndSetExit } from "./context.js";

const USAGE = `Usage:
  keys:create --name <name> [--scopes <preset|a,b>] [--rate-per-min N] [--rate-per-day N]
  keys:list
  keys:revoke <key-id>

Scope presets: search-only (default), curator, owner. Scopes: read:search, read:design, write:collections, write:library, admin.`;

const [command, ...rest] = process.argv.slice(2);
const ctx = openCli();
const keys = new KeyService(ctx.repo, ctx.audit);

try {
  if (command === "create") {
    const { values } = parseArgs({
      args: rest,
      options: {
        name: { type: "string" },
        scopes: { type: "string" },
        "rate-per-min": { type: "string" },
        "rate-per-day": { type: "string" },
      },
    });
    if (!values.name) throw new CliError(`--name is required.\n\n${USAGE}`);
    const num = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) throw new CliError("Rate limits must be positive integers.");
      return n;
    };
    const issued = keys.create({
      name: values.name,
      scopes: values.scopes ? parseScopes(values.scopes) : undefined,
      ratePerMin: num(values["rate-per-min"]),
      ratePerDay: num(values["rate-per-day"]),
    });
    console.log(`Key id:   ${issued.keyId}`);
    console.log(`Name:     ${issued.principal.name}`);
    console.log(`Scopes:   ${issued.principal.scopes.join(", ")}`);
    console.log("");
    console.log("API key (shown exactly once; only its hash is stored):");
    console.log(issued.key);
  } else if (command === "list") {
    const rows = keys.list();
    if (rows.length === 0) console.log("No keys.");
    for (const k of rows) {
      const status = k.revokedAt ? `revoked ${k.revokedAt}` : "active";
      console.log(
        `${k.keyId}  ${k.keyPrefix}…  ${k.principal.name}  [${k.principal.scopes.join(",")}]  ${status}  last used: ${k.lastUsedAt ?? "never"}`,
      );
    }
  } else if (command === "revoke") {
    const id = rest[0];
    if (!id) throw new CliError(`A key id is required.\n\n${USAGE}`);
    if (!keys.revoke(id)) throw new CliError(`No key with id ${id}.`);
    console.log(`Revoked ${id}. It stops working on the next request.`);
  } else {
    throw new CliError(USAGE);
  }
} catch (err) {
  reportAndSetExit(err);
} finally {
  ctx.repo.close();
}

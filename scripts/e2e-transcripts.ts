/* Scripted end-to-end run over real transports. A scripted MCP client (not a language model) plays the
   agent: for three build goals it calls search_inspiration -> get_design -> get_inspiration_brief, once over
   Streamable HTTP with two different agents' keys and once over stdio, and writes a transcript.
   Usage: pnpm e2e:transcripts [outfile] */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/observability/logger.js";
import { runHttp } from "../src/transport/http.js";

const out = process.argv[2] ?? "docs/e2e-transcripts.md";
const dir = mkdtempSync(join(tmpdir(), "edison-e2e-"));
const today = new Date().toISOString().slice(0, 10);
const registerPath = join(dir, "SOURCES.md");
writeFileSync(
  registerPath,
  `## library
- Status: OWN_LIBRARY
- Access method: owned data
- Terms URL: https://example.com/terms
- Terms reviewed on: ${today}   by: e2e-run
- Terms summary: owned data
- AI/ML usage rule: none found
- Capabilities: canSearch=true, canGetById=true, canStoreMetadata=true, canAnalyze=true, canHotlink=true, canProxyImage=false, cacheTtlSeconds=0
- Attribution requirement: Via Edison X library - {creator}
- Rate limits: none
- Owner approval: e2e-run, ${today}
- Notes / risks: none
`,
);
const masterKey = randomBytes(32).toString("base64");
const env = {
  TOKEN_ENCRYPTION_KEY: masterKey,
  DATABASE_PATH: join(dir, "e2e.db"),
  SOURCES_REGISTER_PATH: registerPath,
  LOG_LEVEL: "silent",
};
const app = createApp(loadConfig(env), { logger: createLogger({ level: "silent" }) });
const http = await runHttp(app, 0);
const agentA = app.keys.create({ name: "agent-a (search-only)" });
const agentB = app.keys.create({
  name: "agent-b (search + collections)",
  scopes: ["read:search", "read:design", "write:collections"],
});

const goals = [
  { goal: "dark fitness dashboard, mobile", args: { query: "dark fitness dashboard", platform: "ios" } },
  {
    goal: "SaaS landing page with pricing",
    args: { query: "saas landing page with pricing table", platform: "web" },
  },
  {
    goal: "habit tracker with streaks",
    args: { query: "habit tracker streak calendar", platform: "android" },
  },
];

type Structured = Record<string, unknown>;
const lines: string[] = [];
const log = (s = ""): void => void lines.push(s);

async function session(label: string, client: Client): Promise<void> {
  log(`## ${label}`);
  log();
  const tools = (await client.listTools()).tools.map((t) => t.name);
  log(`Connected. Tools: ${tools.join(", ")}`);
  for (const g of goals) {
    log();
    log(`### Goal: ${g.goal}`);
    const search = (await client.callTool({
      name: "search_inspiration",
      arguments: { ...g.args, limit: 5 },
    })) as unknown as { structuredContent: Structured };
    const results = search.structuredContent.results as Array<{
      id: string;
      title: string;
      source_url: string;
      attribution: string;
    }>;
    log();
    log(
      `\`search_inspiration(${JSON.stringify({ ...g.args, limit: 5 })})\` -> ${results.length} results; sources_queried=${JSON.stringify(search.structuredContent.sources_queried)}`,
    );
    for (const r of results) log(`- ${r.id} - ${r.title} - ${r.attribution} - ${r.source_url}`);
    const first = results[0];
    if (!first) continue;
    const design = (await client.callTool({
      name: "get_design",
      arguments: { id: first.id },
    })) as unknown as { structuredContent: Structured };
    const a = design.structuredContent.analysis as
      { layout: string; components: string[]; buildHints: string[] } | undefined;
    log();
    log(
      `\`get_design({"id":"${first.id}"})\` -> license=${String(design.structuredContent.license)}, palette=${JSON.stringify(design.structuredContent.palette)}`,
    );
    if (a)
      log(
        `  - layout: ${a.layout}\n  - components: ${a.components.join(", ")}\n  - build hints: ${a.buildHints.join("; ")}`,
      );
    const brief = (await client.callTool({
      name: "get_inspiration_brief",
      arguments: { goal: g.goal, max_designs: 6 },
    })) as unknown as { structuredContent: Structured };
    const b = brief.structuredContent;
    log();
    log(
      `\`get_inspiration_brief({"goal":"${g.goal}"})\` -> confidence=${String(b.confidence)}, based_on ${(b.based_on as unknown[]).length} designs`,
    );
    for (const p of b.patterns as Array<{ pattern: string; evidence: string[] }>)
      log(`  - ${p.pattern}  (evidence: ${p.evidence.join(", ")})`);
    log(`  - suggested components: ${(b.suggested_components as string[]).join(", ")}`);
    log(`  - pitfalls: ${(b.pitfalls as string[]).join(" | ")}`);
  }
  log();
}

const clientFor = async (key: string): Promise<Client> => {
  const c = new Client({ name: "scripted-agent", version: "1" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  return c;
};

log("# End-to-end transcripts");
log();
log(
  `Generated ${new Date().toISOString()} by \`pnpm e2e:transcripts\`. The "agent" is a scripted MCP client, not a language model: it proves the real transports, auth and tools work together for three build goals. Running a real model against the server (Claude as a custom connector) is a manual step described in docs/CONNECTING.md.`,
);
log();

const a = await clientFor(agentA.key);
await session("Agent A over Streamable HTTP (own key, search-only scopes)", a);
const denied = (await a.callTool({ name: "create_collection", arguments: { name: "x" } })) as unknown as {
  isError?: boolean;
  content: Array<{ text: string }>;
};
log(
  `Agent A tries \`create_collection\` -> isError=${String(denied.isError)}: ${denied.content[0]?.text ?? ""}`,
);
log();
await a.close();

const b = await clientFor(agentB.key);
await session("Agent B over Streamable HTTP (a second agent, its own key, no code changes)", b);
const col = (await b.callTool({
  name: "create_collection",
  arguments: { name: "Fitness refs" },
})) as unknown as { structuredContent: { id: string } };
await b.callTool({
  name: "add_to_collection",
  arguments: { collection_id: col.structuredContent.id, design_id: "library:fitness-tracker-mobile" },
});
const got = (await b.callTool({
  name: "get_collection",
  arguments: { collection_id: col.structuredContent.id },
})) as unknown as { structuredContent: { designs: Array<{ id: string }> } };
log(
  `Agent B creates a collection, adds a design, reads it back -> ${got.structuredContent.designs.map((d) => d.id).join(", ")}`,
);
log();
await b.close();

const stdio = new Client({ name: "scripted-agent", version: "1" });
await stdio.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    env: { PATH: process.env.PATH ?? "", ...env, TRANSPORT: "stdio", DATABASE_PATH: join(dir, "stdio.db") },
  }),
);
await session("A local agent over stdio", stdio);
await stdio.close();

await http.close();
app.close();
rmSync(dir, { recursive: true, force: true });
writeFileSync(out, lines.join("\n") + "\n");
console.log(`Wrote ${out} (${lines.length} lines)`);

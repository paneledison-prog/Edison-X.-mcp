import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_MASTER_KEY } from "../helpers/fixtures.js";

let dir: string;
let client: Client;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "edison-stdio-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      TOKEN_ENCRYPTION_KEY: TEST_MASTER_KEY,
      TRANSPORT: "stdio",
      DATABASE_PATH: join(dir, "edison.db"),
      ENABLED_SOURCES: "library",
      LOG_LEVEL: "warn",
    },
  });
  client = new Client({ name: "stdio-test", version: "1" });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("stdio transport (real process)", () => {
  it("lists tools and answers search_inspiration over stdio", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(12);
    const r = (await client.callTool({ name: "search_inspiration", arguments: { query: "meal planner week calendar" } })) as unknown as {
      structuredContent: { results: Array<{ id: string; source_url: string; attribution: string }> };
    };
    expect(r.structuredContent.results[0]?.id).toBe("library:meal-planner-week");
    expect(r.structuredContent.results[0]?.source_url).toMatch(/^https:/);
  });

  it("serves get_design with owner analysis over stdio", async () => {
    const r = (await client.callTool({ name: "get_design", arguments: { id: "library:banking-account-overview" } })) as unknown as {
      structuredContent: { analysis?: { generatedBy: string } };
    };
    expect(r.structuredContent.analysis?.generatedBy).toBe("owner");
  });
});

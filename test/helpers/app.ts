import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createApp, type App, type AppOverrides } from "../../src/app.js";
import type { Principal, Scope } from "../../src/auth/scopes.js";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/observability/logger.js";
import { parseRegister } from "../../src/sources/register.js";
import { buildServer } from "../../src/server.js";
import { openDatabase, runMigrations, SqliteRepository } from "../../src/storage/sqlite.js";
import type { SourceAdapter } from "../../src/sources/types.js";
import { entryMarkdown, NOW, TEST_MASTER_KEY } from "./fixtures.js";

export const LIBRARY_REGISTER = entryMarkdown("library", {
  Status: "OWN_LIBRARY",
  Capabilities:
    "canSearch=true, canGetById=true, canStoreMetadata=true, canAnalyze=true, canHotlink=true, canProxyImage=true, cacheTtlSeconds=0",
});

export interface TestAppOptions {
  env?: Record<string, string>;
  /** Extra adapters, and the register markdown that approves them. */
  adapters?: SourceAdapter[];
  registerMarkdown?: string;
  overrides?: AppOverrides;
  seed?: boolean;
  clock?: () => Date;
}

export function testApp(opts: TestAppOptions = {}): App {
  const ids = ["library", ...(opts.adapters ?? []).map((a) => a.id)];
  const config = loadConfig({
    TOKEN_ENCRYPTION_KEY: TEST_MASTER_KEY,
    ENABLED_SOURCES: ids.join(","),
    LOG_LEVEL: "silent",
    DATABASE_PATH: ":memory:",
    LIBRARY_SEED_PATH: opts.seed === false ? "./does-not-exist.json" : "./library/seed-designs.json",
    ...opts.env,
  });
  const db = openDatabase(":memory:");
  runMigrations(db);
  const logger = createLogger({ level: "silent" });
  return createApp(config, {
    logger,
    clock: opts.clock ?? (() => NOW),
    adapters: opts.adapters,
    register: parseRegister(LIBRARY_REGISTER + (opts.registerMarkdown ?? "")),
    repo: new SqliteRepository(db, logger),
    ...opts.overrides,
  });
}

export function principalWith(scopes: Scope[], id = "p_test"): Principal {
  return { id, name: id, scopes, createdAt: NOW.toISOString() };
}

export const ALL_SCOPES: Scope[] = [
  "read:search",
  "read:design",
  "write:collections",
  "write:library",
  "admin",
];

export interface TestClient {
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  data<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export async function connect(
  app: App,
  principal: Principal = principalWith(ALL_SCOPES),
): Promise<TestClient> {
  const server = buildServer(principal, app.runDeps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return {
    client,
    call,
    async data<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const r = await call(name, args);
      if (r.isError) throw new Error(`tool error: ${JSON.stringify(r.content)}`);
      return r.structuredContent as T;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

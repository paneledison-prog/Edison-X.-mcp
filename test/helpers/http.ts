import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { App } from "../../src/app.js";
import { runHttp, type RunningHttp } from "../../src/transport/http.js";

export async function startHttp(app: App): Promise<RunningHttp & { url: string }> {
  const running = await runHttp(app, 0);
  return { ...running, url: `http://127.0.0.1:${running.port}` };
}

export async function mcpClient(url: string, key: string): Promise<Client> {
  const client = new Client({ name: "http-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  return client;
}

export function rpc(method: string, params: unknown = {}, id = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

export const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

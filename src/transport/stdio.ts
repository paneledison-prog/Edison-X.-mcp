import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { App } from "../app.js";
import { buildServer } from "../server.js";

/**
 * Local transport for the owner's own machine. It runs as the configured local principal.
 * stdout carries the protocol, so every log line goes to stderr.
 */
export async function runStdio(app: App): Promise<void> {
  const server = buildServer(app.stdioPrincipal, app.runDeps);
  await server.connect(new StdioServerTransport());
  app.logger.info({ sources: app.registry.ids() }, "edison-x ready on stdio");
}

import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = {
  source: z.string().min(1).max(32).describe("Source id from list_sources, e.g. 'pinterest'."),
};

export const getConnectionStatus: ToolDefinition<typeof inputSchema> = {
  name: "get_connection_status",
  title: "Check a source connection",
  description:
    "Check whether your key is connected to a source that needs a person's own account (for example Pinterest). If it is not, returns a short-lived " +
    "connect_url the person can open in a browser to authorize access. Returns no tokens.",
  scope: "read:search",
  inputSchema,
  outputSchema: z.object({
    source: z.string(),
    connected: z.boolean(),
    connect_url: z.string().optional(),
    notes: z.string().optional(),
  }),
  annotations: { title: "Check a source connection", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    return { data: { ...(await ctx.services.connections.status(args.source, ctx)) } };
  },
};

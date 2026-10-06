import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = {};

export const listSources: ToolDefinition<typeof inputSchema> = {
  name: "list_sources",
  title: "List design sources",
  description:
    "List the enabled design sources with their status, whether they need you to connect an account (and whether you have), and current health. " +
    "Call it to learn valid ids for the sources input of search_inspiration or to see why a source was skipped. Returns no credentials or internal URLs.",
  scope: "read:search",
  inputSchema,
  outputSchema: z.object({
    sources: z.array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        status: z.string(),
        requires_user_auth: z.boolean(),
        connected: z.boolean(),
        health: z.enum(["ok", "degraded", "down"]),
      }),
    ),
  }),
  annotations: { title: "List design sources", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async handler(_args, ctx) {
    return { data: { sources: await ctx.services.sourcesInfo.list(ctx) } };
  },
};

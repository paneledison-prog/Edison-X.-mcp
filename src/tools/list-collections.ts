import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = {};

export const listCollections: ToolDefinition<typeof inputSchema> = {
  name: "list_collections",
  title: "List your collections",
  description: "List the collections created by your key, with item counts. Other keys' collections are never shown.",
  scope: "read:search",
  inputSchema,
  outputSchema: z.object({
    collections: z.array(z.object({ id: z.string(), name: z.string(), created_at: z.string(), item_count: z.number() })),
  }),
  annotations: { title: "List your collections", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler(_args, ctx) {
    return Promise.resolve({ data: { collections: ctx.services.collections.list(ctx) } });
  },
};

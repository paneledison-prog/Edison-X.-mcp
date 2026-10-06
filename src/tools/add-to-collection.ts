import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = {
  collection_id: z.string().min(3).max(40).describe("Id returned by create_collection or list_collections."),
  design_id: z.string().min(3).max(170).describe("Design id from a search result."),
};

export const addToCollection: ToolDefinition<typeof inputSchema> = {
  name: "add_to_collection",
  title: "Add a design to a collection",
  description:
    "Save a design to one of your collections. Adding the same design twice has no further effect. " +
    "Fails if the collection is not yours or the design id is unknown.",
  scope: "write:collections",
  inputSchema,
  outputSchema: z.object({
    collection_id: z.string(),
    design_id: z.string(),
    added: z.boolean(),
    item_count: z.number(),
  }),
  annotations: {
    title: "Add a design to a collection",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(args, ctx) {
    return { data: await ctx.services.collections.add(args.collection_id, args.design_id, ctx) };
  },
};

import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = {
  name: z.string().min(1).max(80).describe("A short name for the collection, e.g. 'Fitness app references'."),
};

export const createCollection: ToolDefinition<typeof inputSchema> = {
  name: "create_collection",
  title: "Create a collection",
  description:
    "Create an empty, private collection of designs to save references for a project. Returns its id; then call add_to_collection. " +
    "Collections are visible only to the key that created them.",
  scope: "write:collections",
  inputSchema,
  outputSchema: z.object({ id: z.string() }),
  annotations: { title: "Create a collection", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler(args, ctx) {
    return Promise.resolve({ data: ctx.services.collections.create(args.name, ctx) });
  },
};

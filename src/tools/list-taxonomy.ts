import { z } from "zod";
import { getTaxonomy } from "../services/taxonomy.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = {};

export const listTaxonomy: ToolDefinition<typeof inputSchema> = {
  name: "list_taxonomy",
  title: "List the design vocabulary",
  description:
    "List the controlled vocabulary Edison X understands: screen categories, style words, platforms and common UI patterns. " +
    "Call it once to learn valid values for the category and style inputs of search_inspiration. Takes no input and has no side effects.",
  scope: "read:search",
  inputSchema,
  outputSchema: z.object({
    categories: z.array(z.string()),
    styles: z.array(z.string()),
    platforms: z.array(z.string()),
    ui_patterns: z.array(z.string()),
  }),
  annotations: { title: "List the design vocabulary", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler() {
    return Promise.resolve({ data: { ...getTaxonomy() } });
  },
};

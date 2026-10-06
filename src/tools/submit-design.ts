import { z } from "zod";
import { CATEGORIES } from "../services/taxonomy.js";
import { ORIGINS } from "../services/library.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = {
  title: z.string().min(1).max(200).describe("Name of the design."),
  source_url: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .describe("https link to the original design. Required."),
  attribution: z
    .string()
    .min(1)
    .max(300)
    .describe("Credit line to show with it, e.g. 'Jane Doe via Example Studio'. Required."),
  license: z
    .string()
    .min(1)
    .max(60)
    .describe(
      "License of the design, e.g. 'owned', 'CC-BY-4.0'. Required; submissions without one are rejected.",
    ),
  origin: z
    .enum(ORIGINS)
    .describe("How you have the right to include it: 'owned', 'open-license' or 'licensed'."),
  origin_source: z
    .string()
    .max(32)
    .optional()
    .describe("Id of the source it came from, if any. Blocked sources are rejected."),
  image_url: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .optional()
    .describe("https URL of your own image for it (optional)."),
  thumbnail_url: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .optional()
    .describe("https URL of a thumbnail (optional)."),
  creator_name: z.string().min(1).max(100).optional().describe("Creator's name."),
  creator_url: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .optional()
    .describe("Link to the creator."),
  platform: z
    .enum(["web", "ios", "android", "desktop", "unknown"])
    .default("unknown")
    .describe("Platform the design is for."),
  category: z.enum(CATEGORIES).optional().describe("Screen category."),
  tags: z.array(z.string().min(1).max(40)).max(20).optional().describe("Up to 20 short tags."),
  palette: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
    .max(8)
    .optional()
    .describe("Up to 8 hex colors like #1e88e5."),
  summary: z.string().max(500).optional().describe("One or two sentences describing the design."),
  analysis: z
    .object({
      layout: z.string().min(1).max(300),
      components: z.array(z.string().min(1).max(60)).max(20),
      typography: z.string().max(300).optional(),
      colorUsage: z.string().max(300).optional(),
      density: z.enum(["airy", "balanced", "dense"]).optional(),
      interactionNotes: z.string().max(400).optional(),
      buildHints: z.array(z.string().min(1).max(200)).max(12),
    })
    .optional()
    .describe(
      "Your own structural analysis. It is stored as owner-written and never overwritten by a model.",
    ),
};

export const submitDesign: ToolDefinition<typeof inputSchema> = {
  name: "submit_design",
  title: "Submit a design to the library",
  description:
    "Add a design to the owner's library. Requires source_url, attribution and license, and the origin must be one you have the right to include. " +
    "Submissions with no license, or from a blocked source such as Pinterest, are rejected. Submitting the same source_url again updates the entry. " +
    "Needs the write:library scope.",
  scope: "write:library",
  inputSchema,
  outputSchema: z.object({ id: z.string(), created: z.boolean() }),
  annotations: {
    title: "Submit a design to the library",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler(args, ctx) {
    const out = ctx.services.library.submit(
      {
        title: args.title,
        sourceUrl: args.source_url,
        attribution: args.attribution,
        license: args.license,
        origin: args.origin,
        originSource: args.origin_source,
        imageUrl: args.image_url,
        thumbnailUrl: args.thumbnail_url,
        creatorName: args.creator_name,
        creatorUrl: args.creator_url,
        platform: args.platform,
        category: args.category,
        tags: args.tags,
        palette: args.palette,
        summary: args.summary,
        analysis: args.analysis,
      },
      ctx,
    );
    return Promise.resolve({ data: out });
  },
};

import { z } from "zod";
import { ATTRIBUTION_NOTICE, PublicDesignSummarySchema, toPublicSummary, type Design } from "../sources/types.js";

export const PlatformInput = z
  .enum(["web", "ios", "android", "desktop", "any"])
  .default("any")
  .describe("Target platform. Matching designs rank higher. Use 'any' if unsure.");

export const ResultListOutput = {
  results: z.array(PublicDesignSummarySchema),
  next_cursor: z.string().optional(),
  total_estimate: z.number().optional(),
  sources_queried: z.array(z.string()),
  sources_skipped: z.array(z.object({ source: z.string(), reason: z.string() })),
  attribution_notice: z.string(),
  truncated: z.boolean().optional(),
};

export function publicResults(items: Array<{ design: Design; canHotlink: boolean }>): ReturnType<typeof toPublicSummary>[] {
  return items.map((i) => toPublicSummary(i.design, i.canHotlink));
}

export { ATTRIBUTION_NOTICE };

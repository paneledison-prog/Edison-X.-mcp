import { z } from "zod";
import { DesignAnalysisSchema, type DesignAnalysis } from "../sources/types.js";

/** What the model is asked to produce. Kept flat and simple so it works as a structured-output schema. */
export const ModelAnalysisSchema = z.object({
  layout: z.string(),
  components: z.array(z.string()),
  typography: z.string(),
  color_usage: z.string(),
  density: z.enum(["airy", "balanced", "dense"]),
  interaction_notes: z.string(),
  build_hints: z.array(z.string()),
});
export type ModelAnalysis = z.infer<typeof ModelAnalysisSchema>;

const orUndefined = (s: string): string | undefined => (s.trim() === "" ? undefined : s.trim());

/**
 * Map raw model output to a DesignAnalysis and validate it against the strict schema (length caps
 * included). Anything invalid returns null: it is discarded and logged, never stored.
 */
export function toDesignAnalysis(raw: unknown, now: Date): DesignAnalysis | null {
  const model = ModelAnalysisSchema.safeParse(raw);
  if (!model.success) return null;
  const m = model.data;
  const strict = DesignAnalysisSchema.safeParse({
    layout: m.layout.trim(),
    components: m.components.map((c) => c.trim()).filter(Boolean),
    typography: orUndefined(m.typography),
    colorUsage: orUndefined(m.color_usage),
    density: m.density,
    interactionNotes: orUndefined(m.interaction_notes),
    buildHints: m.build_hints.map((h) => h.trim()).filter(Boolean),
    generatedBy: "model",
    generatedAt: now.toISOString(),
  });
  return strict.success ? strict.data : null;
}

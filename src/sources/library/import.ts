import { readFileSync } from "node:fs";
import { z } from "zod";
import { sanitizeDesign, type FlagHandler } from "../../security/sanitize.js";
import type { DesignRepository } from "../../storage/repository.js";
import { LIBRARY_ID } from "./index.js";
import type { RawDesign, SourceAdapter } from "../types.js";

const ImportFileSchema = z.object({
  generatedAt: z.iso.datetime().optional(),
  designs: z.array(z.record(z.string(), z.unknown())).max(5000),
});

export interface ImportResult {
  imported: number;
  rejected: Array<{ sourceId: string; reason: string }>;
}

export interface ImportOptions {
  repo: DesignRepository;
  adapter: Pick<SourceAdapter, "id" | "attributionTemplate" | "capabilities" | "ownerContent">;
  /** Valid category ids (the taxonomy). Passed in so this layer does not depend on services. */
  categories: ReadonlySet<string>;
  now: Date;
  submittedBy?: string;
  onFlag?: FlagHandler;
}

/**
 * Sanitize and store owner-provided designs. Each item needs a license and an https source URL;
 * owner-written analysis is stamped `generatedBy: "owner"`.
 */
export function importLibraryDesigns(
  items: Array<Record<string, unknown>>,
  opts: ImportOptions,
): ImportResult {
  const result: ImportResult = { imported: 0, rejected: [] };
  for (const item of items) {
    const sourceId = typeof item.sourceId === "string" ? item.sourceId : "(missing)";
    if (typeof item.license !== "string" || item.license.trim() === "") {
      result.rejected.push({ sourceId, reason: "missing_license" });
      continue;
    }
    const raw: RawDesign = { ...item };
    if (raw.analysis && typeof raw.analysis === "object") {
      raw.analysis = { generatedBy: "owner", generatedAt: opts.now.toISOString(), ...raw.analysis };
    }
    let flagged = false;
    const sanitized = sanitizeDesign(raw, {
      adapter: opts.adapter,
      now: opts.now,
      categories: opts.categories,
      onFlag: (e) => {
        flagged = true;
        opts.onFlag?.(e);
      },
    });
    if (!sanitized.ok) {
      result.rejected.push({ sourceId, reason: sanitized.reason });
      continue;
    }
    // Owner content that trips the instruction filter is rejected, not stored with a placeholder.
    if (flagged) {
      result.rejected.push({ sourceId, reason: "safety_filter" });
      continue;
    }
    opts.repo.upsertDesign(
      { ...sanitized.design, expiresAt: undefined },
      { submittedBy: opts.submittedBy ?? null },
    );
    result.imported += 1;
  }
  return result;
}

export function importLibraryFile(path: string, opts: ImportOptions): ImportResult {
  const parsed = ImportFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return importLibraryDesigns(parsed.designs, opts);
}

export { LIBRARY_ID };

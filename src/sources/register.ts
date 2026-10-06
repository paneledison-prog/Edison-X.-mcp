import { readFileSync } from "node:fs";
import { CAPABILITY_FLAGS, SourceStatusSchema, type SourceCapabilities, type SourceStatus } from "./types.js";

/**
 * Parser and validator for docs/SOURCES.md (Guidelines section 4.4).
 * A source with any blank or placeholder field is treated as not approved.
 */

export const REVIEW_MAX_AGE_DAYS = 180;

export const REQUIRED_FIELDS = [
  "Status",
  "Access method",
  "Terms URL",
  "Terms reviewed on",
  "Terms summary",
  "AI/ML usage rule",
  "Capabilities",
  "Attribution requirement",
  "Rate limits",
  "Owner approval",
  "Notes / risks",
] as const;

export type RawEntry = Record<string, string>;

export interface RegisterEntry {
  id: string;
  status: SourceStatus;
  accessMethod: string;
  termsUrl: string;
  termsReviewedOn: string;
  reviewedBy: string;
  termsSummary: string;
  aiMlRule: string;
  capabilities: Pick<
    SourceCapabilities,
    | "canSearch"
    | "canGetById"
    | "canStoreMetadata"
    | "canAnalyze"
    | "canHotlink"
    | "canProxyImage"
    | "cacheTtlSeconds"
  >;
  attribution: string;
  rateLimits: string;
  ownerApproval: string;
  notes: string;
}

/** Parse every `## <id>` section outside code fences into raw `Key: value` maps. */
export function parseRegister(markdown: string): Map<string, RawEntry> {
  const entries = new Map<string, RawEntry>();
  let current: RawEntry | null = null;
  let currentKey: string | null = null;
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^##\s+([a-z0-9_-]+)\s*$/.exec(line);
    if (heading) {
      current = {};
      currentKey = null;
      entries.set(heading[1] as string, current);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      current = null;
      currentKey = null;
      continue;
    }
    if (!current) continue;
    const field = /^-\s+([^:]+?):\s*(.*)$/.exec(line);
    if (field) {
      currentKey = (field[1] as string).trim();
      current[currentKey] = (field[2] as string).trim();
      continue;
    }
    if (currentKey && /^\s+\S/.test(line))
      current[currentKey] = `${current[currentKey] ?? ""} ${line.trim()}`.trim();
  }
  return entries;
}

export function loadRegisterFile(path: string): Map<string, RawEntry> {
  return parseRegister(readFileSync(path, "utf8"));
}

const PLACEHOLDER = /^(pending|tbd|todo|n\/a pending|\.{3}|<.*>)(\b|$)/i;

export function isBlank(value: string | undefined): boolean {
  if (value === undefined) return true;
  const v = value.trim();
  return v === "" || PLACEHOLDER.test(v);
}

function parseCapabilities(raw: string): { caps?: RegisterEntry["capabilities"]; problem?: string } {
  const map = new Map<string, string>();
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const [k, v] = part.split("=");
    if (k && v !== undefined) map.set(k.trim(), v.trim().toLowerCase());
  }
  const caps: Record<string, boolean | number> = {};
  for (const flag of CAPABILITY_FLAGS) {
    const v = map.get(flag);
    if (v !== "true" && v !== "false") return { problem: `Capabilities: ${flag} must be true or false` };
    caps[flag] = v === "true";
  }
  const ttl = map.get("cacheTtlSeconds");
  if (ttl === undefined || !/^\d+$/.test(ttl))
    return { problem: "Capabilities: cacheTtlSeconds must be a non-negative integer" };
  caps.cacheTtlSeconds = Number(ttl);
  return { caps: caps as unknown as RegisterEntry["capabilities"] };
}

export type EntryValidation = { ok: true; entry: RegisterEntry } | { ok: false; problems: string[] };

/** Validate a raw entry. Never throws; every problem is listed so the owner can fix them in one pass. */
export function validateEntry(id: string, raw: RawEntry | undefined, now: Date): EntryValidation {
  if (!raw) return { ok: false, problems: ["no entry in the source register"] };
  const problems: string[] = [];
  for (const f of REQUIRED_FIELDS)
    if (isBlank(raw[f])) problems.push(`field '${f}' is blank or a placeholder`);

  const status = SourceStatusSchema.safeParse(raw["Status"]?.trim());
  if (!status.success && !isBlank(raw["Status"]))
    problems.push("Status must be APPROVED, USER_OAUTH, OWN_LIBRARY or BLOCKED");

  let reviewedOn = "";
  let reviewedBy = "";
  if (!isBlank(raw["Terms reviewed on"])) {
    const m = /^(\d{4}-\d{2}-\d{2})\s+by:\s*(.+)$/.exec((raw["Terms reviewed on"] as string).trim());
    if (!m) problems.push("Terms reviewed on must look like 'YYYY-MM-DD   by: <name>'");
    else {
      reviewedOn = m[1] as string;
      reviewedBy = (m[2] as string).trim();
      const t = Date.parse(`${reviewedOn}T00:00:00Z`);
      if (Number.isNaN(t)) problems.push("Terms reviewed on is not a valid date");
      else {
        const ageDays = (now.getTime() - t) / 86_400_000;
        if (ageDays > REVIEW_MAX_AGE_DAYS)
          problems.push(`terms review is ${Math.floor(ageDays)} days old (limit ${REVIEW_MAX_AGE_DAYS})`);
        if (ageDays < -1) problems.push("terms review date is in the future");
      }
      if (isBlank(reviewedBy)) problems.push("Terms reviewed on must name the reviewer");
    }
  }

  if (!isBlank(raw["Owner approval"]) && !/\d{4}-\d{2}-\d{2}/.test(raw["Owner approval"] as string)) {
    problems.push("Owner approval must include the approval date (YYYY-MM-DD)");
  }

  let caps: RegisterEntry["capabilities"] | undefined;
  if (!isBlank(raw["Capabilities"])) {
    const r = parseCapabilities(raw["Capabilities"] as string);
    if (r.problem) problems.push(r.problem);
    caps = r.caps;
  }

  if (problems.length > 0 || !status.success || !caps)
    return { ok: false, problems: problems.length ? problems : ["invalid entry"] };
  return {
    ok: true,
    entry: {
      id,
      status: status.data,
      accessMethod: raw["Access method"] as string,
      termsUrl: raw["Terms URL"] as string,
      termsReviewedOn: reviewedOn,
      reviewedBy,
      termsSummary: raw["Terms summary"] as string,
      aiMlRule: raw["AI/ML usage rule"] as string,
      capabilities: caps,
      attribution: raw["Attribution requirement"] as string,
      rateLimits: raw["Rate limits"] as string,
      ownerApproval: raw["Owner approval"] as string,
      notes: raw["Notes / risks"] as string,
    },
  };
}

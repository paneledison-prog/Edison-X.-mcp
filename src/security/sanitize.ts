import {
  DesignAnalysisSchema,
  DesignSchema,
  renderAttribution,
  type Design,
  type DesignAnalysis,
  type Platform,
  type RawDesign,
  type SourceAdapter,
} from "../sources/types.js";
import { checkUrl } from "./ssrf.js";

/**
 * Untrusted-content pipeline (Guidelines section 10). Everything an adapter returns passes through
 * `sanitizeDesign` before it is stored or returned. Text fields are cleaned, capped and screened for
 * instruction-like content; URLs live only in URL fields.
 */

const ZERO_WIDTH_AND_BIDI = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD\u180E]/g;
// eslint-disable-next-line no-control-regex -- stripping control characters is the point of this pattern
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

const URL_IN_TEXT = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')\]]+/gi;
const MD_IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const HTML_TAG = /<\/?[a-zA-Z!][^>]*>/g;
const MD_NOISE = /[`*~]{1,}|^#{1,6}\s+|^>\s+/gm;

/** Rules that mark text as an attempt to instruct the reading model. Order is for reporting only. */
const INSTRUCTION_RULES: Array<[string, RegExp]> = [
  ["ignore_previous", /\b(ignore|disregard|forget|override)\b[^.]{0,30}\b(previous|prior|above|earlier|all|any|system)\b[^.]{0,30}\b(instructions?|prompts?|rules?|messages?|context)\b/i],
  ["system_prompt", /\b(system prompt|developer message|hidden (prompt|instructions?)|initial (prompt|instructions?))\b/i],
  // Only at the start of a line or sentence, so "Design System: Atlas" is not flagged.
  ["role_marker", /(^|\n|[.!?]\s+)\s*(assistant|system|user|human|developer)\s*:/i],
  ["you_must", /\byou\s+(must|shall|are\s+now|are\s+required|will\s+now)\b/i],
  ["new_instructions", /\b(new|updated|additional)\s+instructions?\b/i],
  ["tool_json", /\{\s*"?(name|tool|tool_name|function|function_call|tool_calls?|arguments|action)"?\s*:/i],
  ["tool_call_text", /\b(call|invoke|execute)\s+(the\s+)?[a-z_]{3,40}\s+(tool|function)\b/i],
  ["exfiltrate", /\b(send|forward|post|upload|leak|exfiltrate|email|transmit)\b[^.]{0,60}\b(tokens?|api keys?|passwords?|secrets?|credentials?|conversation|chat history|user'?s? (files|data))\b/i],
  ["secrecy", /\b(do\s+not|don'?t|never)\s+(tell|inform|mention|reveal|disclose)\b[^.]{0,30}\b(user|human|anyone)\b/i],
  ["reveal_prompt", /\b(reveal|print|repeat|output)\b[^.]{0,30}\b(your|the)\b[^.]{0,20}\b(prompt|instructions)\b/i],
  ["jailbreak", /\b(jailbreak|DAN mode|developer mode)\b/i],
  ["special_tokens", /<\|[^|]*\|>|\[INST\]|<<SYS>>|<\/?(system|assistant|tool_use|function_calls)>/i],
];

export interface FlagEvent {
  field: string;
  rule: string;
}

export type FlagHandler = (event: FlagEvent) => void;

/** Normalize and strip: control and zero-width characters, markup, links and URLs. Does not cap length. */
export function cleanText(input: string): string {
  return input
    .normalize("NFC")
    .replace(ZERO_WIDTH_AND_BIDI, "")
    .replace(/[\t\r\n\u2028\u2029]+/g, " ")
    .replace(CONTROL, "")
    .replace(MD_IMAGE, "$1")
    .replace(MD_LINK, "$1")
    .replace(HTML_TAG, " ")
    .replace(URL_IN_TEXT, "")
    .replace(MD_NOISE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Returns the name of the first rule that matches, or null. Checks the raw text and the cleaned text. */
export function detectInstruction(raw: string, cleaned: string): string | null {
  // Keep newlines so line-start rules still work; flatten every other control character.
  const normalizedRaw = raw
    .normalize("NFC")
    .replace(ZERO_WIDTH_AND_BIDI, "")
    // eslint-disable-next-line no-control-regex -- flattening control characters is the point
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, " ");
  for (const [name, re] of INSTRUCTION_RULES) {
    if (re.test(normalizedRaw) || re.test(cleaned)) return name;
  }
  return null;
}

export const PLACEHOLDER_TITLE = "Untitled design (title withheld by safety filter)";

/** Clean, cap and screen one text field. Returns undefined when empty or flagged. */
export function sanitizeText(
  value: unknown,
  field: string,
  max: number,
  onFlag?: FlagHandler,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = cleanText(value);
  if (!cleaned) return undefined;
  const rule = detectInstruction(value, cleaned);
  if (rule) {
    onFlag?.({ field, rule });
    return undefined;
  }
  return cleaned.slice(0, max).trim() || undefined;
}

/** Validate a URL that will live in a dedicated URL field. Returns the normalized href or undefined. */
export function sanitizeUrl(value: unknown, max = 2000): string | undefined {
  if (typeof value !== "string" || value.length > max) return undefined;
  const checked = checkUrl(value.trim());
  if (!checked.ok) return undefined;
  checked.url.hash = "";
  return checked.url.toString().slice(0, max);
}

function sanitizeTag(value: unknown, onFlag?: FlagHandler): string | undefined {
  const t = sanitizeText(value, "tags", 80, onFlag);
  if (!t) return undefined;
  const slug = t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length >= 2 ? slug : undefined;
}

const PLATFORMS: ReadonlySet<string> = new Set(["web", "ios", "android", "desktop", "unknown"]);

export interface SanitizeContext {
  adapter: Pick<SourceAdapter, "id" | "attributionTemplate" | "capabilities" | "ownerContent">;
  now: Date;
  categories: ReadonlySet<string>;
  onFlag?: FlagHandler;
}

export type SanitizeResult = { ok: true; design: Design } | { ok: false; reason: string };

/** Sanitize a model- or owner-written analysis. Any flagged field drops the whole analysis. */
export function sanitizeAnalysis(raw: unknown, onFlag?: FlagHandler): DesignAnalysis | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  let flagged = false;
  const flag: FlagHandler = (e) => {
    flagged = true;
    onFlag?.(e);
  };
  const list = (v: unknown, field: string, max: number, itemMax: number): string[] =>
    (Array.isArray(v) ? v : [])
      .slice(0, max)
      .map((x) => sanitizeText(x, `analysis.${field}`, itemMax, flag))
      .filter((x): x is string => x !== undefined);
  const candidate = {
    layout: sanitizeText(a.layout, "analysis.layout", 300, flag),
    components: list(a.components, "components", 20, 60),
    typography: sanitizeText(a.typography, "analysis.typography", 300, flag),
    colorUsage: sanitizeText(a.colorUsage, "analysis.colorUsage", 300, flag),
    density: a.density,
    interactionNotes: sanitizeText(a.interactionNotes, "analysis.interactionNotes", 400, flag),
    buildHints: list(a.buildHints, "buildHints", 12, 200),
    generatedBy: a.generatedBy,
    generatedAt: a.generatedAt,
  };
  if (flagged) return undefined;
  const parsed = DesignAnalysisSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Turn an untrusted adapter record into a valid, safe Design (or a reason it was rejected).
 * Attribution is rendered by the server from the adapter's template; adapters cannot set it.
 */
export function sanitizeDesign(raw: RawDesign, ctx: SanitizeContext): SanitizeResult {
  const { adapter, now, categories, onFlag } = ctx;
  const sourceId =
    typeof raw.sourceId === "string" ? raw.sourceId : typeof raw.sourceId === "number" ? String(raw.sourceId) : "";
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(sourceId)) return { ok: false, reason: "invalid_source_id" };

  const sourceUrl = sanitizeUrl(raw.sourceUrl);
  if (!sourceUrl) return { ok: false, reason: "invalid_source_url" };

  const title = sanitizeText(raw.title, "title", 200, onFlag) ?? PLACEHOLDER_TITLE;
  const creatorName = sanitizeText(raw.creator?.name, "creator.name", 100, onFlag);
  const creatorUrl = sanitizeUrl(raw.creator?.url);
  const hotlink = adapter.capabilities.canHotlink;
  const imageUrl = hotlink ? sanitizeUrl(raw.imageUrl) : undefined;
  const thumbnailUrl = hotlink ? sanitizeUrl(raw.thumbnailUrl) : undefined;

  const tags = [
    ...new Set(
      (Array.isArray(raw.tags) ? raw.tags : [])
        .slice(0, 40)
        .map((t) => sanitizeTag(t, onFlag))
        .filter((t): t is string => t !== undefined),
    ),
  ].slice(0, 20);

  const palette = (Array.isArray(raw.palette) ? raw.palette : [])
    .filter((c): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c))
    .map((c) => c.toLowerCase())
    .slice(0, 8);

  const platform: Platform =
    typeof raw.platform === "string" && PLATFORMS.has(raw.platform) ? (raw.platform as Platform) : "unknown";
  const category = typeof raw.category === "string" && categories.has(raw.category) ? raw.category : undefined;

  const ttl = adapter.capabilities.cacheTtlSeconds;
  const candidate = {
    id: `${adapter.id}:${sourceId}`,
    source: adapter.id,
    sourceId,
    title,
    sourceUrl,
    ...(imageUrl ? { imageUrl } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(creatorName ? { creator: { name: creatorName, ...(creatorUrl ? { url: creatorUrl } : {}) } } : {}),
    ...(sanitizeText(raw.license, "license", 60, onFlag) ? { license: sanitizeText(raw.license, "license", 60) } : {}),
    attribution:
      (adapter.ownerContent ? sanitizeText(raw.attribution, "attribution", 300, onFlag) : undefined) ??
      renderAttribution(adapter.attributionTemplate, creatorName),
    platform,
    ...(category ? { category } : {}),
    tags,
    ...(palette.length ? { palette } : {}),
    ...(sanitizeText(raw.summary, "summary", 500, onFlag) ? { summary: sanitizeText(raw.summary, "summary", 500) } : {}),
    ...(raw.analysis && adapter.ownerContent ? (() => {
      const a = sanitizeAnalysis(raw.analysis, onFlag);
      return a ? { analysis: a } : {};
    })() : {}),
    fetchedAt: now.toISOString(),
    ...(ttl > 0 ? { expiresAt: new Date(now.getTime() + ttl * 1000).toISOString() } : {}),
  };
  const parsed = DesignSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: "schema_violation" };
  return { ok: true, design: parsed.data };
}

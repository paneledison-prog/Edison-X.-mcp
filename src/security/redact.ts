/** Redaction for logs, audit details, and anything that might echo a secret. */

const SENSITIVE_KEY = /(authorization|token|secret|password|passwd|key|cookie|signature|credential)/i;
// Keys that look sensitive by name but are safe identifiers.
const SAFE_KEYS = new Set(["key_prefix", "keyprefix", "key_id", "keyid", "api_key_id", "monkey"]);

const PATTERNS: Array<[RegExp, string]> = [
  [/ex_[A-Za-z0-9_-]{43}/g, "[REDACTED_KEY]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/(access_token|refresh_token|client_secret|code)=([^&\s"']+)/gi, "$1=[REDACTED]"],
];

export const REDACTED = "[REDACTED]";

/** Replace secret-shaped substrings in a string. */
export function redactString(input: string): string {
  let out = input;
  for (const [re, repl] of PATTERNS) out = out.replace(re, repl);
  return out;
}

/** Deep-copy a value, masking sensitive keys and secret-shaped strings. Depth-limited. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k) && !SAFE_KEYS.has(k.toLowerCase())) out[k] = REDACTED;
    else out[k] = redactValue(v, depth + 1);
  }
  return out;
}

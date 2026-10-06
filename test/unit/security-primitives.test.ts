import { describe, expect, it } from "vitest";
import { decryptString, deriveKey, encryptString, signPayload, verifyPayload } from "../../src/security/crypto.js";
import { redactString, redactValue } from "../../src/security/redact.js";
import { TEST_MASTER_KEY } from "../helpers/fixtures.js";

describe("crypto", () => {
  const key = deriveKey(TEST_MASTER_KEY, "tokens");
  it("round-trips and uses a fresh nonce each time", () => {
    const a = encryptString(key, "secret-token");
    const b = encryptString(key, "secret-token");
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret-token");
    expect(decryptString(key, a)).toBe("secret-token");
  });
  it("detects tampering and wrong keys", () => {
    const enc = encryptString(key, "x");
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => decryptString(key, raw.toString("base64"))).toThrow();
    expect(() => decryptString(deriveKey(TEST_MASTER_KEY, "other"), enc)).toThrow();
  });
  it("derives independent keys per purpose", () => {
    expect(deriveKey(TEST_MASTER_KEY, "a").equals(deriveKey(TEST_MASTER_KEY, "b"))).toBe(false);
  });
  it("signs payloads, rejects tampering and expiry", () => {
    const token = signPayload(key, { a: 1 }, 60, 1_000_000);
    expect(verifyPayload(key, token, 1_000_000)?.a).toBe(1);
    expect(verifyPayload(key, token, 1_000_000 + 61_000)).toBeNull();
    expect(verifyPayload(key, token.replace(/.$/, "A"), 1_000_000)).toBeNull();
    expect(verifyPayload(deriveKey(TEST_MASTER_KEY, "x"), token, 1_000_000)).toBeNull();
    expect(verifyPayload(key, "garbage", 1_000_000)).toBeNull();
  });
});

describe("redaction", () => {
  it("masks secret-shaped strings", () => {
    const k = `ex_${"A".repeat(43)}`;
    expect(redactString(`key ${k} and Bearer abc.def`)).not.toContain(k);
    expect(redactString("https://x/cb?code=abc123&state=s")).toContain("code=[REDACTED]");
  });
  it("masks sensitive keys deeply but keeps safe identifiers", () => {
    const out = redactValue({ a: { access_token: "t", Authorization: "Bearer z", key_prefix: "ex_ab12", list: [{ password: "p" }] } }) as {
      a: Record<string, unknown>;
    };
    expect(out.a.access_token).toBe("[REDACTED]");
    expect(out.a.Authorization).toBe("[REDACTED]");
    expect(out.a.key_prefix).toBe("ex_ab12");
    expect(JSON.stringify(out)).not.toContain('"p"');
  });
});

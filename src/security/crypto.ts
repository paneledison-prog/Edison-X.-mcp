import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/** Derive an independent 32-byte key per purpose from the master key (HKDF-SHA256). */
export function deriveKey(masterKeyBase64: string, purpose: string): Buffer {
  const master = Buffer.from(masterKeyBase64, "base64");
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `edison-x:${purpose}`, 32));
}

export function isValidMasterKey(base64: string): boolean {
  try {
    return Buffer.from(base64, "base64").length === 32;
  } catch {
    return false;
  }
}

/** AES-256-GCM with a random 12-byte nonce. Output: base64(nonce || tag || ciphertext). */
export function encryptString(key: Buffer, plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ct]).toString("base64");
}

/** Throws if the data was tampered with or the key is wrong. */
export function decryptString(key: Buffer, payload: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < 12 + 16 + 1) throw new Error("ciphertext too short");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export function hmacBase64Url(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}

/** Sign a JSON payload with an expiry. Format: base64url(json).base64url(hmac). */
export function signPayload(key: Buffer, payload: Record<string, unknown>, ttlSeconds: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds })).toString("base64url");
  return `${body}.${hmacBase64Url(key, body)}`;
}

/** Returns the payload if the signature is valid and unexpired, otherwise null. */
export function verifyPayload(key: Buffer, token: string, now = Date.now()): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = hmacBase64Url(key, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

import { randomBytes } from "node:crypto";
import { AuthError } from "../errors.js";
import type { AuditLog } from "../observability/audit.js";
import { constantTimeEqualHex, sha256Hex } from "../security/crypto.js";
import type { AuthRepository, KeyRecord } from "../storage/repository.js";
import { DEFAULT_SCOPES, type Principal, type Scope } from "./scopes.js";

const KEY_RE = /^ex_[A-Za-z0-9_-]{43}$/;
/** "ex_" plus the first 8 key characters: enough to find the row, useless for guessing the key. */
export const KEY_PREFIX_LENGTH = 11;

export interface IssuedKey {
  /** Shown exactly once. Only its SHA-256 hash is stored. */
  key: string;
  keyId: string;
  keyPrefix: string;
  principal: Principal;
}

export interface AuthResult {
  principal: Principal;
  keyId: string;
  limits: { perMin?: number; perDay?: number };
}

export function generateKey(): { key: string; prefix: string; hash: string } {
  const key = `ex_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, KEY_PREFIX_LENGTH), hash: sha256Hex(key) };
}

export class KeyService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly audit?: AuditLog,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** New keys get read:search and read:design only unless scopes are given. */
  create(opts: {
    name: string;
    scopes?: readonly Scope[];
    ratePerMin?: number;
    ratePerDay?: number;
  }): IssuedKey {
    const name = opts.name.trim();
    if (!name || name.length > 80) throw new Error("name must be 1-80 characters");
    const { key, prefix, hash } = generateKey();
    const now = this.clock().toISOString();
    const principal: Principal = {
      id: `p_${randomBytes(6).toString("hex")}`,
      name,
      scopes: [...(opts.scopes ?? DEFAULT_SCOPES)],
      createdAt: now,
    };
    const keyId = `k_${randomBytes(6).toString("hex")}`;
    this.repo.createPrincipalWithKey(principal, {
      keyId,
      keyHash: hash,
      keyPrefix: prefix,
      ratePerMin: opts.ratePerMin,
      ratePerDay: opts.ratePerDay,
    });
    this.audit?.record("key_created", principal.id, { keyId, name, scopes: principal.scopes });
    return { key, keyId, keyPrefix: prefix, principal };
  }

  /** Revocation is immediate: the next request re-reads the database. */
  revoke(keyId: string): boolean {
    const ok = this.repo.revokeKey(keyId, this.clock());
    if (ok) this.audit?.record("key_revoked", null, { keyId });
    return ok;
  }

  list(): KeyRecord[] {
    return this.repo.listKeys();
  }

  /** Validate a raw key. Throws AuthError for anything malformed, unknown or revoked. */
  authenticate(rawKey: string): AuthResult {
    if (!KEY_RE.test(rawKey)) throw new AuthError();
    const hash = sha256Hex(rawKey);
    const candidates = this.repo.findKeysByPrefix(rawKey.slice(0, KEY_PREFIX_LENGTH));
    // Compare against every candidate so timing does not reveal which row matched.
    let match: KeyRecord | undefined;
    for (const c of candidates) if (constantTimeEqualHex(hash, c.keyHash)) match = c;
    if (!match || match.revokedAt || match.principal.revokedAt) throw new AuthError();
    const now = this.clock();
    if (!match.lastUsedAt || now.getTime() - Date.parse(match.lastUsedAt) > 60_000)
      this.repo.touchKey(match.keyId, now);
    return {
      principal: match.principal,
      keyId: match.keyId,
      limits: { perMin: match.ratePerMin ?? undefined, perDay: match.ratePerDay ?? undefined },
    };
  }
}

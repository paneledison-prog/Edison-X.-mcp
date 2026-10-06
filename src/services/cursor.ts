import { sha256Hex, signPayload, verifyPayload } from "../security/crypto.js";
import { ValidationError } from "../errors.js";

const CURSOR_TTL_SECONDS = 15 * 60;

export interface CursorBody {
  offset: number;
}

/** Opaque, signed, expiring cursors bound to the principal and the exact query. */
export class CursorCodec {
  constructor(private readonly key: Buffer) {}

  static queryHash(parts: unknown): string {
    return sha256Hex(JSON.stringify(parts)).slice(0, 16);
  }

  encode(offset: number, queryHash: string, principalId: string, now = Date.now()): string {
    return signPayload(this.key, { o: offset, h: queryHash, p: principalId }, CURSOR_TTL_SECONDS, now);
  }

  decode(cursor: string, queryHash: string, principalId: string, now = Date.now()): CursorBody {
    const payload = verifyPayload(this.key, cursor, now);
    if (
      !payload ||
      payload.h !== queryHash ||
      payload.p !== principalId ||
      typeof payload.o !== "number" ||
      payload.o < 0
    ) {
      throw new ValidationError("The cursor is invalid, expired, or belongs to a different search.");
    }
    return { offset: payload.o };
  }
}

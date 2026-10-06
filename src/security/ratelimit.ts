import { RateLimitError } from "../errors.js";
import type { AuthRepository } from "../storage/repository.js";

/** Token bucket for outbound per-source limits. Time is injectable for tests. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly nowMs: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = nowMs();
  }

  /** Take one token. When empty, reports how long to wait. */
  take(): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = this.nowMs();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSecond);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfterMs: Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000) };
  }
}

export interface KeyLimits {
  perMin: number;
  perDay: number;
}

/**
 * Per-key limits (default 60/min, 1000/day) kept in the database so they survive restarts and are
 * shared across processes. A denied minute check does not consume daily budget.
 */
export function enforceKeyRateLimit(
  repo: AuthRepository,
  principalId: string,
  limits: KeyLimits,
  now: Date,
): void {
  const minBucket = Math.floor(now.getTime() / 60_000);
  const dayBucket = Math.floor(now.getTime() / 86_400_000);
  if (repo.incrementWindow(principalId, "min", minBucket) > limits.perMin) {
    const retry = Math.max(1, Math.ceil(((minBucket + 1) * 60_000 - now.getTime()) / 1000));
    throw new RateLimitError(retry, "per-minute rate limit reached");
  }
  if (repo.incrementWindow(principalId, "day", dayBucket) > limits.perDay) {
    const retry = Math.max(1, Math.ceil(((dayBucket + 1) * 86_400_000 - now.getTime()) / 1000));
    throw new RateLimitError(retry, "daily rate limit reached");
  }
  if (Math.random() < 0.01) repo.pruneWindows(minBucket - 5, dayBucket - 2);
}

/** In-memory fixed-window counter used to blunt key-guessing from one address. */
export class FailureLimiter {
  private entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly nowMs: () => number = Date.now,
  ) {}

  private current(key: string): { count: number; resetAt: number } {
    const now = this.nowMs();
    const e = this.entries.get(key);
    if (!e || e.resetAt <= now) {
      const fresh = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, fresh);
      if (this.entries.size > 10_000)
        for (const [k, v] of this.entries) if (v.resetAt <= now) this.entries.delete(k);
      return fresh;
    }
    return e;
  }

  blocked(key: string): { blocked: boolean; retryAfterSeconds: number } {
    const e = this.current(key);
    return {
      blocked: e.count >= this.max,
      retryAfterSeconds: Math.max(1, Math.ceil((e.resetAt - this.nowMs()) / 1000)),
    };
  }

  /** Returns the new failure count for this window. */
  record(key: string): number {
    const e = this.current(key);
    e.count += 1;
    return e.count;
  }
}

/** Typed errors. Every client-visible message is produced by `toClientError`, nowhere else. */

export type ErrorCode =
  "auth" | "scope" | "rate_limit" | "validation" | "not_found" | "source" | "config" | "timeout" | "internal";

export class EdisonError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthError extends EdisonError {
  constructor(message = "authentication failed") {
    super(message, "auth");
  }
}

export class ScopeError extends EdisonError {
  constructor(readonly scope: string) {
    super(`missing scope ${scope}`, "scope");
  }
}

export class RateLimitError extends EdisonError {
  constructor(
    readonly retryAfterSeconds: number,
    message = "rate limit reached",
  ) {
    super(message, "rate_limit");
  }
}

export class ValidationError extends EdisonError {
  /** `message` must be authored by us and must not embed caller-supplied values. */
  constructor(message: string) {
    super(message, "validation");
  }
}

export class NotFoundError extends EdisonError {
  constructor(message = "not found") {
    super(message, "not_found");
  }
}

export class SourceError extends EdisonError {
  constructor(
    readonly source: string,
    readonly reason: string,
  ) {
    super(`source ${source}: ${reason}`, "source");
  }
}

export class ConfigError extends EdisonError {
  constructor(message: string) {
    super(message, "config");
  }
}

export class TimeoutError extends EdisonError {
  constructor(message = "operation timed out") {
    super(message, "timeout");
  }
}

export interface ClientError {
  code: ErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

/** The single place where internal errors become messages an agent may see. */
export function toClientError(err: unknown): ClientError {
  if (err instanceof AuthError) {
    return {
      code: "auth",
      message: "Authentication failed. Send a valid key as 'Authorization: Bearer <key>'.",
    };
  }
  if (err instanceof ScopeError) {
    return {
      code: "scope",
      message: `This key lacks the required scope '${err.scope}'. Ask the owner for a key that includes it.`,
    };
  }
  if (err instanceof RateLimitError) {
    return {
      code: "rate_limit",
      message: `Rate limit reached. Retry in ${err.retryAfterSeconds} seconds.`,
      retryAfterSeconds: err.retryAfterSeconds,
    };
  }
  if (err instanceof ValidationError) {
    return { code: "validation", message: `${err.message} Fix the input and try again.` };
  }
  if (err instanceof NotFoundError) {
    return { code: "not_found", message: `${err.message} Use search_inspiration to find valid ids.` };
  }
  if (err instanceof SourceError) {
    return {
      code: "source",
      message: `Source '${err.source}' could not be used (${err.reason}). Try other sources or retry later.`,
    };
  }
  if (err instanceof TimeoutError) {
    return { code: "timeout", message: "The request took too long. Retry with a narrower query." };
  }
  return {
    code: "internal",
    message: "The server hit an unexpected problem. Retry once; if it persists, tell the owner.",
  };
}

import pino, { type DestinationStream, type Logger } from "pino";
import { redactString, redactValue } from "../security/redact.js";

export type { Logger };

export interface LoggerOptions {
  level: string;
  /** Defaults to stderr (fd 2) because stdout carries the MCP stdio protocol. */
  destination?: DestinationStream;
}

/** Structured JSON logger that redacts secrets from every argument before writing. */
export function createLogger(opts: LoggerOptions): Logger {
  return pino(
    {
      level: opts.level,
      base: { app: "edison-x" },
      redact: { paths: ["req.headers.authorization", "headers.authorization", "authorization"], censor: "[REDACTED]" },
      hooks: {
        logMethod(args, method) {
          const safe = args.map((a) => (typeof a === "string" ? redactString(a) : redactValue(a)));
          // pino's logMethod hook receives a tuple-typed argument list; the mapped copy has the same arity.
          method.apply(this, safe as unknown as Parameters<typeof method>);
        },
      },
    },
    opts.destination ?? pino.destination({ dest: 2, sync: false }),
  );
}

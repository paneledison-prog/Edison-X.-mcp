import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z, ZodRawShape } from "zod";
import { randomUUID } from "node:crypto";
import { ScopeError, TimeoutError, toClientError } from "../errors.js";
import { hasScope, type Principal } from "../auth/scopes.js";
import type { AuditLog } from "../observability/audit.js";
import type { Logger } from "../observability/logger.js";
import type { Metrics } from "../observability/metrics.js";
import type { ToolContext, ToolDefinition, ToolServices } from "./types.js";

export const MAX_RESPONSE_BYTES = 50_000;

export interface RunDeps {
  services: ToolServices;
  audit: AuditLog;
  metrics: Metrics;
  logger: Logger;
  clock: () => Date;
  toolTimeoutMs: number;
}

const size = (v: unknown): number => Buffer.byteLength(JSON.stringify(v));

/**
 * Keep the response under the cap: drop items from the end of the largest array until it fits and
 * flag `truncated: true`. A trimmed page cannot be continued, so `next_cursor` is removed too.
 */
export function capSize(
  data: Record<string, unknown>,
  maxBytes = MAX_RESPONSE_BYTES,
): Record<string, unknown> {
  if (size(data) <= maxBytes) return data;
  const out: Record<string, unknown> = { ...data, truncated: true };
  delete out.next_cursor;
  for (let guard = 0; guard < 10_000 && size(out) > maxBytes; guard++) {
    let bigKey: string | null = null;
    let bigSize = 0;
    for (const [k, v] of Object.entries(out)) {
      if (Array.isArray(v) && v.length > 0) {
        const s = size(v);
        if (s > bigSize) {
          bigSize = s;
          bigKey = k;
        }
      }
    }
    if (!bigKey) break;
    out[bigKey] = (out[bigKey] as unknown[]).slice(0, -1);
  }
  return out;
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Scope check, timeout, metrics and error mapping around every tool call. */
export async function runTool<Shape extends ZodRawShape>(
  def: ToolDefinition<Shape>,
  args: z.infer<z.ZodObject<Shape>>,
  principal: Principal,
  deps: RunDeps,
): Promise<CallToolResult> {
  const started = performance.now();
  const requestId = randomUUID();
  try {
    if (!hasScope(principal, def.scope)) {
      deps.audit.record("scope_denied", principal.id, { tool: def.name, scope: def.scope });
      throw new ScopeError(def.scope);
    }
    const signal = AbortSignal.timeout(deps.toolTimeoutMs);
    const ctx: ToolContext = { principal, signal, now: deps.clock(), requestId, services: deps.services };
    const output = await new Promise<Awaited<ReturnType<typeof def.handler>>>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new TimeoutError()), { once: true });
      def
        .handler(args, ctx)
        .then(resolve, (e: unknown) => reject(e instanceof Error ? e : new Error("tool failed")));
    });
    const data = capSize(output.data);
    deps.metrics.inc("edison_tool_calls_total", { tool: def.name, outcome: "ok" });
    return {
      content: [{ type: "text", text: JSON.stringify(data) }, ...(output.extraContent ?? [])],
      structuredContent: data,
    };
  } catch (err) {
    const client = toClientError(err);
    deps.metrics.inc("edison_tool_calls_total", { tool: def.name, outcome: client.code });
    if (client.code === "internal") deps.logger.error({ err, tool: def.name, requestId }, "tool failed");
    return errorResult(client.message);
  } finally {
    deps.metrics.observe("edison_tool_latency_ms", performance.now() - started, { tool: def.name });
  }
}

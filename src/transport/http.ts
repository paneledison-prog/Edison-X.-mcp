import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { App } from "../app.js";
import { hasScope } from "../auth/scopes.js";
import { AuthError, NotFoundError, RateLimitError, ValidationError } from "../errors.js";
import { enforceKeyRateLimit, FailureLimiter } from "../security/ratelimit.js";
import { buildServer } from "../server.js";

export const MAX_BODY_BYTES = 100 * 1024;

class PayloadTooLarge extends Error {}

function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) return reject(new PayloadTooLarge());
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new PayloadTooLarge());
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

function sendHtml(res: ServerResponse, status: number, message: string): void {
  const html = `<!doctype html><meta charset="utf-8"><title>Edison X</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Edison X</h1><p>${message}</p></body>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
  res.end(html);
}

/** Build the HTTP server (not yet listening). Every route except /healthz and the OAuth callback needs a key. */
export function createHttpServer(app: App): Server {
  const { config, logger, metrics, audit } = app;
  const authFailures = new FailureLimiter(20, 60_000);
  const publicHost = config.publicBaseUrl ? new URL(config.publicBaseUrl).hostname.toLowerCase() : undefined;
  const allowedHostnames = new Set(["localhost", "127.0.0.1", "::1", ...(publicHost ? [publicHost] : [])]);

  const clientIp = (req: IncomingMessage): string => {
    if (config.trustProxy) {
      const fwd = req.headers["x-forwarded-for"];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? "unknown";
  };

  const hostnameOf = (host: string | undefined): string => {
    if (!host) return "";
    const h = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0] ?? "";
    return h.toLowerCase();
  };

  /** Validates the bearer key, applies the per-key rate limit, and returns the principal. Throws on failure. */
  const authenticate = (req: IncomingMessage) => {
    const ip = clientIp(req);
    if (authFailures.blocked(ip).blocked) throw new RateLimitError(authFailures.blocked(ip).retryAfterSeconds, "too many failed attempts");
    try {
      const auth = app.resolvePrincipal(req.headers.authorization);
      enforceKeyRateLimit(
        app.repo,
        auth.principal.id,
        { perMin: auth.limits.perMin ?? config.rateLimitPerMin, perDay: auth.limits.perDay ?? config.rateLimitPerDay },
        app.runDeps.clock(),
      );
      return auth;
    } catch (err) {
      if (err instanceof AuthError) {
        metrics.inc("edison_auth_denied_total");
        if (authFailures.record(ip) <= 5) audit.record("auth_denied", null, { ip });
      } else if (err instanceof RateLimitError) {
        metrics.inc("edison_rate_limit_hits_total", { scope: "key" });
        audit.record("rate_limited", null, { ip });
      }
      throw err;
    }
  };

  const handleError = (res: ServerResponse, err: unknown): void => {
    if (err instanceof AuthError) {
      sendJson(res, 401, { error: "unauthorized", message: "Send a valid key as 'Authorization: Bearer <key>'." }, { "WWW-Authenticate": 'Bearer realm="edison-x"' });
    } else if (err instanceof RateLimitError) {
      sendJson(res, 429, { error: "rate_limited", message: `Rate limit reached. Retry in ${err.retryAfterSeconds} seconds.` }, { "Retry-After": String(err.retryAfterSeconds) });
    } else if (err instanceof NotFoundError) {
      sendJson(res, 404, { error: "not_found", message: "Not found." });
    } else if (err instanceof ValidationError) {
      sendJson(res, 400, { error: "bad_request", message: err.message });
    } else if (err instanceof PayloadTooLarge) {
      sendJson(res, 413, { error: "payload_too_large", message: `Request bodies are limited to ${MAX_BODY_BYTES} bytes.` });
    } else {
      logger.error({ err }, "http handler failed");
      sendJson(res, 500, { error: "internal", message: "The server hit an unexpected problem." });
    }
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";

    if (!allowedHostnames.has(hostnameOf(req.headers.host))) return sendJson(res, 403, { error: "forbidden_host", message: "Unknown host." });
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) return sendJson(res, 403, { error: "forbidden_origin", message: "Origin not allowed." });

    if (url.pathname === "/healthz" && method === "GET") return sendJson(res, 200, { status: "ok" });

    if (url.pathname === "/readyz" && method === "GET") {
      authenticate(req);
      const checks: Record<string, "ok" | "down"> = {};
      for (const s of app.registry.list()) {
        try {
          checks[s.adapter.id] = (await s.adapter.healthCheck()).ok ? "ok" : "down";
        } catch {
          checks[s.adapter.id] = "down";
        }
      }
      const dbOk = app.repo.ping();
      const ready = dbOk && Object.values(checks).every((v) => v === "ok");
      return sendJson(res, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", database: dbOk ? "ok" : "down", sources: checks });
    }

    if (url.pathname === "/metrics" && method === "GET") {
      const { principal } = authenticate(req);
      if (!hasScope(principal, "admin")) {
        audit.record("scope_denied", principal.id, { route: "/metrics", scope: "admin" });
        return sendJson(res, 403, { error: "forbidden", message: "The admin scope is required." });
      }
      const text = metrics.render();
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4", "Content-Length": Buffer.byteLength(text) });
      return void res.end(text);
    }

    if (url.pathname === "/mcp") {
      if (method !== "POST") return sendJson(res, 405, { error: "method_not_allowed", message: "Use POST." }, { Allow: "POST" });
      const { principal } = authenticate(req);
      const raw = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        return sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
      }
      // Stateless: one server and transport per request, bound to this principal.
      const server = buildServer(principal, app.runDeps);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      return transport.handleRequest(req, res, parsed);
    }

    const connect = /^\/connect\/([a-z0-9_-]{1,32})(\/callback)?$/.exec(url.pathname);
    if (connect) {
      const source = connect[1] as string;
      if (!app.oauth.has(source)) return sendJson(res, 404, { error: "not_found", message: "Not found." });

      if (connect[2] && method === "GET") {
        // Anonymous by necessity (a browser redirect). The single-use `state` binds it to the principal who started the flow.
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        if (url.searchParams.get("error") || !state || !code) return sendHtml(res, 400, "The connection was cancelled or incomplete. You can close this tab.");
        try {
          await app.oauth.complete(source, state, code);
          return sendHtml(res, 200, "Connected. You can close this tab and return to your agent.");
        } catch (err) {
          if (!(err instanceof AuthError)) logger.warn({ err, source }, "oauth callback failed");
          return sendHtml(res, 400, "The connection could not be completed. Start again from your agent.");
        }
      }

      if (!connect[2] && method === "GET") {
        // A browser cannot send a Bearer header, so the link from get_connection_status carries a signed, short-lived ticket.
        const ticket = url.searchParams.get("t");
        const verified = ticket ? app.connections.verifyTicket(ticket) : null;
        if (!verified || verified.source !== source) {
          if (authFailures.record(clientIp(req)) <= 5) audit.record("auth_denied", null, { route: "connect" });
          return sendHtml(res, 401, "This connect link is invalid or has expired. Ask your agent for a new one.");
        }
        res.writeHead(302, { Location: app.oauth.begin(source, verified.principalId), "Cache-Control": "no-store" });
        return void res.end();
      }

      if (!connect[2] && method === "DELETE") {
        const { principal } = authenticate(req);
        await app.oauth.disconnect(source, principal.id);
        res.writeHead(204);
        return void res.end();
      }
    }

    return sendJson(res, 404, { error: "not_found", message: "Not found." });
  };

  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    route(req, res).catch((err: unknown) => handleError(res, err));
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

export interface RunningHttp {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export async function runHttp(app: App, port = app.config.port): Promise<RunningHttp> {
  const server = createHttpServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, app.config.bindHost, resolve);
  });
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  app.logger.info({ port: actual, sources: app.registry.ids() }, "edison-x ready on http");
  return {
    server,
    port: actual,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

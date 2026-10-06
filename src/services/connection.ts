import { NotFoundError } from "../errors.js";
import { deriveKey, signPayload, verifyPayload } from "../security/crypto.js";
import type { RequestContext } from "../sources/types.js";
import type { ServiceDeps } from "./context.js";

const TICKET_TTL_SECONDS = 600;

export interface ConnectionStatusView {
  source: string;
  connected: boolean;
  connect_url?: string;
  notes?: string;
}

/**
 * Connection status for sources that need a user's own account. A browser cannot send a Bearer
 * header, so the connect link carries a short-lived signed ticket bound to the principal.
 */
export class ConnectionService {
  private readonly key: Buffer;

  constructor(
    private readonly deps: ServiceDeps,
    masterKey: string,
    private readonly publicBaseUrl?: string,
  ) {
    this.key = deriveKey(masterKey, "connect-ticket");
  }

  issueTicket(principalId: string, source: string, now = Date.now()): string {
    return signPayload(this.key, { p: principalId, s: source }, TICKET_TTL_SECONDS, now);
  }

  verifyTicket(ticket: string, now = Date.now()): { principalId: string; source: string } | null {
    const payload = verifyPayload(this.key, ticket, now);
    if (!payload || typeof payload.p !== "string" || typeof payload.s !== "string") return null;
    return { principalId: payload.p, source: payload.s };
  }

  async status(source: string, ctx: RequestContext): Promise<ConnectionStatusView> {
    const loaded = this.deps.registry.get(source);
    if (!loaded) throw new NotFoundError("No enabled source has that id.");
    if (!loaded.capabilities.requiresUserAuth)
      return { source, connected: true, notes: "This source does not need a connection." };
    const connected = (await loaded.adapter.connectionStatus?.(ctx))?.connected ?? false;
    if (connected) return { source, connected: true };
    if (!this.publicBaseUrl) {
      return {
        source,
        connected: false,
        notes: "Connecting needs the HTTP deployment with PUBLIC_BASE_URL set; ask the owner.",
      };
    }
    const ticket = this.issueTicket(ctx.principal.id, source, ctx.now.getTime());
    return { source, connected: false, connect_url: `${this.publicBaseUrl}/connect/${source}?t=${ticket}` };
  }
}

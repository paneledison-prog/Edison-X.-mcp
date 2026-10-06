import type { RequestContext } from "../sources/types.js";
import type { ServiceDeps } from "./context.js";

export interface SourceInfo {
  id: string;
  displayName: string;
  status: string;
  requires_user_auth: boolean;
  connected: boolean;
  health: "ok" | "degraded" | "down";
}

export class SourcesInfoService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(ctx: RequestContext): Promise<SourceInfo[]> {
    return Promise.all(
      this.deps.registry.list().map(async (s) => {
        let connected = true;
        if (s.capabilities.requiresUserAuth) {
          try {
            connected = (await s.adapter.connectionStatus?.(ctx))?.connected ?? false;
          } catch {
            connected = false;
          }
        }
        return {
          id: s.adapter.id,
          displayName: s.adapter.displayName,
          status: s.adapter.status,
          requires_user_auth: s.capabilities.requiresUserAuth,
          connected,
          health: this.deps.registry.health.health(s.adapter.id),
        };
      }),
    );
  }
}

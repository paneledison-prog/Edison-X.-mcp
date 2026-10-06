import { AuthError } from "../errors.js";
import type { Config } from "../config.js";
import type { KeyService, AuthResult } from "./keys.js";
import type { Principal } from "./scopes.js";

/**
 * The single seam between a request and a principal. Today it validates API keys; an OAuth 2.1
 * authorization server can replace this function without touching any tool code.
 */
export type ResolvePrincipal = (authorizationHeader: string | undefined) => AuthResult;

export function createApiKeyResolver(keys: KeyService): ResolvePrincipal {
  return (header) => {
    const m = /^Bearer ([^\s]+)$/.exec(header ?? "");
    if (!m) throw new AuthError();
    return keys.authenticate(m[1] as string);
  };
}

/** The configured local principal used by the stdio transport (the owner's own machine). */
export function localPrincipal(config: Pick<Config, "stdioPrincipalName" | "stdioScopes">): Principal {
  return { id: "local", name: config.stdioPrincipalName, scopes: [...config.stdioScopes], createdAt: new Date(0).toISOString() };
}

import { z } from "zod";

export const SCOPES = ["read:search", "read:design", "write:collections", "write:library", "admin"] as const;
export const ScopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof ScopeSchema>;

/** Least-privilege presets documented in docs/CONNECTING.md. */
export const SCOPE_PRESETS: Record<string, readonly Scope[]> = {
  "search-only": ["read:search", "read:design"],
  curator: ["read:search", "read:design", "write:library"],
  owner: ["read:search", "read:design", "write:library", "write:collections", "admin"],
};

export const DEFAULT_SCOPES: readonly Scope[] = SCOPE_PRESETS["search-only"] as readonly Scope[];

/** Parse "a,b" or a preset name into validated scopes. Throws on unknown names. */
export function parseScopes(input: string): Scope[] {
  const trimmed = input.trim();
  const preset = SCOPE_PRESETS[trimmed];
  if (preset) return [...preset];
  const parts = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("no scopes given");
  return [...new Set(parts.map((p) => ScopeSchema.parse(p)))];
}

export interface Principal {
  id: string;
  name: string;
  scopes: Scope[];
  createdAt: string;
  revokedAt?: string;
}

/** Exact scope match only: `admin` does not imply other scopes (least privilege). */
export function hasScope(principal: Pick<Principal, "scopes">, scope: Scope): boolean {
  return principal.scopes.includes(scope);
}

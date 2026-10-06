import type { SourceAdapter, SourceCapabilities, Design } from "../../src/sources/types.js";
import type { Principal } from "../../src/auth/scopes.js";

export const NOW = new Date("2026-10-06T12:00:00Z");

export const TEST_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

export function entryMarkdown(id: string, overrides: Record<string, string | null> = {}): string {
  const fields: Record<string, string> = {
    Status: "APPROVED",
    "Access method": "official API v1",
    "Terms URL": "https://example.com/terms",
    "Terms reviewed on": "2026-09-01   by: Tester",
    "Terms summary": "Display allowed with credit. Caching up to one hour. No scraping.",
    "AI/ML usage rule": "none found",
    Capabilities:
      "canSearch=true, canGetById=true, canStoreMetadata=true, canAnalyze=true, canHotlink=true, canProxyImage=true, cacheTtlSeconds=3600",
    "Attribution requirement": "Via Example - {creator}",
    "Rate limits": "100/min",
    "Owner approval": "Owner, 2026-09-02",
    "Notes / risks": "none",
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== null) as Array<[string, string]>),
  };
  const lines = Object.entries(fields)
    .filter(([k]) => overrides[k] !== null)
    .map(([k, v]) => `- ${k}: ${v}`);
  return `## ${id}\n${lines.join("\n")}\n`;
}

export function fakeAdapter(
  id: string,
  patch: Partial<SourceAdapter> = {},
  caps: Partial<SourceCapabilities> = {},
): SourceAdapter {
  return {
    id,
    displayName: id,
    status: "APPROVED",
    capabilities: {
      canSearch: true,
      canGetById: true,
      canStoreMetadata: true,
      canAnalyze: true,
      canHotlink: true,
      canProxyImage: false,
      cacheTtlSeconds: 3600,
      requiresUserAuth: false,
      ...caps,
    },
    attributionTemplate: "Via Example - {creator}",
    allowedHosts: ["example.com"],
    search: () => Promise.resolve({ designs: [] }),
    getById: () => Promise.resolve(null),
    healthCheck: () => Promise.resolve({ ok: true }),
    ...patch,
  };
}

export const PRINCIPAL: Principal = {
  id: "p_test",
  name: "tester",
  scopes: ["read:search", "read:design"],
  createdAt: NOW.toISOString(),
};

export function makeDesign(partial: Partial<Design> & { id?: string } = {}): Design {
  const source = partial.source ?? "library";
  const sourceId = partial.sourceId ?? "d1";
  return {
    id: `${source}:${sourceId}`,
    source,
    sourceId,
    title: "Sample dashboard",
    sourceUrl: `https://example.com/${sourceId}`,
    attribution: "Via Edison X library - Tester",
    platform: "web",
    tags: ["dashboard", "dark"],
    fetchedAt: NOW.toISOString(),
    ...partial,
  };
}

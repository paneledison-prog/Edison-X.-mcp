import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });

/** Rules/04-code-quality.md: dependencies point inward (tools -> services -> sources/storage), never the reverse. */
const FORBIDDEN: Record<string, string[]> = {
  storage: ["tools", "services", "transport", "analysis", "cli", "app", "server"],
  sources: ["tools", "services", "transport", "analysis", "cli", "app", "server", "auth"],
  services: ["tools", "transport", "analysis", "cli", "app", "server"],
  security: ["tools", "services", "transport", "analysis", "cli", "app", "server"],
  observability: ["tools", "services", "transport", "analysis", "cli", "app", "server"],
  tools: ["transport", "cli", "app", "server"],
};

describe("module layering", () => {
  const files = walk("src");
  it.each(Object.keys(FORBIDDEN))("%s never imports from a higher layer", (layer) => {
    const offenders: string[] = [];
    for (const f of files.filter((x) => relative("src", x).startsWith(`${layer}/`))) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const target =
          relative("src", join(f, "..", m[1] ?? ""))
            .split("/")[0]
            ?.replace(/\.js$/, "") ?? "";
        // Principal and Scope are core domain types that every layer may name.
        if (target === "auth" && (m[1] ?? "").endsWith("auth/scopes.js")) continue;
        if ((FORBIDDEN[layer] ?? []).includes(target)) offenders.push(`${f} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no source file uses `any`, ts-ignore or leaves a TODO", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/@ts-ignore|@ts-nocheck/);
      expect(text, f).not.toMatch(/\bTODO\b|\bFIXME\b/);
      expect(text, f).not.toMatch(/:\s*any\b|<any>|as any\b/);
    }
  });
});

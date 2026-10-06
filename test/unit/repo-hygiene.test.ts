import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENV_VARIABLES } from "../../src/config.js";
import { parseRegister, validateEntry } from "../../src/sources/register.js";
import { CATEGORY_SET } from "../../src/services/taxonomy.js";
import { NOW } from "../helpers/fixtures.js";

describe(".env.example", () => {
  const listed = readFileSync(".env.example", "utf8")
    .split("\n")
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((x): x is string => !!x);

  it("lists every variable the server reads, and nothing else", () => {
    expect([...listed].sort()).toEqual([...ENV_VARIABLES].sort());
  });
  it("contains no real values for secrets", () => {
    for (const secret of [
      "TOKEN_ENCRYPTION_KEY",
      "PINTEREST_CLIENT_SECRET",
      "ANTHROPIC_API_KEY",
      "PINTEREST_CLIENT_ID",
    ]) {
      expect(new RegExp(`^${secret}=\\s*$`, "m").test(readFileSync(".env.example", "utf8")), secret).toBe(
        true,
      );
    }
  });
});

describe("shipped register and seed library", () => {
  const register = parseRegister(readFileSync("docs/SOURCES.md", "utf8"));

  it("has a complete, valid entry for the library and an honestly PENDING one for pinterest", () => {
    expect(validateEntry("library", register.get("library"), NOW).ok).toBe(true);
    const pin = validateEntry("pinterest", register.get("pinterest"), NOW);
    expect(pin.ok).toBe(false);
    if (!pin.ok) expect(pin.problems.length).toBeGreaterThanOrEqual(5);
  });

  it("the seed library has at least 30 original, credited, licensed designs with unique links and valid taxonomy", () => {
    interface SeedItem {
      sourceId: string;
      sourceUrl: string;
      license: string;
      attribution: string;
      category: string;
      analysis: { components: string[] };
    }
    const file = JSON.parse(readFileSync("library/seed-designs.json", "utf8")) as { designs: SeedItem[] };
    expect(file.designs.length).toBeGreaterThanOrEqual(30);
    expect(new Set(file.designs.map((d) => d.sourceUrl)).size).toBe(file.designs.length);
    expect(new Set(file.designs.map((d) => d.sourceId)).size).toBe(file.designs.length);
    for (const d of file.designs) {
      expect(d.license, d.sourceId).toBe("owned");
      expect(d.attribution, d.sourceId).toBeTruthy();
      expect(d.sourceUrl, d.sourceId).toMatch(
        /^https:\/\/github\.com\/paneledison-prog\/Edison-X\.-mcp\/blob\/main\/library\/designs\/[a-z0-9-]+\.md$/,
      );
      expect(CATEGORY_SET.has(d.category), d.sourceId).toBe(true);
      expect(d.analysis.components.length).toBeGreaterThan(0);
    }
    const files = new Set(readdirSync("library/designs").map((f) => f.replace(/\.md$/, "")));
    for (const d of file.designs) expect(files.has(d.sourceId), `${d.sourceId}.md`).toBe(true);
    expect(new Set(file.designs.map((d) => d.category)).size).toBe(CATEGORY_SET.size);
  });
});

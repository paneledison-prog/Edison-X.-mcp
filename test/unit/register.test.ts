import { describe, expect, it } from "vitest";
import { parseRegister, validateEntry, REQUIRED_FIELDS } from "../../src/sources/register.js";
import { entryMarkdown, NOW } from "../helpers/fixtures.js";

describe("source register", () => {
  it("parses entries and ignores fenced templates", () => {
    const md = "# Title\n```\n## fake\n- Status: APPROVED\n```\n" + entryMarkdown("alpha") + "\n" + entryMarkdown("beta");
    const reg = parseRegister(md);
    expect([...reg.keys()]).toEqual(["alpha", "beta"]);
    expect(reg.get("alpha")?.["Status"]).toBe("APPROVED");
  });

  it("joins continuation lines", () => {
    const reg = parseRegister("## a\n- Terms summary: line one\n  line two\n- Status: APPROVED\n");
    expect(reg.get("a")?.["Terms summary"]).toBe("line one line two");
  });

  it("accepts a complete, current entry", () => {
    const r = validateEntry("alpha", parseRegister(entryMarkdown("alpha")).get("alpha"), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entry.capabilities.cacheTtlSeconds).toBe(3600);
      expect(r.entry.reviewedBy).toBe("Tester");
    }
  });

  it.each(REQUIRED_FIELDS)("treats a missing '%s' as not approved", (field) => {
    const raw = parseRegister(entryMarkdown("alpha", { [field]: null })).get("alpha");
    const r = validateEntry("alpha", raw, NOW);
    expect(r.ok).toBe(false);
  });

  it.each(["PENDING", "TBD", "", "<name, date>"])("treats placeholder %j as blank", (value) => {
    const raw = parseRegister(entryMarkdown("alpha", { "Owner approval": value })).get("alpha");
    expect(validateEntry("alpha", raw, NOW).ok).toBe(false);
  });

  it("refuses a review older than 180 days and a future-dated one", () => {
    const old = parseRegister(entryMarkdown("a", { "Terms reviewed on": "2026-01-01   by: T" })).get("a");
    const r = validateEntry("a", old, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toMatch(/days old/);
    const future = parseRegister(entryMarkdown("a", { "Terms reviewed on": "2027-01-01   by: T" })).get("a");
    expect(validateEntry("a", future, NOW).ok).toBe(false);
  });

  it("refuses an approval with no date and malformed capabilities", () => {
    expect(validateEntry("a", parseRegister(entryMarkdown("a", { "Owner approval": "Owner" })).get("a"), NOW).ok).toBe(false);
    expect(validateEntry("a", parseRegister(entryMarkdown("a", { Capabilities: "canSearch=true" })).get("a"), NOW).ok).toBe(false);
  });

  it("returns a problem when no entry exists", () => {
    const r = validateEntry("ghost", undefined, NOW);
    expect(r.ok).toBe(false);
  });
});

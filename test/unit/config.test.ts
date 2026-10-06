import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { ConfigError } from "../../src/errors.js";
import { TEST_MASTER_KEY } from "../helpers/fixtures.js";

const base = { TOKEN_ENCRYPTION_KEY: TEST_MASTER_KEY };

describe("config", () => {
  it("loads defaults when only the key is set", () => {
    const c = loadConfig(base);
    expect(c.transport).toBe("stdio");
    expect(c.enabledSources).toEqual(["library"]);
    expect(c.rateLimitPerMin).toBe(60);
    expect(c.stdioScopes).toContain("write:library");
  });

  it("exits with a clear message when the key is missing, without echoing values", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ TOKEN_ENCRYPTION_KEY: "not-a-key-secret-value" })).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    );
    try {
      loadConfig({ TOKEN_ENCRYPTION_KEY: "not-a-key-secret-value" });
    } catch (e) {
      expect((e as Error).message).not.toContain("not-a-key-secret-value");
    }
  });

  it("requires Pinterest settings when pinterest is enabled", () => {
    expect(() => loadConfig({ ...base, ENABLED_SOURCES: "library,pinterest" })).toThrow(
      /PINTEREST_CLIENT_ID/,
    );
    const c = loadConfig({
      ...base,
      ENABLED_SOURCES: "library,pinterest",
      PUBLIC_BASE_URL: "https://edison.example.com/",
      PINTEREST_CLIENT_ID: "id",
      PINTEREST_CLIENT_SECRET: "secret",
      PINTEREST_REDIRECT_URI: "https://edison.example.com/connect/pinterest/callback",
    });
    expect(c.pinterest?.clientId).toBe("id");
    expect(c.publicBaseUrl).toBe("https://edison.example.com");
  });

  it("requires a cost cap and API key when analysis is enabled", () => {
    expect(() => loadConfig({ ...base, ANALYSIS_ENABLED: "true" })).toThrow(/ANALYSIS_DAILY_COST_CAP/);
    const c = loadConfig({
      ...base,
      ANALYSIS_ENABLED: "true",
      ANALYSIS_DAILY_COST_CAP: "2.5",
      ANTHROPIC_API_KEY: "k",
    });
    expect(c.analysis.dailyCostCapUsd).toBe(2.5);
  });

  it("rejects unknown scopes and bad ports", () => {
    expect(() => loadConfig({ ...base, STDIO_SCOPES: "read:everything" })).toThrow(/STDIO_SCOPES/);
    expect(() => loadConfig({ ...base, PORT: "99999" })).toThrow(/PORT/);
  });

  it("insists on https in production", () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: "production", PUBLIC_BASE_URL: "http://x.example.com" }),
    ).toThrow(/https/);
  });
});

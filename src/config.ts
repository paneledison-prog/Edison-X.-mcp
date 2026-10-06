import { z } from "zod";
import { ConfigError } from "./errors.js";
import { isValidMasterKey } from "./security/crypto.js";
import { parseScopes, type Scope } from "./auth/scopes.js";

const csv = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const flag = z.enum(["true", "false"]).transform((v) => v === "true");
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  BIND_HOST: z.string().min(1).default("127.0.0.1"),
  TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  DATABASE_PATH: z.string().min(1).default("./data/edison-x.db"),
  TOKEN_ENCRYPTION_KEY: z.string().refine(isValidMasterKey, "must be 32 bytes, base64-encoded (run: pnpm gen:key)"),
  PUBLIC_BASE_URL: optionalString.pipe(z.url().optional()),
  ALLOWED_ORIGINS: z.string().default("").transform(csv),
  TRUST_PROXY: flag.default(false),
  ENABLED_SOURCES: z.string().default("library").transform(csv),
  SOURCES_REGISTER_PATH: z.string().min(1).default("./docs/SOURCES.md"),
  LIBRARY_SEED_PATH: z.string().min(1).default("./library/seed-designs.json"),
  LIBRARY_IMAGE_HOSTS: z.string().default("").transform(csv),
  STDIO_PRINCIPAL_NAME: z.string().min(1).default("local-owner"),
  STDIO_SCOPES: z.string().default("owner"),
  PINTEREST_CLIENT_ID: optionalString,
  PINTEREST_CLIENT_SECRET: optionalString,
  PINTEREST_REDIRECT_URI: optionalString.pipe(z.url().optional()),
  ANALYSIS_ENABLED: flag.default(false),
  ANALYSIS_DAILY_COST_CAP: optionalString
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().positive().optional()),
  ANALYSIS_MODEL: z.string().min(1).default("claude-opus-5-5"),
  ANALYSIS_PRICE_IN_PER_MTOK: z.coerce.number().nonnegative().default(4),
  ANALYSIS_PRICE_OUT_PER_MTOK: z.coerce.number().nonnegative().default(20),
  ANTHROPIC_API_KEY: optionalString,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_PER_DAY: z.coerce.number().int().min(1).default(1000),
  TOOL_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
  SOURCE_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
});

export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  bindHost: string;
  transport: "stdio" | "http";
  databasePath: string;
  tokenEncryptionKey: string;
  publicBaseUrl?: string;
  allowedOrigins: string[];
  trustProxy: boolean;
  enabledSources: string[];
  sourcesRegisterPath: string;
  librarySeedPath: string;
  libraryImageHosts: string[];
  stdioPrincipalName: string;
  stdioScopes: Scope[];
  pinterest?: { clientId: string; clientSecret: string; redirectUri: string };
  analysis: {
    enabled: boolean;
    dailyCostCapUsd?: number;
    model: string;
    priceInPerMTok: number;
    priceOutPerMTok: number;
    anthropicApiKey?: string;
  };
  logLevel: string;
  rateLimitPerMin: number;
  rateLimitPerDay: number;
  toolTimeoutMs: number;
  sourceTimeoutMs: number;
}

/** Validate all environment variables once at startup. Never echoes values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const problems: string[] = [];

  let stdioScopes: Scope[] = [];
  try {
    stdioScopes = parseScopes(e.STDIO_SCOPES);
  } catch {
    problems.push("STDIO_SCOPES: must be a preset (search-only, curator, owner) or a comma list of valid scopes");
  }

  let pinterest: Config["pinterest"];
  if (e.ENABLED_SOURCES.includes("pinterest")) {
    if (!e.PINTEREST_CLIENT_ID) problems.push("PINTEREST_CLIENT_ID: required when pinterest is enabled");
    if (!e.PINTEREST_CLIENT_SECRET) problems.push("PINTEREST_CLIENT_SECRET: required when pinterest is enabled");
    if (!e.PINTEREST_REDIRECT_URI) problems.push("PINTEREST_REDIRECT_URI: required when pinterest is enabled");
    if (!e.PUBLIC_BASE_URL) problems.push("PUBLIC_BASE_URL: required when pinterest is enabled");
    if (e.PINTEREST_CLIENT_ID && e.PINTEREST_CLIENT_SECRET && e.PINTEREST_REDIRECT_URI) {
      pinterest = {
        clientId: e.PINTEREST_CLIENT_ID,
        clientSecret: e.PINTEREST_CLIENT_SECRET,
        redirectUri: e.PINTEREST_REDIRECT_URI,
      };
    }
  }

  if (e.ANALYSIS_ENABLED) {
    if (e.ANALYSIS_DAILY_COST_CAP === undefined) problems.push("ANALYSIS_DAILY_COST_CAP: required when ANALYSIS_ENABLED=true");
    if (!e.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY: required when ANALYSIS_ENABLED=true");
  }
  if (e.NODE_ENV === "production" && e.PUBLIC_BASE_URL && !e.PUBLIC_BASE_URL.startsWith("https://")) {
    problems.push("PUBLIC_BASE_URL: must be https in production");
  }
  if (problems.length > 0) throw new ConfigError(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    bindHost: e.BIND_HOST,
    transport: e.TRANSPORT,
    databasePath: e.DATABASE_PATH,
    tokenEncryptionKey: e.TOKEN_ENCRYPTION_KEY,
    publicBaseUrl: e.PUBLIC_BASE_URL?.replace(/\/+$/, ""),
    allowedOrigins: e.ALLOWED_ORIGINS,
    trustProxy: e.TRUST_PROXY,
    enabledSources: e.ENABLED_SOURCES,
    sourcesRegisterPath: e.SOURCES_REGISTER_PATH,
    librarySeedPath: e.LIBRARY_SEED_PATH,
    libraryImageHosts: e.LIBRARY_IMAGE_HOSTS,
    stdioPrincipalName: e.STDIO_PRINCIPAL_NAME,
    stdioScopes,
    pinterest,
    analysis: {
      enabled: e.ANALYSIS_ENABLED,
      dailyCostCapUsd: e.ANALYSIS_DAILY_COST_CAP,
      model: e.ANALYSIS_MODEL,
      priceInPerMTok: e.ANALYSIS_PRICE_IN_PER_MTOK,
      priceOutPerMTok: e.ANALYSIS_PRICE_OUT_PER_MTOK,
      anthropicApiKey: e.ANTHROPIC_API_KEY,
    },
    logLevel: e.LOG_LEVEL,
    rateLimitPerMin: e.RATE_LIMIT_PER_MIN,
    rateLimitPerDay: e.RATE_LIMIT_PER_DAY,
    toolTimeoutMs: e.TOOL_TIMEOUT_MS,
    sourceTimeoutMs: e.SOURCE_TIMEOUT_MS,
  };
}

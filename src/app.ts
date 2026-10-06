import { existsSync } from "node:fs";
import { KeyService } from "./auth/keys.js";
import { OAuthService, type OAuthProvider } from "./auth/oauth.js";
import { PinterestConnections } from "./auth/oauth-pinterest.js";
import { createApiKeyResolver, localPrincipal, type ResolvePrincipal } from "./auth/principal.js";
import type { Config } from "./config.js";
import { AuditLog } from "./observability/audit.js";
import { createLogger, type Logger } from "./observability/logger.js";
import { Metrics } from "./observability/metrics.js";
import { deriveKey } from "./security/crypto.js";
import { BriefService } from "./services/brief.js";
import { CollectionService } from "./services/collections.js";
import { ConnectionService } from "./services/connection.js";
import type { ServiceDeps } from "./services/context.js";
import { CursorCodec } from "./services/cursor.js";
import { DesignService, type ImageFetcher } from "./services/designs.js";
import { LibraryService } from "./services/library.js";
import { SearchService } from "./services/search.js";
import { SimilarService } from "./services/similar.js";
import { SourcesInfoService } from "./services/sources-info.js";
import { importLibraryFile } from "./sources/library/import.js";
import { LibraryAdapter, LIBRARY_ID } from "./sources/library/index.js";
import { PinterestAdapter, PINTEREST_ID } from "./sources/pinterest/index.js";
import { PinterestClient, type PinterestFetch } from "./sources/pinterest/client.js";
import { loadRegisterFile, type RawEntry } from "./sources/register.js";
import { loadSources, type SourceRegistry } from "./sources/registry.js";
import type { SourceAdapter } from "./sources/types.js";
import { FtsTextScorer } from "./storage/fts-scorer.js";
import { SqliteRepository } from "./storage/sqlite.js";
import type { RunDeps } from "./tools/run.js";
import { CATEGORY_SET } from "./services/taxonomy.js";
import type { Principal } from "./auth/scopes.js";

export interface App {
  config: Config;
  logger: Logger;
  repo: SqliteRepository;
  registry: SourceRegistry;
  metrics: Metrics;
  audit: AuditLog;
  keys: KeyService;
  resolvePrincipal: ResolvePrincipal;
  oauth: OAuthService;
  connections: ConnectionService;
  runDeps: RunDeps;
  stdioPrincipal: Principal;
  close(): void;
}

export interface AppOverrides {
  logger?: Logger;
  clock?: () => Date;
  /** Extra adapters (tests and optional sources). The library adapter is always built in. */
  adapters?: SourceAdapter[];
  register?: Map<string, RawEntry>;
  oauthProviders?: Map<string, OAuthProvider>;
  imageFetcher?: ImageFetcher;
  /** Test seam: replaces the outbound HTTP used by the Pinterest client. */
  pinterestFetcher?: PinterestFetch;
  repo?: SqliteRepository;
}

/** Composition root: builds every dependency once. Nothing below this file reads global state. */
export function createApp(config: Config, overrides: AppOverrides = {}): App {
  const logger = overrides.logger ?? createLogger({ level: config.logLevel });
  const clock = overrides.clock ?? ((): Date => new Date());
  const repo = overrides.repo ?? SqliteRepository.open(config.databasePath, logger);
  const metrics = new Metrics();
  const audit = new AuditLog(repo, logger, metrics, clock);

  let register: Map<string, RawEntry>;
  if (overrides.register) register = overrides.register;
  else if (existsSync(config.sourcesRegisterPath)) register = loadRegisterFile(config.sourcesRegisterPath);
  else {
    logger.error({ path: config.sourcesRegisterPath }, "source register file not found: no source will load");
    register = new Map();
  }

  const adapters: SourceAdapter[] = [
    new LibraryAdapter(repo, config.libraryImageHosts),
    ...(overrides.adapters ?? []),
  ];
  const oauthProviders = overrides.oauthProviders ?? new Map<string, OAuthProvider>();
  let pinterestProvider: PinterestConnections | undefined;
  if (
    config.pinterest &&
    config.enabledSources.includes(PINTEREST_ID) &&
    !adapters.some((a) => a.id === PINTEREST_ID)
  ) {
    const client = new PinterestClient({ ...config.pinterest, fetcher: overrides.pinterestFetcher });
    const connections = new PinterestConnections(
      repo,
      client,
      config.pinterest,
      config.tokenEncryptionKey,
      clock,
    );
    adapters.push(new PinterestAdapter(connections, client));
    pinterestProvider = connections;
  }
  const registry = loadSources({
    enabledIds: config.enabledSources,
    adapters,
    register,
    now: clock(),
    logger,
    audit,
  });

  // A source the registry refused must not be connectable either.
  if (pinterestProvider && registry.get(PINTEREST_ID)) oauthProviders.set(PINTEREST_ID, pinterestProvider);

  const lib = registry.get(LIBRARY_ID);
  if (lib && repo.countDesigns(LIBRARY_ID) === 0 && existsSync(config.librarySeedPath)) {
    const res = importLibraryFile(config.librarySeedPath, {
      repo,
      adapter: {
        id: lib.adapter.id,
        attributionTemplate: lib.adapter.attributionTemplate,
        capabilities: lib.capabilities,
        ownerContent: true,
      },
      categories: CATEGORY_SET,
      now: clock(),
    });
    logger.info({ imported: res.imported, rejected: res.rejected.length }, "seeded the library");
  }
  repo.purgeExpired(clock());

  const deps: ServiceDeps = {
    repo,
    registry,
    scorer: new FtsTextScorer(),
    cursors: new CursorCodec(deriveKey(config.tokenEncryptionKey, "cursor")),
    audit,
    metrics,
    logger,
    clock,
    sourceTimeoutMs: config.sourceTimeoutMs,
  };
  const search = new SearchService(deps);
  const designs = new DesignService(deps, search.gateway, overrides.imageFetcher);
  const connections = new ConnectionService(deps, config.tokenEncryptionKey, config.publicBaseUrl);
  const services = {
    search,
    designs,
    similar: new SimilarService(deps, designs),
    brief: new BriefService(search),
    sourcesInfo: new SourcesInfoService(deps),
    collections: new CollectionService(deps, designs),
    library: new LibraryService(deps, () => registry.get(LIBRARY_ID)),
    connections,
  };
  const keys = new KeyService(repo, audit, clock);
  const oauth = new OAuthService(repo, audit, oauthProviders, clock);

  return {
    config,
    logger,
    repo,
    registry,
    metrics,
    audit,
    keys,
    resolvePrincipal: createApiKeyResolver(keys),
    oauth,
    connections,
    runDeps: { services, audit, metrics, logger, clock, toolTimeoutMs: config.toolTimeoutMs },
    stdioPrincipal: localPrincipal(config),
    close: () => repo.close(),
  };
}

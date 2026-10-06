import { ValidationError } from "../errors.js";
import { sha256Hex } from "../security/crypto.js";
import { hostMatches } from "../security/ssrf.js";
import { importLibraryDesigns } from "../sources/library/import.js";
import type { LoadedSource } from "../sources/registry.js";
import type { RequestContext } from "../sources/types.js";
import { canonicalUrl } from "./ranking.js";
import type { ServiceDeps } from "./context.js";

/**
 * Origins that may never enter the library. Pinterest content may only be reached through the
 * official, user-authorised adapter; it is never copied into the owner's library.
 */
export const BLOCKED_ORIGIN_HOSTS = ["pinterest.com", "pinimg.com", "pin.it"] as const;

export const ORIGINS = ["owned", "open-license", "licensed"] as const;
export type Origin = (typeof ORIGINS)[number];

export interface SubmitInput {
  title: string;
  sourceUrl: string;
  attribution: string;
  license: string;
  origin: Origin;
  originSource?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  creatorName?: string;
  creatorUrl?: string;
  platform?: string;
  category?: string;
  tags?: string[];
  palette?: string[];
  summary?: string;
  analysis?: Record<string, unknown>;
}

export class LibraryService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly library: () => LoadedSource | undefined,
    private readonly blockedHosts: readonly string[] = BLOCKED_ORIGIN_HOSTS,
    private readonly blockedSourceIds: () => string[] = () => ["pinterest"],
  ) {}

  /** Add one design to the owner's library. Rejects missing licenses and blocked origins. */
  submit(input: SubmitInput, ctx: RequestContext): { id: string; created: boolean } {
    const lib = this.library();
    if (!lib) throw new ValidationError("The library source is not enabled on this server.");
    if (!input.license.trim())
      throw new ValidationError("A license is required for every library submission.");
    if (!input.attribution.trim())
      throw new ValidationError("An attribution is required for every library submission.");

    const urls = [input.sourceUrl, input.imageUrl, input.thumbnailUrl, input.creatorUrl].filter(
      (u): u is string => !!u,
    );
    for (const u of urls) {
      let host: string;
      try {
        host = new URL(u).hostname;
      } catch {
        throw new ValidationError("One of the URLs is not a valid https URL.");
      }
      if (hostMatches(host, this.blockedHosts)) {
        throw new ValidationError("This origin is a blocked source and cannot be added to the library.");
      }
    }
    if (input.originSource && this.blockedSourceIds().includes(input.originSource.toLowerCase())) {
      throw new ValidationError("This origin is a blocked source and cannot be added to the library.");
    }

    const sourceId = `u-${sha256Hex(canonicalUrl(input.sourceUrl)).slice(0, 16)}`;
    const id = `library:${sourceId}`;
    const existed = this.deps.repo.getDesign(id, { principalId: ctx.principal.id, now: ctx.now }) !== null;
    const raw: Record<string, unknown> = {
      sourceId,
      title: input.title,
      sourceUrl: input.sourceUrl,
      attribution: input.attribution,
      license: input.license,
      imageUrl: input.imageUrl,
      thumbnailUrl: input.thumbnailUrl,
      creator: input.creatorName ? { name: input.creatorName, url: input.creatorUrl } : null,
      platform: input.platform,
      category: input.category,
      tags: input.tags ?? [],
      palette: input.palette,
      summary: input.summary,
      analysis: input.analysis,
    };
    const result = importLibraryDesigns([raw], {
      repo: this.deps.repo,
      adapter: {
        id: lib.adapter.id,
        attributionTemplate: lib.adapter.attributionTemplate,
        capabilities: lib.capabilities,
        ownerContent: true,
      },
      now: ctx.now,
      submittedBy: ctx.principal.id,
      onFlag: (e) =>
        this.deps.audit.record("sanitizer_flag", ctx.principal.id, {
          source: "library",
          field: e.field,
          rule: e.rule,
        }),
    });
    if (result.imported !== 1) {
      const reason = result.rejected[0]?.reason ?? "invalid";
      if (reason === "safety_filter")
        throw new ValidationError(
          "The submission contains instruction-like text and was rejected by the safety filter.",
        );
      throw new ValidationError(
        `The design was rejected (${reason}). Check the title, source_url and license.`,
      );
    }
    this.deps.audit.record("library_submission", ctx.principal.id, {
      id,
      origin: input.origin,
      license: input.license,
    });
    return { id, created: !existed };
  }
}

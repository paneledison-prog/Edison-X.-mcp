import { NotFoundError, SourceError, ValidationError } from "../errors.js";
import type { Design, RequestContext } from "../sources/types.js";
import type { LoadedSource } from "../sources/registry.js";
import type { ServiceDeps } from "./context.js";
import { SourceGateway } from "./gateway.js";
import { fetchAndResizeImage, type ImageResult } from "./images.js";

const ID_RE = /^([a-z0-9_-]{1,32}):([A-Za-z0-9_.-]{1,128})$/;

export interface DesignLookup {
  design: Design;
  source: LoadedSource;
}

export type ImageFetcher = typeof fetchAndResizeImage;

export class DesignService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly gateway: SourceGateway,
    private readonly imageFetcher: ImageFetcher = fetchAndResizeImage,
  ) {}

  static parseId(id: string): { source: string; sourceId: string } {
    const m = ID_RE.exec(id);
    if (!m) throw new ValidationError("The design id must look like '<source>:<id>', for example 'library:fitness-dashboard-dark'.");
    return { source: m[1] as string, sourceId: m[2] as string };
  }

  /** Stored copy first (visible to the caller only), then the source itself if it supports lookup by id. */
  async get(id: string, ctx: RequestContext): Promise<DesignLookup> {
    const { source, sourceId } = DesignService.parseId(id);
    const loaded = this.deps.registry.get(source);
    if (!loaded) throw new NotFoundError("No design with that id was found.");
    const stored = this.deps.repo.getDesign(id, { principalId: ctx.principal.id, now: ctx.now });
    if (stored) return { design: stored, source: loaded };
    if (!loaded.capabilities.canGetById) throw new NotFoundError("No design with that id was found.");
    if (loaded.capabilities.requiresUserAuth) {
      const status = await loaded.adapter.connectionStatus?.(ctx);
      if (!status?.connected) throw new SourceError(source, "not connected");
    }
    const fetched = await this.gateway.getById(loaded, sourceId, ctx);
    if (!fetched) throw new NotFoundError("No design with that id was found.");
    return { design: fetched, source: loaded };
  }

  /** Only when the register grants `canProxyImage`; otherwise explain why nothing was returned. */
  async image(lookup: DesignLookup, ctx: RequestContext): Promise<ImageResult> {
    if (!lookup.source.capabilities.canProxyImage) {
      return { note: "Image not returned: this source's terms do not allow image proxying. Use source_url to view the original." };
    }
    if (!lookup.design.imageUrl) return { note: "Image not returned: this design has no image." };
    return this.imageFetcher(lookup.design.imageUrl, lookup.source.adapter.allowedHosts, ctx.signal);
  }
}

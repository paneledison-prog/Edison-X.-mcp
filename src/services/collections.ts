import { randomBytes } from "node:crypto";
import { NotFoundError, ValidationError } from "../errors.js";
import { sanitizeText } from "../security/sanitize.js";
import type { Design, RequestContext } from "../sources/types.js";
import type { ServiceDeps } from "./context.js";
import type { DesignService } from "./designs.js";

export const MAX_COLLECTIONS_PER_PRINCIPAL = 100;
export const MAX_ITEMS_PER_COLLECTION = 500;

export interface CollectionView {
  id: string;
  name: string;
  created_at: string;
  item_count: number;
}

/** Collections belong to the principal that created them; nobody else can read or change them. */
export class CollectionService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly designs: DesignService,
  ) {}

  create(name: string, ctx: RequestContext): { id: string } {
    const clean = sanitizeText(name, "collection.name", 80);
    if (!clean)
      throw new ValidationError("The collection name is empty or was rejected by the safety filter.");
    if (this.deps.repo.listCollections(ctx.principal.id).length >= MAX_COLLECTIONS_PER_PRINCIPAL) {
      throw new ValidationError(
        `You already have ${MAX_COLLECTIONS_PER_PRINCIPAL} collections, which is the limit.`,
      );
    }
    const id = `col_${randomBytes(6).toString("hex")}`;
    this.deps.repo.createCollection({
      id,
      ownerPrincipalId: ctx.principal.id,
      name: clean,
      createdAt: ctx.now.toISOString(),
    });
    this.deps.audit.record("collection_created", ctx.principal.id, { collection: id });
    return { id };
  }

  /** Not-found and not-yours look identical so ids cannot be probed. */
  private owned(collectionId: string, ctx: RequestContext): { id: string; name: string; createdAt: string } {
    const c = this.deps.repo.getCollection(collectionId);
    if (!c || c.ownerPrincipalId !== ctx.principal.id)
      throw new NotFoundError("No collection with that id was found for you.");
    return c;
  }

  async add(
    collectionId: string,
    designId: string,
    ctx: RequestContext,
  ): Promise<{ collection_id: string; design_id: string; added: boolean; item_count: number }> {
    this.owned(collectionId, ctx);
    const { design } = await this.designs.get(designId, ctx);
    if (this.deps.repo.collectionDesignIds(collectionId).length >= MAX_ITEMS_PER_COLLECTION) {
      throw new ValidationError(`A collection can hold at most ${MAX_ITEMS_PER_COLLECTION} designs.`);
    }
    const added = this.deps.repo.addCollectionItem(collectionId, design.id, ctx.now);
    return {
      collection_id: collectionId,
      design_id: design.id,
      added,
      item_count: this.deps.repo.collectionDesignIds(collectionId).length,
    };
  }

  list(ctx: RequestContext): CollectionView[] {
    return this.deps.repo.listCollections(ctx.principal.id).map((c) => ({
      id: c.id,
      name: c.name,
      created_at: c.createdAt,
      item_count: c.itemCount,
    }));
  }

  get(
    collectionId: string,
    ctx: RequestContext,
  ): { collection: CollectionView; designs: Array<{ design: Design; canHotlink: boolean }> } {
    const c = this.owned(collectionId, ctx);
    const viewer = { principalId: ctx.principal.id, now: ctx.now };
    const hotlink = new Map(this.deps.registry.list().map((s) => [s.adapter.id, s.capabilities.canHotlink]));
    const ids = this.deps.repo.collectionDesignIds(collectionId);
    const designs = ids
      .map((id) => this.deps.repo.getDesign(id, viewer))
      .filter((d): d is Design => d !== null && hotlink.has(d.source))
      .map((design) => ({ design, canHotlink: hotlink.get(design.source) ?? false }));
    return {
      collection: { id: c.id, name: c.name, created_at: c.createdAt, item_count: ids.length },
      designs,
    };
  }
}

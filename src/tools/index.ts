import type { ZodRawShape } from "zod";
import { addToCollection } from "./add-to-collection.js";
import { createCollection } from "./create-collection.js";
import { findSimilarDesigns } from "./find-similar-designs.js";
import { getCollection } from "./get-collection.js";
import { getConnectionStatus } from "./get-connection-status.js";
import { getDesign } from "./get-design.js";
import { getInspirationBrief } from "./get-inspiration-brief.js";
import { listCollections } from "./list-collections.js";
import { listSources } from "./list-sources.js";
import { listTaxonomy } from "./list-taxonomy.js";
import { searchInspiration } from "./search-inspiration.js";
import { submitDesign } from "./submit-design.js";
import type { ToolDefinition } from "./types.js";

/**
 * The public tool contract (Guidelines section 6). Names are permanent; add tools only with owner approval.
 */
export const ALL_TOOLS = [
  searchInspiration,
  getDesign,
  findSimilarDesigns,
  getInspirationBrief,
  listTaxonomy,
  listSources,
  createCollection,
  addToCollection,
  listCollections,
  getCollection,
  submitDesign,
  getConnectionStatus,
] as unknown as ReadonlyArray<ToolDefinition<ZodRawShape>>;

export const TOOL_NAMES = ALL_TOOLS.map((t) => t.name);

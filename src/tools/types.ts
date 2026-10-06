import type { z, ZodRawShape } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Scope } from "../auth/scopes.js";
import type { RequestContext } from "../sources/types.js";
import type { BriefService } from "../services/brief.js";
import type { CollectionService } from "../services/collections.js";
import type { ConnectionService } from "../services/connection.js";
import type { DesignService } from "../services/designs.js";
import type { LibraryService } from "../services/library.js";
import type { SearchService } from "../services/search.js";
import type { SimilarService } from "../services/similar.js";
import type { SourcesInfoService } from "../services/sources-info.js";

export interface ToolServices {
  search: SearchService;
  designs: DesignService;
  similar: SimilarService;
  brief: BriefService;
  sourcesInfo: SourcesInfoService;
  collections: CollectionService;
  library: LibraryService;
  connections: ConnectionService;
}

export interface ToolContext extends RequestContext {
  services: ToolServices;
}

export type ImageBlock = { type: "image"; data: string; mimeType: string };

export interface ToolOutput {
  /** Becomes both the JSON text content and `structuredContent`. */
  data: Record<string, unknown>;
  /** Extra MCP content blocks (images). Not counted against the JSON size cap. */
  extraContent?: ImageBlock[];
}

/** One tool = one file exporting one definition (Rules/03-mcp-protocol.md). */
export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  title: string;
  /** Written for an AI reader: what it does, when to call it, what it returns, what it will not do. */
  description: string;
  scope: Scope;
  inputSchema: Shape;
  outputSchema: z.ZodObject<ZodRawShape>;
  annotations: ToolAnnotations;
  handler(args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext): Promise<ToolOutput>;
}

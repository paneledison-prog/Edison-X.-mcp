import type { Design, RequestContext } from "../sources/types.js";
import type { ServiceDeps } from "./context.js";
import type { DesignService } from "./designs.js";
import { colorCloseness, dedupeBySourceUrl, parseColor } from "./ranking.js";

export interface SimilarOutcome {
  ranked: Array<{ design: Design; score: number; canHotlink: boolean }>;
  sourcesQueried: string[];
  totalEstimate: number;
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function palettePairCloseness(a: string[] | undefined, b: string[] | undefined): number {
  if (!a?.length || !b?.length) return 0;
  const bc = b.map((c) => parseColor(c) ?? [0, 0, 0]);
  const per = a.map((c) => {
    const ac = parseColor(c) ?? [0, 0, 0];
    return Math.max(...bc.map((x) => colorCloseness(ac, x as [number, number, number])));
  });
  return per.reduce((s, x) => s + x, 0) / per.length;
}

export const SIMILARITY_WEIGHTS = {
  category: 0.35,
  platform: 0.1,
  tags: 0.3,
  palette: 0.1,
  components: 0.15,
} as const;

/** Deterministic similarity from shared category, tags, platform, palette closeness and components. */
export function similarity(seed: Design, d: Design): number {
  const w = SIMILARITY_WEIGHTS;
  let s = 0;
  if (seed.category && seed.category === d.category) s += w.category;
  if (seed.platform !== "unknown" && seed.platform === d.platform) s += w.platform;
  s += w.tags * jaccard(seed.tags, d.tags);
  s += w.palette * palettePairCloseness(seed.palette, d.palette);
  if (seed.analysis && d.analysis)
    s += w.components * jaccard(seed.analysis.components, d.analysis.components);
  return Math.round(s * 1e9) / 1e9;
}

export class SimilarService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly designs: DesignService,
  ) {}

  async find(
    id: string,
    limit: number,
    sameSourceOnly: boolean,
    ctx: RequestContext,
  ): Promise<SimilarOutcome> {
    const { design: seed } = await this.designs.get(id, ctx);
    const loaded = this.deps.registry.ids();
    const sources = sameSourceOnly ? [seed.source] : loaded;
    const candidates = this.deps.repo
      .similarityCandidates(seed, {
        sources,
        limit: 100,
        viewer: { principalId: ctx.principal.id, now: ctx.now },
      })
      .filter((d) => loaded.includes(d.source));
    const scored = dedupeBySourceUrl(
      candidates.map((design) => ({ design, score: similarity(seed, design) })),
    )
      .filter((c) => c.score > 0 && c.design.id !== seed.id)
      .sort((a, b) => b.score - a.score || a.design.id.localeCompare(b.design.id));
    const hotlink = new Map(this.deps.registry.list().map((s) => [s.adapter.id, s.capabilities.canHotlink]));
    return {
      ranked: scored
        .slice(0, limit)
        .map((s) => ({ ...s, canHotlink: hotlink.get(s.design.source) ?? false })),
      sourcesQueried: [...sources].sort(),
      totalEstimate: scored.length,
    };
  }
}

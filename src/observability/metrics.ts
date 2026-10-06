/** Minimal in-process metrics with a Prometheus text exporter. */

type Labels = Record<string, string>;

function key(name: string, labels: Labels): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v.replace(/[\\"\n]/g, "_")}"`);
  return parts.length ? `${name}{${parts.join(",")}}` : name;
}

export class Metrics {
  private counters = new Map<string, number>();
  private sums = new Map<string, { count: number; sum: number }>();

  inc(name: string, labels: Labels = {}, by = 1): void {
    const k = key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    const k = key(name, labels);
    const cur = this.sums.get(k) ?? { count: 0, sum: 0 };
    cur.count += 1;
    cur.sum += value;
    this.sums.set(k, cur);
  }

  get(name: string, labels: Labels = {}): number {
    return this.counters.get(key(name, labels)) ?? 0;
  }

  snapshot(): {
    counters: Record<string, number>;
    summaries: Record<string, { count: number; sum: number }>;
  } {
    return { counters: Object.fromEntries(this.counters), summaries: Object.fromEntries(this.sums) };
  }

  /** Prometheus exposition format. */
  render(): string {
    const lines: string[] = [];
    for (const [k, v] of [...this.counters].sort(([a], [b]) => a.localeCompare(b))) lines.push(`${k} ${v}`);
    for (const [k, v] of [...this.sums].sort(([a], [b]) => a.localeCompare(b))) {
      const idx = k.indexOf("{");
      const base = idx === -1 ? k : k.slice(0, idx);
      const lbl = idx === -1 ? "" : k.slice(idx);
      lines.push(`${base}_count${lbl} ${v.count}`, `${base}_sum${lbl} ${v.sum}`);
    }
    return lines.join("\n") + "\n";
  }
}

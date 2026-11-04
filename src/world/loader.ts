/** Streaming fetches with byte-based progress. */
import type { LoadProgress } from '../app/contracts';
import { type MapMeta, isMapMeta } from '../shared/mapFormat';

export type ProgressFn = (p: LoadProgress) => void;

export class ProgressTracker {
  private loaded = new Map<string, number>();
  constructor(
    private totals: Map<string, number>,
    private cb?: ProgressFn,
  ) {}
  report(name: string, loaded: number, label: string) {
    const total = this.totals.get(name) ?? loaded;
    // A host that inflates .gz in transit reports more bytes than the listed size; clamp.
    this.loaded.set(name, Math.min(loaded, total));
    let l = 0;
    let t = 0;
    for (const [k, v] of this.totals) {
      t += v;
      l += this.loaded.get(k) ?? 0;
    }
    this.cb?.({ loadedBytes: l, totalBytes: t, label });
  }
  done(name: string, label: string) {
    this.report(name, this.totals.get(name) ?? 0, label);
  }
}

export async function fetchMeta(baseUrl: string): Promise<MapMeta> {
  const res = await fetch(`${baseUrl}meta.json`);
  if (!res.ok) throw new Error(`meta.json: HTTP ${res.status}`);
  const meta: unknown = await res.json();
  if (!isMapMeta(meta)) throw new Error('meta.json is not a valid map description');
  return meta;
}

/** Fetch a file, counting bytes as they stream in. */
export async function fetchBytes(url: string, onBytes: (loaded: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes(buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    onBytes(n);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

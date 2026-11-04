/** LINZ Auckland 2024 LiDAR: STAC discovery, tile selection, checksum-verified download. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LINZ, WORLD } from '../config';
import { lonLatToNztm } from '../lib/geo';
import { parseMultihashSha256 } from '../lib/multihash';
import { RAW_LINZ, STAC_DIR, ensure } from '../lib/paths';

export interface LinzTile {
  kind: 'dem' | 'dsm';
  id: string;
  file: string;
  url: string;
  checksum: string;
}

let networkRequests = 0;
export function linzNetworkRequests() {
  return networkRequests;
}

async function cachedJson(url: string, cacheName: string, refresh: boolean): Promise<any> {
  const path = resolve(STAC_DIR, cacheName);
  if (!refresh && existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  networkRequests++;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  const text = await res.text();
  ensure(STAC_DIR);
  writeFileSync(path, text);
  return JSON.parse(text);
}

function intersectsWorld(geom: { type: string; coordinates: number[][][] }, margin: number): boolean {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const [lon, lat] of geom.coordinates[0]) {
    const [e, n] = lonLatToNztm(lon, lat);
    minE = Math.min(minE, e); maxE = Math.max(maxE, e);
    minN = Math.min(minN, n); maxN = Math.max(maxN, n);
  }
  return (
    maxE > WORLD.minE - margin && minE < WORLD.maxE + margin && maxN > WORLD.minN - margin && minN < WORLD.maxN + margin
  );
}

export async function discoverTiles(refresh: boolean): Promise<LinzTile[]> {
  const tiles: LinzTile[] = [];
  for (const col of LINZ.collections) {
    const kind = col.includes('/dem_') ? 'dem' : 'dsm';
    const part = col.split('/')[1];
    const base = `${LINZ.bucket}/${col}`;
    const collection = await cachedJson(`${base}/collection.json`, `${part}.${kind}.collection.json`, refresh);
    const items = (collection.links as any[]).filter((l) => l.rel === 'item');
    for (const link of items) {
      const name = String(link.href).replace(/^\.\//, '');
      const item = await cachedJson(`${base}/${name}`, `${part}.${kind}.${name}`, refresh);
      // The world rectangle sits exactly on tile edges, so +100 m would also pull in the four neighbours;
      // a -1 m margin keeps only tiles that genuinely overlap it (tile corners are rounded to ~1 cm).
      if (!intersectsWorld(item.geometry, -1)) continue;
      const asset = item.assets.visual ?? Object.values(item.assets)[0];
      const file = String(asset.href).replace(/^\.\//, '');
      tiles.push({
        kind,
        id: item.id,
        file,
        url: `${base}/${file}`,
        checksum: parseMultihashSha256(asset['file:checksum']),
      });
    }
  }
  const got = tiles.map((t) => `${t.kind}:${t.id}`).sort();
  const want = (['dem', 'dsm'] as const).flatMap((k) => LINZ.expectedTiles.map((id) => `${k}:${id}`)).sort();
  if (got.join() !== want.join()) {
    throw new Error(`LINZ tile set differs from expected.\n got:  ${got.join(' ')}\n want: ${want.join(' ')}`);
  }
  return tiles;
}

export function tilePath(t: Pick<LinzTile, 'kind' | 'file'>): string {
  return resolve(RAW_LINZ, t.kind, t.file);
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

export async function fetchLinz(refresh: boolean): Promise<void> {
  const tiles = await discoverTiles(refresh);
  console.log(`linz: ${tiles.length} tiles selected (${LINZ.expectedTiles.join(', ')} x dem/dsm)`);
  ensure(resolve(RAW_LINZ, 'dem'));
  ensure(resolve(RAW_LINZ, 'dsm'));
  for (const t of tiles) {
    const dest = tilePath(t);
    if (!refresh && existsSync(dest)) {
      console.log(`linz: cached ${t.kind}/${t.file} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
      continue;
    }
    const part = `${dest}.part`;
    console.log(`linz: downloading ${t.kind}/${t.file}`);
    networkRequests++;
    const res = await fetch(t.url);
    if (!res.ok || !res.body) throw new Error(`GET ${t.url}: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(part));
    const sum = await sha256File(part);
    if (sum !== t.checksum) {
      unlinkSync(part);
      throw new Error(`Checksum mismatch for ${t.file}: got ${sum}, want ${t.checksum}`);
    }
    renameSync(part, dest);
    console.log(`linz: verified ${t.file} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
  }
}

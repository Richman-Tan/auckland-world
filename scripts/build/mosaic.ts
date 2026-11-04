/**
 * DEM / DSM mosaics: Float32 at 1 m covering the world rectangle (7200 x 8000). Row 0 is N = maxN,
 * column 0 is E = minE; nodata becomes NaN. Nothing at full resolution is written to disk.
 *
 * LERC decode path: geotiff@2.1.3's built-in LERC decoder (TIFF compression 34887) works as is.
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromFile } from 'geotiff';
import { WORLD } from '../config';
import { RAW_LINZ } from '../lib/paths';

export const MW = WORLD.maxE - WORLD.minE; // 7200
export const MH = WORLD.maxN - WORLD.minN; // 8000

export interface Mosaic {
  data: Float32Array;
  w: number;
  h: number;
}

const cache = new Map<string, Mosaic>();

export async function loadMosaic(kind: 'dem' | 'dsm'): Promise<Mosaic> {
  const hit = cache.get(kind);
  if (hit) return hit;
  const data = new Float32Array(MW * MH).fill(NaN);
  const dir = resolve(RAW_LINZ, kind);
  const files = readdirSync(dir).filter((f) => f.endsWith('.tiff'));
  for (const f of files) {
    const tiff = await fromFile(resolve(dir, f));
    const img = await tiff.getImage();
    const [oE, oN] = img.getOrigin();
    const [resX, resY] = img.getResolution();
    if (Math.abs(resX - 1) > 1e-9 || Math.abs(resY + 1) > 1e-9) throw new Error(`${f}: expected 1 m pixels`);
    const nodata = img.getGDALNoData() ?? -9999;
    // Overlap in tile pixel space.
    const c0 = Math.max(0, WORLD.minE - oE);
    const c1 = Math.min(img.getWidth(), WORLD.maxE - oE);
    const r0 = Math.max(0, oN - WORLD.maxN);
    const r1 = Math.min(img.getHeight(), oN - WORLD.minN);
    if (c1 <= c0 || r1 <= r0) continue;
    const STRIP = 1024;
    for (let r = r0; r < r1; r += STRIP) {
      const rEnd = Math.min(r1, r + STRIP);
      const out = (await img.readRasters({ window: [c0, r, c1, rEnd], interleave: false })) as unknown as Float32Array[];
      const band = out[0];
      const ww = c1 - c0;
      for (let rr = r; rr < rEnd; rr++) {
        const dstRow = WORLD.maxN - oN + rr; // mosaic row for tile row rr
        if (dstRow < 0 || dstRow >= MH) continue;
        const dstCol = oE + c0 - WORLD.minE;
        const src = (rr - r) * ww;
        for (let k = 0; k < ww; k++) {
          const v = band[src + k];
          data[dstRow * MW + dstCol + k] = v === nodata || !Number.isFinite(v) ? NaN : v;
        }
      }
    }
  }
  const m = { data, w: MW, h: MH };
  cache.set(kind, m);
  return m;
}

/** Mosaic pixel centre in local metres. */
export const pxX = (c: number) => WORLD.minE - WORLD.originE + c + 0.5;
export const pxZ = (r: number) => -(WORLD.maxN - r - 0.5 - WORLD.originN);

/** Local (x, z) -> mosaic (col, row), fractional. */
export function toPx(x: number, z: number): [number, number] {
  return [x - (WORLD.minE - WORLD.originE), z - -(WORLD.maxN - WORLD.originN)];
}

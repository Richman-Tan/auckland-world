/** 512 px opaque minimap: sea, land, parks, primary-and-up roads, coastline. */
import { createCanvas } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { GROUND, hexToRgb } from '../../src/shared/palette';
import { BOUNDS, MINIMAP_WIDTH, PUBLIC_MAP_DIR } from '../config';
import { writeFile } from '../lib/io';
import { areaFeatures, drawRoads } from './ground';
import { coastlines, isSea, loadWater } from './water';
import { polyPath } from './ground';

export async function buildMinimap() {
  const w = MINIMAP_WIDTH;
  const mpp = (BOUNDS.maxX - BOUNDS.minX) / w;
  const h = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / mpp);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = GROUND.land;
  ctx.fillRect(0, 0, w, h);
  // Parks, pitches, woods and scrub (layers 3 and 4).
  for (const f of areaFeatures()) {
    if (f.layer !== 3 && f.layer !== 4) continue;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    for (const p of f.polys) polyPath(ctx, p.rings, mpp);
    ctx.fill('evenodd');
  }
  drawRoads(ctx, mpp, 'primary', false);

  // Sea over everything, from the 1.5 m mask.
  const { mask } = loadWater();
  const img = ctx.getImageData(0, 0, w, h);
  const [sr, sg, sb] = hexToRgb(GROUND.minimapSea).map((v) => Math.round(v * 255));
  const sea = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      // Vote over a 3x3 sample of the cell.
      let wet = 0;
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
        if (isSea(mask, BOUNDS.minX + (c + (dx + 0.5) / 3) * mpp, BOUNDS.minZ + (r + (dy + 0.5) / 3) * mpp)) wet++;
      }
      const i = r * w + c;
      sea[i] = wet >= 5 ? 1 : 0;
      if (sea[i]) {
        img.data[i * 4] = sr; img.data[i * 4 + 1] = sg; img.data[i * 4 + 2] = sb; img.data[i * 4 + 3] = 255;
      } else img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Coastline.
  ctx.strokeStyle = '#2b3a3a';
  ctx.lineWidth = 0.9;
  for (const l of coastlines()) {
    ctx.beginPath();
    for (let i = 0; i < l.length; i += 2) {
      const X = (l[i] - BOUNDS.minX) / mpp, Y = (l[i + 1] - BOUNDS.minZ) / mpp;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }
  let q = 85;
  let enc = await canvas.encode('webp', q);
  while (enc.byteLength > 90 * 1024 && q > 40) { q -= 5; enc = await canvas.encode('webp', q); }
  const entry = writeFile(resolve(PUBLIC_MAP_DIR, 'minimap.webp'), enc);
  console.log(`minimap: ${w}x${h} q${q} ${(entry.bytes / 1024).toFixed(0)} KB`);
  return { width: w, height: h };
}

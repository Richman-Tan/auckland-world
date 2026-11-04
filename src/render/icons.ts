/** 16x16 pixel icons for the beacons, drawn in code (no image assets). */
import { CanvasTexture, NearestFilter, type Texture } from 'three';
import type { StopPlacement } from '../app/contracts';
import { ACCENTS, type PaletteKey } from '../shared/palette';

export type IconName = StopPlacement['icon'];
const SIZE = 16;
const OUTLINE = '#0f1c24';
const LIGHT = '#fff7e0';

type Mask = Uint8Array; // 0 empty, 1 accent, 2 light

function set(m: Mask, x: number, y: number, v: number) {
  if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) m[y * SIZE + x] = v;
}
function rect(m: Mask, x0: number, y0: number, x1: number, y1: number, v = 1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(m, x, y, v);
}
/** Bresenham, 2 px wide (horizontal neighbour). */
function line(m: Mask, x0: number, y0: number, x1: number, y1: number, v = 1) {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    set(m, x0, y0, v);
    set(m, x0 + 1, y0, v);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawGlyph(name: IconName): Mask {
  const m: Mask = new Uint8Array(SIZE * SIZE);
  switch (name) {
    case 'code': {
      line(m, 5, 4, 2, 8);
      line(m, 2, 8, 5, 12);
      line(m, 10, 4, 12, 8);
      line(m, 12, 8, 10, 12);
      line(m, 9, 3, 6, 13, 2);
      break;
    }
    case 'briefcase': {
      rect(m, 5, 2, 10, 3);
      rect(m, 5, 4, 6, 5);
      rect(m, 9, 4, 10, 5);
      rect(m, 1, 6, 14, 13);
      rect(m, 1, 9, 14, 9, 0);
      rect(m, 7, 8, 8, 10, 2);
      break;
    }
    case 'cap': {
      // mortarboard: diamond top, bowl below, tassel
      for (let i = 0; i <= 3; i++) rect(m, 7 - i * 2, 3 + i, 8 + i * 2, 3 + i);
      for (let i = 0; i <= 2; i++) rect(m, 3 + i * 2, 7 + i, 12 - i * 2, 7 + i);
      rect(m, 4, 10, 11, 12);
      rect(m, 4, 9, 5, 9);
      rect(m, 10, 9, 11, 9);
      rect(m, 14, 6, 14, 11, 2);
      rect(m, 13, 12, 14, 13, 2);
      rect(m, 7, 5, 8, 6, 2);
      break;
    }
    case 'chat': {
      rect(m, 2, 2, 13, 10);
      rect(m, 1, 3, 1, 9);
      rect(m, 14, 3, 14, 9);
      rect(m, 3, 11, 12, 11);
      rect(m, 4, 12, 6, 12);
      rect(m, 4, 13, 5, 13);
      rect(m, 3, 14, 4, 14);
      set(m, 4, 6, 0);
      set(m, 7, 6, 0);
      set(m, 8, 6, 0);
      set(m, 11, 6, 0);
      break;
    }
    case 'peak': {
      for (let y = 2; y <= 13; y++) {
        const hw = Math.floor((y - 2) * 0.65);
        rect(m, 6 - hw, y, 6 + hw, y);
      }
      for (let y = 7; y <= 13; y++) {
        const hw = Math.floor((y - 7) * 0.7);
        rect(m, 12 - hw, y, Math.min(14, 12 + hw), y);
      }
      rect(m, 5, 2, 7, 2, 2);
      rect(m, 4, 3, 8, 4, 2);
      rect(m, 3, 5, 4, 5, 2);
      rect(m, 8, 5, 9, 5, 2);
      break;
    }
  }
  return m;
}

/** Draw an icon into a fresh 16x16 canvas: accent fill, light highlights, dark 1 px outline. */
export function drawIconCanvas(name: IconName, color: PaletteKey): HTMLCanvasElement {
  const mask = drawGlyph(name);
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return c;
  const img = g.createImageData(SIZE, SIZE);
  const fill = hexRgb(ACCENTS[color]);
  const light = hexRgb(LIGHT);
  const out = hexRgb(OUTLINE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = mask[y * SIZE + x];
      let rgb: [number, number, number] | null = null;
      if (v === 1) rgb = fill;
      else if (v === 2) rgb = light;
      else {
        for (let dy = -1; dy <= 1 && !rgb; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < SIZE && yy < SIZE && mask[yy * SIZE + xx] !== 0) {
              rgb = out;
              break;
            }
          }
      }
      if (rgb) {
        const o = (y * SIZE + x) * 4;
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createIconTexture(name: IconName, color: PaletteKey): Texture {
  const tex = new CanvasTexture(drawIconCanvas(name, color));
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

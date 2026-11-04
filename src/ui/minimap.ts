/** Minimap geometry and drawing for the nav overlay and the heading-up radar. */
import type { StopPlacement, UiWorld } from '../app/contracts';
import { ACCENTS } from '../shared/palette';

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** World (x east, z south) to minimap pixels. The minimap covers bounds exactly, north up. */
export function worldToMap(b: Bounds, w: number, h: number, x: number, z: number): { x: number; y: number } {
  return { x: ((x - b.minX) / (b.maxX - b.minX)) * w, y: ((z - b.minZ) / (b.maxZ - b.minZ)) * h };
}

/** Inverse of worldToMap. */
export function mapToWorld(b: Bounds, w: number, h: number, px: number, py: number): { x: number; z: number } {
  return { x: b.minX + (px / w) * (b.maxX - b.minX), z: b.minZ + (py / h) * (b.maxZ - b.minZ) };
}

/**
 * Position of a world point on a heading-up radar centred on the plane.
 * Returns pixels relative to the radar centre (y down), and whether it is outside the range.
 */
export function radarPoint(
  plane: { x: number; z: number; headingRad: number },
  x: number,
  z: number,
  rangeM: number,
  radiusPx: number,
): { x: number; y: number; clamped: boolean } {
  const dx = x - plane.x;
  const dz = z - plane.z;
  // Rotate so the nose points up: rotate by -heading (canvas rotate is clockwise-positive).
  const c = Math.cos(-plane.headingRad);
  const s = Math.sin(-plane.headingRad);
  let rx = dx * c - dz * s;
  let ry = dx * s + dz * c;
  const scale = radiusPx / rangeM;
  rx *= scale;
  ry *= scale;
  const d = Math.hypot(rx, ry);
  const lim = radiusPx - 3;
  if (d > lim) return { x: (rx / d) * lim, y: (ry / d) * lim, clamped: true };
  return { x: rx, y: ry, clamped: false };
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

export function accentOf(s: StopPlacement): string {
  return ACCENTS[s.color];
}

const FONT = '11px "Departure Mono", ui-monospace, monospace';

/** Full-map view for the nav overlay. */
export function drawNavMap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  img: HTMLImageElement | null,
  world: UiWorld,
  plane: { x: number; z: number; headingRad: number } | null,
  selected: string | null,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1f6f78';
  ctx.fillRect(0, 0, w, h);
  if (img) ctx.drawImage(img, 0, 0, w, h);
  const b = world.meta.bounds;
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  for (const s of world.stops) {
    const p = worldToMap(b, w, h, s.x, s.z);
    const col = accentOf(s);
    const sel = s.id === selected;
    if (sel) {
      ctx.strokeStyle = '#f4ecd8';
      ctx.lineWidth = 3;
      ctx.strokeRect(Math.round(p.x) - 13, Math.round(p.y) - 13, 26, 26);
    }
    ctx.fillStyle = '#0b1c20';
    ctx.fillRect(Math.round(p.x) - 10, Math.round(p.y) - 10, 20, 20);
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(p.x) - 8, Math.round(p.y) - 8, 16, 16);
    ctx.fillStyle = '#0b1c20';
    ctx.textAlign = 'center';
    ctx.fillText(String(s.hotkey), Math.round(p.x), Math.round(p.y) + 1);
    ctx.textAlign = p.x > w * 0.62 ? 'right' : 'left';
    const lx = p.x > w * 0.62 ? p.x - 16 : p.x + 16;
    const text = s.label;
    ctx.fillStyle = 'rgba(11,28,32,.85)';
    const tw = ctx.measureText(text).width;
    ctx.fillRect(ctx.textAlign === 'left' ? lx - 3 : lx - tw - 3, p.y - 8, tw + 6, 16);
    ctx.fillStyle = '#f4ecd8';
    ctx.fillText(text, lx, p.y + 1);
  }
  if (plane) {
    const p = worldToMap(b, w, h, plane.x, plane.z);
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.rotate(plane.headingRad);
    ctx.fillStyle = '#0b1c20';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 5);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4ecd8';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** Heading-up circular radar. `size` is the canvas edge in px. */
export function drawRadar(
  ctx: CanvasRenderingContext2D,
  size: number,
  img: HTMLImageElement | null,
  world: UiWorld | null,
  plane: { x: number; z: number; headingRad: number },
  rangeM: number,
): void {
  const r = size / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#0b2a2e';
  ctx.fillRect(0, 0, size, size);
  if (!world || !img) {
    ctx.fillStyle = 'rgba(244,236,216,.6)';
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NO MAP', r, r + 14);
  } else {
    const b = world.meta.bounds;
    const s = r / rangeM;
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(-plane.headingRad);
    ctx.drawImage(img, (b.minX - plane.x) * s, (b.minZ - plane.z) * s, (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    ctx.restore();
    ctx.fillStyle = 'rgba(9,27,31,.25)';
    ctx.fillRect(0, 0, size, size);
    for (const st of world.stops) {
      const p = radarPoint(plane, st.x, st.z, rangeM, r);
      const x = Math.round(r + p.x);
      const y = Math.round(r + p.y);
      const sz = p.clamped ? 4 : 6;
      ctx.fillStyle = '#0b1c20';
      ctx.fillRect(x - sz / 2 - 1, y - sz / 2 - 1, sz + 2, sz + 2);
      ctx.fillStyle = accentOf(st);
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
  }
  ctx.restore();
  // range ring and plane
  ctx.strokeStyle = 'rgba(244,236,216,.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(r, r, r / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4ecd8';
  ctx.beginPath();
  ctx.moveTo(r, r - 6);
  ctx.lineTo(r + 4, r + 4);
  ctx.lineTo(r, r + 2);
  ctx.lineTo(r - 4, r + 4);
  ctx.closePath();
  ctx.fill();
}

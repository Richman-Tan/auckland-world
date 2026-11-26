/**
 * A tiny low-poly mesh builder for the landmarks. Triangles are non-indexed with a per-vertex
 * colour (Uint8 RGBA, normalised) and are wound to face away from a reference point, so the
 * shaders can derive flat normals from screen-space derivatives and still cull back faces.
 */
import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';

export type V3 = [number, number, number];

/**
 * What a face is, carried in the vertex colour's alpha for the landmark shader (render/materials.ts).
 * By day the last two are shaded like any other face; at night they light up.
 */
export const ALPHA_NORMAL = 255;
/** The blinking red aircraft light. */
export const ALPHA_BLINK = 128;
/** A band of windows: warm glow at night. */
export const ALPHA_WINDOW = 176;
/** A floodlit face: shown in its own light at night. */
export const ALPHA_FLOOD = 208;

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  /** Add a triangle facing away from `ref`. `alpha` 255 = normal, ~128 = blinking light. */
  tri(a: V3, b: V3, c: V3, ref: V3, color: string, alpha = 255) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const cx = (a[0] + b[0] + c[0]) / 3 - ref[0];
    const cy = (a[1] + b[1] + c[1]) / 3 - ref[1];
    const cz = (a[2] + b[2] + c[2]) / 3 - ref[2];
    if (nx * cx + ny * cy + nz * cz < 0) {
      const t = b;
      b = c;
      c = t;
    }
    const [r, g, bl] = hexRgb(color);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(r, g, bl, alpha);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, ref: V3, color: string, alpha = 255) {
    this.tri(a, b, c, ref, color, alpha);
    this.tri(a, c, d, ref, color, alpha);
  }

  /** Vertical (optionally tapered) prism around the y axis with `sides` sides; side colours may alternate. */
  frustum(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, sides: number, color: string, opts: { capTop?: boolean; capBottom?: boolean; color2?: string; alpha?: number } = {}) {
    const alpha = opts.alpha ?? ALPHA_NORMAL;
    const ym = (y0 + y1) / 2;
    const ref: V3 = [cx, ym, cz];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const b0: V3 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0];
      const b1: V3 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const t0: V3 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1];
      const t1: V3 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      const c = opts.color2 && i % 2 === 1 ? opts.color2 : color;
      this.quad(b0, b1, t1, t0, ref, c, alpha);
      if (opts.capTop) this.tri(t0, t1, [cx, y1, cz], ref, color, alpha);
      if (opts.capBottom) this.tri(b0, b1, [cx, y0, cz], ref, color, alpha);
    }
  }

  /** A box from its 8 corners: 0-3 round the bottom, 4-7 round the top, in the same order. */
  hexahedron(c: V3[], color: string, topColor = color, alpha = ALPHA_NORMAL) {
    const ref: V3 = [0, 0, 0];
    for (const p of c) {
      ref[0] += p[0] / 8;
      ref[1] += p[1] / 8;
      ref[2] += p[2] / 8;
    }
    // corners 0-3 bottom, 4-7 top, in loop order
    this.quad(c[4], c[5], c[6], c[7], ref, topColor, alpha);
    this.quad(c[0], c[1], c[2], c[3], ref, color, alpha);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(c[i], c[j], c[j + 4], c[i + 4], ref, color, alpha);
    }
  }

  /** A square-section beam from p0 to p1; `side` is a horizontal-ish hint for the section's width axis. */
  beam(p0: V3, p1: V3, w: number, h: number, color: string, side: V3 = [0, 0, 1], alpha = ALPHA_NORMAL) {
    const d = new Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    const s = new Vector3(side[0], side[1], side[2]);
    s.addScaledVector(d, -s.dot(d));
    if (s.lengthSq() < 1e-6) s.set(0, 1, 0).addScaledVector(d, -d.y);
    s.normalize();
    const u = new Vector3().crossVectors(d, s).normalize();
    const corner = (p: V3, a: number, b: number): V3 => [
      p[0] + s.x * a * w * 0.5 + u.x * b * h * 0.5,
      p[1] + s.y * a * w * 0.5 + u.y * b * h * 0.5,
      p[2] + s.z * a * w * 0.5 + u.z * b * h * 0.5,
    ];
    const ring = (p: V3): V3[] => [corner(p, -1, -1), corner(p, 1, -1), corner(p, 1, 1), corner(p, -1, 1)];
    const a = ring(p0);
    const b = ring(p1);
    this.hexahedron([...a, ...b], color, color, alpha);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('aColor', new BufferAttribute(new Uint8Array(this.col), 4, true));
    g.boundingSphere = computeSphere(this.pos);
    return g;
  }
}

function computeSphere(pos: number[]): Sphere {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < pos.length; i += 3) {
    min.x = Math.min(min.x, pos[i]);
    min.y = Math.min(min.y, pos[i + 1]);
    min.z = Math.min(min.z, pos[i + 2]);
    max.x = Math.max(max.x, pos[i]);
    max.y = Math.max(max.y, pos[i + 1]);
    max.z = Math.max(max.z, pos[i + 2]);
  }
  const c = min.clone().add(max).multiplyScalar(0.5);
  let r2 = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const dx = pos[i] - c.x, dy = pos[i + 1] - c.y, dz = pos[i + 2] - c.z;
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  return new Sphere(c, Math.sqrt(r2));
}

/**
 * The Sky Deck interior: a 12-sided ring between the core and the windows, inside the Sky Tower pod.
 * Only shown while visiting (WorldScene.setInterior). From inside, the pod's outward-facing skin is
 * back-face culled, so the windows look straight out at the real city.
 */
import type { BufferGeometry } from 'three';
import { LIFT_SIGN, PLATE, SKY_DECK as D, SKY_DECK_SPOTS, facetAngle } from '../../room/layout';
import type { MapMeta } from '../../shared/mapFormat';
import { MeshBuilder, type V3 } from './builder';

const CARPET = '#3f3634';
const CARPET_EDGE = '#5b4e47';
const CEILING = '#d9d1c2';
const CORE = '#cfc8b8';
const BASEBOARD = '#7d776c';
const FRAME = '#2b2f33';
const RAIL = '#c9c1b1';
const BEZEL = '#15181b';
const LIFT = '#9aa3a8';
const LIFT_FRAME = '#5d646a';
const WOOD = '#8a6a4a';

export function buildSkyDeck(meta: MapMeta): BufferGeometry {
  const { x: cx, z: cz, groundY } = meta.landmarks.skyTower;
  const F = groundY + D.floor;
  const T = F + D.height;
  const n = D.sides;
  const b = new MeshBuilder();
  const at = (r: number, phi: number, y: number): V3 => [cx + Math.cos(phi) * r, y, cz + Math.sin(phi) * r];
  const vert = (i: number) => (i / n) * Math.PI * 2;

  // Floor: an inner walkway ring and carpet out to a lighter strip by the windows (all facing up).
  const rings: [number, number, string][] = [
    [D.coreRadius, D.coreRadius + 1.4, CARPET_EDGE],
    [D.coreRadius + 1.4, D.windowRadius - 1.1, CARPET],
    [D.windowRadius - 1.1, D.windowRadius, CARPET_EDGE],
  ];
  for (const [r0, r1, c] of rings) {
    for (let i = 0; i < n; i++) {
      const a0 = vert(i);
      const a1 = vert(i + 1);
      b.quad(at(r0, a0, F), at(r0, a1, F), at(r1, a1, F), at(r1, a0, F), [cx, F - 10, cz], c);
      // Ceiling, facing down.
      b.quad(at(r0, a0, T), at(r0, a1, T), at(r1, a1, T), at(r1, a0, T), [cx, T + 10, cz], CEILING);
    }
  }

  // Core wall and baseboard (facing out into the room).
  b.frustum(cx, cz, F, T, D.coreRadius, D.coreRadius, n, CORE);
  b.frustum(cx, cz, F, F + 0.14, D.coreRadius + 0.04, D.coreRadius + 0.04, n, BASEBOARD);

  // Windows: a low sill and a header band facing inward, mullions at each corner, a hand rail.
  const inward = (r: number, y0: number, y1: number, c: string) => {
    for (let i = 0; i < n; i++) {
      const a0 = vert(i);
      const a1 = vert(i + 1);
      const mid = (a0 + a1) / 2;
      b.quad(at(r, a0, y0), at(r, a1, y0), at(r, a1, y1), at(r, a0, y1), at(r + 10, mid, (y0 + y1) / 2), c);
    }
  };
  inward(D.windowRadius, F, F + 0.35, FRAME);
  inward(D.windowRadius, T - 0.3, T, FRAME);
  for (let i = 0; i < n; i++) {
    const a = vert(i);
    const p = at(D.windowRadius - 0.1, a, 0);
    b.beam([p[0], F, p[2]], [p[0], T, p[2]], 0.22, 0.22, FRAME, [-Math.sin(a), 0, Math.cos(a)]);
    const a1 = vert(i + 1);
    const r = D.windowRadius - 0.45;
    b.beam(at(r, a, F + 1.0), at(r, a1, F + 1.0), 0.07, 0.07, RAIL, [0, 1, 0]);
  }

  // Screen bezels and the lift doors on their core facets.
  const ap = D.coreRadius * Math.cos(Math.PI / n);
  for (const s of SKY_DECK_SPOTS) {
    const phi = facetAngle(s.facet);
    const ox = Math.cos(phi);
    const oz = Math.sin(phi);
    const tx = -oz;
    const tz = ox;
    const box = (out0: number, out1: number, halfW: number, y0: number, y1: number, c: string) => {
      const corner = (o: number, t: number, y: number): V3 => [cx + ox * (ap + o) + tx * t, y, cz + oz * (ap + o) + tz * t];
      b.hexahedron(
        [
          corner(out0, -halfW, y0), corner(out1, -halfW, y0), corner(out1, halfW, y0), corner(out0, halfW, y0),
          corner(out0, -halfW, y1), corner(out1, -halfW, y1), corner(out1, halfW, y1), corner(out0, halfW, y1),
        ],
        c,
      );
    };
    if (s.kind === 'screen') {
      box(-0.02, 0.07, 1.42, F + 0.98, F + 2.56, BEZEL);
      // Plate backing, a little larger than the plate itself.
      box(-0.02, 0.05, PLATE.width / 2 + 0.06, F + PLATE.y - PLATE.height / 2 - 0.05, F + PLATE.y + PLATE.height / 2 + 0.05, BEZEL);
    } else {
      box(-0.02, 0.08, 1.15, F, F + 2.62, LIFT_FRAME);
      box(0.07, 0.1, 0.95, F, F + 2.45, LIFT);
      box(0.1, 0.11, 0.015, F, F + 2.45, LIFT_FRAME); // door seam
      box(-0.02, 0.08, LIFT_SIGN.width / 2 + 0.05, F + LIFT_SIGN.y - LIFT_SIGN.height / 2 - 0.04, F + LIFT_SIGN.y + LIFT_SIGN.height / 2 + 0.04, BEZEL);
    }
  }

  // Three benches facing the view.
  for (const phi of [0.8, 2.9, 5.0]) {
    const r = D.windowRadius - 4.2;
    const tx = -Math.sin(phi);
    const tz = Math.cos(phi);
    const c = at(r, phi, 0);
    const p0: V3 = [c[0] - tx * 1.1, F + 0.42, c[2] - tz * 1.1];
    const p1: V3 = [c[0] + tx * 1.1, F + 0.42, c[2] + tz * 1.1];
    b.beam(p0, p1, 0.55, 0.12, WOOD, [Math.cos(phi), 0, Math.sin(phi)]);
    for (const k of [-0.85, 0.85]) {
      const lx = c[0] + tx * k;
      const lz = c[2] + tz * k;
      b.beam([lx, F, lz], [lx, F + 0.36, lz], 0.4, 0.1, FRAME, [tx, 0, tz]);
    }
  }

  return b.build();
}

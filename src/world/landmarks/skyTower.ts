/** Sky Tower: low-poly, matching the SKY_TOWER dimensions used by the collision colliders. */
import { type BufferGeometry } from 'three';
import { SKY_TOWER as S } from '../../shared/collision';
import type { MapMeta } from '../../shared/mapFormat';
import { MeshBuilder, type V3 } from './builder';

const CONCRETE = '#cfc8b8';
const CONCRETE_DARK = '#b3aea4';
const POD_LIGHT = '#e7e2d4';
const GLASS = '#1f5058';
const MAST_WHITE = '#f1ece0';
const MAST_RED = '#d7263d';

export function buildSkyTower(meta: MapMeta): BufferGeometry {
  const { x, z, groundY: g } = meta.landmarks.skyTower;
  const b = new MeshBuilder();

  // flared legs: four leaning prisms from the footprint to the shaft at legsTop, inside legsRadius
  const outer = S.legsRadius - 4;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const p0: V3 = [x + dx * outer, g - 4, z + dz * outer];
    const p1: V3 = [x + dx * 3.5, g + S.legsTop - 2, z + dz * 3.5];
    b.beam(p0, p1, 5, 5, CONCRETE_DARK, [-dz, 0, dx]);
  }
  // collar tying the legs into the shaft
  b.frustum(x, z, g + S.legsTop - 6, g + S.legsTop + 3, S.shaftRadius + 2.5, S.shaftRadius + 1, 10, CONCRETE_DARK, { capTop: true });

  // shaft
  b.frustum(x, z, g, g + S.shaftTop, S.shaftRadius, S.shaftRadius, 10, CONCRETE);

  // pod stack: flared underside, light rim, dark window band, light rim, tapering top
  const r = S.podRadius;
  const pb = g + S.podBottom;
  b.frustum(x, z, pb, pb + 6, S.shaftRadius + 1, r, 12, POD_LIGHT, { capBottom: true });
  b.frustum(x, z, pb + 6, pb + 10, r, r, 12, POD_LIGHT);
  b.frustum(x, z, pb + 10, pb + 24, r, r, 12, GLASS);
  b.frustum(x, z, pb + 24, pb + 28, r, r, 12, POD_LIGHT);
  b.frustum(x, z, pb + 28, g + S.podTop, r, S.upperShaftRadius + 1, 12, POD_LIGHT, { capBottom: true });

  // upper shaft, with an antenna platform ring
  b.frustum(x, z, g + S.podTop, g + S.upperShaftTop, S.upperShaftRadius, S.upperShaftRadius, 8, CONCRETE);
  b.frustum(x, z, g + S.upperShaftTop - 16, g + S.upperShaftTop - 11, 7, 7, 8, POD_LIGHT, { capTop: true, capBottom: true });

  // mast, banded white and red
  const y0 = g + S.upperShaftTop;
  const y1 = g + S.height;
  const band = 8;
  for (let y = y0, k = 0; y < y1; y += band, k++) {
    b.frustum(x, z, y, Math.min(y + band, y1), S.mastRadius, S.mastRadius, 8, k % 2 ? MAST_RED : MAST_WHITE, { capTop: y + band >= y1 });
  }

  // aircraft light on top (alpha ~128 marks it as the blinking emissive)
  const top = y1 + 0.2;
  const ref: V3 = [x, top + 1.5, z];
  const lx = 2.2;
  const lo = top;
  const hi = top + 3;
  const corners: V3[] = [
    [x - lx, lo, z - lx], [x + lx, lo, z - lx], [x + lx, lo, z + lx], [x - lx, lo, z + lx],
    [x - lx, hi, z - lx], [x + lx, hi, z - lx], [x + lx, hi, z + lx], [x - lx, hi, z + lx],
  ];
  const faces: [number, number, number, number][] = [
    [4, 5, 6, 7], [0, 1, 2, 3], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  for (const f of faces) b.quad(corners[f[0]], corners[f[1]], corners[f[2]], corners[f[3]], ref, '#ff2a2a', 128);

  return b.build();
}

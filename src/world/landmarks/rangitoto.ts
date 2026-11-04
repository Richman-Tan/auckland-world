/**
 * Rangitoto: a broad shield cone with a summit crater, built around a local origin at its
 * centre on the water line. The caller places it (and, being far beyond the camera's far plane,
 * scales it towards the camera along the same direction, which keeps its angular size).
 */
import type { BufferGeometry } from 'three';
import type { MapMeta } from '../../shared/mapFormat';
import { MeshBuilder, type V3 } from './builder';

function hash(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function buildRangitoto(meta: MapMeta): BufferGeometry {
  const { baseRadius: R, summitY } = meta.landmarks.rangitoto;
  const H = summitY - meta.water.level;
  const SEG = 40;
  const RINGS = 14;
  const b = new MeshBuilder();

  const radiusAt = (theta: number) => R * (1 + 0.1 * Math.sin(3 * theta + 1) + 0.06 * Math.sin(5 * theta + 2));
  // t: 0 = summit, 1 = shore, > 1 = skirt below water
  const vertex = (j: number, i: number): V3 => {
    const theta = (i / SEG) * Math.PI * 2;
    const t = j > RINGS ? 1.05 : (j / RINGS) ** 1.6;
    let h: number;
    if (j > RINGS) {
      h = -10;
    } else {
      h = H * (0.7 * (1 - t) ** 1.35 + 0.3 * Math.max(0, 1 - t / 0.2));
      h -= H * 0.1 * Math.max(0, 1 - t / 0.07); // summit crater
      h *= 1 + (hash(i % SEG, j) - 0.5) * 0.06;
      if (j === RINGS) h = 0;
    }
    const rr = radiusAt(theta) * t * (1 + (j > 0 && j <= RINGS ? (hash(j, i % SEG) - 0.5) * 0.04 : 0));
    return [Math.cos(theta) * rr, h + meta.water.level, Math.sin(theta) * rr];
  };

  const ref: V3 = [0, -200, 0];
  for (let j = 0; j <= RINGS; j++) {
    for (let i = 0; i < SEG; i++) {
      const p00 = vertex(j, i);
      const p01 = vertex(j, i + 1);
      const p10 = vertex(j + 1, i);
      const p11 = vertex(j + 1, i + 1);
      const tm = ((j + 0.5) / RINGS);
      const rock = tm < 0.2;
      const shade = hash(i, j + 7);
      const color = rock ? (shade > 0.5 ? '#7a5d4e' : '#6a5246') : tm < 0.55 ? (shade > 0.5 ? '#557d3c' : '#4a7035') : shade > 0.5 ? '#3f6431' : '#37592b';
      const col2 = j > RINGS - 1 ? '#2c4a26' : color;
      if (j === 0) {
        // summit fan
        b.tri(p10, p11, [0, p00[1], 0], ref, color);
      } else {
        b.quad(p00, p01, p11, p10, ref, col2);
      }
    }
  }
  return b.build();
}

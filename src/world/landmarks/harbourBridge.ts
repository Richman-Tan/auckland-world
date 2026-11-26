/** Auckland Harbour Bridge: deck, clip-on girders, piers and a steel truss that follows topY. */
import type { BufferGeometry } from 'three';
import { HARBOUR_BRIDGE as H, bridgeModel } from '../../shared/bridge';
import type { MapMeta } from '../../shared/mapFormat';
import { MeshBuilder, type V3 } from './builder';

const STEEL = '#8e979c';
const STEEL_LIGHT = '#a9b2b6';
const STEEL_DARK = '#6c757b';
const ROAD = '#4a4e55';
const CONCRETE = '#b8b2a6';
/** Minimum member thickness so the truss survives the low internal resolution. */
const MEMBER = 2.6;

export function buildHarbourBridge(meta: MapMeta): BufferGeometry {
  // The smoothed deck and the single truss run, shared with the colliders and the traffic.
  const hb = bridgeModel(meta.landmarks.harbourBridge);
  const b = new MeshBuilder();
  const len = hb.length;
  // lateral unit vector (perpendicular, horizontal)
  const { vx, vz } = hb;
  const n = hb.stations;

  const at = (s: number, lat: number, y: number): V3 => {
    const p = hb.at(s, lat, y);
    return [p.x, p.y, p.z];
  };
  const sOf = (i: number) => Math.min(i * hb.step, len);

  /** A slab between two stations: lateral extent [l0, l1], vertical [yBot, yTop] given as per-station offsets from deck. */
  const slab = (s0: number, s1: number, l0: number, l1: number, deck0: number, deck1: number, bot: number, top: number, color: string, topColor = color) => {
    const c: V3[] = [
      at(s0, l0, deck0 + bot), at(s1, l0, deck1 + bot), at(s1, l1, deck1 + bot), at(s0, l1, deck0 + bot),
      at(s0, l0, deck0 + top), at(s1, l0, deck1 + top), at(s1, l1, deck1 + top), at(s0, l1, deck0 + top),
    ];
    b.hexahedron(c, color, topColor);
  };

  const gird = H.deckHalfWidth - 3;
  for (let i = hb.span.first; i < hb.span.last; i++) {
    const s0 = sOf(i);
    const s1 = sOf(i + 1);
    if (s1 <= s0) break;
    const d0 = hb.deckY[i];
    const d1 = hb.deckY[i + 1];
    // road slab
    slab(s0, s1, -gird, gird, d0, d1, -H.deckThickness, 0, STEEL_DARK, ROAD);
    // clip-on girders along both edges, proud of the road by a kerb
    slab(s0, s1, -H.deckHalfWidth, -gird, d0, d1, -H.deckThickness, 0.8, STEEL, STEEL_LIGHT);
    slab(s0, s1, gird, H.deckHalfWidth, d0, d1, -H.deckThickness, 0.8, STEEL, STEEL_LIGHT);
  }

  // piers
  for (const f of H.pierFractions) {
    const s = f * len;
    const deck = hb.deckAt(s);
    const top = deck - H.deckThickness;
    const c: V3[] = [
      at(s - H.pierHalfLength, -H.pierHalfWidth, -10), at(s + H.pierHalfLength, -H.pierHalfWidth, -10),
      at(s + H.pierHalfLength, H.pierHalfWidth, -10), at(s - H.pierHalfLength, H.pierHalfWidth, -10),
      at(s - H.pierHalfLength, -H.pierHalfWidth, top), at(s + H.pierHalfLength, -H.pierHalfWidth, top),
      at(s + H.pierHalfLength, H.pierHalfWidth, top), at(s - H.pierHalfLength, H.pierHalfWidth, top),
    ];
    b.hexahedron(c, CONCRETE);
  }

  // truss: two planes on the central lanes, top chord following topY
  const isTruss = (i: number) => hb.isTruss(i);
  const chordBottom = 1.4;
  for (const lat of [-H.trussHalfWidth + 1.3, H.trussHalfWidth - 1.3]) {
    for (let i = 0; i < n; i++) {
      if (!isTruss(i)) continue;
      const s = sOf(i);
      const top = hb.topY[i];
      const deck = hb.deckY[i] + chordBottom;
      // vertical post
      b.beam(at(s, lat, deck), at(s, lat, top), MEMBER, MEMBER, STEEL, [vx, 0, vz]);
      if (i + 1 < n && isTruss(i + 1)) {
        const s1 = sOf(i + 1);
        const top1 = hb.topY[i + 1];
        const deck1 = hb.deckY[i + 1] + chordBottom;
        b.beam(at(s, lat, top), at(s1, lat, top1), MEMBER, MEMBER, STEEL_LIGHT, [vx, 0, vz]);
        b.beam(at(s, lat, deck), at(s1, lat, deck1), MEMBER, MEMBER, STEEL_DARK, [vx, 0, vz]);
        // alternating diagonals
        if (i % 2 === 0) b.beam(at(s, lat, deck), at(s1, lat, top1), MEMBER, MEMBER, STEEL, [vx, 0, vz]);
        else b.beam(at(s, lat, top), at(s1, lat, deck1), MEMBER, MEMBER, STEEL, [vx, 0, vz]);
      }
    }
  }
  // lateral struts across the top every third station
  for (let i = 0; i < n; i += 3) {
    if (!isTruss(i)) continue;
    const s = sOf(i);
    const top = hb.topY[i];
    b.beam(at(s, -H.trussHalfWidth + 1.3, top), at(s, H.trussHalfWidth - 1.3, top), MEMBER, MEMBER, STEEL_DARK, [0, 1, 0]);
  }

  return b.build();
}

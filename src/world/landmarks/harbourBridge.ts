/**
 * Auckland Harbour Bridge, from the one description in shared/bridge.ts (which the colliders and
 * the traffic also read, so nothing drawn here can drift from what is hit or driven on).
 *
 * What it is made of, as the real one is:
 *  - the road: a slab with a parapet along each edge, a median barrier down the middle and a kerb
 *    either side of the four original lanes, where the truss stands;
 *  - the steel bridge over the harbour: a truss hung under the road, deepest at the two main piers
 *    and arching up to the crown of the navigation span, with the arch standing above the road
 *    over that span (its height is the measured one);
 *  - the clip-ons: a box girder along each side carrying two more lanes, deeper over each pier;
 *  - six piers, each two tapered legs under the truss and a beam across their tops that reaches
 *    out under the clip-ons;
 *  - the viaducts beyond each shore: a plain deck on rows of columns.
 *
 * Lane markings are not here: they are painted by the road layer on strips laid over the deck
 * (world/ribbons.ts, bridgeStrips). The lamp posts and flags, which only read from close by, are a
 * second mesh (buildHarbourBridgeDetail) that is drawn only when the plane is near.
 *
 * At night the parapets and the top of the arch are floodlit and a red light blinks on the crown.
 */
import type { BufferGeometry } from 'three';
import { BRIDGE_MEDIAN_HALF_WIDTH } from '../../shared/ambientPaths';
import { HARBOUR_BRIDGE as H, type BridgeModel, bridgeModel } from '../../shared/bridge';
import type { MapMeta } from '../../shared/mapFormat';
import { ALPHA_BLINK, ALPHA_FLOOD, ALPHA_NORMAL, ALPHA_WINDOW, MeshBuilder, type V3 } from './builder';

const STEEL = '#8e979c';
const STEEL_LIGHT = '#a9b2b6';
const STEEL_DARK = '#6c757b';
/** The seal, in the colour the road layer paints it from close by, so the two agree where they meet. */
const ROAD = '#625d61';
const CONCRETE = '#b8b2a6';
const CONCRETE_DARK = '#9d978b';
/** Minimum member thickness so the truss survives the low internal resolution. */
const MEMBER = 2.6;
/** The two planes of the truss stand this far either side of the centreline. */
export const TRUSS_PLANE = H.trussHalfWidth - 1.3;
/** The road slab: half its width, its thickness, and the outer face of the parapet beyond it. */
const ROAD_HALF = 18;
const SLAB = 1.2;
const PARAPET_OUT = 18.7;
const PARAPET_HEIGHT = 1.1;
/** The clip-on girder: its inner face, its depth between piers and the extra over a pier. */
const CLIP_IN = 10.2;
const CLIP_DEPTH = 2.6;
const CLIP_HAUNCH = 3.2;
const CLIP_HAUNCH_REACH = 45;
/** The truss under the road is drawn in panels this long. */
const PANEL = 20;

type At = (s: number, lateral: number, y: number) => V3;

/** How deep the clip-on girder is at s: deeper over each pier, like the real ones. */
export function clipOnDepth(m: BridgeModel, s: number): number {
  let k = 0;
  for (const p of m.piers) k = Math.max(k, 1 - Math.abs(s - p.s) / CLIP_HAUNCH_REACH);
  return CLIP_DEPTH + CLIP_HAUNCH * k * k;
}

/** A box along the bridge between two distances: across [l0, l1], with its own bottom and top at each end. */
function run(b: MeshBuilder, at: At, s0: number, s1: number, l0: number, l1: number, bot0: number, bot1: number, top0: number, top1: number, color: string, topColor = color, alpha = ALPHA_NORMAL) {
  b.hexahedron(
    [at(s0, l0, bot0), at(s1, l0, bot1), at(s1, l1, bot1), at(s0, l1, bot0), at(s0, l0, top0), at(s1, l0, top1), at(s1, l1, top1), at(s0, l1, top0)],
    color,
    topColor,
    alpha,
  );
}

/** The distances at which a run from `from` to `to` is cut: every `step`, and at both ends. */
function cuts(from: number, to: number, step: number): number[] {
  const out = [from];
  for (let s = Math.ceil((from + 1e-6) / step) * step; s < to - 1e-6; s += step) out.push(s);
  out.push(to);
  return out;
}

export function buildHarbourBridge(meta: MapMeta): BufferGeometry {
  const hb = bridgeModel(meta.landmarks.harbourBridge);
  const b = new MeshBuilder();
  const at: At = (s, lat, y) => {
    const p = hb.at(s, lat, y);
    return [p.x, p.y, p.z];
  };
  const from = hb.span.first * hb.step;
  const to = Math.min(hb.span.last * hb.step, hb.length);
  const deck = hb.deckAt;
  const across: V3 = [hb.vx, 0, hb.vz];

  // ---- the road, at every station so traffic and the painted lanes sit exactly on it
  const stations = cuts(from, to, hb.step);
  for (let i = 0; i + 1 < stations.length; i++) {
    const s0 = stations[i];
    const s1 = stations[i + 1];
    run(b, at, s0, s1, -ROAD_HALF, ROAD_HALF, deck(s0) - SLAB, deck(s1) - SLAB, deck(s0), deck(s1), STEEL_DARK, ROAD);
  }
  // Parapets, floodlit at night: the line of the bridge after dark.
  const twenties = cuts(from, to, 20);
  for (let i = 0; i + 1 < twenties.length; i++) {
    const s0 = twenties[i];
    const s1 = twenties[i + 1];
    for (const side of [-1, 1]) {
      run(b, at, s0, s1, side * ROAD_HALF, side * PARAPET_OUT, deck(s0) - SLAB, deck(s1) - SLAB, deck(s0) + PARAPET_HEIGHT, deck(s1) + PARAPET_HEIGHT, CONCRETE, CONCRETE, ALPHA_FLOOD);
    }
  }
  // The median barrier, and the kerbs the truss stands on between the middle lanes and the clip-ons.
  // Cut long, and sunk a little into the road, so a long box still meets the curve of the deck.
  const forties = cuts(from, to, 40);
  for (let i = 0; i + 1 < forties.length; i++) {
    const s0 = forties[i];
    const s1 = forties[i + 1];
    run(b, at, s0, s1, -BRIDGE_MEDIAN_HALF_WIDTH, BRIDGE_MEDIAN_HALF_WIDTH, deck(s0) - 0.5, deck(s1) - 0.5, deck(s0) + 0.9, deck(s1) + 0.9, CONCRETE_DARK, CONCRETE);
    for (const side of [-1, 1]) {
      run(b, at, s0, s1, side * 7.3, side * 9.9, deck(s0) - 0.5, deck(s1) - 0.5, deck(s0) + 0.5, deck(s1) + 0.5, STEEL_DARK, STEEL);
    }
  }

  // ---- under the road
  for (let i = 0; i + 1 < stations.length; i++) {
    const s0 = stations[i];
    const s1 = stations[i + 1];
    const mid = (s0 + s1) / 2;
    if (mid > hb.steel.from && mid < hb.steel.to) {
      // Clip-on box girders, deeper over the piers.
      for (const side of [-1, 1]) {
        run(b, at, s0, s1, side * CLIP_IN, side * PARAPET_OUT, deck(s0) - clipOnDepth(hb, s0), deck(s1) - clipOnDepth(hb, s1), deck(s0) - SLAB, deck(s1) - SLAB, STEEL);
      }
    } else if (i % 2 === 0) {
      // The viaducts: the deck's own girders, two stations at a time.
      const s2 = stations[Math.min(i + 2, stations.length - 1)];
      run(b, at, s0, s2, -PARAPET_OUT + 1, PARAPET_OUT - 1, hb.bottomAt(s0), hb.bottomAt(s2), deck(s0) - SLAB, deck(s2) - SLAB, CONCRETE_DARK);
    }
  }

  // The truss under the road: a bottom chord that follows the model's underside, posts and
  // diagonals up to the deck, in two planes, with a strut between them at every other panel.
  const panels = cuts(hb.steel.from, hb.steel.to, PANEL);
  const chord = (s: number) => hb.bottomAt(s) + MEMBER / 2;
  const underDeck = (s: number) => deck(s) - SLAB;
  /** Worth drawing members only where there is room for them under the slab. */
  const open = (s: number) => underDeck(s) - chord(s) > MEMBER;
  for (let i = 0; i + 1 < panels.length; i++) {
    const s0 = panels[i];
    const s1 = panels[i + 1];
    for (const side of [-1, 1]) {
      const lat = side * TRUSS_PLANE;
      if (open(s0) || open(s1)) b.beam(at(s0, lat, chord(s0)), at(s1, lat, chord(s1)), MEMBER, MEMBER, STEEL_DARK, across);
      if (open(s0)) b.beam(at(s0, lat, chord(s0)), at(s0, lat, underDeck(s0)), MEMBER, MEMBER, STEEL, across);
      if (open(s0) && open(s1)) {
        if (i % 2 === 0) b.beam(at(s0, lat, chord(s0)), at(s1, lat, underDeck(s1)), MEMBER, MEMBER, STEEL, across);
        else b.beam(at(s0, lat, underDeck(s0)), at(s1, lat, chord(s1)), MEMBER, MEMBER, STEEL, across);
      }
    }
    if (i % 2 === 0 && open(s0)) b.beam(at(s0, -TRUSS_PLANE, chord(s0)), at(s0, TRUSS_PLANE, chord(s0)), MEMBER, MEMBER, STEEL_DARK, [0, 1, 0]);
  }

  // ---- the arch over the navigation span: two planes on the middle lanes, top chord at the measured height
  const sOf = (i: number) => Math.min(i * hb.step, hb.length);
  const chordBottom = 1.4;
  for (const lat of [-TRUSS_PLANE, TRUSS_PLANE]) {
    for (let i = 0; i < hb.stations; i++) {
      if (!hb.isTruss(i)) continue;
      const s = sOf(i);
      const top = hb.topY[i];
      const low = hb.deckY[i] + chordBottom;
      b.beam(at(s, lat, low), at(s, lat, top), MEMBER, MEMBER, STEEL, across);
      if (i + 1 < hb.stations && hb.isTruss(i + 1)) {
        const s1 = sOf(i + 1);
        const top1 = hb.topY[i + 1];
        const low1 = hb.deckY[i + 1] + chordBottom;
        // The top chord is what the floodlights pick out.
        b.beam(at(s, lat, top), at(s1, lat, top1), MEMBER, MEMBER, STEEL_LIGHT, across, ALPHA_FLOOD);
        if (i % 2 === 0) b.beam(at(s, lat, low), at(s1, lat, top1), MEMBER, MEMBER, STEEL, across);
        else b.beam(at(s, lat, top), at(s1, lat, low1), MEMBER, MEMBER, STEEL, across);
      }
    }
  }
  // Struts across the top every third station, and the red light on the crown.
  let crown = -1;
  for (let i = 0; i < hb.stations; i++) {
    if (!hb.isTruss(i)) continue;
    if (crown < 0 || hb.topY[i] > hb.topY[crown]) crown = i;
    // (Not where the arch is still low at its ends: a strut there would bar the road.)
    if (i % 3 === 0 && hb.topY[i] - hb.deckY[i] > 8) b.beam(at(sOf(i), -TRUSS_PLANE, hb.topY[i]), at(sOf(i), TRUSS_PLANE, hb.topY[i]), MEMBER, MEMBER, STEEL_DARK, [0, 1, 0]);
  }
  if (crown >= 0) {
    for (const lat of [-TRUSS_PLANE, TRUSS_PLANE]) {
      const p = at(sOf(crown), lat, hb.topY[crown] + MEMBER / 2);
      b.frustum(p[0], p[2], p[1], p[1] + 2.2, 1.1, 1.1, 4, '#d7263d', { capTop: true, alpha: ALPHA_BLINK });
    }
  }

  // ---- piers: two tapered legs, a beam across their tops flaring out under the clip-ons, and
  // a bracket up to each clip-on girder. The main piers are a third heavier.
  for (const pier of hb.piers) {
    const s = pier.s;
    const k = pier.main ? 1.3 : 1;
    const top = hb.bottomAt(s);
    const cap = top - H.pierCapHeight;
    const hl = Math.min(H.pierHalfLength, 2.8 * k);
    for (const side of [-1, 1]) {
      const c = side * TRUSS_PLANE;
      const w0 = Math.min(H.pierHalfWidth - TRUSS_PLANE, 2.7 * k);
      const w1 = w0 * 0.7;
      const l1 = hl * 0.72;
      b.hexahedron(
        [at(s - hl, c - w0, -10), at(s + hl, c - w0, -10), at(s + hl, c + w0, -10), at(s - hl, c + w0, -10), at(s - l1, c - w1, cap), at(s + l1, c - w1, cap), at(s + l1, c + w1, cap), at(s - l1, c + w1, cap)],
        CONCRETE,
      );
      // The bracket under the clip-on.
      const girder = deck(s) - clipOnDepth(hb, s);
      if (girder - top > 0.5) run(b, at, s - 2.2, s + 2.2, side * 11, side * 18, top, top, girder, girder, CONCRETE_DARK);
    }
    const cl = H.pierCapHalfLength;
    b.hexahedron(
      [at(s - cl * 0.8, -12.5, cap), at(s + cl * 0.8, -12.5, cap), at(s + cl * 0.8, 12.5, cap), at(s - cl * 0.8, 12.5, cap), at(s - cl, -19.5, top), at(s + cl, -19.5, top), at(s + cl, 19.5, top), at(s - cl, 19.5, top)],
      CONCRETE_DARK,
      CONCRETE,
    );
    // A tie between the legs half way up a tall pier.
    if (cap > 18) run(b, at, s - 1.2, s + 1.2, -TRUSS_PLANE, TRUSS_PLANE, cap * 0.5 - 1.2, cap * 0.5 - 1.2, cap * 0.5 + 1.2, cap * 0.5 + 1.2, CONCRETE_DARK);
  }

  // ---- rows of columns under the viaducts and at the two ends of the steel
  for (const s of hb.bents) {
    const top = hb.bottomAt(s);
    const foot = hb.groundAt(s) - 3;
    const head = Math.max(foot + 1, top - 1.6);
    for (const side of [-1, 1]) run(b, at, s - 1.2, s + 1.2, side * TRUSS_PLANE - 1.2, side * TRUSS_PLANE + 1.2, foot, foot, head, head, CONCRETE);
    run(b, at, s - H.bentHalfLength + 0.2, s + H.bentHalfLength - 0.2, -H.bentHalfWidth + 1, H.bentHalfWidth - 1, head, head, top, top, CONCRETE_DARK);
  }

  return b.build();
}

/** Lamp posts stand this far apart, on alternate sides, as the lamp pools on the painted lanes do. */
const LAMP_SPACING = 40;

/**
 * What only reads from close by: lamp posts along the kerbs outside the arch (where the lights
 * hang from the steel instead) and the two flags on its crown. Drawn only when the plane is near.
 */
export function buildHarbourBridgeDetail(meta: MapMeta): BufferGeometry {
  const hb = bridgeModel(meta.landmarks.harbourBridge);
  const b = new MeshBuilder();
  const at: At = (s, lat, y) => {
    const p = hb.at(s, lat, y);
    return [p.x, p.y, p.z];
  };
  const from = hb.span.first * hb.step;
  const to = Math.min(hb.span.last * hb.step, hb.length);
  const across: V3 = [hb.vx, 0, hb.vz];
  const along: V3 = [hb.ux, 0, hb.uz];
  const POST = 0.7;
  let n = 0;
  for (let s = from + LAMP_SPACING / 2; s < to; s += LAMP_SPACING, n++) {
    if (hb.isTruss(Math.round(s / hb.step))) continue;
    // The side the painted lamp pool falls on: positive for the first, then alternating.
    const side = n % 2 === 0 ? 1 : -1;
    const lat = side * TRUSS_PLANE;
    const y = hb.deckAt(s);
    const top = y + 10.5;
    b.beam(at(s, lat, y), at(s, lat, top), POST, POST, STEEL_DARK, across);
    // A crook to each side: one over the middle lanes, one over the clip-on.
    for (const reach of [-4.2, 4.2]) {
      b.beam(at(s, lat, top), at(s, lat + reach, top + 0.6), POST * 0.8, POST * 0.8, STEEL_DARK, along);
      b.beam(at(s - 0.9, lat + reach, top + 0.4), at(s + 0.9, lat + reach, top + 0.4), 1.3, 0.5, '#f4ecd2', across, ALPHA_WINDOW);
    }
  }
  // The flags on the crown of the arch, one on each plane of the truss.
  let crown = -1;
  for (let i = 0; i < hb.stations; i++) if (hb.isTruss(i) && (crown < 0 || hb.topY[i] > hb.topY[crown])) crown = i;
  if (crown >= 0) {
    const s = crown * hb.step + 6;
    for (const lat of [-TRUSS_PLANE, TRUSS_PLANE]) {
      const y = hb.topY[crown] + MEMBER / 2;
      b.beam(at(s, lat, y), at(s, lat, y + 13), 0.6, 0.6, '#e9efe6', across);
      // Larger than life, like everything that has to survive the pixel size: a blue field, and
      // the canton by the pole as one red block.
      run(b, at, s + 0.3, s + 7.3, lat - 0.15, lat + 0.15, y + 8.6, y + 8.6, y + 12.8, y + 12.8, '#22316c');
      run(b, at, s + 0.3, s + 3.4, lat - 0.2, lat + 0.2, y + 10.8, y + 10.8, y + 12.8, y + 12.8, '#c8324a');
    }
  }
  return b.build();
}

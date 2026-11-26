/**
 * The Harbour Bridge as everything else should see it. The model, the colliders and the traffic
 * all read this one description, so what is drawn, what can be hit and where the cars drive cannot
 * drift apart.
 *
 * The profile in the map (meta.landmarks.harbourBridge) is measured from LiDAR and is noisy: a lamp
 * post or a gantry reads as a few metres of "truss", and the deck wobbles by a metre or two towards
 * the northern end and then drops to the ground at the abutment. Used raw, that drew nine stray
 * pieces of truss along the approaches and put colliders on them. Here the bridge ends at its
 * abutments, the deck between them is one smooth rise and fall, and the truss is the single run
 * that contains the arch.
 */
import type { MapMeta } from './mapFormat';

/** Harbour Bridge cross-section in metres. */
export const HARBOUR_BRIDGE = {
  /** Full deck width including the clip-on lanes. */
  deckHalfWidth: 20,
  /** Deck slab thickness below the road surface. */
  deckThickness: 4,
  /** The steel truss sits on the original central lanes only. */
  trussHalfWidth: 10,
  /** The truss stands where it rises more than this above the deck. */
  trussMinRise: 4,
  pierHalfLength: 6,
  pierHalfWidth: 9,
  /** Pier positions as fractions along a -> b. Shared by the visual model and the colliders. */
  pierFractions: [0.08, 0.17, 0.26, 0.36, 0.48, 0.72, 0.86] as readonly number[],
  /** A fall of more than this between two stations is the end of the bridge: the ground beyond an abutment. */
  abutmentDrop: 3.5,
} as const;

/** Profile value at distance s along a -> b, linearly interpolated between samples. */
export function bridgeProfileAt(profile: readonly number[], step: number, s: number): number {
  if (profile.length === 0) return 0;
  const f = Math.min(Math.max(s / step, 0), profile.length - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, profile.length - 1);
  return profile[i] + (profile[j] - profile[i]) * (f - i);
}

type Measured = MapMeta['landmarks']['harbourBridge'];

export interface BridgeModel {
  /** End a to end b, metres. */
  length: number;
  /** Distance between stations. */
  step: number;
  stations: number;
  /** Unit vector along a -> b, and the lateral one (to the left of it is negative). */
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  /** Heading (radians, 0 = north, clockwise) when travelling from a to b. */
  heading: number;
  /**
   * The stations the bridge actually spans, abutment to abutment. The measured profile can run on
   * past an abutment onto the ground; nothing is drawn, hit or driven on out there.
   */
  span: { first: number; last: number };
  /** Road surface height at each station: one smooth rise to the crest and fall from it. */
  deckY: readonly number[];
  /** Top of the truss at each station inside `truss`; equal to the deck everywhere else. */
  topY: readonly number[];
  /** The one run of stations that carries the truss above the deck, or null if there is none. */
  truss: { first: number; last: number } | null;
  /** The station where the deck is highest. */
  crest: number;
  isTruss(station: number): boolean;
  deckAt(s: number): number;
  topAt(s: number): number;
  /** A point `lateral` metres to the side at distance s; y defaults to the road surface. */
  at(s: number, lateral: number, y?: number): { x: number; y: number; z: number };
}

/** Median over a window of 2 * half + 1 samples, with the ends held. */
export function medianFilter(values: readonly number[], half: number): number[] {
  const n = values.length;
  return values.map((_, i) => {
    const w: number[] = [];
    for (let k = -half; k <= half; k++) w.push(values[Math.min(n - 1, Math.max(0, i + k))]);
    w.sort((a, b) => a - b);
    return w[half];
  });
}

/** The closest non-decreasing sequence to `values` (pool adjacent violators). */
export function nonDecreasing(values: readonly number[]): number[] {
  const sums: number[] = [];
  const counts: number[] = [];
  for (const v of values) {
    sums.push(v);
    counts.push(1);
    while (sums.length > 1 && sums[sums.length - 2] / counts[counts.length - 2] > sums[sums.length - 1] / counts[counts.length - 1]) {
      const s = sums.pop() as number;
      const c = counts.pop() as number;
      sums[sums.length - 1] += s;
      counts[counts.length - 1] += c;
    }
  }
  const out: number[] = [];
  sums.forEach((s, i) => {
    for (let k = 0; k < counts[i]; k++) out.push(s / counts[i]);
  });
  return out;
}

const cache = new WeakMap<Measured, BridgeModel>();

export function bridgeModel(hb: Measured): BridgeModel {
  const known = cache.get(hb);
  if (known) return known;

  const dx = hb.b.x - hb.a.x;
  const dz = hb.b.z - hb.a.z;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length;
  const uz = dz / length;
  const vx = -uz;
  const vz = ux;
  const step = hb.step;
  const n = hb.deckY.length;

  // ---- the deck: from abutment to abutment, up to the crest and down from it
  const rough = medianFilter(hb.deckY, 2);
  // The crest is the highest station nearest the arch (the top of the deck is a long plateau).
  const archS = (hb.archTop.x - hb.a.x) * ux + (hb.archTop.z - hb.a.z) * uz;
  const peak = Math.max(...rough, -Infinity);
  let crest = 0;
  let bestD = Infinity;
  rough.forEach((y, i) => {
    const d = Math.abs(i * step - archS);
    if (y >= peak - 0.5 && d < bestD) {
      bestD = d;
      crest = i;
    }
  });
  // An abutment shows as a sudden fall to ground level, going outwards from the crest.
  const sharp = medianFilter(hb.deckY, 1);
  let first = 0;
  let last = Math.max(0, n - 1);
  for (let i = crest + 1; i < n; i++) {
    if (sharp[i - 1] - sharp[i] > HARBOUR_BRIDGE.abutmentDrop) {
      last = i - 1;
      break;
    }
  }
  for (let i = crest - 1; i >= 0; i--) {
    if (sharp[i + 1] - sharp[i] > HARBOUR_BRIDGE.abutmentDrop) {
      first = i + 1;
      break;
    }
  }
  const rise = nonDecreasing(rough.slice(first, crest + 1));
  const fall = nonDecreasing(rough.slice(crest, last + 1).reverse()).reverse();
  const inner = [...rise.slice(0, -1), Math.max(rise[rise.length - 1] ?? -Infinity, fall[0] ?? -Infinity), ...fall.slice(1)];
  // Outside the span the deck simply holds its end height; nothing uses it out there.
  const deck = rough.map((_, i) => inner[Math.min(Math.max(i, first), last) - first]);
  // Pooling leaves flat treads with a step between them; average those into a slope.
  const deckY = deck.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      sum += deck[j];
      count++;
    }
    return sum / count;
  });
  // Averaging can leave a ripple of a few centimetres on the long flat top: press it out, so the
  // deck is strictly one rise and one fall. (Raising a low sample to its neighbour never steepens anything.)
  for (let i = 1; i <= crest; i++) deckY[i] = Math.max(deckY[i], deckY[i - 1]);
  for (let i = n - 2; i >= crest; i--) deckY[i] = Math.max(deckY[i], deckY[i + 1]);

  // ---- the truss: the run around the arch where it stands clear of the deck
  const tops = medianFilter(hb.topY, 1);
  const clear = (i: number) => i >= first && i <= last && tops[i] - deckY[i] > HARBOUR_BRIDGE.trussMinRise;
  const archStation = Math.min(n - 1, Math.max(0, Math.round(archS / step)));
  let truss: BridgeModel['truss'] = null;
  // The arch top itself is a single sample; look a couple of stations either side for the run.
  const seed = [0, 1, -1, 2, -2].map((k) => archStation + k).find(clear);
  if (seed !== undefined) {
    let from = seed;
    let to = seed;
    while (clear(from - 1)) from--;
    while (clear(to + 1)) to++;
    if (to > from) truss = { first: from, last: to };
  }
  const isTruss = (i: number) => truss !== null && i >= truss.first && i <= truss.last;
  const topY = deckY.map((d, i) => (isTruss(i) ? tops[i] : d));

  const model: BridgeModel = {
    length,
    step,
    stations: n,
    ux,
    uz,
    vx,
    vz,
    heading: Math.atan2(ux, -uz),
    span: { first, last },
    deckY,
    topY,
    truss,
    crest,
    isTruss,
    deckAt: (s) => bridgeProfileAt(deckY, step, s),
    topAt: (s) => bridgeProfileAt(topY, step, s),
    at(s, lateral, y) {
      return { x: hb.a.x + ux * s + vx * lateral, y: y ?? bridgeProfileAt(deckY, step, s), z: hb.a.z + uz * s + vz * lateral };
    },
  };
  cache.set(hb, model);
  return model;
}

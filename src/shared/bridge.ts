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
 *
 * The structure under the road comes from here too. The steel bridge proper runs from shore to
 * shore (1,020 m on the real map, which is its real length) on six piers: four under the southern
 * approach spans and the two that carry the 244 m navigation span. Its truss hangs below the road,
 * deepest at those two piers and arching up to almost nothing at mid-span, which is what leaves
 * 43 m for shipping. Beyond the shores the road is a plain viaduct on rows of columns.
 */
import type { MapMeta } from './mapFormat';

/** Harbour Bridge cross-section in metres. */
export const HARBOUR_BRIDGE = {
  /** Full deck width including the clip-on lanes. */
  deckHalfWidth: 20,
  /** The road slab and the girders under it, where there is no truss: how far below the road they reach. */
  deckThickness: 3,
  /** The steel truss sits on the original central lanes only. */
  trussHalfWidth: 10,
  /** The truss stands where it rises more than this above the deck. */
  trussMinRise: 4,
  /** A fall of more than this between two stations is the end of the bridge: the ground beyond an abutment. */
  abutmentDrop: 3.5,

  /** The navigation span, pier to pier (the real one is 243.8 m). */
  mainSpan: 244,
  /** About how far apart the piers stand under the approach spans, and how long the span beyond the far main pier may be. */
  approachSpan: 118,
  anchorSpan: 175,
  /** How far below the road the truss reaches: along the approaches, at the two main piers, and at mid-span. */
  trussDepth: 8,
  pierDepth: 16,
  crownDepth: 3,
  /** The truss deepens towards a main pier over this distance. */
  haunchReach: 90,
  /** The truss runs inland from the shore this far at most, and only while there is this much room under the road. */
  steelInland: 60,
  steelMinClearance: 11,

  /** A pier: two legs under the truss, footprint half-sizes along and across the bridge, and the beam across their tops. */
  pierHalfLength: 3.6,
  pierHalfWidth: 12.2,
  pierCapHeight: 3,
  pierCapHalfLength: 4,
  /** Rows of columns under the approach viaducts: spacing, the least room that needs one, and the row's half-sizes. */
  bentSpacing: 40,
  bentMinClearance: 4,
  bentHalfLength: 1.6,
  bentHalfWidth: 16,
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

  /** The ground under each station, 0 over the sea (all 0 on a map that did not measure it). */
  groundY: readonly number[];
  groundAt(s: number): number;
  /** The steel bridge proper, shore to shore, as distances from end a. Outside it the road is a viaduct. */
  steel: { from: number; to: number };
  /** Its piers, in order along the bridge; `main` marks the two that carry the navigation span. */
  piers: readonly { s: number; main: boolean }[];
  /** Rows of columns under the approach viaducts and at the two ends of the steel, as distances from end a. */
  bents: readonly number[];
  /** How far below the road the structure reaches at s: the truss, or just the deck's own girders. */
  depthAt(s: number): number;
  /** The underside of the structure at s: nothing of the bridge but its piers is below this. */
  bottomAt(s: number): number;
}

/** Evenly spaced points strictly between `from` and `to`, about `about` apart. */
function between(from: number, to: number, about: number): number[] {
  const n = Math.max(1, Math.round((to - from) / about));
  const out: number[] = [];
  for (let k = 1; k < n; k++) out.push(from + (k * (to - from)) / n);
  return out;
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

  // ---- what is under the road
  const groundY = deckY.map((_, i) => Math.max(0, hb.groundY?.[i] ?? 0));
  const groundAt = (s: number) => bridgeProfileAt(groundY, step, s);
  const sea = (i: number) => groundY[i] <= 0.5;
  // The steel bridge: the water under the crest, shore to shore, and inland a little while the
  // road is still high enough above the ground for a truss to hang under it.
  let steelFirst = first;
  let steelLast = last;
  if (sea(crest)) {
    let w0 = crest;
    let w1 = crest;
    while (w0 - 1 >= first && sea(w0 - 1)) w0--;
    while (w1 + 1 <= last && sea(w1 + 1)) w1++;
    const inland = (from: number, dir: 1 | -1) => {
      let i = from;
      for (let k = 0; k < HARBOUR_BRIDGE.steelInland / step; k++) {
        const j = i + dir;
        if (j < first || j > last || deckY[j] - groundY[j] < HARBOUR_BRIDGE.steelMinClearance) break;
        i = j;
      }
      return i;
    };
    steelFirst = inland(w0, -1);
    steelLast = inland(w1, 1);
  }
  const steel = { from: steelFirst * step, to: Math.min(steelLast * step, length) };

  // The two main piers stand half a navigation span either side of the middle of the arch.
  const middle = (truss ? (truss.first + truss.last) / 2 : crest) * step;
  const half = Math.min(HARBOUR_BRIDGE.mainSpan / 2, Math.max(20, (steel.to - steel.from) / 2 - 20));
  const mainA = Math.max(steel.from + 20, middle - half);
  const mainB = Math.min(steel.to - 20, middle + half);
  const piers: { s: number; main: boolean }[] = [];
  if (mainB - mainA > 40) {
    for (const s of between(steel.from, mainA, HARBOUR_BRIDGE.approachSpan)) piers.push({ s, main: false });
    piers.push({ s: mainA, main: true }, { s: mainB, main: true });
    for (const s of between(mainB, steel.to, HARBOUR_BRIDGE.anchorSpan)) piers.push({ s, main: false });
  }

  const deckAt = (s: number) => bridgeProfileAt(deckY, step, s);
  const depthAt = (s: number) => {
    if (s <= steel.from || s >= steel.to || piers.length === 0) return HARBOUR_BRIDGE.deckThickness;
    let depth: number;
    if (s > mainA && s < mainB) {
      // The navigation span: deepest at the piers, arching up to the crown.
      const t = ((s - mainA) / (mainB - mainA)) * 2 - 1;
      depth = HARBOUR_BRIDGE.crownDepth + (HARBOUR_BRIDGE.pierDepth - HARBOUR_BRIDGE.crownDepth) * t * t;
    } else {
      const k = Math.max(0, 1 - (s <= mainA ? mainA - s : s - mainB) / HARBOUR_BRIDGE.haunchReach);
      depth = HARBOUR_BRIDGE.trussDepth + (HARBOUR_BRIDGE.pierDepth - HARBOUR_BRIDGE.trussDepth) * k * k;
    }
    // It tapers into the plain deck over the last thirty metres at each shore.
    const end = Math.min(s - steel.from, steel.to - s);
    return end < 30 ? HARBOUR_BRIDGE.deckThickness + (depth - HARBOUR_BRIDGE.deckThickness) * (end / 30) : depth;
  };
  // Never into the ground, and never thinner than a road slab.
  const bottomAt = (s: number) => Math.min(deckAt(s) - 1, Math.max(deckAt(s) - depthAt(s), groundAt(s) + 0.5));

  // Rows of columns: one at each end of the steel, then every so often out along the viaducts,
  // wherever the road is far enough off the ground to need holding up.
  const bents: number[] = [];
  const spanFrom = first * step;
  const spanTo = Math.min(last * step, length);
  const tall = (s: number) => deckAt(s) - groundAt(s) >= HARBOUR_BRIDGE.bentMinClearance;
  if (steel.from > spanFrom || steel.to < spanTo) {
    for (let s = steel.from; s >= spanFrom + 4; s -= HARBOUR_BRIDGE.bentSpacing) if (steel.from > spanFrom && tall(s)) bents.push(s);
    for (let s = steel.to; s <= spanTo - 4; s += HARBOUR_BRIDGE.bentSpacing) if (steel.to < spanTo && tall(s)) bents.push(s);
    bents.sort((a, b) => a - b);
  }

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
    deckAt,
    topAt: (s) => bridgeProfileAt(topY, step, s),
    groundY,
    groundAt,
    steel,
    piers,
    bents,
    depthAt,
    bottomAt,
    at(s, lateral, y) {
      return { x: hb.a.x + ux * s + vx * lateral, y: y ?? bridgeProfileAt(deckY, step, s), z: hb.a.z + uz * s + vz * lateral };
    },
  };
  cache.set(hb, model);
  return model;
}

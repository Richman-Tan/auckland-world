/**
 * The landmarks modelled from what the map measures of them: Auckland Museum, Eden Park, the
 * Wynyard silos and footbridge, and the port's cranes. One mesh for all of them. Their sizes and
 * positions come from meta.landmarks through shared/landmarkSites.ts, which the colliders read too,
 * so each can be hit exactly where it is drawn; a map without one of them simply does not get it.
 */
import type { BufferGeometry } from 'three';
import { CROSSING_MAST, FLOODLIGHT, craneShape, floodlights, museumShape, standFacing } from '../../shared/landmarkSites';
import type { MapMeta, SiteBox } from '../../shared/mapFormat';
import { ALPHA_BLINK, ALPHA_FLOOD, ALPHA_NORMAL, ALPHA_WINDOW, MeshBuilder, type V3 } from './builder';

const STONE = '#d9d3c4';
const STONE_SHADE = '#bdb6a6';
const COPPER = '#7f8f7a';
const CONCRETE = '#b8b2a6';
const CONCRETE_DARK = '#9d978b';
const SEATS = '#3f4d63';
const SEATS_LIGHT = '#566a86';
const CANOPY = '#e6e9e8';
const TURF = '#5c9a45';
const TURF_LIGHT = '#69a850';
const SILO = '#cfc8b8';
const SILO_CAP = '#a79f8f';
const CRANE = '#5d7388';
const CRANE_LIGHT = '#8ea2b2';
const CRANE_HOUSE = '#e9ece8';
const WHITE = '#eef0ec';

/** A point in a site's own frame: `a` along its long side, `v` across it, at height y. */
type Frame = (a: number, v: number, y: number) => V3;
const frame = (s: { x: number; z: number; ux: number; uz: number }): Frame => (a, v, y) => [s.x + s.ux * a - s.uz * v, y, s.z + s.uz * a + s.ux * v];

/** A box in a frame: along [a0, a1], across [v0, v1], from y0 to y1. */
function box(b: MeshBuilder, at: Frame, a0: number, a1: number, v0: number, v1: number, y0: number, y1: number, color: string, top = color, alpha = ALPHA_NORMAL) {
  b.hexahedron([at(a0, v0, y0), at(a1, v0, y0), at(a1, v1, y0), at(a0, v1, y0), at(a0, v0, y1), at(a1, v0, y1), at(a1, v1, y1), at(a0, v1, y1)], color, top, alpha);
}

function museum(b: MeshBuilder, m: SiteBox) {
  const s = museumShape(m);
  const at = frame(m);
  const g = s.ground - 4;
  // The block and its rounded southern end, floodlit at night as the real one is.
  box(b, at, s.block.from, s.block.to, -s.block.halfWidth, s.block.halfWidth, g, s.wall, STONE, STONE_SHADE, ALPHA_FLOOD);
  const apse = at(s.apse.at, 0, 0);
  b.frustum(apse[0], apse[2], g, s.wall, s.apse.r, s.apse.r, 10, STONE, { capTop: true, color2: STONE_SHADE, alpha: ALPHA_FLOOD });
  // The hall behind the portico, and the copper dome over the atrium.
  box(b, at, s.attic.from, s.attic.to, -s.attic.halfWidth, s.attic.halfWidth, s.wall, s.attic.top, STONE, STONE_SHADE);
  const dome = at(s.dome.at, 0, 0);
  const rise = s.dome.top - s.wall;
  b.frustum(dome[0], dome[2], s.wall, s.wall + rise * 0.35, s.dome.r, s.dome.r, 10, STONE_SHADE);
  b.frustum(dome[0], dome[2], s.wall + rise * 0.35, s.wall + rise * 0.8, s.dome.r, s.dome.r * 0.62, 10, COPPER);
  b.frustum(dome[0], dome[2], s.wall + rise * 0.8, s.dome.top, s.dome.r * 0.62, 0.5, 10, COPPER, { capTop: true });
  // The portico: a row of columns standing clear of the front wall, under an entablature, above broad steps.
  const front = m.halfLength;
  const p = s.portico;
  for (let i = 0; i < p.columns; i++) {
    const v = -p.halfWidth + ((i + 0.5) / p.columns) * 2 * p.halfWidth;
    box(b, at, front + p.out - 0.9, front + p.out + 0.9, v - 0.9, v + 0.9, s.ground, p.top, STONE, STONE, ALPHA_FLOOD);
  }
  box(b, at, front - 0.5, front + p.out + 1.6, -p.halfWidth - 1.5, p.halfWidth + 1.5, p.top, s.wall, STONE, STONE_SHADE, ALPHA_FLOOD);
  // The wall behind the columns is in their shade, which is what makes them read as columns.
  box(b, at, front, front + 0.4, -p.halfWidth, p.halfWidth, s.ground, p.top, '#8f8a7c');
  box(b, at, front, front + p.out + 4, -p.halfWidth - 4, p.halfWidth + 4, g, s.ground - 0.6, STONE_SHADE);
  box(b, at, front, front + p.out + 1.8, -p.halfWidth - 2, p.halfWidth + 2, g, s.ground + 0.4, STONE_SHADE);
  // Windows along the two long sides: a band that glows at night.
  for (const side of [-1, 1]) {
    box(b, at, s.block.from + 6, s.block.to - 8, side * s.block.halfWidth, side * (s.block.halfWidth + 0.25), s.ground + 7, s.ground + 11, '#5a6672', '#5a6672', ALPHA_WINDOW);
  }
}

function edenPark(b: MeshBuilder, park: NonNullable<MapMeta['landmarks']['edenPark']>) {
  const pitch = park.pitch;
  // The pitch, mown in strips.
  const at = frame(pitch);
  const strips = 10;
  for (let i = 0; i < strips; i++) {
    const a0 = -pitch.halfLength + (i / strips) * 2 * pitch.halfLength;
    const a1 = -pitch.halfLength + ((i + 1) / strips) * 2 * pitch.halfLength;
    box(b, at, a0, a1, -pitch.halfWidth, pitch.halfWidth, pitch.groundY - 2, pitch.groundY + 0.6, i % 2 ? TURF : TURF_LIGHT);
  }
  // The stands: three tiers of seats stepping up and back from the pitch, a concourse wall
  // behind, and on the two big ones a roof reaching out over the seats.
  for (const s of park.stands) {
    const sf = frame(s);
    const face = standFacing(s, pitch);
    const w = s.halfWidth;
    const g = s.groundY - 4;
    const h = s.topY - s.groundY;
    const big = h > 20;
    const tiers = big ? [0.3, 0.58, 0.84] : [0.45, 0.8];
    // Across the stand: +face is the pitch side. Each tier is a block; the nearer the pitch, the lower.
    tiers.forEach((t, i) => {
      const inner = w - ((i + 0) / tiers.length) * 2 * w * 0.86;
      const outer = w - ((i + 1) / tiers.length) * 2 * w * 0.86;
      const v0 = Math.min(face * inner, face * outer);
      const v1 = Math.max(face * inner, face * outer);
      box(b, sf, -s.halfLength, s.halfLength, v0, v1, g, s.groundY + h * t, CONCRETE_DARK, i % 2 ? SEATS : SEATS_LIGHT);
    });
    // The back wall, with a band of windows that lights up at night.
    const back0 = Math.min(-face * w, -face * w * 0.72);
    const back1 = Math.max(-face * w, -face * w * 0.72);
    box(b, sf, -s.halfLength, s.halfLength, back0, back1, g, s.groundY + h * 0.92, CONCRETE, CONCRETE_DARK);
    box(b, sf, -s.halfLength * 0.94, s.halfLength * 0.94, -face * (w + 0.3), -face * w, s.groundY + h * 0.35, s.groundY + h * 0.5, '#5a6672', '#5a6672', ALPHA_WINDOW);
    if (big) {
      // The roof: a pale canopy from the back wall out over the top tier, on its supports.
      const r0 = Math.min(-face * w, face * w * 0.45);
      const r1 = Math.max(-face * w, face * w * 0.45);
      box(b, sf, -s.halfLength, s.halfLength, r0, r1, s.topY - 1.4, s.topY, CANOPY, CANOPY);
      for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) box(b, sf, a * s.halfLength - 0.8, a * s.halfLength + 0.8, -face * w * 0.74, -face * w * 0.66, s.groundY + h * 0.9, s.topY - 1.4, CONCRETE_DARK);
    }
  }
  // Floodlight towers: a mast, and a bank of lamps turned to the pitch.
  for (const f of floodlights(park)) {
    const top = f.groundY + FLOODLIGHT.height;
    b.frustum(f.x, f.z, f.groundY - 3, top, FLOODLIGHT.r, FLOODLIGHT.r * 0.6, 5, CONCRETE_DARK);
    const dx = pitch.x - f.x;
    const dz = pitch.z - f.z;
    const len = Math.hypot(dx, dz) || 1;
    const lamp = frame({ x: f.x, z: f.z, ux: dx / len, uz: dz / len });
    box(b, lamp, 0.4, 1.8, -5.5, 5.5, top - 2, top + 5, '#f4ecd2', '#f4ecd2', ALPHA_WINDOW);
  }
}

function silos(b: MeshBuilder, list: NonNullable<MapMeta['landmarks']['silos']>) {
  for (const s of list) {
    b.frustum(s.x, s.z, s.groundY - 3, s.topY, s.r, s.r, 10, SILO, { color2: '#c3bcab', capTop: true });
    // A rim and a low cap.
    b.frustum(s.x, s.z, s.topY, s.topY + 1.2, s.r * 0.94, s.r * 0.3, 10, SILO_CAP, { capTop: true });
  }
}

function crossing(b: MeshBuilder, w: NonNullable<MapMeta['landmarks']['wynyardCrossing']>) {
  const dx = w.b.x - w.a.x;
  const dz = w.b.z - w.a.z;
  const len = Math.hypot(dx, dz) || 1;
  const at = frame({ x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2, ux: dx / len, uz: dz / len });
  const hl = len / 2;
  const hw = w.halfWidth;
  const y = w.deckY;
  // The deck, its white rails, and the piers it stands on.
  box(b, at, -hl, hl, -hw, hw, y - 0.9, y, '#8b8f93', '#b9b5aa');
  for (const side of [-1, 1]) box(b, at, -hl, hl, side * hw, side * (hw + 0.35), y - 0.9, y + 1.3, WHITE);
  for (const a of [-0.38, -0.2, 0.2, 0.38]) box(b, at, a * len - 1.4, a * len + 1.4, -hw - 0.8, hw + 0.8, -6, y - 0.9, CONCRETE);
  // The two lifting spans meet in the middle; each swings up on a pair of white masts with a counterweight behind.
  for (const side of [-1, 1]) {
    const pivot = side * len * 0.2;
    for (const v of [-1, 1]) {
      b.beam(at(pivot, v * (hw + 1.2), y - 0.9), at(pivot - side * 2.5, v * (hw + 1.2), y + CROSSING_MAST), 1.1, 1.1, WHITE, [0, 0, 1]);
      // A stay from the masthead down to the tip of the span.
      b.beam(at(pivot - side * 2.5, v * (hw + 1.2), y + CROSSING_MAST), at(side * 1.5, v * (hw + 0.6), y + 1.2), 0.5, 0.5, WHITE, [0, 1, 0]);
    }
    box(b, at, pivot - side * 2.5 - 1.6, pivot - side * 2.5 + 1.6, -hw - 1.7, hw + 1.7, y + CROSSING_MAST - 1.2, y + CROSSING_MAST, WHITE);
  }
}

function cranes(b: MeshBuilder, port: NonNullable<MapMeta['landmarks']['port']>) {
  for (const c of port.cranes) {
    const s = craneShape(c, port.groundY);
    const at = frame(c);
    const half = s.gauge / 2;
    const w = s.width / 2;
    const leg = 2.4;
    const along: V3 = [c.ux, 0, c.uz];
    const acrossAxis: V3 = [-c.uz, 0, c.ux];
    // Four legs, tied along each rail at the foot and across at the portal.
    for (const a of [-half, half]) {
      for (const v of [-w, w]) b.beam(at(a, v, s.ground - 2), at(a, v, s.girder), leg, leg, CRANE, along);
      b.beam(at(a, -w, s.ground + 3), at(a, w, s.ground + 3), leg, leg * 1.4, CRANE, [0, 1, 0]);
      b.beam(at(a, -w, s.girder - 1.5), at(a, w, s.girder - 1.5), leg, leg, CRANE, [0, 1, 0]);
    }
    for (const v of [-w, w]) {
      b.beam(at(-half, v, s.girder - 14), at(half, v, s.girder - 14), leg, leg, CRANE, [0, 1, 0]);
      // A diagonal brace in each side.
      b.beam(at(-half, v, s.girder - 14), at(half, v, s.girder - 1.5), leg * 0.7, leg * 0.7, CRANE, acrossAxis);
    }
    // The main girder, running back over the yard, with the machinery house on it.
    box(b, at, -half - s.back, half, -3, 3, s.girder, s.girder + 4, CRANE_LIGHT, CRANE_LIGHT);
    box(b, at, -half - s.back * 0.7, -half + 4, -4.2, 4.2, s.girder + 4, s.girder + 9, CRANE_HOUSE, CRANE_HOUSE);
    // The A-frame over the waterside legs, and its back stay.
    for (const v of [-2.6, 2.6]) {
      b.beam(at(half, v, s.girder + 4), at(half - 4, v, s.apex), 1.6, 1.6, CRANE, acrossAxis);
      b.beam(at(half - 4, v, s.apex), at(-half - s.back * 0.8, v, s.girder + 4), 1, 1, CRANE, acrossAxis);
    }
    b.beam(at(half - 4, -2.6, s.apex), at(half - 4, 2.6, s.apex), 1.6, 1.6, CRANE, [0, 1, 0]);
    if (s.raised) {
      // Boom up, as they are parked: hinged at the waterside legs, standing almost upright.
      const tip = at(half + 9, 0, s.top);
      for (const v of [-2.2, 2.2]) b.beam(at(half + 1, v, s.girder + 2), at(half + 9, v, s.top), 2.4, 2.4, CRANE_LIGHT, acrossAxis);
      b.beam(at(half - 4, 0, s.apex), at(half + 6, 0, s.girder + (s.top - s.girder) * 0.62), 0.9, 0.9, CRANE, acrossAxis);
      b.frustum(tip[0], tip[2], s.top, s.top + 2.4, 1.3, 1.3, 4, '#d7263d', { capTop: true, alpha: ALPHA_BLINK });
    } else {
      // Boom down over the water, held by stays from the top of the frame.
      box(b, at, half, half + s.out, -2.6, 2.6, s.girder, s.girder + 3.4, CRANE_LIGHT, CRANE_LIGHT);
      for (const v of [-2.6, 2.6]) {
        b.beam(at(half - 4, v, s.apex), at(half + s.out * 0.55, v, s.girder + 3.4), 0.9, 0.9, CRANE, acrossAxis);
        b.beam(at(half - 4, v, s.apex), at(half + s.out * 0.95, v, s.girder + 3.4), 0.9, 0.9, CRANE, acrossAxis);
      }
      const peak = at(half - 4, 0, s.apex);
      b.frustum(peak[0], peak[2], s.apex + 0.8, s.apex + 3.2, 1.3, 1.3, 4, '#d7263d', { capTop: true, alpha: ALPHA_BLINK });
    }
  }
}

/** Every modelled landmark the map has, as one mesh; null if it has none. */
export function buildSites(meta: MapMeta): BufferGeometry | null {
  const l = meta.landmarks;
  const b = new MeshBuilder();
  if (l.museum) museum(b, l.museum);
  if (l.edenPark) edenPark(b, l.edenPark);
  if (l.silos) silos(b, l.silos);
  if (l.wynyardCrossing) crossing(b, l.wynyardCrossing);
  if (l.port) cranes(b, l.port);
  return b.triangleCount > 0 ? b.build() : null;
}

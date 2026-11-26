import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRID_STACK_SIZE, landmarkColliders } from '../src/shared/collision';
import {
  CONTAINER,
  CONTAINER_COLOURS,
  CROSSING_MAST,
  FLOODLIGHT,
  STACK_SIZE,
  containerStacks,
  craneShape,
  excludedBuildings,
  floodlights,
  inSiteBox,
  museumShape,
  siteColliders,
  standFacing,
  yardAxis,
} from '../src/shared/landmarkSites';
import { type BuildingRecord, type SiteBox, decodeBuildings, encodeBuildings } from '../src/shared/mapFormat';
import { buildSites } from '../src/world/landmarks/sites';
import { FAKE_DIR, REAL_DIR, loadWorld, realMapExists } from './flightWorld';

const site = (over: Partial<SiteBox> = {}): SiteBox => ({ x: 100, z: -50, ux: 0, uz: -1, halfLength: 60, halfWidth: 40, groundY: 10, roofY: 30, topY: 38, ...over });
const square = (x: number, z: number, s: number) => [x - s, z + s, x + s, z + s, x + s, z - s, x - s, z - s];

describe('a landmark and the plain buildings it replaces', () => {
  it('knows what is inside a site, whichever way it is turned', () => {
    const s = site({ ux: Math.SQRT1_2, uz: -Math.SQRT1_2 });
    expect(inSiteBox(s, 100, -50)).toBe(true);
    // 55 m along its long side, which runs north-east.
    expect(inSiteBox(s, 100 + 55 * Math.SQRT1_2, -50 - 55 * Math.SQRT1_2)).toBe(true);
    // 55 m across it: outside its 40 m half-width, inside with a 20 m margin.
    expect(inSiteBox(s, 100 + 55 * Math.SQRT1_2, -50 + 55 * Math.SQRT1_2)).toBe(false);
    expect(inSiteBox(s, 100 + 55 * Math.SQRT1_2, -50 + 55 * Math.SQRT1_2, 20)).toBe(true);
  });

  it('leaves out the buildings on a site and keeps its neighbours', () => {
    const list: BuildingRecord[] = [
      { rings: [square(100, -50, 30)], baseY: 10, topY: 30, style: 0 }, // the museum's own block
      { rings: [square(120, -90, 5)], baseY: 30, topY: 34, style: 0 }, // something on its roof
      { rings: [square(100, 40, 10)], baseY: 10, topY: 20, style: 0 }, // next door, 30 m beyond its end
      { rings: [square(-300, 0, 4)], baseY: 3, topY: 37, style: 0 }, // a silo
      { rings: [square(-300, 20, 4)], baseY: 3, topY: 12, style: 0 }, // a shed beside it
    ];
    const b = decodeBuildings(encodeBuildings(list));
    const landmarks = { museum: site(), silos: [{ x: -300, z: 0, r: 4.2, groundY: 3, topY: 37 }] } as never;
    expect(Array.from(excludedBuildings(b, landmarks))).toEqual([1, 1, 0, 1, 0]);
    expect(Array.from(excludedBuildings(b, undefined))).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(excludedBuildings(b, {} as never))).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('the shapes the models and the colliders share', () => {
  it('lays the museum out from front to back inside its own rectangle', () => {
    const m = site();
    const s = museumShape(m);
    expect(s.block.to).toBe(m.halfLength);
    expect(s.block.from).toBeLessThan(0);
    expect(s.apse.r).toBeLessThanOrEqual(m.halfWidth);
    // The drum at the back does not reach past the back of the rectangle.
    expect(s.apse.at - s.apse.r).toBeGreaterThanOrEqual(-m.halfLength - 1e-6);
    expect(s.dome.top).toBe(m.topY);
    expect(s.attic.top).toBeGreaterThan(s.wall);
    expect(s.attic.top).toBeLessThanOrEqual(m.topY);
    expect(s.portico.top).toBeLessThan(s.wall);
  });

  it('turns each stand to face the pitch, and stands a floodlight beyond each corner of it', () => {
    const pitch = site({ x: 0, z: 0, ux: 1, uz: 0, halfLength: 64, halfWidth: 40, groundY: 33, roofY: 33, topY: 33 });
    const north = site({ x: 0, z: -75, ux: 1, uz: 0 });
    const south = site({ x: 0, z: 75, ux: 1, uz: 0 });
    expect(standFacing(north, pitch)).toBe(1);
    expect(standFacing(south, pitch)).toBe(-1);
    // The same stand described the other way round faces the other way in its own terms, towards the same pitch.
    expect(standFacing({ ...north, ux: -1 }, pitch)).toBe(-1);
    const lights = floodlights({ stands: [north, south], pitch });
    expect(lights).toHaveLength(4);
    for (const f of lights) {
      expect(Math.abs(f.x)).toBeGreaterThan(pitch.halfLength);
      expect(Math.abs(f.z)).toBeGreaterThan(pitch.halfWidth);
    }
  });

  it('parks a tall crane with its boom up and a low one with it out over the water', () => {
    const up = craneShape({ x: 0, z: 0, ux: 0, uz: -1, topY: 123 }, 3);
    expect(up.raised).toBe(true);
    expect(up.out).toBe(0);
    expect(up.top).toBe(123);
    expect(up.apex).toBeLessThan(up.top);
    expect(up.girder).toBeLessThan(up.apex);
    const down = craneShape({ x: 0, z: 0, ux: 0, uz: -1, topY: 73 }, 3);
    expect(down.raised).toBe(false);
    expect(down.out).toBeGreaterThan(40);
    expect(down.apex).toBe(73);
    expect(down.girder).toBeGreaterThan(30);
  });
});

describe('container stacks', () => {
  // A yard 600 m by 300 m, long side east-west.
  const port = { ring: [0, 0, 600, 0, 600, -300, 0, -300], groundY: 3, cranes: [] };
  const stacks = containerStacks(port, () => true);
  const n = stacks.length / STACK_SIZE;

  it('fills the yard in rows along its longest side, clear of the quays', () => {
    const axis = yardAxis(port.ring);
    expect(Math.abs(axis.ux)).toBe(1);
    expect(Math.abs(axis.uz)).toBe(0);
    expect(n).toBeGreaterThan(150);
    expect(n).toBeLessThan(900);
    for (let i = 0; i < n; i++) {
      const [x, z, levels, colour] = [stacks[i * STACK_SIZE], stacks[i * STACK_SIZE + 1], stacks[i * STACK_SIZE + 2], stacks[i * STACK_SIZE + 3]];
      expect(x).toBeGreaterThan(34);
      expect(x).toBeLessThan(566);
      expect(z).toBeLessThan(-34);
      expect(z).toBeGreaterThan(-266);
      expect([1, 2, 3, 4]).toContain(levels);
      expect(colour).toBeLessThan(CONTAINER_COLOURS.length);
    }
  });

  it('never puts two in the same place, and has every height and colour in use', () => {
    const levels = new Set<number>();
    const colours = new Set<number>();
    for (let i = 0; i < n; i++) {
      levels.add(stacks[i * STACK_SIZE + 2]);
      colours.add(stacks[i * STACK_SIZE + 3]);
      for (let j = i + 1; j < n; j++) {
        const dx = Math.abs(stacks[i * STACK_SIZE] - stacks[j * STACK_SIZE]);
        const dz = Math.abs(stacks[i * STACK_SIZE + 1] - stacks[j * STACK_SIZE + 1]);
        expect(dx >= CONTAINER.length || dz >= CONTAINER.width, `stacks ${i} and ${j}`).toBe(true);
      }
    }
    expect(levels.size).toBe(4);
    expect(colours.size).toBe(CONTAINER_COLOURS.length);
  });

  it('is the same yard every time, and leaves alone ground that is not free', () => {
    expect(Array.from(containerStacks(port, () => true))).toEqual(Array.from(stacks));
    expect(containerStacks(port, () => false)).toHaveLength(0);
    const west = containerStacks(port, (x) => x < 300);
    expect(west.length).toBeGreaterThan(0);
    for (let i = 0; i < west.length; i += STACK_SIZE) expect(west[i]).toBeLessThan(300);
  });
});

describe('the fake map', () => {
  it('has none of these landmarks, so nothing is drawn, excluded or added', () => {
    const { meta, world } = loadWorld(FAKE_DIR);
    expect(buildSites(meta)).toBeNull();
    expect(siteColliders(meta.landmarks)).toEqual([]);
    expect(world.colliders.every((c) => /Sky Tower|Harbour Bridge/.test(c.name))).toBe(true);
  });
});

describe.runIf(realMapExists && existsSync(REAL_DIR))('the landmarks on the real map', () => {
  const { meta, world, grid } = loadWorld(REAL_DIR);
  const l = meta.landmarks;

  it('finds all five: the museum, Eden Park, the silos, the footbridge and the port', () => {
    expect(l.museum).toBeDefined();
    expect(l.edenPark?.stands).toHaveLength(4);
    expect(l.silos).toHaveLength(7);
    expect(l.wynyardCrossing).toBeDefined();
    expect(l.port?.cranes.length).toBeGreaterThanOrEqual(5);
    // The museum faces north, to the harbour, and stands about twenty metres high on its hill.
    expect(l.museum!.uz).toBeLessThan(-0.9);
    expect(l.museum!.roofY - l.museum!.groundY).toBeGreaterThan(14);
    expect(l.museum!.roofY - l.museum!.groundY).toBeLessThan(26);
    // The footbridge is about a hundred metres long, a few metres over the water.
    const w = l.wynyardCrossing!;
    expect(Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z)).toBeGreaterThan(80);
    expect(Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z)).toBeLessThan(130);
    expect(w.deckY).toBeLessThan(8);
    // One big silo and six smaller, all about 34 m tall.
    for (const s of l.silos!) expect(s.topY - s.groundY).toBeGreaterThan(28);
    expect(l.silos!.filter((s) => s.r > 6)).toHaveLength(1);
  });

  it('points every crane boom out over the water, from a foot on the quay', () => {
    for (const c of l.port!.cranes) {
      expect(Math.hypot(c.ux, c.uz)).toBeCloseTo(1, 2);
      expect(world.groundAt(c.x, c.z), `crane at ${c.x}, ${c.z}`).toBeGreaterThan(meta.water.level + 0.5);
      expect(world.groundAt(c.x + c.ux * 75, c.z + c.uz * 75), `75 m out from the crane at ${c.x}, ${c.z}`).toBeLessThanOrEqual(meta.water.level + 0.5);
      expect(c.topY).toBeGreaterThan(60);
      expect(c.topY).toBeLessThanOrEqual(125);
    }
  });

  it('can be hit at the top of every one of them, and flown over just above', () => {
    const tops: [string, number, number, number][] = [];
    const m = l.museum!;
    const ms = museumShape(m);
    tops.push(['museum roof', m.x, ms.wall, m.z]);
    tops.push(['museum dome', m.x + m.ux * ms.dome.at, ms.dome.top, m.z + m.uz * ms.dome.at]);
    for (const s of l.edenPark!.stands) tops.push(['a stand', s.x, s.topY, s.z]);
    for (const f of floodlights(l.edenPark!)) tops.push(['a floodlight', f.x, f.groundY + FLOODLIGHT.height, f.z]);
    for (const s of l.silos!) tops.push(['a silo', s.x, s.topY, s.z]);
    const w = l.wynyardCrossing!;
    tops.push(['the footbridge', (w.a.x + w.b.x) / 2, w.deckY, (w.a.z + w.b.z) / 2]);
    for (const c of l.port!.cranes) {
      const s = craneShape(c, l.port!.groundY);
      tops.push(['a crane frame', c.x, s.apex, c.z]);
      if (s.raised) tops.push(['a raised boom', c.x + c.ux * (s.gauge / 2 + 8), s.top, c.z + c.uz * (s.gauge / 2 + 8)]);
      else tops.push(['a lowered boom', c.x + c.ux * (s.gauge / 2 + s.out - 4), s.girder + 2, c.z + c.uz * (s.gauge / 2 + s.out - 4)]);
    }
    for (const [name, x, y, z] of tops) {
      expect(world.hitCollider(x, y - 1, z, 1), `${name} at its top`).not.toBeNull();
      expect(world.hitCollider(x, y + 14, z, 1), `${name} from 14 m above`).toBeNull();
    }
    expect(CROSSING_MAST).toBeGreaterThan(8);
  });

  it('draws them in few triangles, and none of their plain boxes with them', () => {
    const geometry = buildSites(meta)!;
    expect(geometry.getAttribute('position').count / 3).toBeLessThan(6000);
    // The solid grid no longer has the stands' or the museum's boxes: over the pitch-side seats it is the ground.
    const colliders = landmarkColliders(meta).map((c) => c.name);
    for (const name of ['Auckland Museum', 'Eden Park stand', 'Silo', 'Wynyard Crossing', 'Port crane']) expect(colliders).toContain(name);
  });

  it('stacks about seven hundred containers in the yard, on open ground, and makes them solid', () => {
    const stacks = grid.containers!;
    const n = stacks.length / GRID_STACK_SIZE;
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(1300);
    for (let i = 0; i < n; i++) {
      const [x, z, levels, , base] = [stacks[i * GRID_STACK_SIZE], stacks[i * GRID_STACK_SIZE + 1], stacks[i * GRID_STACK_SIZE + 2], stacks[i * GRID_STACK_SIZE + 3], stacks[i * GRID_STACK_SIZE + 4]];
      expect(base).toBeGreaterThan(meta.water.level);
      // As tall as it is drawn, or as whatever taller stack shares the cell.
      // (The grid keeps heights to a decimetre.)
      expect(world.solidAt(x, z)).toBeGreaterThanOrEqual(base + levels * CONTAINER.height - 0.11);
      // (A taller neighbour may share the cell, standing on ground a little higher.)
      expect(world.solidAt(x, z)).toBeLessThanOrEqual(base + 4 * CONTAINER.height + 1);
    }
  });
});

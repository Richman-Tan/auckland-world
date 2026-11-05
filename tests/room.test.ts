import { describe, expect, it } from 'vitest';
import { content } from '../src/content';
import { SKY_TOWER } from '../src/shared/collision';
import { LIFT_SIGN, PLATE, SKY_DECK, SKY_DECK_SPOTS, apothem, hotspotPoint } from '../src/room/layout';
import { WALK, hotspotAt, spawnWalker, stepWalker } from '../src/room/walker';

const r = (w: { x: number; z: number }) => Math.hypot(w.x, w.z);

describe('sky deck layout', () => {
  it('maps every screen to a real projects page and a video', () => {
    const pages = content.stops.find((s) => s.id === 'projects')!.briefing.map((p) => p.id);
    for (const s of SKY_DECK_SPOTS.filter((x) => x.kind === 'screen')) {
      expect(pages).toContain(s.pageId);
      expect(s.video).toMatch(/^\/media\/skydeck\/.+\.mp4$/);
    }
    expect(SKY_DECK_SPOTS.filter((s) => s.kind === 'lift')).toHaveLength(1);
    expect(new Set(SKY_DECK_SPOTS.map((s) => s.facet)).size).toBe(SKY_DECK_SPOTS.length);
  });
  it('keeps plates under their screens, on the core facet, and the lift sign under the ceiling', () => {
    const facetWidth = 2 * SKY_DECK.coreRadius * Math.sin(Math.PI / SKY_DECK.sides);
    expect(PLATE.width).toBeLessThan(facetWidth);
    expect(PLATE.y + PLATE.height / 2).toBeLessThan(0.98); // screen bezel starts at 0.98 m
    expect(PLATE.y - PLATE.height / 2).toBeGreaterThan(0.2);
    expect(LIFT_SIGN.y - LIFT_SIGN.height / 2).toBeGreaterThan(2.62); // above the lift frame
    expect(LIFT_SIGN.y + LIFT_SIGN.height / 2).toBeLessThan(SKY_DECK.height - 0.3); // below the header band
  });

  it('fits inside the pod', () => {
    expect(SKY_DECK.windowRadius).toBeLessThan(SKY_TOWER.podRadius);
    expect(SKY_DECK.coreRadius).toBeGreaterThan(SKY_TOWER.shaftRadius);
    expect(SKY_DECK.floor).toBeGreaterThan(SKY_TOWER.podBottom);
    expect(SKY_DECK.floor + SKY_DECK.height).toBeLessThan(SKY_TOWER.podTop);
  });
});

describe('walking', () => {
  it('starts at the lift, inside the ring', () => {
    const w = spawnWalker();
    expect(r(w)).toBeGreaterThan(SKY_DECK.coreRadius);
    expect(r(w)).toBeLessThan(apothem(SKY_DECK.windowRadius));
  });
  it('moves forward with W (negative pitch) and turns right with positive turn', () => {
    const w0 = { x: 10, z: 0, yaw: 0 };
    const w1 = stepWalker(w0, { turn: 0, pitch: -1 }, 1);
    expect(w1.z).toBeCloseTo(-WALK.speed);
    expect(stepWalker(w0, { turn: 1, pitch: 0 }, 1).yaw).toBeGreaterThan(0);
  });
  it('never walks into the core or through the windows', () => {
    let w = { x: 10, z: 0, yaw: Math.PI / 2 }; // facing +x, towards the windows
    for (let i = 0; i < 200; i++) w = stepWalker(w, { turn: 0, pitch: -1, boost: true }, 0.05);
    expect(r(w)).toBeLessThan(apothem(SKY_DECK.windowRadius));
    w = { x: 10, z: 0, yaw: -Math.PI / 2 }; // facing the core
    for (let i = 0; i < 200; i++) w = stepWalker(w, { turn: 0, pitch: -1, boost: true }, 0.05);
    expect(r(w)).toBeGreaterThanOrEqual(SKY_DECK.coreRadius + WALK.coreMargin - 1e-9);
  });
  it('finds the screen you are standing at and facing, not one behind you', () => {
    const dg = SKY_DECK_SPOTS[0];
    const p = hotspotPoint(dg, 2.5);
    const facing = Math.atan2(-p.x, p.z); // yaw that looks back towards the axis
    expect(hotspotAt({ x: p.x, z: p.z, yaw: facing })?.id).toBe('dementiaguide');
    expect(hotspotAt({ x: p.x, z: p.z, yaw: facing + Math.PI })).toBeNull();
    const far = hotspotPoint(dg, 9);
    expect(hotspotAt({ x: far.x, z: far.z, yaw: facing })).toBeNull();
  });
});

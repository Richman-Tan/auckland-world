import { describe, expect, it } from 'vitest';
import { createGovernor } from '../src/app/governor';

/** Run the governor at a steady frame rate for some seconds; returns the levels it passed through. */
function run(g: ReturnType<typeof createGovernor>, fps: number | ((level: number) => number), seconds: number): number[] {
  const seen = [g.level];
  let t = 0;
  while (t < seconds) {
    const rate = typeof fps === 'function' ? fps(g.level) : fps;
    const dt = 1 / rate;
    const level = g.sample(dt);
    if (level !== seen[seen.length - 1]) seen.push(level);
    t += dt;
  }
  return seen;
}

describe('frame-rate governor', () => {
  it('leaves full detail alone at a healthy frame rate', () => {
    const g = createGovernor({ levels: 4 });
    expect(run(g, 60, 60)).toEqual([0]);
    expect(run(g, 50, 60)).toEqual([0]);
    expect(g.fps).toBeGreaterThan(49);
  });

  it('ignores a brief dip and single hitches', () => {
    const g = createGovernor({ levels: 4 });
    run(g, 60, 5);
    expect(run(g, 20, 1.5)).toEqual([0]);
    run(g, 60, 5);
    // A tab switch or shader compile: one half-second frame, then normal again.
    for (let i = 0; i < 5; i++) {
      g.sample(0.5);
      run(g, 60, 1);
    }
    expect(g.level).toBe(0);
  });

  it('lowers detail a step at a time while frames stay slow, and stops when they recover', () => {
    const g = createGovernor({ levels: 4 });
    // 30 fps at full detail, 40 one step down, 60 from the second step: it should settle there.
    const load = (level: number) => [30, 40, 60, 60][level];
    const seen = run(g, load, 60);
    // Down to level 2, one probe back up to level 1 after a clean run (too slow, so down again)...
    expect(seen).toEqual([0, 1, 2, 1, 2]);
    // ...and then it stays put instead of probing for ever.
    expect(run(g, load, 300)).toEqual([2]);
  });

  it('never goes below the lowest level', () => {
    const g = createGovernor({ levels: 3 });
    // Slow everywhere, but much better at the bottom than at the top (so it is not a capped rate).
    run(g, (level) => [15, 22, 35][level], 120);
    expect(g.level).toBe(2);
  });

  it('raises detail again after a long clean run', () => {
    const g = createGovernor({ levels: 4 });
    run(g, (level) => (level === 0 ? 30 : 60), 10);
    expect(g.level).toBe(1);
    // The load goes away (the visitor flew out of the dense CBD): back to full detail, and it holds.
    expect(run(g, 60, 40)).toEqual([1, 0]);
    expect(run(g, 60, 60)).toEqual([0]);
  });

  it('stops trying a level that brings the stutter straight back', () => {
    const g = createGovernor({ levels: 4 });
    // Full detail is always too slow, one step down is always fine: after one failed attempt to go
    // back up it must settle on level 1 rather than flip between the two for ever.
    const seen = run(g, (level) => (level === 0 ? 30 : 60), 300);
    expect(seen).toEqual([0, 1, 0, 1]);
    expect(g.level).toBe(1);
  });

  it('gives the detail back when lowering it changes nothing (a capped frame rate)', () => {
    const g = createGovernor({ levels: 4 });
    // A 30 Hz low-power mode: 30 fps whatever is drawn.
    const seen = run(g, 30, 120);
    expect(seen[seen.length - 1]).toBe(0);
    expect(Math.max(...seen)).toBe(3);
    // And it does not start hunting again.
    expect(run(g, 30, 120)).toEqual([0]);
    // Until told to start over.
    g.reset();
    run(g, (level) => (level === 0 ? 30 : 60), 10);
    expect(g.level).toBe(1);
  });

  it('with a single level there is nothing to adjust', () => {
    const g = createGovernor({ levels: 1 });
    expect(run(g, 10, 60)).toEqual([0]);
  });

  it('tolerates zero, negative and NaN frame times', () => {
    const g = createGovernor({ levels: 4 });
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(g.sample(dt)).toBe(0);
    expect(Number.isFinite(g.fps)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { type PadSnapshot, readPad } from '../src/input/gamepad';

function pad(over: { axes?: number[]; down?: number[]; values?: Record<number, number> } = {}): PadSnapshot {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: !!over.down?.includes(i),
    value: over.values?.[i] ?? (over.down?.includes(i) ? 1 : 0),
  }));
  return { axes: over.axes ?? [0, 0, 0, 0], buttons };
}

describe('gamepad', () => {
  it('a centred or slightly drifting stick reads as no input', () => {
    expect(readPad(pad(), [], 'flight').stick).toBeNull();
    expect(readPad(pad({ axes: [0.1, -0.12] }), [], 'flight').stick).toBeNull();
  });

  it('the left stick steers, ramping from the edge of the deadzone to full deflection', () => {
    const right = readPad(pad({ axes: [1, 0] }), [], 'flight').stick!;
    expect(right.x).toBeCloseTo(1, 5);
    expect(right.y).toBeCloseTo(0, 5);
    const down = readPad(pad({ axes: [0, 1] }), [], 'flight').stick!;
    expect(down.y).toBeCloseTo(1, 5);
    const half = readPad(pad({ axes: [0.59, 0] }), [], 'flight').stick!;
    expect(half.x).toBeCloseTo(0.5, 2);
    const just = readPad(pad({ axes: [0.2, 0] }), [], 'flight').stick!;
    expect(just.x).toBeGreaterThan(0);
    expect(just.x).toBeLessThan(0.05);
    // A worn stick pushed past 1 on the diagonal is still clamped.
    const diag = readPad(pad({ axes: [1, 1] }), [], 'flight').stick!;
    expect(Math.hypot(diag.x, diag.y)).toBeLessThanOrEqual(1.0001);
  });

  it('either the right trigger or the right bumper boosts', () => {
    expect(readPad(pad(), [], 'flight').boost).toBe(false);
    expect(readPad(pad({ values: { 7: 0.2 } }), [], 'flight').boost).toBe(false);
    expect(readPad(pad({ values: { 7: 0.6 } }), [], 'flight').boost).toBe(true);
    expect(readPad(pad({ down: [5] }), [], 'flight').boost).toBe(true);
  });

  it('buttons emit their action once per press, not while held', () => {
    const first = readPad(pad({ down: [0, 3] }), [], 'flight');
    expect(first.actions).toEqual(['briefing', 'nav']);
    const held = readPad(pad({ down: [0, 3] }), first.pressed, 'flight');
    expect(held.actions).toEqual([]);
    const released = readPad(pad(), held.pressed, 'flight');
    expect(released.actions).toEqual([]);
    expect(readPad(pad({ down: [0] }), released.pressed, 'flight').actions).toEqual(['briefing']);
  });

  it('covers every action the keyboard has', () => {
    const all = readPad(pad({ down: [0, 1, 2, 3, 4, 8, 9, 14, 15] }), [], 'flight').actions;
    expect(all).toEqual(['briefing', 'interact', 'back', 'nav', 'menu', 'help', 'prev', 'next', 'nextStop']);
  });

  it('A confirms in a dialog (Enter) and reads or uses while flying (Space)', () => {
    expect(readPad(pad({ down: [0] }), [], 'dialog').actions).toEqual(['engage']);
    expect(readPad(pad({ down: [0] }), [], 'flight').actions).toEqual(['briefing']);
  });

  it('copes with a controller that reports fewer buttons or axes', () => {
    const r = readPad({ axes: [], buttons: [{ pressed: true, value: 1 }] }, [], 'flight');
    expect(r.stick).toBeNull();
    expect(r.boost).toBe(false);
    expect(r.actions).toEqual(['briefing']);
  });
});

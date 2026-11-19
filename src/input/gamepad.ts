/**
 * Gamepad mapping, as a pure function of one controller snapshot so it can be unit-tested in Node.
 * index.ts does the polling. Uses the "standard" layout (Xbox naming):
 *
 *   left stick   steer and pitch (walk, inside a room)
 *   RT or RB     boost
 *   A            read or talk at a beacon, use what you face; in a dialog, confirm (same as Enter)
 *   X            land at a stop with a room
 *   B            back / close
 *   Y            destinations map
 *   Start        pause menu (and again to resume)
 *   Select       show the keys
 *   D-pad ← →    page through a briefing, move through the map list
 *   LB           next stop (in a briefing)
 */
import type { InputAction } from '../app/contracts';

export interface PadSnapshot {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface PadRead {
  /** Left stick, each axis -1..1 (y: +1 = down), or null inside the deadzone. */
  stick: { x: number; y: number } | null;
  boost: boolean;
  /** Actions for buttons that went down since the previous read. */
  actions: InputAction[];
  /** Button states to pass back in as `prev` next time. */
  pressed: boolean[];
}

/** Worn sticks rest a little off centre; ignore that much. */
const DEADZONE = 0.18;
const TRIGGER = 0.35;

const BUTTON = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, rt: 7, select: 8, start: 9, left: 14, right: 15 } as const;

export function readPad(pad: PadSnapshot, prev: readonly boolean[], mode: 'flight' | 'dialog' | 'chat' | 'off'): PadRead {
  const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
  const went = (i: number) => !!pressed[i] && !prev[i];

  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  const mag = Math.hypot(x, y);
  // Rescale so the stick ramps from 0 at the edge of the deadzone instead of jumping.
  const k = mag > DEADZONE ? Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag : 0;
  const stick = k > 0 ? { x: x * k, y: y * k } : null;

  const boost = (pad.buttons[BUTTON.rt]?.value ?? 0) > TRIGGER || !!pressed[BUTTON.rb];

  const actions: InputAction[] = [];
  if (went(BUTTON.a)) actions.push(mode === 'dialog' ? 'engage' : 'briefing');
  if (went(BUTTON.x)) actions.push('interact');
  if (went(BUTTON.b)) actions.push('back');
  if (went(BUTTON.y)) actions.push('nav');
  if (went(BUTTON.start)) actions.push('menu');
  if (went(BUTTON.select)) actions.push('help');
  if (went(BUTTON.left)) actions.push('prev');
  if (went(BUTTON.right)) actions.push('next');
  if (went(BUTTON.lb)) actions.push('nextStop');
  return { stick, boost, actions, pressed };
}

/**
 * DOM-free input logic: key routing by mode, drag and stick analogue values, action emission.
 * The DOM wiring lives in index.ts and touch.ts so this can be unit-tested in Node.
 */
import type { Controls, InputAction } from '../app/contracts';

/**
 * Pitch sense. Default (not inverted): W / stick-up = nose down, S / stick-down = nose up, like a
 * flight yoke. Inverted flips keys, mouse drag, the touch stick and a gamepad together. It is a
 * visitor setting (src/app/settings.ts), changed at runtime with setInvertPitch.
 */
export interface InputCoreOptions {
  invertPitch?: boolean;
}

/** 'chat' passes every key through to the page except Esc, which closes the chat even while typing. */
export type InputMode = 'flight' | 'dialog' | 'chat' | 'off';

export interface KeyLike {
  code: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when the event target is an input, textarea, select or contenteditable. */
  editable?: boolean;
  /** True while an IME composition is in progress. */
  composing?: boolean;
  /** True when the event target is a button, link or other control the browser activates with Enter or Space. */
  interactive?: boolean;
}

const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const NOSE_DOWN = ['KeyW', 'ArrowUp'];
const NOSE_UP = ['KeyS', 'ArrowDown'];
const BOOST = ['ShiftLeft', 'ShiftRight'];
const STEER_KEYS = new Set([...LEFT, ...RIGHT, ...NOSE_DOWN, ...NOSE_UP]);

const ACTION_KEYS: Record<string, InputAction> = {
  Space: 'briefing',
  Tab: 'nav',
  KeyM: 'nav',
  Escape: 'back',
  Enter: 'engage',
  NumpadEnter: 'engage',
  KeyE: 'interact',
  KeyH: 'help',
};
/**
 * Tab is deliberately absent: in a dialog it belongs to the browser, so focus can move between the
 * buttons. M still toggles the destinations map.
 */
const DIALOG_KEYS: Record<string, InputAction> = {
  // E: land from a briefing at a stop with a room, or close a room's page and keep walking.
  KeyE: 'interact',
  KeyM: 'nav',
  // N: on to the next stop from a briefing.
  KeyN: 'nextStop',
  Escape: 'back',
  Enter: 'engage',
  NumpadEnter: 'engage',
};

const ACTIVATE_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

const DRAG_DEADZONE_PX = 6;
const DRAG_FULL_PX = 110;
const STICK_DEADZONE = 0.12;

/** 'Digit3' / 'Numpad3' -> 3, else 0. */
function digitOf(code: string): number {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? Number(m[1]) : 0;
}

const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

export interface InputCore {
  /** Returns true when the key event was consumed and the caller should preventDefault. */
  keyDown(e: KeyLike): boolean;
  keyUp(e: KeyLike): void;
  /** Window lost focus: release everything. */
  blur(): void;
  setMode(mode: InputMode): void;
  readonly mode: InputMode;
  dragStart(x: number, y: number): void;
  dragMove(x: number, y: number): void;
  dragEnd(): void;
  /** Touch stick, each axis -1..1 (screen y: +1 = down). null releases. */
  setStick(v: { x: number; y: number } | null): void;
  setTouchBoost(on: boolean): void;
  /** Gamepad stick (already past its own deadzone) and boost. null releases. */
  setPad(v: { x: number; y: number; boost: boolean } | null): void;
  setInvertPitch(on: boolean): void;
  /** Called whenever the mode changes (the touch overlay hides outside flight). */
  onMode(cb: (mode: InputMode) => void): () => void;
  /** Emit an action as if a key had been pressed (touch buttons). Respects the mode. */
  trigger(action: InputAction): void;
  controls(): Controls;
  hasFlightInput(): boolean;
  onAction(cb: (a: InputAction) => void): () => void;
}

export function createInputCore(opts: InputCoreOptions = {}): InputCore {
  const down = new Set<string>();
  const listeners = new Set<(a: InputAction) => void>();
  const modeListeners = new Set<(m: InputMode) => void>();
  let mode: InputMode = 'flight';
  let drag: { x0: number; y0: number; x: number; y: number } | null = null;
  let stick: { x: number; y: number } | null = null;
  let touchBoost = false;
  let pad: { x: number; y: number; boost: boolean } | null = null;
  let sign = opts.invertPitch ? -1 : 1;

  const emit = (a: InputAction) => {
    for (const cb of [...listeners]) cb(a);
  };
  const anyDown = (codes: string[]) => codes.some((c) => down.has(c));

  function dragAxes() {
    if (!drag) return { turn: 0, pitch: 0 };
    const dx = drag.x - drag.x0;
    const dy = drag.y - drag.y0;
    const ax = (v: number) => (Math.abs(v) < DRAG_DEADZONE_PX ? 0 : clamp1((v - Math.sign(v) * DRAG_DEADZONE_PX) / (DRAG_FULL_PX - DRAG_DEADZONE_PX)));
    // Drag right = turn right. Drag down = nose up (same sense as the stick).
    return { turn: ax(dx), pitch: sign * ax(dy) };
  }
  function stickAxes() {
    if (!stick) return { turn: 0, pitch: 0 };
    const ax = (v: number) => (Math.abs(v) < STICK_DEADZONE ? 0 : clamp1((v - Math.sign(v) * STICK_DEADZONE) / (1 - STICK_DEADZONE)));
    return { turn: ax(stick.x), pitch: sign * ax(stick.y) };
  }

  function controls(): Controls {
    if (mode !== 'flight') return { turn: 0, pitch: 0, boost: false };
    const kTurn = (anyDown(RIGHT) ? 1 : 0) - (anyDown(LEFT) ? 1 : 0);
    const kPitch = sign * ((anyDown(NOSE_UP) ? 1 : 0) - (anyDown(NOSE_DOWN) ? 1 : 0));
    const d = dragAxes();
    const s = stickAxes();
    return {
      turn: clamp1(kTurn + d.turn + s.turn + (pad?.x ?? 0)),
      pitch: clamp1(kPitch + d.pitch + s.pitch + sign * (pad?.y ?? 0)),
      boost: anyDown(BOOST) || touchBoost || !!pad?.boost,
    };
  }

  return {
    get mode() {
      return mode;
    },
    keyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const code = e.code;
      if (mode === 'chat') {
        if (code !== 'Escape' || e.repeat || e.composing) return false;
        emit('back');
        return true;
      }
      if (e.editable) return false;
      down.add(code);
      if (mode === 'off') return false;
      if (mode === 'flight') {
        if (STEER_KEYS.has(code) || BOOST.includes(code)) return true;
        const a = ACTION_KEYS[code] ?? (digitOf(code) ? (`select${digitOf(code)}` as InputAction) : undefined);
        if (!a) return false;
        if (!e.repeat) emit(a);
        return code === 'Tab' || code === 'Space';
      }
      // dialog
      // Enter or Space on a focused button or link activates that control and nothing else; without
      // this, Enter on "Controls help" would also resume the game.
      if (e.interactive && ACTIVATE_KEYS.has(code)) return false;
      if (!e.repeat) {
        if (LEFT.includes(code)) emit('prev');
        else if (RIGHT.includes(code)) emit('next');
        else {
          const a = DIALOG_KEYS[code] ?? (digitOf(code) ? (`select${digitOf(code)}` as InputAction) : undefined);
          if (!a) return false;
          emit(a);
          return false;
        }
        return true;
      }
      return LEFT.includes(code) || RIGHT.includes(code);
    },
    keyUp(e) {
      down.delete(e.code);
    },
    blur() {
      down.clear();
      drag = null;
      stick = null;
      touchBoost = false;
      pad = null;
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      if (m !== 'flight') {
        drag = null;
        stick = null;
        touchBoost = false;
      }
      for (const cb of [...modeListeners]) cb(m);
    },
    dragStart(x, y) {
      if (mode === 'flight') drag = { x0: x, y0: y, x, y };
    },
    dragMove(x, y) {
      if (drag) {
        drag.x = x;
        drag.y = y;
      }
    },
    dragEnd() {
      drag = null;
    },
    setStick(v) {
      stick = mode === 'flight' ? v : null;
    },
    setTouchBoost(on) {
      touchBoost = mode === 'flight' && on;
    },
    setPad(v) {
      // Polled every frame, so unlike a touch it needs no clearing when the mode changes:
      // controls() already returns nothing outside flight.
      pad = v;
    },
    setInvertPitch(on) {
      sign = on ? -1 : 1;
    },
    onMode(cb) {
      modeListeners.add(cb);
      return () => modeListeners.delete(cb);
    },
    trigger(a) {
      if (mode !== 'off') emit(a);
    },
    controls,
    hasFlightInput() {
      if (mode !== 'flight') return false;
      const c = controls();
      return c.boost || Math.abs(c.turn) > 0.05 || Math.abs(c.pitch) > 0.05;
    },
    onAction(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

import type { InputAction, InputSystem } from '../app/contracts';
import { type InputCore, type KeyLike, createInputCore } from './core';

export { INVERT_PITCH } from './core';
export { createInputCore } from './core';

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** Controls the browser activates itself on Enter or Space. */
function isInteractive(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'SUMMARY') return true;
  if (tag === 'A') return el.hasAttribute('href');
  return el.getAttribute?.('role') === 'button';
}

const toKey = (e: KeyboardEvent): KeyLike => ({
  code: e.code,
  repeat: e.repeat,
  ctrlKey: e.ctrlKey,
  metaKey: e.metaKey,
  altKey: e.altKey,
  editable: isEditable(e.target),
  composing: e.isComposing,
  interactive: isInteractive(e.target),
});

/**
 * Keyboard, mouse-drag and touch input. Only this module listens to keys.
 * Touch controls are created when the device reports a coarse pointer or on the first touch.
 */
export function createInput(opts: { canvas: HTMLCanvasElement; touchRoot: HTMLElement }): InputSystem {
  const { canvas, touchRoot } = opts;
  const core: InputCore = createInputCore();

  const onKeyDown = (e: KeyboardEvent) => {
    if (core.keyDown(toKey(e))) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => core.keyUp(toKey(e));
  const onBlur = () => core.blur();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // Mouse (and pen): hold and drag on the canvas. No pointer lock.
  let dragId: number | null = null;
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.button !== 0 || dragId !== null) return;
    dragId = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);
    core.dragStart(e.clientX, e.clientY);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId === dragId) core.dragMove(e.clientX, e.clientY);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    core.dragEnd();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onPointerUp);

  // Touch controls, lazily.
  let touch: { dispose(): void } | null = null;
  let disposed = false;
  const mountTouch = async () => {
    if (touch || disposed) return;
    touch = { dispose() {} }; // reserve while the module loads
    const { createTouchControls } = await import('./touch');
    if (disposed) return;
    touch = createTouchControls(touchRoot, core);
  };
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const onFirstTouch = () => {
    window.removeEventListener('touchstart', onFirstTouch);
    void mountTouch();
  };
  if (coarse) void mountTouch();
  else window.addEventListener('touchstart', onFirstTouch, { passive: true });

  return {
    controls: () => core.controls(),
    hasFlightInput: () => core.hasFlightInput(),
    onAction(cb: (a: InputAction) => void) {
      return core.onAction(cb);
    },
    setMode(m) {
      core.setMode(m);
    },
    dispose() {
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('touchstart', onFirstTouch);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      touch?.dispose();
      core.blur();
    },
  };
}

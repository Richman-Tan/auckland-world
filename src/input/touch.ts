import type { InputCore } from './core';
import './touch.css';

const STICK_R = 54;

/** Virtual stick (bottom left), BOOST / MAP / READ buttons (bottom right) and MENU (top left). */
export function createTouchControls(root: HTMLElement, core: InputCore): { dispose(): void } {
  const wrap = document.createElement('div');
  wrap.className = 'aw-touch';

  const stick = document.createElement('div');
  stick.className = 'aw-stick';
  stick.setAttribute('role', 'application');
  stick.setAttribute('aria-label', 'Flight stick');
  const thumb = document.createElement('div');
  thumb.className = 'aw-stick-thumb';
  stick.append(thumb);

  const btns = document.createElement('div');
  btns.className = 'aw-btns';
  const mk = (label: string, cls: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `aw-btn ${cls}`;
    b.textContent = label;
    return b;
  };
  const boost = mk('BOOST', 'aw-btn-boost');
  const map = mk('MAP', '');
  const read = mk('READ', '');
  btns.append(boost, map, read);
  // The only way to the pause menu, and so to the settings, without a keyboard.
  const menu = mk('MENU', 'aw-btn-menu');
  wrap.append(stick, btns, menu);
  root.append(wrap);
  // The stick and buttons only mean something while flying or walking; over the title screen, a
  // briefing sheet or the chat they just cover the page (each of those has its own buttons).
  const showFor = (mode: InputCore['mode']) => (wrap.hidden = mode !== 'flight');
  showFor(core.mode);
  const offMode = core.onMode(showFor);

  let stickId: number | null = null;
  const place = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > STICK_R) {
      dx = (dx / l) * STICK_R;
      dy = (dy / l) * STICK_R;
    }
    thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    core.setStick({ x: dx / STICK_R, y: dy / STICK_R });
  };
  const release = () => {
    stickId = null;
    thumb.style.transform = '';
    core.setStick(null);
  };
  const onDown = (e: PointerEvent) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    place(e);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId === stickId) place(e);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === stickId) release();
  };
  stick.addEventListener('pointerdown', onDown);
  stick.addEventListener('pointermove', onMove);
  stick.addEventListener('pointerup', onUp);
  stick.addEventListener('pointercancel', onUp);
  stick.addEventListener('lostpointercapture', onUp);

  const boostOn = (e: PointerEvent) => {
    boost.setPointerCapture(e.pointerId);
    boost.dataset.on = 'true';
    core.setTouchBoost(true);
    e.preventDefault();
  };
  const boostOff = () => {
    boost.dataset.on = 'false';
    core.setTouchBoost(false);
  };
  boost.addEventListener('pointerdown', boostOn);
  boost.addEventListener('pointerup', boostOff);
  boost.addEventListener('pointercancel', boostOff);
  boost.addEventListener('lostpointercapture', boostOff);
  const onMap = () => core.trigger('nav');
  const onRead = () => core.trigger('briefing');
  map.addEventListener('click', onMap);
  read.addEventListener('click', onRead);
  menu.addEventListener('click', () => core.trigger('menu'));

  return {
    dispose() {
      offMode();
      core.setStick(null);
      core.setTouchBoost(false);
      wrap.remove();
    },
  };
}

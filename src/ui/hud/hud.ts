/** The flight HUD: compass, bottom deck, prompt, off-screen arrow, pull-up warning, toasts. */
import type { AppEvent, PromptInfo, Telemetry, UiWorld } from '../../app/contracts';
import type { SettingsStore } from '../../app/settings';
import { h, setHidden, setText } from '../dom';
import { edgeArrow, formatDistance, hudLine } from '../format';
import { drawRadar } from '../minimap';
import { COMPASS_H, COMPASS_W, drawCompass } from './compass';

const RADAR_PX = 96;
const RADAR_RANGE_M = 1800;
const SEGMENTS = 10;
export const HUD_INTERVAL_MS = 1000 / 15;

export interface Hud {
  el: HTMLElement;
  update(t: Telemetry): void;
  setWorld(world: UiWorld, minimap: HTMLImageElement | null): void;
  setPrompt(p: PromptInfo | null): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
  setActive(active: boolean): void;
  setAutopilotLabel(text: string | null): void;
  /** Pixel scale (the --px value) for tape offsets. */
  setPixelScale(px: number): void;
}

export function createHud(dispatch: (e: AppEvent) => void, settings?: SettingsStore, now: () => number = () => performance.now()): Hud {
  let px = 3;
  let world: UiWorld | null = null;
  let minimap: HTMLImageElement | null = null;
  let active = false;
  let lastAt = -Infinity;
  const cache: Record<string, string> = {};
  const changed = (k: string, v: string) => (cache[k] === v ? false : ((cache[k] = v), true));

  const compass = h('canvas', { class: 'aw-hud__compass-c', width: COMPASS_W, height: COMPASS_H, 'aria-hidden': 'true' });
  const compassWrap = h('div', { class: 'aw-hud__compass' }, compass);
  const apChip = h('div', { class: 'aw-hud__ap', hidden: true, role: 'status' });

  const speedNum = h('span', { class: 'aw-hud__num', text: '0' });
  const speedTape = h('div', { class: 'aw-hud__tape' });
  const boost = h('div', { class: 'aw-hud__boost', role: 'img', 'aria-label': 'Boost reserve' });
  const segs: HTMLElement[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const s = h('i');
    segs.push(s);
    boost.append(s);
  }
  const speed = h(
    'div',
    { class: 'aw-hud__speed' },
    h('div', { class: 'aw-hud__label', text: 'Speed' }),
    h('div', {}, speedNum, h('span', { class: 'aw-hud__unit', text: 'KM/H' })),
    speedTape,
    boost,
  );

  const radar = h('canvas', { class: 'aw-hud__radar', width: RADAR_PX, height: RADAR_PX, 'aria-hidden': 'true' });
  const line = h('div', { class: 'aw-hud__line', 'aria-live': 'off' });
  const mid = h('div', { class: 'aw-hud__mid' }, line);

  const altNum = h('span', { class: 'aw-hud__num', text: '0' });
  const altTape = h('div', { class: 'aw-hud__alttape' });
  const alt = h(
    'div',
    { class: 'aw-hud__alt' },
    h('div', { class: 'aw-hud__label', text: 'Alt' }),
    h('div', {}, altNum, h('span', { class: 'aw-hud__unit', text: 'M' })),
    altTape,
  );

  const deck = h('div', { class: 'aw-hud__deck aw-panel' }, speed, radar, mid, alt);
  const pullUp = h('div', { class: 'aw-pullup', role: 'alert', hidden: true, text: 'PULL UP' });
  const arrowTxt = h('span', { class: 'aw-arrow__txt' });
  const arrowTri = h('div', { class: 'aw-arrow__tri' });
  const arrow = h('div', { class: 'aw-arrow', hidden: true, 'aria-hidden': 'true' }, arrowTri, arrowTxt);
  const toasts = h('div', { class: 'aw-toasts', role: 'status', 'aria-live': 'polite' });
  // The approach prompt: where you are, and one button per thing you can do there, so each is a
  // single tap on a phone (the key hints are hidden on touch screens by CSS).
  const prompt = h('div', { class: 'aw-prompt', role: 'group', hidden: true });

  // Sound is off until asked for; this is the quick way to it (the pause menu has the same switch).
  const soundBtn = settings ? h('button', { class: 'aw-hud__sound', type: 'button' }) : null;
  if (settings && soundBtn) {
    const paint = () => {
      const on = settings.get().sound;
      soundBtn.textContent = on ? 'Sound on' : 'Sound off';
      soundBtn.setAttribute('aria-pressed', String(on));
    };
    soundBtn.addEventListener('click', () => settings.set({ sound: !settings.get().sound }));
    settings.subscribe(paint);
    paint();
  }

  const el = h('div', { class: 'aw-hud', hidden: true }, compassWrap, apChip, deck, pullUp, arrow, prompt, toasts, soundBtn);


  const cctx = compass.getContext('2d');
  const rctx = radar.getContext('2d');
  let lastPlane = { x: 0, z: 0, headingRad: 0 };

  function paintRadar(): void {
    if (rctx) drawRadar(rctx, RADAR_PX, minimap, world, lastPlane, RADAR_RANGE_M);
  }
  paintRadar();

  function update(t: Telemetry): void {
    if (!active) return;
    const n = now();
    if (n - lastAt < HUD_INTERVAL_MS) return;
    lastAt = n;

    const kmh = Math.round(t.speedKmh);
    if (changed('speed', String(kmh))) {
      setText(speedNum, String(kmh));
      speedTape.style.backgroundPositionX = `${Math.round(-(kmh / 5) * 4) * px}px`;
    }
    const seg = Math.round(Math.min(1, Math.max(0, t.boost)) * SEGMENTS);
    if (changed('boost', `${seg}${t.boosting}`)) {
      segs.forEach((s, i) => s.classList.toggle('on', i < seg));
      boost.dataset.boosting = String(t.boosting);
      boost.dataset.low = String(seg <= 2 && !t.boosting);
      boost.setAttribute('aria-label', `Boost reserve ${seg * 10} percent`);
    }
    const m = Math.round(t.altitudeAsl);
    if (changed('alt', String(m))) {
      setText(altNum, String(m));
      altTape.style.backgroundPositionY = `${Math.round((m / 10) * 4) * px}px`;
    }

    const tgt = t.target;
    const text = hudLine({ place: t.place, headingDeg: t.headingDeg, target: tgt, pullUp: t.pullUp });
    if (changed('line', text)) {
      setText(line, text);
      line.dataset.warn = String(t.pullUp);
    }

    const hd = Math.round(t.headingDeg);
    const compassKey = `${hd}|${tgt ? `${tgt.id}${Math.round(tgt.bearingDeg)}` : '-'}`;
    if (cctx && changed('compass', compassKey)) {
      drawCompass(cctx, t.headingDeg, tgt ? { bearingDeg: tgt.bearingDeg, label: `${tgt.label} ${formatDistance(tgt.distanceM)}` } : null);
    }

    const p = t.plane;
    if (changed('plane', `${Math.round(p.x / 4)}|${Math.round(p.z / 4)}|${Math.round(p.headingRad * 30)}`)) {
      lastPlane = p;
      paintRadar();
    }

    setHidden(pullUp, !t.pullUp);

    const showArrow = !!tgt && !tgt.onScreen;
    setHidden(arrow, !showArrow);
    if (tgt && showArrow) {
      const w = el.clientWidth || window.innerWidth;
      const hh = el.clientHeight || window.innerHeight;
      const a = edgeArrow(tgt.relativeDeg, w, hh);
      const k = `${Math.round(a.x / 2)}|${Math.round(a.y / 2)}|${Math.round(a.rotDeg / 3)}|${Math.round(tgt.distanceM / 10)}`;
      if (changed('arrow', k)) {
        arrow.style.left = `${Math.round(a.x)}px`;
        arrow.style.top = `${Math.round(a.y)}px`;
        arrowTri.style.transform = `rotate(${Math.round(a.rotDeg)}deg)`;
        setText(arrowTxt, `${tgt.label} ${formatDistance(tgt.distanceM)}`);
      }
    }
  }

  return {
    el,
    update,
    setWorld(w, img) {
      world = w;
      minimap = img;
      paintRadar();
    },
    setPrompt(p) {
      if (!p) {
        setHidden(prompt, true);
        return;
      }
      prompt.replaceChildren(h('span', { class: 'aw-prompt__where', text: `${p.place} · ${p.label}` }));
      for (const a of p.actions) {
        const b = h('button', { class: 'aw-prompt__act', type: 'button' }, h('b', { class: 'aw-prompt__key', text: `[${a.key}]` }), document.createTextNode(` ${a.label}`));
        b.addEventListener('click', () => dispatch(a.action === 'interact' ? { type: 'ENTER_ROOM', stop: p.stop } : { type: 'OPEN_BRIEFING', stop: p.stop }));
        prompt.append(b);
      }
      prompt.setAttribute('aria-label', `${p.label} at ${p.place}. ${p.actions.map((a) => `${a.key}: ${a.label}`).join('. ')}`);
      setHidden(prompt, false);
    },
    toast(text, kind = 'info') {
      const t = h('div', { class: 'aw-toast', 'data-kind': kind, text });
      toasts.append(t);
      while (toasts.children.length > 4) toasts.firstElementChild?.remove();
      window.setTimeout(() => t.remove(), kind === 'warn' ? 5000 : 3500);
    },
    setActive(a) {
      active = a;
      setHidden(el, !a);
      if (!a) {
        for (const k of Object.keys(cache)) delete cache[k];
        lastAt = -Infinity;
      }
    },
    setAutopilotLabel(text) {
      if (text === null) setHidden(apChip, true);
      else {
        setText(apChip, text);
        setHidden(apChip, false);
      }
    },
    setPixelScale(v) {
      if (v !== px) {
        px = v;
        delete cache.speed;
        delete cache.alt;
      }
    },
  };
}

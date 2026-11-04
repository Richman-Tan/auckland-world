/** Destinations overlay: stop list on the left, minimap with beacons and the plane on the right. */
import type { AppEvent, StopPlacement, Telemetry, UiWorld } from '../../app/contracts';
import type { SiteContent, StopId } from '../../content/types';
import { ACCENTS } from '../../shared/palette';
import { h } from '../dom';
import { drawNavMap, worldToMap } from '../minimap';

export function createNavView(content: SiteContent, dispatch: (e: AppEvent) => void) {
  let selected: StopId | null = null;
  let world: UiWorld | null = null;
  let img: HTMLImageElement | null = null;
  let plane: Telemetry['plane'] | null = null;
  let visible = false;

  const click = (id: StopId) => {
    if (selected === id) dispatch({ type: 'ENGAGE', stop: id });
    else dispatch({ type: 'NAV_SELECT', stop: id });
  };

  const buttons = new Map<StopId, HTMLButtonElement>();
  const list = h('ul', { class: 'aw-nav__list' });
  for (const s of content.stops) {
    const b = h(
      'button',
      { class: 'aw-stopbtn', type: 'button', 'aria-pressed': 'false', style: `--accent:${ACCENTS[s.beacon.color]}` },
      h('span', { class: 'aw-kbd', text: String(s.hotkey) }),
      h('span', { class: 'aw-stopbtn__label', text: s.label }),
      h('span', { class: 'aw-stopbtn__place', text: s.place }),
      h('span', { class: 'aw-stopbtn__pitch', text: s.pitch }),
    );
    b.addEventListener('click', () => click(s.id));
    buttons.set(s.id, b);
    list.append(h('li', {}, b));
  }

  const fly = h('button', { class: 'aw-btn aw-btn--primary', type: 'button', text: 'Fly me there', 'aria-disabled': 'true' });
  fly.addEventListener('click', () => {
    if (selected) dispatch({ type: 'ENGAGE' });
  });
  const close = h('button', { class: 'aw-btn', type: 'button', text: 'Close', 'aria-label': 'Close destinations' });
  close.addEventListener('click', () => dispatch({ type: 'CLOSE_NAV' }));
  const hint = h('p', { class: 'aw-stopbtn__place', text: 'Pick a destination, then pick it again or press Fly me there.' });

  const side = h(
    'div',
    { class: 'aw-nav__side' },
    h('div', { class: 'aw-nav__head' }, h('h2', { class: 'aw-h', id: 'aw-nav-h', text: 'Destinations' }), close),
    hint,
    list,
    h('div', { class: 'aw-nav__actions' }, fly, h('a', { class: 'aw-link', href: '/page/', text: 'Read everything as a page' })),
  );

  const canvas = h('canvas', { class: 'aw-nav__map', width: 420, height: 467, 'aria-label': 'Map of central Auckland with the five stops. Use the list to choose one.', role: 'img' });
  const noMap = h('div', { class: 'aw-nav__nomap', text: 'Map loads with the world' });
  const mapWrap = h('div', { class: 'aw-nav__mapwrap' }, noMap, canvas);
  canvas.hidden = true;
  const ctx = canvas.getContext('2d');

  canvas.addEventListener('click', (e) => {
    if (!world) return;
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * canvas.width;
    const py = ((e.clientY - r.top) / r.height) * canvas.height;
    let best: StopPlacement | null = null;
    let bd = 26;
    for (const s of world.stops) {
      const p = worldToMap(world.meta.bounds, canvas.width, canvas.height, s.x, s.z);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bd) (bd = d), (best = s);
    }
    if (best) click(best.id);
  });

  const box = h('div', { class: 'aw-nav__box aw-panel' }, side, mapWrap);
  const el = h('div', { class: 'aw-nav', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'aw-nav-h' }, box);

  function redraw(): void {
    if (!visible || !world || !ctx) return;
    drawNavMap(ctx, canvas.width, canvas.height, img, world, plane, selected);
  }

  return {
    el,
    focusTarget(): HTMLElement {
      return (selected && buttons.get(selected)) || (buttons.values().next().value as HTMLElement);
    },
    show(v: boolean, sel: StopId | null) {
      visible = v;
      this.select(sel);
      if (v) redraw();
    },
    select(id: StopId | null) {
      selected = id;
      for (const [sid, b] of buttons) b.setAttribute('aria-pressed', String(sid === id));
      fly.setAttribute('aria-disabled', String(id === null));
      redraw();
    },
    setWorld(w: UiWorld, image: HTMLImageElement | null) {
      world = w;
      img = image;
      const b = w.meta.bounds;
      const aspect = (b.maxX - b.minX) / (b.maxZ - b.minZ);
      canvas.height = 480;
      canvas.width = Math.round(480 * aspect);
      canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
      canvas.hidden = false;
      noMap.hidden = true;
      redraw();
    },
    setPlane(p: Telemetry['plane']) {
      plane = p;
      redraw();
    },
  };
}

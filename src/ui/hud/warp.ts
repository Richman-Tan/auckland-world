/** Time-warp overlay in a "transit tape" style. Shown only while autopilot warp is above 1. */
import type { Telemetry } from '../../app/contracts';
import { h, setHidden, setText } from '../dom';
import { formatEta } from '../format';

export interface WarpOverlay {
  el: HTMLElement;
  update(t: Telemetry, destination: string | null): void;
  hide(): void;
}

export function createWarp(): WarpOverlay {
  const x = h('div', { class: 'aw-warp__x' });
  const dest = h('div', { class: 'aw-warp__dest' });
  const done = h('div', { class: 'aw-warp__done' });
  const plane = h('div', { class: 'aw-warp__plane' });
  const line = h('div', { class: 'aw-warp__line' }, done, plane);
  const eta = h('b');
  const route = h('div', { class: 'aw-warp__route' }, h('div', { class: 'aw-hud__label', text: 'Transit' }), dest, line);
  const etaBox = h('div', { class: 'aw-warp__eta' }, h('span', { class: 'aw-hud__label', text: 'ETA ' }), eta);
  const tape = h('div', { class: 'aw-warp__tape', role: 'status', 'aria-label': 'Autopilot time warp' }, x, route, etaBox);
  const el = h('div', { class: 'aw-warp', hidden: true }, h('div', { class: 'aw-warp__streaks', 'aria-hidden': 'true' }), tape);

  return {
    el,
    update(t, destination) {
      const ap = t.autopilot;
      const show = !!ap && t.warp > 1;
      setHidden(el, !show);
      if (!show || !ap) return;
      setText(x, `×${Math.round(t.warp * 10) / 10}`);
      setText(dest, destination ? `→ ${destination}` : '→');
      setText(eta, formatEta(ap.etaS));
      const pct = `${Math.round(Math.min(1, Math.max(0, ap.progress)) * 100)}%`;
      if (done.style.width !== pct) {
        done.style.width = pct;
        plane.style.left = pct;
      }
    },
    hide() {
      setHidden(el, true);
    },
  };
}

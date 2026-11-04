import type { AppEvent } from '../../app/contracts';
import type { SiteContent } from '../../content/types';
import { CONTROLS_HINT } from '../controls';
import { h } from '../dom';

/** A crisp pixel skyline (Sky Tower, Harbour Bridge arch, Rangitoto, Mt Eden) as inline SVG. */
function skyline(): HTMLElement {
  const wrap = h('div', { class: 'aw-title__scene', 'aria-hidden': 'true' });
  wrap.innerHTML = `<svg viewBox="0 0 160 40" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="34" width="160" height="6" fill="#1f6f78"/>
<path d="M0 34 L30 28 L48 34Z" fill="#6f9a4a"/>
<path d="M98 34 L118 24 L138 34Z" fill="#557d3c"/>
<g fill="#8fa3a8"><rect x="52" y="24" width="6" height="10"/><rect x="60" y="20" width="7" height="14"/><rect x="69" y="26" width="5" height="8"/><rect x="76" y="22" width="6" height="12"/><rect x="84" y="27" width="6" height="7"/></g>
<g fill="#5f6b70"><rect x="44" y="28" width="6" height="6"/><rect x="92" y="25" width="5" height="9"/></g>
<rect x="72" y="6" width="2" height="22" fill="#f4ecd8"/><rect x="70" y="12" width="6" height="3" fill="#f4ecd8"/><rect x="73" y="2" width="1" height="5" fill="#d7263d"/>
<g fill="#d7263d"><rect x="2" y="30" width="26" height="1"/><rect x="6" y="28" width="18" height="1"/><rect x="2" y="31" width="1" height="3"/><rect x="27" y="31" width="1" height="3"/></g>
<rect x="136" y="33" width="24" height="1" fill="#e9f3ea"/>
<circle cx="132" cy="12" r="5" fill="#fff1c9"/>
</svg>`;
  return wrap;
}

export function createTitleView(content: SiteContent, dispatch: (e: AppEvent) => void) {
  const p = content.profile;
  const fly = h('button', { class: 'aw-btn aw-btn--primary aw-title__fly', type: 'button', text: 'Fly over Auckland' });
  fly.addEventListener('click', () => dispatch({ type: 'FLY' }));

  const stopsList = h('ul', { class: 'aw-title__stops', 'aria-label': 'Stops' });
  for (const s of content.stops) {
    const b = h('button', { class: 'aw-btn', type: 'button' }, h('span', { class: 'aw-kbd', text: String(s.hotkey) }), s.label);
    b.setAttribute('aria-label', `Go to ${s.label}, ${s.place}`);
    b.addEventListener('click', () => dispatch({ type: 'GO_TO_STOP', stop: s.id }));
    stopsList.append(h('li', {}, b));
  }

  const foot = h('p', { class: 'aw-title__foot' });
  foot.innerHTML =
    'Map data © OpenStreetMap contributors, ODbL · Heights from LINZ LiDAR, CC BY 4.0 · Fonts under the OFL · Concept inspired by dvlan.dev · <a href="/page/#credits">Credits</a>';

  const el = h(
    'main',
    { class: 'aw-title', 'aria-labelledby': 'aw-title-name', hidden: true },
    skyline(),
    h('p', { class: 'aw-title__place', text: p.location }),
    h('h1', { class: 'aw-title__name', id: 'aw-title-name', text: p.name }),
    h('p', { class: 'aw-title__role', text: p.title }),
    h('p', { class: 'aw-title__tag', text: p.tagline }),
    fly,
    h('p', { class: 'aw-title__or', text: 'Or go straight to a stop' }),
    stopsList,
    h('p', { class: 'aw-title__page' }, 'Or ', h('a', { href: '/page/', text: 'read it as a page' })),
    h('p', { class: 'aw-title__hint', text: CONTROLS_HINT }),
    foot,
  );
  return { el, focusTarget: fly };
}

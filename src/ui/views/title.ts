import type { AppEvent, LoadProgress } from '../../app/contracts';
import type { SiteContent } from '../../content/types';
import { ACCENTS } from '../../shared/palette';
import { CONTROLS_HINT } from '../controls';
import { h } from '../dom';

/** A small side-view pixel plane for the primary button, nose to the right (15 x 7 grid). */
const PLANE_SVG =
  '<svg class="aw-title__plane" viewBox="0 0 15 7" shape-rendering="crispEdges" aria-hidden="true">' +
  '<path fill="currentColor" d="M1 0h2v3H1zM2 3h11v2H2zM5 2h6v1H5zM14 1h1v5h-1zM13 3h1v2h-1zM6 5h1v1H6zM10 5h1v1h-1z"/></svg>';

/**
 * The landing screen. Until the map has loaded it sits on a dusk gradient with a slim progress bar;
 * once the world is ready (UiApi.setWorld adds .aw-world-ready to the root) the backdrop fades and the
 * live 3D city, orbited by the app's attract camera, shows through on the right.
 */
export function createTitleView(content: SiteContent, dispatch: (e: AppEvent) => void) {
  const p = content.profile;

  const fly = h('button', { class: 'aw-btn aw-btn--primary aw-title__fly', type: 'button' });
  fly.innerHTML = `${PLANE_SVG}<span>Fly over Auckland</span><span class="aw-title__cap" aria-hidden="true">Enter</span>`;
  fly.addEventListener('click', () => dispatch({ type: 'FLY' }));

  const read = h('a', { class: 'aw-btn aw-btn--ghost aw-title__read', href: '/page/', text: 'Read it as a page' });

  const stopsList = h('ul', { class: 'aw-title__stops', 'aria-label': 'Go straight to a stop' });
  for (const s of content.stops) {
    const b = h(
      'button',
      { class: 'aw-title__stop', type: 'button', style: `--accent: ${ACCENTS[s.beacon.color]}` },
      h('span', { class: 'aw-title__stopkey', text: String(s.hotkey), 'aria-hidden': 'true' }),
      h(
        'span',
        { class: 'aw-title__stoptext' },
        h('span', { class: 'aw-title__stoplabel', text: s.label }),
        h('span', { class: 'aw-title__stopplace', text: s.place }),
      ),
    );
    b.setAttribute('aria-label', `Go to ${s.label}, ${s.place}`);
    b.addEventListener('click', () => dispatch({ type: 'GO_TO_STOP', stop: s.id }));
    stopsList.append(h('li', {}, b));
  }

  const bar = h('span', { class: 'aw-title__barfill' });
  const progressText = h('span', { class: 'aw-title__progresstext', text: 'Loading Auckland…' });
  const progress = h('div', { class: 'aw-title__progress', role: 'status' }, h('span', { class: 'aw-title__bar' }, bar), progressText);

  const credit = h('p', { class: 'aw-title__credit' });
  credit.innerHTML = '© OpenStreetMap contributors · LINZ LiDAR · Inspired by dvlan.dev · <a href="/page/#credits">Credits</a>';

  const card = h(
    'div',
    { class: 'aw-title__card' },
    h('p', { class: 'aw-title__place' }, h('span', { class: 'aw-title__pin', 'aria-hidden': 'true' }), p.location),
    h('h1', { class: 'aw-title__name', id: 'aw-title-name', text: p.name }),
    h('p', { class: 'aw-title__role', text: p.title }),
    h('p', { class: 'aw-title__tag', text: p.tagline }),
    h('div', { class: 'aw-title__cta' }, fly, read),
    h('p', { class: 'aw-title__or', text: 'Or jump straight to a stop' }),
    stopsList,
  );

  const el = h(
    'main',
    { class: 'aw-title', 'aria-labelledby': 'aw-title-name', hidden: true },
    h('div', { class: 'aw-title__backdrop', 'aria-hidden': 'true' }),
    h('div', { class: 'aw-title__scrim', 'aria-hidden': 'true' }),
    card,
    h('footer', { class: 'aw-title__foot' }, progress, h('p', { class: 'aw-title__hint', text: CONTROLS_HINT }), credit),
  );

  function setProgress(lp: LoadProgress): void {
    const f = lp.totalBytes > 0 ? Math.min(1, lp.loadedBytes / lp.totalBytes) : 0;
    bar.style.width = `${Math.round(f * 100)}%`;
    progressText.textContent = `Loading Auckland · ${(lp.loadedBytes / 1e6).toFixed(1)} of ${(lp.totalBytes / 1e6).toFixed(1)} MB`;
  }

  return { el, focusTarget: fly, setProgress };
}

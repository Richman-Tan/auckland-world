import type { AppEvent, LoadProgress, ProgressView } from '../../app/contracts';
import { TOUR_ORDER } from '../../app/progress';
import type { SiteContent, StopId } from '../../content/types';
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

  // The tour: autopilot to each stop in turn, picking up at the first one not yet seen.
  let tourStart: StopId = TOUR_ORDER[0];
  const tourLabel = h('span', { text: 'Take the tour' });
  const tourNote = h('span', { class: 'aw-title__tournote', hidden: true });
  const tour = h('button', { class: 'aw-btn aw-title__tour', type: 'button' }, tourLabel, tourNote);
  tour.addEventListener('click', () => dispatch({ type: 'TOUR', stop: tourStart }));

  const read = h('a', { class: 'aw-btn aw-btn--ghost aw-title__read', href: '/page/', text: 'Read it as a page' });

  const stopButtons = new Map<StopId, HTMLButtonElement>();
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
    stopButtons.set(s.id, b);
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
    h('div', { class: 'aw-title__cta' }, fly, tour, read),
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

  /** Tick the stops already seen and let the tour pick up where the visitor left off. */
  function setSeen(p: ProgressView): void {
    const seen = p.visited.size;
    tourStart = p.next(null) ?? TOUR_ORDER[0];
    const partway = seen > 0 && seen < p.total;
    tourLabel.textContent = partway ? 'Continue the tour' : 'Take the tour';
    tourNote.textContent = seen > 0 ? `${seen} of ${p.total} seen` : '';
    tourNote.hidden = seen === 0;
    for (const s of content.stops) {
      const b = stopButtons.get(s.id);
      if (!b) continue;
      const done = p.visited.has(s.id);
      b.classList.toggle('is-seen', done);
      b.setAttribute('aria-label', `Go to ${s.label}, ${s.place}${done ? ' (seen)' : ''}`);
    }
  }

  return { el, card, focusTarget: fly, setProgress, setSeen };
}

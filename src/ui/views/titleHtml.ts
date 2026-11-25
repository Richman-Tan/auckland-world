/**
 * The landing screen as an HTML string, with no DOM and no browser: the build writes it into
 * index.html (scripts/vite/pagePrerender.ts), so the name, the pitch and every button are painted
 * from the first response, before any script has run. title.ts then takes over those same elements.
 *
 * Until the script arrives the screen is marked `is-booting` and its buttons are disabled; "Read it
 * as a page" is a plain link and works from the start.
 */
import { esc, jobTitle } from '../../content/renderHtml';
import type { SiteContent } from '../../content/types';
import { ACCENTS } from '../../shared/palette';
import { CONTROLS_HINT } from '../controls';

/** A small side-view pixel plane for the primary button, nose to the right (15 x 7 grid). */
const PLANE_SVG =
  '<svg class="aw-title__plane" viewBox="0 0 15 7" shape-rendering="crispEdges" aria-hidden="true">' +
  '<path fill="currentColor" d="M1 0h2v3H1zM2 3h11v2H2zM5 2h6v1H5zM14 1h1v5h-1zM13 3h1v2h-1zM6 5h1v1H6zM10 5h1v1h-1z"/></svg>';

/** What the loader says before the script can report real progress. */
export const LOADING_LABEL = 'Loading Auckland';
/** A true line about what is being loaded (a test checks the figure against the built map). */
export const LOADING_BUILDINGS = 33_000;
export const LOADING_FACT = `About ${LOADING_BUILDINGS.toLocaleString('en-NZ')} real buildings from OpenStreetMap`;

export function titleHtml(content: SiteContent): string {
  const p = content.profile;
  // --i orders the wake-up: each control lights a beat after the one before it.
  let i = 0;
  const stops = content.stops
    .map(
      (s) =>
        `<li><button class="aw-title__stop" type="button" disabled data-stop="${esc(s.id)}" style="--accent: ${ACCENTS[s.beacon.color]}; --i: ${3 + i++}" aria-label="${esc(`Go to ${s.label}, ${s.place}`)}">` +
        `<span class="aw-title__stopkey" aria-hidden="true">${esc(String(s.hotkey))}</span>` +
        `<span class="aw-title__stoptext"><span class="aw-title__stoplabel">${esc(s.label)}</span><span class="aw-title__stopplace">${esc(s.place)}</span></span>` +
        '</button></li>',
    )
    .join('');

  return (
    '<main class="aw-title is-booting" aria-labelledby="aw-title-name">' +
    '<div class="aw-title__scrim" aria-hidden="true"></div>' +
    '<div class="aw-title__card">' +
    `<p class="aw-title__place"><span class="aw-title__pin" aria-hidden="true"></span><span>${esc(p.location)}</span><span class="aw-title__clock" hidden></span></p>` +
    `<h1 class="aw-title__name" id="aw-title-name">${esc(p.name)}</h1>` +
    // The job only: where it is done is on the Work stop, not on the front of the site.
    `<p class="aw-title__role">${esc(jobTitle(p.title))}</p>` +
    `<p class="aw-title__tag">${esc(p.tagline)}</p>` +
    '<div class="aw-title__cta">' +
    `<button class="aw-btn aw-btn--primary aw-title__fly" type="button" disabled style="--i: 0">${PLANE_SVG}<span>Fly over Auckland</span><span class="aw-title__cap" aria-hidden="true">Enter</span></button>` +
    '<button class="aw-btn aw-title__tour" type="button" disabled style="--i: 1"><span class="aw-title__tourlabel">Take the tour</span><span class="aw-title__tournote" hidden></span></button>' +
    '<a class="aw-btn aw-btn--ghost aw-title__read" href="/page/" style="--i: 2">Read it as a page</a>' +
    '</div>' +
    '<p class="aw-title__or">Or jump straight to a stop</p>' +
    `<ul class="aw-title__stops" aria-label="Go straight to a stop">${stops}</ul>` +
    '</div>' +
    // The loader. Only the label is announced; the figures beside it change too often to read out.
    '<div class="aw-title__loader">' +
    `<p class="aw-title__loadhead"><span class="aw-title__loadlabel" role="status">${LOADING_LABEL}</span><span class="aw-title__loadpct" aria-hidden="true"></span></p>` +
    '<div class="aw-title__bar" aria-hidden="true"><span class="aw-title__barfill"></span></div>' +
    `<p class="aw-title__loadnote" aria-hidden="true">${LOADING_FACT}</p>` +
    '</div>' +
    '<footer class="aw-title__foot">' +
    `<p class="aw-title__hint">${esc(CONTROLS_HINT)}</p>` +
    '<p class="aw-title__credit">© OpenStreetMap contributors · LINZ LiDAR · Inspired by dvlan.dev · <a href="/page/#credits">Credits</a></p>' +
    '</footer>' +
    '</main>'
  );
}

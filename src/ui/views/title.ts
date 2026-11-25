import type { AppEvent, LoadProgress, ProgressView } from '../../app/contracts';
import { TOUR_ORDER } from '../../app/progress';
import type { SiteContent, StopId } from '../../content/types';
import { loadStage } from '../loadStage';
import { LOADING_FACT, titleHtml } from './titleHtml';

/**
 * The landing screen. Its markup is already in the page (the build prerenders titleHtml into
 * index.html), so this takes over those elements rather than building new ones; where the page has
 * none (the dev harness) it makes them from the same string.
 *
 * While the map loads the screen sits over the boot scene (ui/boot) and its loader shows how far
 * along things are. Buttons work from the moment this runs: flying before the map is ready goes to
 * the loading view.
 */
export function createTitleView(content: SiteContent, dispatch: (e: AppEvent) => void, root?: HTMLElement) {
  const made = () => {
    const t = document.createElement('template');
    t.innerHTML = titleHtml(content);
    return t.content.firstElementChild as HTMLElement;
  };
  const el: HTMLElement = root?.querySelector<HTMLElement>(':scope > .aw-title') ?? made();
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel) as T;

  const card = q('.aw-title__card');
  const fly = q<HTMLButtonElement>('.aw-title__fly');
  fly.addEventListener('click', () => dispatch({ type: 'FLY' }));

  // The tour: autopilot to each stop in turn, picking up at the first one not yet seen.
  let tourStart: StopId = TOUR_ORDER[0];
  const tour = q<HTMLButtonElement>('.aw-title__tour');
  const tourLabel = q('.aw-title__tourlabel');
  const tourNote = q('.aw-title__tournote');
  tour.addEventListener('click', () => dispatch({ type: 'TOUR', stop: tourStart }));

  const stopButtons = new Map<StopId, HTMLButtonElement>();
  for (const s of content.stops) {
    const b = q<HTMLButtonElement>(`.aw-title__stop[data-stop="${s.id}"]`);
    b.addEventListener('click', () => dispatch({ type: 'GO_TO_STOP', stop: s.id }));
    stopButtons.set(s.id, b);
  }

  const loader = q('.aw-title__loader');
  const loadLabel = q('.aw-title__loadlabel');
  const loadPct = q('.aw-title__loadpct');
  const loadNote = q('.aw-title__loadnote');
  const bar = q('.aw-title__barfill');
  const clock = q('.aw-title__clock');

  // Awake: the controls are wired, so they stop looking (and being) switched off.
  for (const b of el.querySelectorAll<HTMLButtonElement>('button[disabled]')) b.disabled = false;
  el.classList.remove('is-booting');

  function setProgress(lp: LoadProgress): void {
    const stage = loadStage(lp);
    loader.dataset.known = 'true';
    bar.style.width = `${Math.round(stage.fraction * 100)}%`;
    loadPct.textContent = `${Math.round(stage.fraction * 100)}%`;
    // The label is a live region: change it only when the stage does.
    if (loadLabel.textContent !== stage.label) loadLabel.textContent = stage.label;
    const note = stage.detail ? `${stage.detail} · ${LOADING_FACT}` : LOADING_FACT;
    if (loadNote.textContent !== note) loadNote.textContent = note;
  }

  /** The city could not be loaded. The screen still works: flying shows what went wrong. */
  function setFailed(): void {
    loader.dataset.known = 'true';
    loader.classList.add('is-failed');
    loadLabel.textContent = 'The 3D city did not load';
    loadNote.textContent = 'Everything is still on the page version';
  }

  /** The city is on screen: say so once, then let the loader go. */
  function setReady(): void {
    bar.style.width = '100%';
    loadPct.textContent = '100%';
    loadLabel.textContent = 'Auckland is ready';
    loader.classList.add('is-done');
    el.classList.add('is-ready');
  }

  /** The time in Auckland and the part of the day the city is lit for ("9:41 am · Morning"), or null to hide it. */
  function setClock(text: string | null): void {
    clock.hidden = text === null;
    if (text !== null && clock.textContent !== text) clock.textContent = text;
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

  return { el, card, focusTarget: fly, setProgress, setReady, setFailed, setClock, setSeen };
}

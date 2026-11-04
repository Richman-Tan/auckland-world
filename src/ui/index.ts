/**
 * The UI: title, loading, HUD, destinations, briefing, pause and error views, mounted inside
 * opts.root over the canvas. It renders from AppState and dispatches AppEvents on pointer clicks;
 * it never listens to keys and never mutates app state.
 */
import type { AppState, CreateUi, LoadProgress, PromptInfo, Telemetry, UiApi, UiWorld } from '../app/contracts';
import type { StopId } from '../content/types';
import { h, readPixelScale, setHidden } from './dom';
import { createHud } from './hud/hud';
import { createWarp } from './hud/warp';
import { loadImage } from './minimap';
import './styles/ui.css';
import { createBriefingView } from './views/briefing';
import { createLoadingView } from './views/loading';
import { createPauseView, createErrorView } from './views/modals';
import { createNavView } from './views/nav';
import { createTitleView } from './views/title';

export const createUi: CreateUi = ({ root, content, dispatch }): UiApi => {
  root.classList.add('aw-ui');

  const title = createTitleView(content, dispatch);
  const loading = createLoadingView();
  const hud = createHud(dispatch);
  const warp = createWarp();
  const nav = createNavView(content, dispatch);
  const briefing = createBriefingView(content, dispatch);
  const pause = createPauseView(dispatch);
  const error = createErrorView();
  const attrib = h('a', { class: 'aw-attrib', href: '/page/#credits', text: '© OpenStreetMap · LINZ', 'aria-label': 'Map credits: OpenStreetMap and LINZ' });

  root.replaceChildren(title.el, loading.el, hud.el, warp.el, nav.el, briefing.el, pause.el, error.el, attrib);

  const stopLabel = (id: StopId | null): string | null => content.stops.find((s) => s.id === id)?.label ?? null;

  let state: AppState = { kind: 'title' };
  let autopilotTarget: StopId | null = null;
  let focusKey = '';
  let lastPlaneKey = '';
  let latest: Telemetry | null = null;

  function syncPixelScale(): void {
    const px = readPixelScale();
    hud.setPixelScale(px);
  }
  syncPixelScale();
  window.addEventListener('resize', syncPixelScale);

  function focusOnce(key: string, el: HTMLElement): void {
    if (key === focusKey) return;
    focusKey = key;
    // Wait a frame so the element is laid out after being unhidden.
    requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }

  function sync(next: AppState): void {
    state = next;
    // 'hidden' pauses (tab hidden) show nothing: keep rendering what was underneath.
    const view: AppState = next.kind === 'paused' ? next.resumeTo : next;
    const menu = next.kind === 'paused' && next.reason === 'menu';
    root.dataset.state = menu ? 'paused' : view.kind;

    setHidden(title.el, view.kind !== 'title');
    setHidden(loading.el, view.kind !== 'loading');
    setHidden(error.el, view.kind !== 'error');
    setHidden(nav.el, view.kind !== 'nav');
    setHidden(briefing.el, view.kind !== 'briefing');
    setHidden(pause.el, !menu);
    setHidden(attrib, view.kind === 'title' || view.kind === 'loading' || view.kind === 'error');

    const hudOn = view.kind === 'flying' || view.kind === 'autopilot' || view.kind === 'briefing';
    hud.setActive(hudOn);
    if (view.kind === 'autopilot') {
      autopilotTarget = view.target;
      hud.setAutopilotLabel(`AUTOPILOT · ${stopLabel(view.target) ?? ''} · ${view.phase.toUpperCase()}`);
    } else {
      autopilotTarget = null;
      hud.setAutopilotLabel(null);
      warp.hide();
    }

    if (view.kind === 'nav') nav.show(true, view.selected);
    else nav.show(false, null);

    if (view.kind === 'briefing') briefing.render(view.stop, view.page);
    else briefing.reset();

    if (view.kind === 'error') error.set(view.reason, view.message);

    // Move focus into whatever dialog just opened.
    if (menu) focusOnce('pause', pause.focusTarget);
    else if (view.kind === 'title') focusOnce('title', title.focusTarget);
    else if (view.kind === 'nav') focusOnce('nav', nav.focusTarget());
    else if (view.kind === 'briefing') focusOnce(`briefing:${view.stop}`, briefing.focusTarget);
    else if (view.kind === 'error') focusOnce('error', error.focusTarget);
    else {
      if (focusKey && focusKey !== 'scene') pause.reset();
      focusKey = view.kind === 'loading' ? 'loading' : 'scene';
    }
    syncPixelScale();
  }

  sync(state);

  return {
    sync,
    setLoading(p: LoadProgress) {
      loading.set(p);
      title.setProgress(p);
    },
    updateTelemetry(t: Telemetry) {
      latest = t;
      hud.update(t);
      if (autopilotTarget) warp.update(t, t.target?.label ?? stopLabel(autopilotTarget));
      if (state.kind === 'nav') {
        const k = `${Math.round(t.plane.x / 5)}|${Math.round(t.plane.z / 5)}|${Math.round(t.plane.headingRad * 20)}`;
        if (k !== lastPlaneKey) {
          lastPlaneKey = k;
          nav.setPlane(t.plane);
        }
      }
    },
    toast(text, kind) {
      hud.toast(text, kind);
    },
    setPrompt(p: PromptInfo | null) {
      hud.setPrompt(p);
    },
    focusScene() {
      focusKey = 'scene';
      document.getElementById('scene')?.focus({ preventScroll: true });
    },
    setWorld(world: UiWorld) {
      // The live city now renders behind the title screen: fade the placeholder backdrop.
      root.classList.add('aw-world-ready');
      hud.setWorld(world, null);
      nav.setWorld(world, null);
      if (latest) nav.setPlane(latest.plane);
      void loadImage(world.minimapUrl).then((img) => {
        hud.setWorld(world, img);
        nav.setWorld(world, img);
        if (latest) nav.setPlane(latest.plane);
      });
    },
  };
};

export { createUi as default };

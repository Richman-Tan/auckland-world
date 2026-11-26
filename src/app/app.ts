/**
 * The integrator: owns the state machine and the frame loop, and wires the world (src/world),
 * flight and input (src/flight, src/input) and UI (src/ui) together through src/app/contracts.ts.
 * The title screen and content ship in the entry chunk; three.js and the map load in the background.
 */
import { type Hotspot, SKY_DECK_SPOTS, hotspotPoint } from '../room/layout';
import { detailLadder, lowDetailLevel } from '../shared/detail';
import { applyPixelScale } from '../shared/pixelScale';
import { aucklandSolarHour, aucklandTime, chosenSolarHour, dayPart, lookAtSolar } from '../shared/timeOfDay';
import type { Obstruction } from '../flight/holdView';
import { content } from '../content/index';
import type { StopId } from '../content/types';
import { latLonToLocal } from '../shared/mapFormat';
import { createUi } from '../ui/index';
import type {
  Autopilot,
  ChaseCamera,
  Controls,
  FlightSim,
  FlightState,
  InputAction,
  InputSystem,
  OrbitController,
  PlaneModel,
  PromptInfo,
  Proximity,
  QualityTier,
  StopPlacement,
  TargetInfo,
  Telemetry,
  UiApi,
  WorldScene,
} from './contracts';
import { NO_CONTROLS } from './contracts';
import { type AppEvent, type AppState, simulationRunning, transition } from './fsm';
import { createGovernor } from './governor';
import { placeStops, spawnPoint } from './placement';
import { TOUR_ORDER, createProgress, onward } from './progress';
import { type Route, pageHref, pageIndex, parseRoute, routeOf, routeTitle, samePlace, sameRoute, searchFor } from './route';
import { type Settings, createSettings } from './settings';
import { browserStorage } from './storage';

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 60;
/** How long to wait for a lost WebGL context to come back before showing the error screen. */
const CONTEXT_RESTORE_MS = 5000;
/** How long the title screen's camera takes to settle in once the city is shown. */
const ATTRACT_SETTLE_S = 3.4;
const STOP_IDS: StopId[] = content.stops.map((s) => s.id);

type FlightModule = typeof import('../flight/index');
type Sound = import('../audio/index').Sound;
type HoldView = ReturnType<FlightModule['createHoldView']>;
type SkyDeck = import('../world/index').SkyDeck;

interface Loaded {
  world: WorldScene;
  flight: FlightModule;
  sim: FlightSim;
  camera: ChaseCamera;
  plane: PlaneModel;
  proximity: Proximity;
  stops: StopPlacement[];
  /** Wide shot of the landmark while a briefing or chat is open. */
  hold: HoldView;
  /** The walkable room in the Sky Tower (screens load on the first visit). */
  deck: SkyDeck;
}

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** What to load: ?quality= for this visit, else a pinned graphics setting, else a guess from the device. */
function detectQuality(params: URLSearchParams, setting: Settings['graphics']): QualityTier {
  const q = params.get('quality');
  if (q === 'low' || q === 'high') return q;
  if (setting !== 'auto') return setting;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  return coarse || cores <= 4 ? 'low' : 'high';
}

const wrapDeg = (d: number) => ((d % 360) + 360) % 360;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export function startApp(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const root = document.getElementById('ui') as HTMLElement;
  const touchRoot = document.createElement('div');
  touchRoot.id = 'touch';
  document.body.append(touchRoot);

  // Size the UI's pixel art now, with the same rule the renderer uses later, so nothing resizes
  // when the map finishes loading. Registered before the UI's own resize listener.
  applyPixelScale(innerHeight);
  addEventListener('resize', () => applyPixelScale(innerHeight));

  const params = new URLSearchParams(location.search);
  const baseUrl = params.get('map') === 'fake' ? '/map-fake/' : '/map/';
  const debug = import.meta.env.DEV || params.has('debug');

  let state: AppState = { kind: 'title' };
  const hasChat = (id: StopId) =>
    !!content.stops.find((s) => s.id === id)?.experiences.some((x) => x.kind === 'chat' && x.status === 'live');
  /** The stop whose beacon the plane circles: the open briefing or chat. */
  const holdingAt = (s: AppState): StopId | null => (s.kind === 'briefing' || s.kind === 'chat' ? s.stop : null);
  const hasRoom = (id: StopId) =>
    !!content.stops.find((s) => s.id === id)?.experiences.some((x) => x.kind === 'room' && x.status === 'live');
  const roomName = (id: StopId) =>
    (content.stops.find((s) => s.id === id)?.experiences.find((x) => x.kind === 'room') as { label?: string } | undefined)?.label ?? 'room';
  const fsmCtx = {
    pageCount: (id: StopId) => content.stops.find((s) => s.id === id)?.briefing.length ?? 1,
    hasChat,
    hasRoom,
  };
  /** The room being shown, including under a pause menu. */
  const roomView = (s: AppState) => (s.kind === 'room' ? s : s.kind === 'paused' && s.resumeTo.kind === 'room' ? s.resumeTo : null);

  let ui: UiApi;
  let loaded: Loaded | null = null;
  let input: InputSystem | null = null;
  let autopilot: Autopilot | null = null;
  let orbit: OrbitController | null = null;
  let navSelected: StopId | null = null;
  let proximityCurrent: StopId | null = null;

  const placement = (id: StopId) => loaded?.stops.find((s) => s.id === id) ?? null;

  /** Set if the world failed to load in the background; entering 'loading' then fails at once. */
  let failure: string | null = null;

  function dispatch(e: AppEvent) {
    if (e.type === 'ROOM_USE') {
      useRoomSpot();
      return;
    }
    const prev = state;
    const next = transition(prev, e, fsmCtx);
    if (next === prev) return;
    state = next;
    onEnter(prev, next, e);
    ui.sync(state);
    syncUrl();
    if (failure && state.kind === 'loading') dispatch({ type: 'LOAD_FAILED', message: failure });
  }

  const storage = browserStorage();
  /** Visitor settings (pause menu), remembered between visits. */
  const settings = createSettings(storage);

  ui = createUi({ root, content, dispatch, settings });
  ui.sync(state);

  /** Stops seen so far, remembered between visits: ticks, and where "next stop" leads. */
  const progress = createProgress(TOUR_ORDER, storage);
  ui.setProgress(progress);

  /* ------------------------------------------------------------------ motion */

  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  /** The device asks for less motion, or the visitor chose Reduced. */
  const reducedMotion = () => settings.get().motion === 'reduced' || motionQuery.matches;
  function applyMotion() {
    // CSS animations and the chat's typewriter read this (the media query covers the device's own preference).
    document.documentElement.dataset.motion = settings.get().motion === 'reduced' ? 'reduced' : '';
    loaded?.camera.setRollScale(reducedMotion() ? 0 : 1);
    loaded?.hold.setSpin(!reducedMotion());
  }
  motionQuery.addEventListener('change', applyMotion);
  applyMotion();

  /* ------------------------------------------------------- address and history */

  const baseTitle = document.title;
  /** What the address bar says right now. */
  let urlRoute: Route = parseRoute(location.search, content);
  /** True while following the browser's Back or Forward, so the app does not add entries of its own. */
  let followingHistory = false;
  // A link to a stop that cannot be shown in 3D still leads to the same spot on the plain page.
  ui.setPageHref(pageHref(urlRoute));

  /** Keep the address in step with the state, so any stop, page or room can be linked to. */
  function syncUrl() {
    const r = routeOf(state, content);
    if (!r) return;
    document.title = routeTitle(r, content, baseTitle);
    if (sameRoute(r, urlRoute)) return;
    const url = `${location.pathname}${searchFor(r, location.search)}${location.hash}`;
    // A page turn rewrites the current entry; moving to another stop, or through the room's door,
    // adds one, so Back retraces the visit a stop at a time.
    if (followingHistory || samePlace(r, urlRoute)) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    urlRoute = r;
    ui.setPageHref(pageHref(r));
  }

  function openRoute(r: Route, type: 'GO_TO_STOP' | 'JUMP') {
    if (!r.stop) return;
    const page = pageIndex(content, r.stop, r.page);
    dispatch({ type, stop: r.stop, page: page >= 0 ? page : undefined, room: !!r.room });
  }

  addEventListener('popstate', () => {
    const r = parseRoute(location.search, content);
    urlRoute = r;
    followingHistory = true;
    try {
      if (state.kind === 'paused' && state.reason === 'menu') dispatch({ type: 'RESUME' });
      if (r.stop) openRoute(r, state.kind === 'title' ? 'GO_TO_STOP' : 'JUMP');
      else {
        // Back to the bare address: close whatever is open and carry on flying.
        if (state.kind === 'room' && state.panel !== null) dispatch({ type: 'CLOSE_BRIEFING' });
        if (state.kind === 'room') dispatch({ type: 'LEAVE_ROOM' });
        else if (state.kind === 'briefing') dispatch({ type: 'CLOSE_BRIEFING' });
        else if (state.kind === 'chat') dispatch({ type: 'CLOSE_CHAT' });
      }
    } finally {
      followingHistory = false;
    }
  });

  /* ----------------------------------------------------------- state effects */

  function holdingPosition(stop: StopPlacement) {
    // On the orbit circle south of the beacon, flying clockwise (heading east).
    return { pos: { x: stop.x, y: stop.orbitY, z: stop.z + stop.orbitRadius }, heading: Math.PI / 2 };
  }

  /** Chase camera straight to the plane, dropping any blend from the holding view. */
  function snapCamera(l: Loaded) {
    l.camera.snap(l.sim.state);
    l.hold.reset(l.camera.camera);
  }

  let roomSpot: Hotspot | null = null;

  function useRoomSpot() {
    if (state.kind !== 'room') return;
    if (state.panel !== null) {
      dispatch({ type: 'CLOSE_BRIEFING' });
      return;
    }
    if (!roomSpot) return;
    if (roomSpot.kind === 'lift') {
      dispatch({ type: 'LEAVE_ROOM' });
      return;
    }
    const roomStop = state.stop;
    const pages = content.stops.find((s) => s.id === roomStop)?.briefing ?? [];
    const page = pages.findIndex((p) => p.id === roomSpot?.pageId);
    if (page >= 0) dispatch({ type: 'ROOM_PANEL', page });
  }

  function onEnter(prev: AppState, next: AppState, event: AppEvent) {
    if (next.kind === 'loading' && loaded) queueMicrotask(() => dispatch({ type: 'LOADED' }));

    if (sound) {
      if (prev.kind === 'autopilot' && (next.kind === 'briefing' || next.kind === 'chat')) sound.cue('arrive');
      else if (next.kind === 'room' && prev.kind !== 'room' && prev.kind !== 'paused') sound.cue('land');
      else if (next.kind === 'nav' && prev.kind === 'nav' && next.selected !== prev.selected) sound.cue('select');
      else if (next.kind === 'briefing' && prev.kind === 'briefing' && next.stop === prev.stop && next.page !== prev.page) sound.cue('page');
      else if (next.kind === 'room' && prev.kind === 'room' && next.panel !== prev.panel && next.panel !== null) sound.cue('page');
    }

    // Opening a stop in any form (briefing, chat, room) counts as having seen it.
    if ((next.kind === 'briefing' || next.kind === 'chat' || next.kind === 'room') && progress.visit(next.stop)) ui.setProgress(progress);

    // Into and out of a room: swap the interior in, and on the way out put the plane back on the
    // stop's holding circle (the lift "returns you to the plane"), before any autopilot starts.
    const wasRoom = prev.kind === 'room' || (prev.kind === 'paused' && prev.resumeTo.kind === 'room');
    if (loaded && next.kind === 'room' && !wasRoom) {
      loaded.world.setInterior(true);
      loaded.deck.enter();
      roomSpot = null;
      deckOffset.x = deckOffset.y = 0;
      coverTimer = 0;
    } else if (loaded && wasRoom && next.kind !== 'room' && next.kind !== 'paused') {
      loaded.world.setInterior(false);
      loaded.deck.leave();
      roomSpot = null;
      ui.setRoomSpot(null);
      const stop = placement((prev.kind === 'room' ? prev : (prev as { resumeTo: { stop: StopId } }).resumeTo).stop);
      if (stop) {
        loaded.sim.reset({ ...holdingPosition(stop), speed: 50 });
        snapCamera(loaded);
      }
    }

    if (prev.kind === 'loading' && loaded) {
      const held = holdingAt(next);
      if (held) {
        const stop = placement(held);
        if (stop) {
          loaded.sim.reset({ ...holdingPosition(stop), speed: 50 });
          snapCamera(loaded);
        }
      } else if (next.kind === 'flying' || next.kind === 'autopilot') {
        // Free flight, or the tour setting off for its first stop.
        loaded.sim.reset({ ...spawnPoint(content, loaded.world.meta), speed: 55 });
        snapCamera(loaded);
      }
    }

    // A jump (browser Back or Forward) opens a stop without flying there: cut through black and put
    // the plane on that stop's holding circle, unless it is already circling it.
    if (event.type === 'JUMP' && loaded && holdingAt(next) && holdingAt(prev) !== holdingAt(next)) {
      const stop = placement(event.stop);
      if (stop) {
        ui.flash();
        loaded.sim.reset({ ...holdingPosition(stop), speed: 50 });
        snapCamera(loaded);
      }
    }

    // Reduced motion: no time-warped dash across the city. Cut to the stop instead.
    if (next.kind === 'autopilot' && reducedMotion()) {
      const target = next.target;
      queueMicrotask(() => {
        if (state.kind === 'autopilot' && state.target === target) dispatch({ type: 'JUMP', stop: target });
      });
    }

    if (next.kind === 'autopilot' && loaded && (prev.kind !== 'autopilot' || prev.target !== next.target)) {
      const target = placement(next.target);
      autopilot = target ? loaded.flight.createAutopilot(target, loaded.world.query, loaded.sim.state) : null;
    }
    if (next.kind !== 'autopilot') autopilot = null;

    const held = holdingAt(next);
    if (held && loaded) {
      const stop = placement(held);
      if (!orbit || holdingAt(prev) !== held) orbit = stop ? loaded.flight.createOrbit(stop) : null;
    } else {
      orbit = null;
    }

    if (next.kind === 'nav') navSelected = next.selected;

    setInputMode(next);

    const active =
      next.kind === 'nav' ? next.selected : next.kind === 'autopilot' ? next.target : (holdingAt(next) ?? proximityCurrent);
    loaded?.world.setActiveStop(active);

    if ((prev.kind === 'briefing' || prev.kind === 'chat' || prev.kind === 'nav' || prev.kind === 'paused' || prev.kind === 'room') && (next.kind === 'flying' || next.kind === 'autopilot')) {
      ui.focusScene();
    }
    // Walking again (just landed, or a screen's panel closed): keys go back to the scene.
    if (next.kind === 'room' && next.panel === null && !(prev.kind === 'room' && prev.panel === null)) ui.focusScene();
    updatePrompt();
    // The title card comes and goes with the state; measure it once the UI has been synced.
    queueMicrotask(applyIconClip);
  }

  /**
   * Beacon icons are drawn over everything in the 3D view, so behind the title screen they would
   * sit on top of its text. Hide the ones under the text block (all of them on a narrow screen,
   * where the block spans the width); the ones beside it, around the Sky Tower, stay.
   */
  function applyIconClip() {
    if (!loaded) return;
    const right = ui.titleRight();
    // A little past the block's edge, as a fraction of the view: -1 is its left edge, 1 its right.
    loaded.world.setIconClip(right === null ? null : Math.min(1, ((right + 24) / innerWidth) * 2 - 1));
  }

  function setInputMode(s: AppState) {
    input?.setMode(
      s.kind === 'flying' || s.kind === 'autopilot' || (s.kind === 'room' && s.panel === null)
        ? 'flight'
        : s.kind === 'room'
          ? 'dialog'
        : s.kind === 'briefing' || s.kind === 'nav' || s.kind === 'paused' || s.kind === 'title'
          ? 'dialog'
          : s.kind === 'chat'
            ? 'chat'
            : 'off',
    );
  }

  function updatePrompt() {
    if (state.kind !== 'flying' || !proximityCurrent) {
      ui.setPrompt(null);
      return;
    }
    const stop = content.stops.find((s) => s.id === proximityCurrent);
    if (!stop) return;
    const prompt: PromptInfo = {
      stop: stop.id,
      label: stop.label,
      place: stop.place,
      actions: [
        { action: 'briefing', key: 'Space', label: hasChat(stop.id) ? 'Say hello' : 'Read briefing' },
        ...(hasRoom(stop.id) ? [{ action: 'interact' as const, key: 'E', label: `Land on the ${roomName(stop.id)}` }] : []),
      ],
    };
    ui.setPrompt(prompt);
  }

  /* ------------------------------------------------------------------ input */

  function stopForHotkey(action: InputAction): StopId | null {
    const m = /^select(\d)$/.exec(action);
    if (!m) return null;
    return content.stops.find((s) => s.hotkey === Number(m[1]))?.id ?? null;
  }

  /** N in a briefing: on to the next stop not yet seen (the same place the panel's button leads). */
  function flyOnward(from: StopId) {
    const to = onward(progress, from);
    if (to) dispatch({ type: 'GO_TO_STOP', stop: to.stop });
  }

  function onAction(action: InputAction) {
    // The pause menu (and with it the settings) from anywhere, not only by backing out of flight:
    // a touch screen has no Esc key, and inside a room "back" means leave.
    if (action === 'menu') {
      dispatch(state.kind === 'paused' && state.reason === 'menu' ? { type: 'RESUME' } : { type: 'PAUSE', reason: 'menu' });
      return;
    }
    const hot = stopForHotkey(action);
    switch (state.kind) {
      case 'title':
        if (action === 'engage') dispatch({ type: 'FLY' });
        else if (hot) dispatch({ type: 'GO_TO_STOP', stop: hot });
        break;
      case 'flying':
        if (action === 'interact') {
          if (proximityCurrent && hasRoom(proximityCurrent)) dispatch({ type: 'ENTER_ROOM', stop: proximityCurrent });
          else if (proximityCurrent) dispatch({ type: 'OPEN_BRIEFING', stop: proximityCurrent });
        } else if (action === 'nav') dispatch({ type: 'OPEN_NAV' });
        else if (action === 'back') dispatch({ type: 'BACK' });
        else if (action === 'briefing') {
          if (proximityCurrent) dispatch({ type: 'OPEN_BRIEFING', stop: proximityCurrent });
          else ui.toast('Fly to a beacon first. Tab opens the map.');
        } else if (hot) {
          dispatch({ type: 'OPEN_NAV' });
          dispatch({ type: 'NAV_SELECT', stop: hot });
        } else if (action === 'engage' && navSelected) dispatch({ type: 'ENGAGE', stop: navSelected });
        else if (action === 'help') ui.toast('WASD or arrows to fly · Shift boost · Tab map · Space read or talk · Esc menu');
        break;
      case 'nav':
        if (hot) dispatch({ type: 'NAV_SELECT', stop: hot });
        else if (action === 'engage') dispatch({ type: 'ENGAGE' });
        else if (action === 'nav' || action === 'back') dispatch({ type: 'CLOSE_NAV' });
        else if (action === 'next' || action === 'prev') {
          const i = navSelected ? STOP_IDS.indexOf(navSelected) : -1;
          const n = STOP_IDS.length;
          const j = action === 'next' ? (i + 1) % n : (i - 1 + n) % n;
          dispatch({ type: 'NAV_SELECT', stop: STOP_IDS[j] });
        }
        break;
      case 'autopilot':
        if (action === 'nav') dispatch({ type: 'OPEN_NAV' });
        else if (action === 'back') dispatch({ type: 'CANCEL_AUTOPILOT' });
        else if (hot) dispatch({ type: 'ENGAGE', stop: hot });
        break;
      case 'briefing':
        if (action === 'interact') dispatch({ type: 'ENTER_ROOM', stop: state.stop });
        else if (action === 'next') dispatch({ type: 'PAGE', delta: 1 });
        else if (action === 'prev') dispatch({ type: 'PAGE', delta: -1 });
        else if (action === 'back' || action === 'briefing') dispatch({ type: 'CLOSE_BRIEFING' });
        else if (action === 'nav') dispatch({ type: 'OPEN_NAV' });
        else if (action === 'nextStop') flyOnward(state.stop);
        else if (hot) dispatch({ type: 'GO_TO_STOP', stop: hot });
        break;
      case 'chat':
        if (action === 'back') dispatch({ type: 'CLOSE_CHAT' });
        break;
      case 'room':
        if (state.panel !== null) {
          if (action === 'next') dispatch({ type: 'PAGE', delta: 1 });
          else if (action === 'prev') dispatch({ type: 'PAGE', delta: -1 });
          else if (action === 'back' || action === 'briefing' || action === 'interact') dispatch({ type: 'CLOSE_BRIEFING' });
          else if (action === 'nextStop') flyOnward(state.stop);
        } else if (action === 'interact' || action === 'briefing') useRoomSpot();
        else if (action === 'back') dispatch({ type: 'LEAVE_ROOM' });
        else if (action === 'nav') dispatch({ type: 'OPEN_NAV' });
        else if (hot) dispatch({ type: 'GO_TO_STOP', stop: hot });
        else if (action === 'help') ui.toast('WASD or arrows to walk · E to use what you face · Esc to leave');
        break;
      case 'paused':
        if (action === 'back' || action === 'engage') dispatch({ type: 'RESUME' });
        break;
      default:
        break;
    }
  }

  document.addEventListener('visibilitychange', () => {
    sound?.setActive(!document.hidden);
    if (document.hidden) dispatch({ type: 'PAUSE', reason: 'hidden' });
    else if (state.kind === 'paused' && state.reason === 'hidden') dispatch({ type: 'RESUME' });
  });

  /* ---------------------------------------------------------------- loading */

  if (!hasWebGL2() || typeof DecompressionStream === 'undefined') {
    dispatch({ type: 'NO_WEBGL' });
    return;
  }

  const quality = detectQuality(params, settings.get().graphics);

  /* ------------------------------------------------------------------ detail */

  // Runtime detail: draw distance and pixel size, stepped down by the governor when frames are slow.
  const ladder = detailLadder(quality);
  const governor = createGovernor({ levels: ladder.length });
  let detailLevel = 0;
  /** Frames drawn since the pause menu opened; drawing stops after a couple (see frame). */
  let idleFrames = 0;
  const redraw = () => {
    idleFrames = 0;
  };
  addEventListener('resize', redraw);
  addEventListener('resize', () => applyIconClip());

  function setDetailLevel(level: number) {
    detailLevel = Math.min(Math.max(level, 0), ladder.length - 1);
    loaded?.world.setDetail(ladder[detailLevel]);
    redraw();
  }

  /** Auto hands the level to the governor (starting from full detail); Sharp and Fast pin it. */
  function applyGraphics() {
    const g = settings.get().graphics;
    governor.reset();
    setDetailLevel(g === 'low' ? lowDetailLevel(ladder) : 0);
  }

  /* ------------------------------------------------------------------- sound */

  // Off by default. The synthesiser is its own chunk, fetched the first time sound is switched on.
  let sound: Sound | null = null;
  let soundLoading = false;
  async function startSound() {
    if (sound || soundLoading || !settings.get().sound) return;
    soundLoading = true;
    try {
      sound = (await import('../audio/index')).createSound();
    } catch (err) {
      console.error(err);
    } finally {
      soundLoading = false;
    }
    // Switched off again while the chunk was loading.
    if (!settings.get().sound) stopSound();
  }
  function stopSound() {
    sound?.dispose();
    sound = null;
  }
  // Remembered as on from an earlier visit: browsers only let audio start from a click or key press.
  if (settings.get().sound) {
    const onGesture = () => {
      removeEventListener('pointerdown', onGesture);
      removeEventListener('keydown', onGesture);
      void startSound();
    };
    addEventListener('pointerdown', onGesture);
    addEventListener('keydown', onGesture);
  }

  /* ------------------------------------------------------------- time of day */

  /** Seconds until the look is next refreshed from the clock (it only moves on Auto). */
  let lookTimer = 0;
  /** Sky, light and water for the chosen time: ?time=, else the setting, else the real hour in Auckland. */
  /** Beside the place name on the title screen: the real time in Auckland, when that is what lights the city. */
  function applyClock() {
    const live = settings.get().time === 'auto' && !params.get('time');
    const now = new Date();
    ui.setClock(live ? `${aucklandTime(now)} · ${dayPart(aucklandSolarHour(now))}` : null);
  }
  applyClock();

  function applyLook() {
    applyClock();
    if (!loaded) return;
    const look = lookAtSolar(chosenSolarHour(settings.get().time, params.get('time'), new Date()));
    loaded.world.setLook(look);
    lookTimer = 30;
    redraw();
  }

  settings.subscribe((now, before) => {
    if (now.graphics !== before.graphics) applyGraphics();
    if (now.time !== before.time) applyLook();
    if (now.sound !== before.sound) {
      if (now.sound) void startSound();
      else stopSound();
    }
    if (now.motion !== before.motion) applyMotion();
    if (now.invertPitch !== before.invertPitch) input?.setInvertPitch(now.invertPitch);
    redraw();
  });

  async function load(): Promise<Loaded> {
    const [{ loadWorld, createSkyDeck }, flight, inputMod] = await Promise.all([
      import('../world/index'),
      import('../flight/index'),
      import('../input/index'),
    ]);
    const world = await loadWorld({ canvas, baseUrl, quality, onProgress: (p) => ui.setLoading(p) });
    const stops = placeStops(content, world.meta, world.query.groundAt);
    world.setStops(stops);
    const camera = flight.createChaseCamera();
    const plane = flight.createPlane(world.lighting);
    world.add(plane.object);
    const sim = flight.createFlightSim();
    sim.reset({ ...spawnPoint(content, world.meta), speed: 55 });
    camera.snap(sim.state);
    input = inputMod.createInput({ canvas, touchRoot, invertPitch: settings.get().invertPitch });
    input.onAction(onAction);
    setInputMode(state);
    const minimapUrl = `${baseUrl}${world.meta.minimap.file}`;
    ui.setWorld({ meta: world.meta, stops, minimapUrl });
    const deck = createSkyDeck(world.meta);
    world.add(deck.group);
    const resize = () => {
      world.resize(innerWidth, innerHeight);
      camera.setAspect(innerWidth / innerHeight);
      deck.setAspect(innerWidth / innerHeight);
    };
    addEventListener('resize', resize);
    resize();
    // The browser can take the WebGL context away (GPU reset, memory pressure, a long sleep) and
    // usually hands it back within a second or two; three.js then rebuilds its own state.
    let contextTimer = 0;
    world.onContextChange((lost) => {
      clearTimeout(contextTimer);
      if (lost) {
        ui.setNotice('The 3D view was interrupted. Restoring it now.');
        contextTimer = window.setTimeout(() => {
          ui.setNotice(null);
          dispatch({ type: 'CONTEXT_LOST' });
        }, CONTEXT_RESTORE_MS);
      } else {
        ui.setNotice(null);
        resize();
        redraw();
      }
    });
    return { world, flight, sim, camera, plane, proximity: flight.createProximity(stops), stops, hold: flight.createHoldView(), deck };
  }

  load().then(
    (l) => {
      loaded = l;
      applyGraphics();
      applyMotion();
      applyLook();
      applyIconClip();
      if (state.kind === 'loading') dispatch({ type: 'LOADED' });
      requestAnimationFrame(frame);
    },
    (err: unknown) => {
      console.error(err);
      // The title screen stays usable; asking to fly then shows the error with the page link.
      failure = err instanceof Error ? err.message : String(err);
      ui.setLoadFailed();
      if (state.kind === 'loading') dispatch({ type: 'LOAD_FAILED', message: failure });
    },
  );

  // A link to a stop, one of its pages or its room opens there once the world has loaded.
  openRoute(urlRoute, 'GO_TO_STOP');

  /* ------------------------------------------------------------------- loop */

  let last = performance.now();
  let acc = 0;
  let toastCooldown = 0;
  let placeName: string | null = null;
  let placeTimer = 0;
  const prevPose: FlightState = {
    pos: { x: 0, y: 0, z: 0 },
    heading: 0,
    pitch: 0,
    bank: 0,
    speed: 0,
    vy: 0,
    boost: 1,
    boosting: false,
  };
  const renderPose: FlightState = structuredClone(prevPose);
  let attractAngle = 0;
  /** When the live city was first shown (frame clock, seconds); the title camera eases in from then. */
  let revealedAt: number | null = null;

  function controlsFor(l: Loaded): Controls {
    if (state.kind === 'autopilot' && autopilot) return autopilot.update(l.sim.state, l.world.query);
    if (holdingAt(state) && orbit) return orbit.update(l.sim.state, l.world.query);
    if (state.kind === 'flying' && input) return input.controls();
    return NO_CONTROLS;
  }

  function copyPose(dst: FlightState, src: FlightState) {
    dst.pos.x = src.pos.x;
    dst.pos.y = src.pos.y;
    dst.pos.z = src.pos.z;
    dst.heading = src.heading;
    dst.pitch = src.pitch;
    dst.bank = src.bank;
    dst.speed = src.speed;
    dst.vy = src.vy;
    dst.boost = src.boost;
    dst.boosting = src.boosting;
  }

  function lerpAngle(a: number, b: number, t: number) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function nearestPlace(l: Loaded, x: number, z: number): string | null {
    let best: string | null = null;
    let bestD = 1400;
    for (const p of l.world.meta.places) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = p.name;
      }
    }
    return best ? best.toUpperCase() : null;
  }

  /** Screen area covered by the open panel, refreshed a few times a second for the holding camera. */
  let cover: Obstruction | null = null;
  let coverTimer = 0;
  const deckOffset = { x: 0, y: 0 };

  function frame(now: number) {
    requestAnimationFrame(frame);
    const l = loaded;
    if (!l) return;
    const frameS = (now - last) / 1000;
    const dt = Math.min(0.1, frameS);
    last = now;
    input?.poll();
    // On Auto the sun keeps moving with the real clock; half a minute is finer than the eye can tell.
    lookTimer -= dt;
    if (lookTimer <= 0) applyLook();

    if (sound) {
      const scene =
        state.kind === 'flying' || state.kind === 'autopilot' ? 'flight' : state.kind === 'briefing' || state.kind === 'chat' ? 'hold' : state.kind === 'room' ? 'room' : 'silent';
      sound.update(scene, l.sim.state.speed, l.sim.state.boosting);
    }

    // Nothing moves under the pause menu: draw a couple of frames to settle, then stop until it
    // closes (or the window or a setting changes) instead of redrawing a still picture 60 times a second.
    if (state.kind === 'paused' && state.reason === 'menu') {
      if (++idleFrames > 2) return;
    } else idleFrames = 0;

    // The governor only judges frames from the flying view, where the load is.
    if (settings.get().graphics === 'auto' && simulationRunning(state)) {
      const level = governor.sample(frameS);
      if (level !== detailLevel) setDetailLevel(level);
    }
    const time = now / 1000;
    toastCooldown = Math.max(0, toastCooldown - dt);
    let warp = 1;

    const inRoom = roomView(state);
    if (inRoom) {
      const walking = state.kind === 'room' && state.panel === null && input;
      const spot = l.deck.step(dt, walking ? input!.controls() : NO_CONTROLS);
      if (spot?.id !== roomSpot?.id) {
        roomSpot = spot;
        ui.setRoomSpot(spot ? { id: spot.id, action: spot.action } : null);
      }
      // With a page open, slide the view into the free part of the screen (beside the docked panel or
      // above the phone sheet), so the screen you were facing stays visible.
      coverTimer -= dt;
      if (coverTimer <= 0) {
        cover = state.kind === 'room' && state.panel !== null ? ui.obstruction() : null;
        coverTimer = 0.25;
      }
      const ease = 1 - Math.exp(-dt * 6);
      deckOffset.x += ((cover ? cover.right / 2 : 0) - deckOffset.x) * ease;
      deckOffset.y += ((cover ? cover.bottom / 2 : 0) - deckOffset.y) * ease;
      const cam = l.deck.camera;
      if (Math.abs(deckOffset.x) < 0.5 && Math.abs(deckOffset.y) < 0.5) {
        if (cam.view?.enabled) cam.clearViewOffset();
      } else {
        cam.setViewOffset(innerWidth, innerHeight, deckOffset.x, deckOffset.y, innerWidth, innerHeight);
      }
      l.plane.object.visible = false;
      l.world.update(dt, time, l.deck.camera);
      l.world.render(l.deck.camera);
      return;
    }

    if (simulationRunning(state)) {
      if (state.kind === 'autopilot' && input?.hasFlightInput()) dispatch({ type: 'CANCEL_AUTOPILOT' });
      warp = state.kind === 'autopilot' && autopilot ? Math.max(1, Math.round(autopilot.status().warp)) : 1;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
        acc -= STEP;
        for (let w = 0; w < warp && steps < MAX_STEPS_PER_FRAME; w++) {
          copyPose(prevPose, l.sim.state);
          const res = l.sim.step(STEP, controlsFor(l), l.world.query);
          steps++;
          if (res.respawned) ui.toast('Recovered to a safe altitude.', 'warn');
          else if (res.collided && toastCooldown <= 0) {
            ui.toast('Bump!', 'warn');
            sound?.cue('bump');
            toastCooldown = 1.5;
          }
          if (res.outOfBounds && toastCooldown <= 0) {
            ui.toast('Turning back. That is the edge of the map.');
            toastCooldown = 4;
          }
          if (state.kind === 'autopilot' && autopilot) {
            const st = autopilot.status();
            if (st.phase !== state.phase) dispatch({ type: 'AUTOPILOT_PHASE', phase: st.phase });
            if (st.arrived) {
              dispatch({ type: 'ARRIVED' });
              break;
            }
          }
        }
      }
      if (steps >= MAX_STEPS_PER_FRAME) acc = 0;

      const prox = l.proximity.update(l.sim.state.pos);
      if (prox.current !== proximityCurrent) {
        proximityCurrent = prox.current;
        if (state.kind === 'flying') l.world.setActiveStop(proximityCurrent);
        updatePrompt();
      }

      // Interpolate between the last two steps for smooth rendering.
      const t = warp > 1 ? 1 : acc / STEP;
      copyPose(renderPose, l.sim.state);
      renderPose.pos.x = prevPose.pos.x + (l.sim.state.pos.x - prevPose.pos.x) * t;
      renderPose.pos.y = prevPose.pos.y + (l.sim.state.pos.y - prevPose.pos.y) * t;
      renderPose.pos.z = prevPose.pos.z + (l.sim.state.pos.z - prevPose.pos.z) * t;
      renderPose.heading = lerpAngle(prevPose.heading, l.sim.state.heading, t);
      renderPose.pitch = prevPose.pitch + (l.sim.state.pitch - prevPose.pitch) * t;
      renderPose.bank = prevPose.bank + (l.sim.state.bank - prevPose.bank) * t;
      l.hold.restore(l.camera.camera);
      l.camera.update(dt, renderPose, l.world.query, warp);
      coverTimer -= dt;
      if (coverTimer <= 0) {
        cover = ui.obstruction();
        coverTimer = 0.25;
      }
      const held = holdingAt(state);
      l.hold.apply(dt, l.camera.camera, held ? placement(held) : null, l.world.query, cover);
    } else if (state.kind === 'title' || state.kind === 'loading') {
      // Attract mode: a slow orbit around the CBD behind the title screen.
      // Slow orbit around the Sky Tower, framed in the right third so the title card has the left.
      if (!reducedMotion()) attractAngle += dt * 0.03;
      const st = l.world.meta.landmarks.skyTower;
      const cam = l.camera.camera;
      // An establishing shot: start high and wide as the city appears, and settle in over a few seconds.
      const sinceReveal = revealedAt === null ? 0 : time - revealedAt;
      const settle = reducedMotion() ? 1 : 1 - Math.pow(1 - Math.min(1, sinceReveal / ATTRACT_SETTLE_S), 3);
      const radius = 1250 + (1 - settle) * 520;
      const cx = st.x + Math.sin(attractAngle) * radius;
      const cz = st.z + Math.cos(attractAngle) * radius;
      cam.position.set(cx, 290 + (1 - settle) * 170, cz);
      const fx = (st.x - cx) / radius;
      const fz = (st.z - cz) / radius;
      // Camera right vector is (-fz, 0, fx); aim left of the tower to push it right on screen.
      const shift = innerWidth > innerHeight * 1.1 ? radius * 0.32 : 0;
      cam.lookAt(st.x + fz * shift, st.groundY + 140, st.z - fx * shift);
      copyPose(renderPose, l.sim.state);
    } else {
      copyPose(renderPose, l.sim.state);
    }

    l.plane.object.visible = state.kind !== 'title' && state.kind !== 'loading';
    l.plane.update(renderPose, time);
    l.world.update(dt, time, l.camera.camera);
    l.world.render(l.camera.camera);
    if (revealedAt === null) {
      // The city has now really been drawn (the first frame is the one that uploads everything):
      // let the boot scene give way to it.
      revealedAt = time;
      void ui.reveal();
      // Now that there is something to look at, fetch what makes it hold up close.
      l.world.startDetail();
    }

    // Telemetry
    placeTimer -= dt;
    if (placeTimer <= 0) {
      placeName = nearestPlace(l, renderPose.pos.x, renderPose.pos.z);
      placeTimer = 0.5;
    }
    ui.updateTelemetry(telemetry(l, renderPose, warp));
  }

  function targetInfo(l: Loaded, pose: FlightState): TargetInfo | null {
    const id =
      state.kind === 'autopilot' ? state.target : (holdingAt(state) ?? navSelected ?? proximityCurrent);
    const stop = id ? placement(id) : null;
    if (!stop) return null;
    const dx = stop.x - pose.pos.x;
    const dz = stop.z - pose.pos.z;
    const north = l.world.meta.crs.trueNorthAngleRad;
    const gridBearing = Math.atan2(dx, -dz);
    const bearingDeg = wrapDeg(((gridBearing - north) * 180) / Math.PI);
    const relativeDeg = wrap180(((gridBearing - pose.heading) * 180) / Math.PI);
    const cam = l.camera.camera;
    // clone() gives a Vector3 without importing three into the entry chunk.
    const p = cam.position.clone().set(stop.x, stop.baseY + 40, stop.z).project(cam);
    const onScreen = p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
    const rect = canvas.getBoundingClientRect();
    return {
      id: stop.id,
      label: stop.label,
      distanceM: Math.hypot(dx, dz),
      bearingDeg,
      relativeDeg,
      onScreen,
      screen: onScreen ? { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height } : undefined,
    };
  }

  function telemetry(l: Loaded, pose: FlightState, warp: number): Telemetry {
    const north = l.world.meta.crs.trueNorthAngleRad;
    return {
      speedKmh: pose.speed * 3.6,
      altitudeAsl: pose.pos.y,
      heightAboveGround: pose.pos.y - l.world.query.solidAt(pose.pos.x, pose.pos.z),
      headingDeg: wrapDeg(((pose.heading - north) * 180) / Math.PI),
      boost: pose.boost,
      boosting: pose.boosting,
      pullUp: pose.pos.y - l.world.query.solidAt(pose.pos.x, pose.pos.z) < 15 && state.kind === 'flying',
      place: placeName,
      target: targetInfo(l, pose),
      warp,
      autopilot: state.kind === 'autopilot' && autopilot ? autopilot.status() : null,
      plane: { x: pose.pos.x, z: pose.pos.z, headingRad: pose.heading },
    };
  }

  /* ------------------------------------------------------------------ debug */

  if (debug) {
    // getExtension returns null once the context is lost, so keep the handle from before.
    let loseExt: WEBGL_lose_context | null = null;
    (window as unknown as { __aw: unknown }).__aw = {
      state: () => state,
      dispatch,
      settings,
      /** Simulate the browser dropping the WebGL context; restoreContext() hands it back. */
      loseContext: () => {
        loseExt = loaded?.world.renderer.getContext().getExtension('WEBGL_lose_context') ?? loseExt;
        loseExt?.loseContext();
        return !!loseExt;
      },
      restoreContext: () => {
        loseExt?.restoreContext();
        return !!loseExt;
      },
      info: () => {
        const l = loaded;
        if (!l) return { loaded: false };
        return {
          loaded: true,
          pose: structuredClone(l.sim.state),
          stats: l.world.stats(),
          proximity: proximityCurrent,
          detail: { level: detailLevel, ...ladder[detailLevel], governorFps: Math.round(governor.fps), idleFrames },
          // The plane's shadow as the shaders see it: strength, and the direction it is cast from.
          shadow: { strength: l.world.lighting.uShadowK.value, from: l.world.lighting.uShadowDir.value.toArray().map((v) => Math.round(v * 100) / 100) },
        };
      },
      teleport: (id: StopId) => {
        const l = loaded;
        const stop = placement(id);
        if (!l || !stop) return false;
        l.sim.reset({ pos: { x: stop.x, y: stop.orbitY, z: stop.z + stop.orbitRadius + 150 }, heading: 0, speed: 45 });
        snapCamera(l);
        return true;
      },
      teleportLatLon: (lat: number, lon: number, y: number, headingDeg = 0) => {
        const l = loaded;
        if (!l) return false;
        const p = latLonToLocal(l.world.meta.geo, lat, lon);
        l.sim.reset({ pos: { x: p.x, y, z: p.z }, heading: (headingDeg * Math.PI) / 180 + l.world.meta.crs.trueNorthAngleRad, speed: 45 });
        snapCamera(l);
        return true;
      },
      autopilot: (id: StopId) => dispatch({ type: 'ENGAGE', stop: id }),
      /** In a room: stand in front of a hotspot (by id), facing it. */
      roomFace: (id: string, out = 2.5) => {
        const spot = SKY_DECK_SPOTS.find((s) => s.id === id);
        if (!loaded || !spot) return false;
        const p = hotspotPoint(spot, out);
        loaded.deck.place({ x: p.x, z: p.z, yaw: Math.atan2(-p.x, p.z) });
        return true;
      },
    };
  }
}

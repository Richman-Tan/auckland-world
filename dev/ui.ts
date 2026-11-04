/**
 * UI harness: createUi over a plain background, with the fake map's minimap, real placeStops,
 * a local AppState driven by the real transition(), and an animated plane circling the CBD.
 * ?s=<view> jumps straight to a view (title, loading, flying, nav, autopilot, briefing, briefing-last,
 * pause, error-webgl, error-load); ?panel=0 hides the floating panel.
 */
import { placeStops } from '../src/app/placement';
import { transition, type AppEvent, type AppState } from '../src/app/fsm';
import type { Telemetry, UiApi, UiWorld } from '../src/app/contracts';
import { content } from '../src/content/index';
import { decodeTerrain, isGzip, isMapMeta, latLonToLocal, sampleTerrain, type MapMeta } from '../src/shared/mapFormat';
import { createUi } from '../src/ui/index';

const root = document.getElementById('ui') as HTMLElement;
const panel = document.getElementById('panel') as HTMLElement;
const q = new URLSearchParams(location.search);

let state: AppState = { kind: 'title' };
let ui: UiApi;
const ctx = { pageCount: (id: string) => content.stops.find((s) => s.id === id)?.briefing.length ?? 1 };

function set(s: AppState): void {
  state = s;
  ui.sync(state);
  if (s.kind === 'loading') startLoading();
}
function dispatch(e: AppEvent): void {
  console.log('dispatch', e);
  set(transition(state, e, ctx));
}

ui = createUi({ root, content, dispatch });

let world: UiWorld | null = null;
let meta: MapMeta | null = null;
let loadTimer = 0;
function startLoading(): void {
  clearInterval(loadTimer);
  let b = 0;
  loadTimer = window.setInterval(() => {
    b += 600_000;
    ui.setLoading({ loadedBytes: Math.min(b, 2_600_000), totalBytes: 2_600_000, label: b < 1_500_000 ? 'Buildings' : 'Terrain' });
    if (b >= 2_600_000) {
      clearInterval(loadTimer);
      if (state.kind === 'loading') dispatch({ type: 'LOADED' });
    }
  }, 500);
}

async function loadWorld(): Promise<void> {
  const base = '/map-fake/';
  const m = (await (await fetch(`${base}meta.json`)).json()) as unknown;
  if (!isMapMeta(m)) throw new Error('bad meta');
  meta = m;
  const buf = new Uint8Array(await (await fetch(`${base}${m.terrain.file}`)).arrayBuffer());
  // The dev server may already have decoded Content-Encoding: gzip.
  const raw = isGzip(buf) ? new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : buf;
  const terrain = decodeTerrain(raw);
  const stops = placeStops(content, m, (x, z) => sampleTerrain(terrain, x, z));
  world = { meta: m, stops, minimapUrl: `${base}${m.minimap.file}` };
  ui.setWorld(world);
}

/* ---- mock telemetry: circle the CBD ---- */
let t0 = performance.now();
let warp = 1;
function telemetry(): Telemetry | null {
  if (!world || !meta) return null;
  const t = (performance.now() - t0) / 1000;
  const cx = world.meta.landmarks.skyTower.x;
  const cz = world.meta.landmarks.skyTower.z;
  const R = 900;
  const a = t * 0.12;
  const x = cx + Math.sin(a) * R;
  const z = cz - Math.cos(a) * R;
  const headingRad = a + Math.PI / 2; // tangent, clockwise
  const trueN = meta.crs.trueNorthAngleRad;
  const sel = state.kind === 'nav' ? state.selected : state.kind === 'autopilot' ? state.target : null;
  const target = world.stops.find((s) => s.id === sel) ?? world.stops[0];
  const dx = target.x - x;
  const dz = target.z - z;
  const bearingGrid = Math.atan2(dx, -dz);
  const bearingDeg = ((((bearingGrid - trueN) * 180) / Math.PI) % 360 + 360) % 360;
  const headingDeg = ((((headingRad - trueN) * 180) / Math.PI) % 360 + 360) % 360;
  let rel = bearingDeg - headingDeg;
  rel = ((rel + 540) % 360) - 180;
  const places = ['PONSONBY', 'FREEMANS BAY', 'CBD', 'PARNELL', 'MT EDEN'];
  return {
    speedKmh: 210 + Math.sin(t * 0.5) * 30,
    altitudeAsl: 150 + Math.sin(t * 0.3) * 20,
    heightAboveGround: 100,
    headingDeg,
    boost: 0.5 + 0.5 * Math.sin(t * 0.4),
    boosting: Math.sin(t * 0.4) > 0.7,
    pullUp: q.get('pullup') === '1',
    place: places[Math.floor(t / 6) % places.length],
    target: { id: target.id, label: target.label, distanceM: Math.hypot(dx, dz), bearingDeg, relativeDeg: rel, onScreen: Math.abs(rel) < 30 },
    warp,
    autopilot: state.kind === 'autopilot' ? { phase: state.phase, warp, etaS: 40 - ((t * 2) % 40), progress: ((t * 0.05) % 1), arrived: false } : null,
    plane: { x, z, headingRad },
  };
}
function tick(): void {
  const tel = telemetry();
  if (tel) ui.updateTelemetry(tel);
  requestAnimationFrame(tick);
}

/* ---- jump table ---- */
function jump(name: string): void {
  warp = 1;
  const first = content.stops[0];
  switch (name) {
    case 'title': return set({ kind: 'title' });
    case 'loading': return set({ kind: 'loading', intent: { mode: 'fly' } });
    case 'flying': return set({ kind: 'flying' });
    case 'nav': return set({ kind: 'nav', selected: 'projects' });
    case 'autopilot': warp = 4; return set({ kind: 'autopilot', target: 'projects', phase: 'cruise' });
    case 'briefing': return set({ kind: 'briefing', stop: first.id, page: 0, pageCount: first.briefing.length });
    case 'briefing-last': return set({ kind: 'briefing', stop: first.id, page: first.briefing.length - 1, pageCount: first.briefing.length });
    case 'work': { const s = content.stops[1]; return set({ kind: 'briefing', stop: s.id, page: 0, pageCount: s.briefing.length }); }
    case 'pause': return set({ kind: 'paused', reason: 'menu', resumeTo: { kind: 'flying' } });
    case 'error-webgl': return set({ kind: 'error', reason: 'webgl' });
    case 'error-load': return set({ kind: 'error', reason: 'load', message: 'meta.json: 404' });
    case 'prompt':
      set({ kind: 'flying' });
      return ui.setPrompt({ stop: 'projects', label: 'PROJECTS', place: 'SKY TOWER', actions: [{ action: 'briefing', key: 'Space', label: 'Read briefing' }] });
    case 'toast': return ui.toast('Autopilot engaged', 'info');
  }
}
(window as unknown as Record<string, unknown>).__ui = { jump, dispatch, set };

const names = ['title', 'loading', 'flying', 'prompt', 'nav', 'autopilot', 'briefing', 'briefing-last', 'work', 'pause', 'error-webgl', 'error-load', 'toast'];
for (const n of names) {
  const b = document.createElement('button');
  b.textContent = n;
  b.addEventListener('click', () => jump(n));
  panel.append(b);
}
panel.hidden = q.get('panel') === '0';

void loadWorld().then(() => {
  t0 = performance.now();
  const s = q.get('s');
  if (s) jump(s);
  requestAnimationFrame(tick);
});

/** Dev harness for the world renderer: free-fly camera, stats, preset views. */
import { PerspectiveCamera, Vector3 } from 'three';
import { placeStops } from '../src/app/placement';
import type { QualityTier, WorldScene } from '../src/app/contracts';
import { content } from '../src/content/index';
import { chosenSolarHour, lookAtSolar } from '../src/shared/timeOfDay';
import { loadWorld } from '../src/world/index';

const params = new URLSearchParams(location.search);
const baseUrl = params.get('map') === 'real' ? '/map/' : '/map-fake/';
const quality: QualityTier = params.get('q') === 'low' ? 'low' : 'high';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const msg = document.getElementById('msg') as HTMLElement;
const stage = document.getElementById('stage') as HTMLElement;

const camera = new PerspectiveCamera(60, 16 / 9, 0.5, 3500);
let yaw = 0; // 0 = north (-z), clockwise
let pitch = 0;
const keys = new Set<string>();

function applyCamera() {
  camera.rotation.order = 'YXZ';
  camera.rotation.set(pitch, -yaw, 0);
}

function lookAt(from: [number, number, number], to: [number, number, number]) {
  camera.position.set(...from);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  yaw = Math.atan2(dx, -dz);
  pitch = Math.atan2(dy, Math.hypot(dx, dz));
  applyCamera();
}

const VIEWS: Record<string, { from: [number, number, number]; to: [number, number, number] }> = {
  // ~300 m south-east of the Sky Tower, looking at its pod
  cbd: { from: [150, 150, 150], to: [-88, 210, -85] },
  eden: { from: [40, 330, 2450], to: [40, 190, 3047] },
  bridge: { from: [-1050, 90, -1750], to: [-1677, 45, -2177] },
  devonport: { from: [2150, 130, -1550], to: [2876, 20, -2193] },
  wide: { from: [-600, 420, 900], to: [0, 20, -1200] },
  // Close-up views, for judging detail. Low and near, where the world has to hold up.
  // The low pass beside the bridge's southern approach, heading east-north-east over the marina.
  westhaven: { from: [-1745, 24, -1600], to: [-1359, 14, -1704] },
  // Standing on the bridge deck south of the arch, looking along it.
  deck: { from: [-1590, 52, -1980], to: [-1448, 48, -2244] },
  ponsonby: { from: [-1650, 60, 900], to: [-1350, 15, 600] },
  domain: { from: [1000, 110, 1650], to: [1292, 60, 1238] },
  viaduct: { from: [-650, 60, -400], to: [-374, 5, -670] },
  port: { from: [1500, 120, -300], to: [2100, 30, -650] },
  edenpark: { from: [-1400, 140, 3200], to: [-1700, 20, 2830] },
  junction: { from: [-650, 160, 1600], to: [-307, 40, 1230] },
};

addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
let dragging = false;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
addEventListener('pointerup', () => (dragging = false));
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw += e.movementX * 0.004;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.004));
  applyCamera();
});

let world: WorldScene | null = null;

function resize() {
  if (!world) return;
  const { width, height } = world.resize(innerWidth, innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

async function main() {
  const t0 = performance.now();
  world = await loadWorld({
    canvas,
    baseUrl,
    quality,
    onProgress: (p) => (msg.textContent = `${p.label} ${(p.loadedBytes / 1024).toFixed(0)} / ${(p.totalBytes / 1024).toFixed(0)} KB`),
  });
  const loadMs = performance.now() - t0;
  msg.textContent = '';
  stage.appendChild(canvas);
  const stops = placeStops(content, world.meta, world.query.groundAt);
  world.setStops(stops);
  world.setActiveStop((params.get('active') as never) ?? null);
  resize();

  // ?view=<name>, or any view at all with ?from=x,y,z&to=x,y,z
  const triple = (name: string): [number, number, number] | null => {
    const n = (params.get(name) ?? '').split(',').map(Number);
    return n.length === 3 && n.every(Number.isFinite) ? [n[0], n[1], n[2]] : null;
  };
  const view = params.get('view');
  const v = view ? VIEWS[view] : undefined;
  const from = triple('from');
  const to = triple('to');
  if (from && to) lookAt(from, to);
  else if (v) lookAt(v.from, v.to);
  else lookAt([-600, 200, 600], [-88, 150, -85]);

  // ?time=<solar hour or preset>; [ and ] scrub half an hour at a time.
  let solar = chosenSolarHour('afternoon', params.get('time'), new Date());
  const setTime = (h: number) => {
    solar = ((h % 24) + 24) % 24;
    world?.setLook(lookAtSolar(solar));
  };
  setTime(solar);
  addEventListener('keydown', (e) => {
    if (e.code === 'BracketLeft') setTime(solar - 0.5);
    if (e.code === 'BracketRight') setTime(solar + 0.5);
  });

  const w = window as unknown as Record<string, unknown>;
  w.__world = { world, camera, stops, loadMs, lookAt, VIEWS, setTime };

  let last = performance.now();
  let hudAcc = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = (fast ? 400 : 80) * dt;
    const fx = Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const fwd = new Vector3(fx, 0, fz);
    const right = new Vector3(-fz, 0, fx);
    if (keys.has('KeyW')) camera.position.addScaledVector(fwd, speed);
    if (keys.has('KeyS')) camera.position.addScaledVector(fwd, -speed);
    if (keys.has('KeyD')) camera.position.addScaledVector(right, speed);
    if (keys.has('KeyA')) camera.position.addScaledVector(right, -speed);
    if (keys.has('KeyE')) camera.position.y += speed;
    if (keys.has('KeyQ')) camera.position.y -= speed;
    for (let i = 0; i <= 5; i++) {
      if (keys.has(`Digit${i}`)) world?.setActiveStop(i === 0 ? null : (stops[i - 1]?.id ?? null));
    }
    world?.update(dt, now / 1000, camera);
    world?.render(camera);
    hudAcc += dt;
    if (hudAcc > 0.25 && world) {
      hudAcc = 0;
      const s = world.stats();
      hud.textContent =
        `fps ${s.fps.toFixed(0)}  cpu ${s.frameMs.toFixed(1)} ms\n` +
        `draws ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k\n` +
        `${s.internalWidth}x${s.internalHeight} @ x${s.pixelScale}\n` +
        `pos ${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)}, ${camera.position.z.toFixed(0)}\n` +
        `load ${(loadMs / 1000).toFixed(2)} s  ${baseUrl}\n` +
        `solar ${solar.toFixed(1)} h  ([ ] to scrub)`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((e) => {
  msg.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});

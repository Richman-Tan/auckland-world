/** Dev harness for the world renderer: free-fly camera, stats, preset views. */
import { PerspectiveCamera, Vector3 } from 'three';
import { placeStops } from '../src/app/placement';
import type { QualityTier, WorldScene } from '../src/app/contracts';
import { content } from '../src/content/index';
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

  const view = params.get('view');
  const v = view ? VIEWS[view] : undefined;
  if (v) lookAt(v.from, v.to);
  else lookAt([-600, 200, 600], [-88, 150, -85]);

  const w = window as unknown as Record<string, unknown>;
  w.__world = { world, camera, stops, loadMs, lookAt, VIEWS };

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
        `load ${(loadMs / 1000).toFixed(2)} s  ${baseUrl}`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((e) => {
  msg.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});

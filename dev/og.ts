/**
 * Dev-only: renders the real city behind the social-preview card at whatever size the page is
 * opened at (open it in a 1200x630 frame, then capture). ?a= sets the orbit angle in radians.
 */
import '../src/app/base.css';
import '../src/ui/styles/fonts.css';
import { placeStops } from '../src/app/placement';
import { content } from '../src/content/index';
import { createChaseCamera } from '../src/flight/index';
import { loadWorld } from '../src/world/index';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const world = await loadWorld({ canvas, baseUrl: '/map/', quality: 'high' });
world.setStops(placeStops(content, world.meta, world.query.groundAt));
const cam = createChaseCamera().camera;

const params = new URLSearchParams(location.search);
const angle = Number(params.get('a') ?? 0.35);
const st = world.meta.landmarks.skyTower;
const radius = Number(params.get('r') ?? 1150);
const height = Number(params.get('y') ?? 260);

function place() {
  world.resize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight;
  cam.updateProjectionMatrix();
  const cx = st.x + Math.sin(angle) * radius;
  const cz = st.z + Math.cos(angle) * radius;
  cam.position.set(cx, height, cz);
  const fx = (st.x - cx) / radius;
  const fz = (st.z - cz) / radius;
  const shift = radius * Number(params.get('s') ?? 0.3);
  cam.lookAt(st.x + fz * shift, st.groundY + 130, st.z - fx * shift);
}
place();
addEventListener('resize', place);

function frame(t: number) {
  world.update(1 / 60, t / 1000, cam);
  world.render(cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.body.dataset.ready = '1';

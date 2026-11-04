/**
 * Crude flight harness for the integrator. Run `npm run dev`, open /dev/flight.html.
 * WASD/arrows fly, Shift boosts, 1-5 selects a stop, Enter engages the autopilot, Esc cancels,
 * R respawns at the spawn point. Mouse drag steers too. Add ?map=/map/ to use the real map.
 */
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  Fog,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { placeStops, spawnPoint } from '../src/app/placement';
import type { Autopilot, StopPlacement } from '../src/app/contracts';
import { content } from '../src/content/index';
import { buildCollisionGrid, createWorldQuery, landmarkColliders } from '../src/shared/collision';
import { type MapMeta, decodeBuildings, decodeTerrain, isGzip } from '../src/shared/mapFormat';
import { createAutopilot, createChaseCamera, createFlightSim, createOrbit, createPlane, createProximity } from '../src/flight';
import { createInput } from '../src/input';

const base = new URLSearchParams(location.search).get('map') ?? '/map-fake/';

async function bytes(url: string): Promise<Uint8Array> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  if (!isGzip(buf)) return buf;
  const ds = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

async function main() {
  const meta = (await (await fetch(`${base}meta.json`)).json()) as MapMeta;
  const terrain = decodeTerrain(await bytes(base + meta.terrain.file));
  const buildings = decodeBuildings(await bytes(base + meta.buildings.file));
  const grid = buildCollisionGrid(terrain, buildings, meta.bounds, meta.collision.cell, meta.water.level);
  const world = createWorldQuery(terrain, grid, landmarkColliders(meta), meta.bounds, meta.water.level);
  const stops: StopPlacement[] = placeStops(content, meta, world.groundAt);

  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  const scene = new Scene();
  scene.background = new Color(0x9fd3e6);
  scene.fog = new Fog(0x9fd3e6, 800, 3400);

  // terrain mesh, one vertex per grid point, coloured by height
  const g = new PlaneGeometry(1, 1, terrain.cols - 1, terrain.rows - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let r = 0; r < terrain.rows; r++) {
    for (let c = 0; c < terrain.cols; c++) {
      const i = r * terrain.cols + c;
      const h = terrain.heights[i];
      pos.setXYZ(i, terrain.x0 + c * terrain.cell, Math.max(h, meta.water.level), terrain.z0 + r * terrain.cell);
      const k = h <= meta.water.level ? [0.1, 0.4, 0.5] : [0.25 + h / 400, 0.5 + h / 600, 0.25];
      col.set(k, i * 3);
    }
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.computeVertexNormals();
  scene.add(new Mesh(g, new MeshBasicMaterial({ vertexColors: true })));

  // buildings as boxes from each footprint's bounding box
  const inst = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xc9bfa6 }), buildings.count);
  const m = new Matrix4();
  for (let b = 0; b < buildings.count; b++) {
    const ring = buildings.buildingRingStart[b];
    const vs = buildings.ringVertexStart[ring] * 2;
    const ve = buildings.ringVertexStart[ring + 1] * 2;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = vs; i < ve; i += 2) {
      x0 = Math.min(x0, buildings.xz[i]); x1 = Math.max(x1, buildings.xz[i]);
      z0 = Math.min(z0, buildings.xz[i + 1]); z1 = Math.max(z1, buildings.xz[i + 1]);
    }
    const top = buildings.topY[b];
    const bot = world.groundAt((x0 + x1) / 2, (z0 + z1) / 2);
    m.makeScale(Math.max(x1 - x0, 2), Math.max(top - bot, 2), Math.max(z1 - z0, 2));
    m.setPosition((x0 + x1) / 2, (top + bot) / 2, (z0 + z1) / 2);
    inst.setMatrixAt(b, m);
  }
  scene.add(inst);

  // stop markers
  for (const s of stops) {
    const beam = new Mesh(new BoxGeometry(6, 400, 6), new MeshBasicMaterial({ color: 0xd7263d }));
    beam.position.set(s.x, s.baseY + 200, s.z);
    scene.add(beam);
  }

  const sim = createFlightSim();
  const plane = createPlane();
  scene.add(plane.object);
  const cam = createChaseCamera();
  const prox = createProximity(stops);
  const input = createInput({ canvas, touchRoot: document.getElementById('touch') as HTMLElement });
  const spawn = spawnPoint(content, meta);
  const respawn = () => {
    sim.reset(spawn);
    cam.snap(sim.state);
  };
  respawn();

  let selected: StopPlacement | null = null;
  let ap: Autopilot | null = null;
  let arrivedOrbit: ReturnType<typeof createOrbit> | null = null;
  input.onAction((a) => {
    if (a.startsWith('select')) selected = stops.find((s) => s.hotkey === Number(a.slice(6))) ?? null;
    else if (a === 'engage' && selected) {
      ap = createAutopilot(selected, world, sim.state);
      arrivedOrbit = null;
    } else if (a === 'back') {
      ap = null;
      arrivedOrbit = null;
    } else if (a === 'nav') toast = stops.map((s) => `${s.hotkey} ${s.label}`).join('  ');
  });
  addEventListener('keydown', (e) => e.code === 'KeyR' && respawn());

  const hud = document.getElementById('hud') as HTMLElement;
  let toast = '';
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    cam.setAspect(innerWidth / innerHeight);
  };
  addEventListener('resize', resize);
  resize();

  let last = performance.now();
  let acc = 0;
  let time = 0;
  let lastWarp = 1;
  const DT = 1 / 60;
  let note = '';
  const frame = (now: number) => {
    const dtReal = Math.min((now - last) / 1000, 0.1);
    last = now;
    acc += dtReal;
    time += dtReal;
    while (acc >= DT) {
      acc -= DT;
      if (ap && input.hasFlightInput()) ap = arrivedOrbit = null;
      const warp = ap && !arrivedOrbit ? Math.round(ap.status().warp) : 1;
      lastWarp = warp;
      for (let i = 0; i < warp; i++) {
        const controls = arrivedOrbit
          ? arrivedOrbit.update(sim.state, world)
          : ap
            ? ap.update(sim.state, world)
            : input.controls();
        const r = sim.step(DT, controls, world);
        note = r.respawned ? 'RESPAWNED' : r.collided ? `HIT ${r.hit}` : r.pullUp ? 'PULL UP' : r.outOfBounds ? 'TURN BACK' : '';
        if (ap?.status().arrived && !arrivedOrbit) {
          arrivedOrbit = createOrbit(ap.target);
          toast = `ARRIVED: ${ap.target.label} (orbiting; Esc to leave)`;
          break;
        }
      }
    }
    const p = prox.update(sim.state.pos);
    plane.update(sim.state, time);
    cam.update(dtReal, sim.state, world, lastWarp);
    renderer.render(scene, cam.camera);
    const s = sim.state;
    const st = ap?.status();
    hud.textContent =
      `spd ${s.speed.toFixed(0)} m/s  alt ${s.pos.y.toFixed(0)} m  hdg ${((s.heading * 180) / Math.PI).toFixed(0)}  boost ${(s.boost * 100).toFixed(0)}%\n` +
      `${note}  ${p.current ? 'NEAR ' + p.current : ''}\n` +
      `selected: ${selected?.label ?? '-'}  (1-5 select, Enter engage, Esc cancel, R respawn, Tab list)\n` +
      (st && !arrivedOrbit ? `AUTOPILOT ${st.phase} x${st.warp.toFixed(1)} eta ${st.etaS.toFixed(0)}s ${(st.progress * 100).toFixed(0)}%\n` : '') +
      toast;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();

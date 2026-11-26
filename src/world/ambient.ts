/**
 * Ambient life: ferries crossing the harbour and traffic on the Harbour Bridge. Two instanced meshes
 * (two draw calls), driven from the pure paths in shared/ambientPaths.ts. Nothing here can be hit:
 * it is scenery.
 */
import { BufferAttribute, Color, DynamicDrawUsage, Group, InstancedMesh, Object3D } from 'three';
import type { QualityTier } from '../app/contracts';
import { type Box, VERTS_PER_BOX, mergeBoxes } from '../render/boxes';
import { createAmbientMaterial } from '../render/materials';
import type { SharedUniforms } from '../render/uniforms';
import { BRIDGE_CAR_HALF_WIDTH, BRIDGE_LANES_FIT, bridgeCar, bridgeGeometry, ferryPaths, shuttleAt } from '../shared/ambientPaths';
import type { WorldQuery } from '../shared/collision';
import type { MapMeta } from '../shared/mapFormat';

const NO_GLOW = 0;
const GLOW_WHITE = 1;
const GLOW_RED = 2;
const GLOW_WINDOW = 3;
/** Not a lamp: a part that keeps its own colour when the instance is painted. */
const PLAIN = 4;

/** A box and which lamp it is, if any. Bow and bonnet point along -z, like the plane's nose. */
type Part = readonly [...Box, glow: number];

// A harbour ferry, a little larger than life so it survives the low resolution. y = 0 is the waterline.
const FERRY: readonly Part[] = [
  [7.4, 1.0, 26, 0, 0.3, 0, 0x1f3a5f, NO_GLOW], // hull, below the rubbing strake
  [7.0, 2.0, 25.4, 0, 1.7, 0, 0xe9efe6, NO_GLOW], // hull
  [5.8, 2.6, 14, 0, 4.0, 1.5, 0xcfd8d2, NO_GLOW], // cabin
  [6.0, 1.0, 13, 0, 4.2, 1.5, 0x2b4a5c, GLOW_WINDOW], // cabin windows
  [5.0, 0.4, 12, 0, 5.5, 1.5, 0xe9efe6, NO_GLOW], // cabin roof
  [1.2, 2.2, 1.6, 0, 6.6, 5.0, 0xd7263d, NO_GLOW], // funnel
  [0.9, 0.9, 0.9, 0, 8.0, -2.5, 0xfff6c9, GLOW_WHITE], // masthead light
];

// A car, drawn white so the instance colour is its paint.
const CAR: readonly Part[] = [
  [2.6, 1.3, 5.6, 0, 0.95, 0, 0xffffff, NO_GLOW], // body
  [2.3, 1.0, 2.8, 0, 2.05, 0.3, 0x9aa7ad, NO_GLOW], // cabin
  [2.6, 0.9, 0.7, 0, 1.0, -2.75, 0xfff6c9, GLOW_WHITE], // headlights
  [2.6, 0.9, 0.7, 0, 1.0, 2.75, 0x7a1c1c, GLOW_RED], // tail lights
];
/** The car model is 2.6 m wide; this is the scale that makes it as wide as the lanes were checked for. */
const BRIDGE_CAR_SCALE = (BRIDGE_CAR_HALF_WIDTH * 2) / 2.6;
// Moored boats, each drawn to its own length (the model is MOORED_LENGTH long) and in white, so the
// instance colour is its hull. y = 0 is the waterline; the bow points along -z.
export const MOORED_LENGTH = 10;
const YACHT_PARTS: readonly Part[] = [
  [3.0, 1.1, 10, 0, 0.35, 0, 0xffffff, NO_GLOW], // hull
  [2.0, 0.5, 6.4, 0, 1.15, 0.2, 0xe9efe6, PLAIN], // deck
  [1.7, 0.75, 3.2, 0, 1.75, 0.6, 0xcfd8d2, PLAIN], // cabin
  [0.28, 12.5, 0.28, 0, 7.6, -0.9, 0xc9cdd0, PLAIN], // mast
  [0.22, 0.22, 4.4, 0, 2.6, 1.4, 0xe9e2cf, PLAIN], // boom, with the sail furled along it
];
const LAUNCH_PARTS: readonly Part[] = [
  [3.3, 1.5, 10, 0, 0.5, 0, 0xffffff, NO_GLOW], // hull
  [2.9, 1.5, 5.2, 0, 2.0, 0.4, 0xe9efe6, PLAIN], // cabin
  [3.0, 0.6, 4.6, 0, 2.2, 0.4, 0x2b4a5c, PLAIN], // cabin windows (dark at night: nobody is aboard)
  [2.4, 0.9, 2.4, 0, 3.2, 1.2, 0xd9dedb, PLAIN], // flybridge
];
/** Hull paints: most are white. */
export const HULL_PAINT = ['#f1ece0', '#f1ece0', '#f1ece0', '#e3e6e2', '#1f3a5f', '#8f2d2a', '#2f5f63', '#3a3d42'] as const;

/** The two moored-boat models (yacht, launch), ready to be instanced. */
export function mooredBoatModels() {
  return [model(YACHT_PARTS), model(LAUNCH_PARTS)];
}

const CAR_PAINT = ['#e9efe6', '#c9c2b4', '#2a9d8f', '#d7263d', '#3a3d42', '#f2c230', '#6f8a94', '#8b6a55'] as const;

function model(parts: readonly Part[]) {
  const g = mergeBoxes(
    parts.map((p) => p.slice(0, 7) as unknown as Box),
    true,
  );
  // The ambient shader names its own attributes (three only declares `color` for its own materials).
  g.setAttribute('aTint', g.getAttribute('color'));
  g.deleteAttribute('color');
  const glow = new Float32Array(parts.length * VERTS_PER_BOX);
  parts.forEach((p, i) => glow.fill(p[7], i * VERTS_PER_BOX, (i + 1) * VERTS_PER_BOX));
  g.setAttribute('aGlow', new BufferAttribute(glow, 1));
  return g;
}

export interface Ambient {
  readonly group: Group;
  /** Move everything to where it is at `time` (seconds, any steady clock). */
  update(time: number): void;
  dispose(): void;
}

export function createAmbient(meta: MapMeta, query: WorldQuery, shared: SharedUniforms, quality: QualityTier): Ambient {
  const group = new Group();
  group.name = 'ambient';
  const material = createAmbientMaterial(shared);
  const dummy = new Object3D();
  dummy.rotation.order = 'YXZ';
  const updaters: ((time: number) => void)[] = [];
  const disposables: { dispose(): void }[] = [material];

  // Ferries: only on routes that are wholly over water on this map.
  const boats: { path: ReturnType<typeof ferryPaths>[number]['path']; speed: number; phase: number }[] = [];
  for (const { route, path } of ferryPaths(meta, query)) {
    const n = quality === 'low' ? 1 : route.boats;
    for (let i = 0; i < n; i++) boats.push({ path, speed: route.speed, phase: i / n + 0.13 * boats.length });
  }
  if (boats.length) {
    const geo = model(FERRY);
    const mesh = new InstancedMesh(geo, material, boats.length);
    mesh.name = 'ferries';
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // Instances move every frame; culling by a stale bounding sphere would make them blink out.
    mesh.frustumCulled = false;
    group.add(mesh);
    disposables.push(geo, mesh);
    updaters.push((time) => {
      boats.forEach((b, i) => {
        const p = shuttleAt(b.path, b.speed, time, b.phase);
        // A slow roll, each boat out of step with the next.
        dummy.position.set(p.x, meta.water.level + 0.15 * Math.sin(time * 0.9 + i * 2.1), p.z);
        dummy.rotation.set(0, -p.heading, 0.03 * Math.sin(time * 0.7 + i));
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  // Bridge traffic.
  const hb = meta.landmarks.harbourBridge;
  if (BRIDGE_LANES_FIT && hb.deckY.length > 1) {
    const bridge = bridgeGeometry(hb);
    // Eight lanes now: enough cars that none of them looks empty.
    const count = quality === 'low' ? 24 : 56;
    const geo = model(CAR);
    const mesh = new InstancedMesh(geo, material, count);
    mesh.name = 'bridge-traffic';
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    const paint = new Color();
    for (let i = 0; i < count; i++) {
      const hex = CAR_PAINT[(i * 5) % CAR_PAINT.length];
      // Display colours, as written: the ambient shader does no colour conversion.
      const n = parseInt(hex.slice(1), 16);
      paint.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
      mesh.setColorAt(i, paint);
    }
    group.add(mesh);
    disposables.push(geo, mesh);
    updaters.push((time) => {
      for (let i = 0; i < count; i++) {
        // Cars keep to the bridge itself: abutment to abutment.
        const car = bridgeCar(i, count, bridge.road.to - bridge.road.from, time);
        const p = bridge.at(bridge.road.from + car.s, car.lateral);
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, -(car.forward ? bridge.heading : bridge.heading + Math.PI), 0);
        // Larger than life, like the bridge's own members, so a car is still a few pixels from the air,
        // and no larger than a lane and the gap to the truss allow (BRIDGE_CAR_HALF_WIDTH).
        dummy.scale.setScalar(BRIDGE_CAR_SCALE);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  return {
    group,
    update(time) {
      for (const u of updaters) u(time);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

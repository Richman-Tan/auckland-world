/** Beacons: an additive light column, a pulsing ground ring and a 16x16 pixel icon billboard per stop. */
import {
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  PlaneGeometry,
  RingGeometry,
  type ShaderMaterial,
  type Texture,
} from 'three';
import type { StopPlacement } from '../app/contracts';
import type { StopId } from '../content/types';
import { createIconTexture } from './icons';
import { createColumnMaterial, createIconMaterial, createRingMaterial } from './materials';
import type { SharedUniforms } from './uniforms';

export const BEACON_HEIGHT = 700;
export const BEACON_RADIUS = 6;
const RING_RADIUS = 50;
/** Icon size on screen, in internal pixels (16 texels at 2x). */
const ICON_PX = 32;
const ICON_LIFT = 45;

interface Entry {
  id: StopId;
  column: ShaderMaterial;
  ring: ShaderMaterial;
  icon: ShaderMaterial;
  tex: Texture;
  active: number;
}

export class Beacons {
  readonly group = new Group();
  private entries: Entry[] = [];
  private activeId: StopId | null = null;
  private columnGeo = new CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 16, 1, true).translate(0, BEACON_HEIGHT / 2, 0);
  private ringGeo = new RingGeometry(0, RING_RADIUS, 48).rotateX(-Math.PI / 2);
  private iconGeo = new PlaneGeometry(1, 1);

  constructor(private shared: SharedUniforms) {
    this.group.name = 'beacons';
  }

  setStops(stops: StopPlacement[]) {
    this.clear();
    for (const s of stops) {
      const column = createColumnMaterial(this.shared, s.color);
      const ring = createRingMaterial(this.shared, s.color, RING_RADIUS);
      const tex = createIconTexture(s.icon, s.color);
      const icon = createIconMaterial(this.shared, tex, ICON_PX);

      const cm = new Mesh(this.columnGeo, column);
      cm.position.set(s.x, s.baseY, s.z);
      cm.frustumCulled = false;
      cm.renderOrder = 100;
      cm.name = `beacon-column-${s.id}`;

      const rm = new Mesh(this.ringGeo, ring);
      rm.position.set(s.x, s.groundY + 1.2, s.z);
      rm.frustumCulled = false;
      rm.renderOrder = 101;
      rm.name = `beacon-ring-${s.id}`;

      icon.uniforms.uCenter.value.set(s.x, s.baseY + ICON_LIFT, s.z);
      const im = new Mesh(this.iconGeo, icon);
      im.frustumCulled = false;
      im.renderOrder = 102;
      im.name = `beacon-icon-${s.id}`;

      this.group.add(cm, rm, im);
      this.entries.push({ id: s.id, column, ring, icon, tex, active: s.id === this.activeId ? 1 : 0 });
    }
  }

  setActive(id: StopId | null) {
    this.activeId = id;
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 6);
    for (const e of this.entries) {
      const target = e.id === this.activeId ? 1 : 0;
      e.active += (target - e.active) * k;
      e.column.uniforms.uActive.value = e.active;
      e.ring.uniforms.uActive.value = e.active;
      e.icon.uniforms.uActive.value = e.active;
    }
  }

  private clear() {
    this.group.clear();
    for (const e of this.entries) {
      (e.column as Material).dispose();
      (e.ring as Material).dispose();
      (e.icon as Material).dispose();
      e.tex.dispose();
    }
    this.entries = [];
  }

  dispose() {
    this.clear();
    this.columnGeo.dispose();
    this.ringGeo.dispose();
    this.iconGeo.dispose();
  }
}

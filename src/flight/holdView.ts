/**
 * The camera while a briefing or chat is open. The chase camera keeps running underneath (it owns
 * its spring state); this blends the rendered camera from the chase shot to a wide view that circles
 * the landmark slowly, then back again when the panel closes.
 *
 * The landmark is framed in the part of the screen the panel leaves free: setViewOffset shifts the
 * picture left of a docked panel, or up above a bottom sheet, without changing the perspective.
 */
import { Matrix4, type PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { StopPlacement, WorldQuery } from '../app/contracts';

/** How much of the screen the open panel covers, in CSS px. */
export interface Obstruction {
  right: number;
  bottom: number;
}

/** Wide-shot geometry for a stop: camera distance and height, and the point it looks at. */
export function holdShot(stop: StopPlacement, azimuth: number, query: WorldQuery) {
  const distance = stop.orbitRadius * 2.3;
  const x = stop.x + Math.sin(azimuth) * distance;
  const z = stop.z + Math.cos(azimuth) * distance;
  const y = Math.max(stop.orbitY + 50, query.solidAt(x, z) + 40);
  // Aim at the landmark's body rather than the top of its light column.
  const lookY = stop.groundY + (stop.baseY - stop.groundY) * 0.65;
  return { x, y, z, lookX: stop.x, lookY, lookZ: stop.z };
}

const smooth = (t: number) => t * t * (3 - 2 * t);
/** Radians of azimuth per second: a full lap takes about two and a half minutes. */
const SPIN = 0.04;

export function createHoldView() {
  /** False holds the wide shot still instead of circling the landmark (reduced motion). */
  let spin = true;
  let weight = 0;
  let azimuth = 0;
  let started = false;
  let saved = false;
  let last: StopPlacement | null = null;
  let offX = 0;
  let offY = 0;
  const chasePos = new Vector3();
  const chaseQuat = new Quaternion();
  const holdPos = new Vector3();
  const holdQuat = new Quaternion();
  const target = new Vector3();
  const m = new Matrix4();
  const up = new Vector3(0, 1, 0);

  return {
    /** Before the chase camera updates: give it back the pose it computed last frame. */
    restore(cam: PerspectiveCamera): void {
      if (!saved) return;
      cam.position.copy(chasePos);
      cam.quaternion.copy(chaseQuat);
    },

    /**
     * After the chase camera updates. stop is the landmark being circled, or null when nothing is
     * open (the view then eases back to the chase shot).
     */
    apply(dt: number, cam: PerspectiveCamera, stop: StopPlacement | null, query: WorldQuery, cover: Obstruction | null): void {
      chasePos.copy(cam.position);
      chaseQuat.copy(cam.quaternion);
      saved = true;

      weight += ((stop ? 1 : 0) - weight) * (1 - Math.exp(-dt * 2.2));
      if (!stop && weight < 0.002) {
        weight = 0;
        started = false;
        if (cam.view?.enabled) cam.clearViewOffset();
        offX = offY = 0;
        return;
      }
      if (stop) {
        if (!started || stop.id !== last?.id) {
          // Start on the side the camera is already on, so the move out is short.
          azimuth = Math.atan2(cam.position.x - stop.x, cam.position.z - stop.z);
          started = true;
        }
        last = stop;
        if (spin) azimuth += dt * SPIN;
      }
      if (!last) return;

      const shot = holdShot(last, azimuth, query);
      holdPos.set(shot.x, shot.y, shot.z);
      target.set(shot.lookX, shot.lookY, shot.lookZ);
      m.lookAt(holdPos, target, up);
      holdQuat.setFromRotationMatrix(m);

      const k = smooth(Math.min(1, weight));
      cam.position.lerpVectors(chasePos, holdPos, k);
      cam.quaternion.slerpQuaternions(chaseQuat, holdQuat, k);

      // Frame the landmark in the free part of the screen.
      const w = innerWidth;
      const h = innerHeight;
      const wantX = stop && cover ? cover.right / 2 : 0;
      const wantY = stop && cover ? cover.bottom / 2 : 0;
      const ease = 1 - Math.exp(-dt * 4);
      offX += (wantX - offX) * ease;
      offY += (wantY - offY) * ease;
      const x = offX * k;
      const y = offY * k;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
        if (cam.view?.enabled) cam.clearViewOffset();
      } else {
        cam.setViewOffset(w, h, x, y, w, h);
      }
    },

    /** Forget the blend (after a camera snap): the chase camera's own pose is current again. */
    reset(cam: PerspectiveCamera): void {
      saved = false;
      weight = 0;
      started = false;
      offX = offY = 0;
      if (cam.view?.enabled) cam.clearViewOffset();
    },

    setSpin(on: boolean): void {
      spin = on;
    },

    /** True while the wide shot is showing at all (for tests and debugging). */
    get weight(): number {
      return weight;
    },
  };
}

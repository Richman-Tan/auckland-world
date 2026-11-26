/**
 * An original chunky voxel-style light aircraft, about 13 m across the wings, nose along -z.
 *
 * It is a list of coloured boxes merged into one mesh and one draw call. Each box says which part
 * of the aircraft it belongs to and where that part hinges; the material (createPlaneMaterial)
 * moves the ailerons, elevator, rudder, propeller and boost flame from that, and lights the whole
 * thing with the same sun or moon as the city. The plane also tells the world's shaders where it
 * is, so they can draw its shadow on whatever lies below.
 *
 * Sized for how it is seen: about 64 pixels across in the chase view, so nothing here is under 0.3 m.
 */
import { BufferAttribute, Group, Mesh, Vector3 } from 'three';
import type { FlightState, PlaneModel } from '../app/contracts';
import { type Box, VERTS_PER_BOX, mergeBoxes } from '../render/boxes';
import { createPlaneMaterial } from '../render/materials';
import { type SharedUniforms, createSharedUniforms } from '../render/uniforms';
import { FOG_FAR } from '../shared/detail';
import { type Attitude, shadowDirection, surfaceDeflections } from './planeMotion';

const RED = 0xd7263d;
const RED_DARK = 0x9c1a2c;
const CREAM = 0xf4ecd8;
const CREAM_DARK = 0xc9bfa6;
const TEAL = 0x0f4c5c;
const TEAL_LIGHT = 0x2a7f8f;
const DARK = 0x22252b;

/** aPart values (see createPlaneMaterial). */
const BODY = 0;
const PROPELLER = 1;
const AILERON_L = 2;
const AILERON_R = 3;
const ELEVATOR = 4;
const RUDDER = 5;
const FLAME = 6;
const DISC = 7;
/** aGlow values. */
const PAINT = 0;
const NAV_RED = 1;
const NAV_GREEN = 2;
const STROBE = 3;
const LANDING = 4;
const FIRE = 5;

type V3 = readonly [number, number, number];
interface Piece {
  box: Box;
  part: number;
  glow: number;
  pivot: V3;
}
const ORIGIN: V3 = [0, 0, 0];
const piece = (box: Box, part = BODY, pivot: V3 = ORIGIN, glow = PAINT): Piece => ({ box, part, glow, pivot });

const PROP_HUB: V3 = [0, 0.25, -6.35];
const FLAME_ROOT: V3 = [0, 0.55, 7.2];

/** The shadow never comes from lower than this, so it stays under the plane (see shadowDirection). */
const SHADOW_MIN_ELEVATION = 65;

const PIECES: Piece[] = [
  // ---- fuselage, stepping down towards the tail: red over a darker belly, a cream cowl and cheat line
  piece([2.2, 1.9, 1.7, 0, 0.25, -5.05, CREAM]),
  piece([1.6, 1.3, 0.3, 0, 0.25, -6.0, CREAM_DARK]),
  piece([2.4, 1.6, 4.5, 0, 0.3, -1.95, RED]),
  piece([2.2, 0.6, 4.5, 0, -0.75, -1.95, RED_DARK]),
  piece([2.0, 1.4, 2.6, 0, 0.4, 1.6, RED]),
  piece([1.8, 0.5, 2.6, 0, -0.5, 1.6, RED_DARK]),
  piece([1.5, 1.2, 2.4, 0, 0.5, 4.1, RED]),
  piece([1.3, 0.4, 2.4, 0, -0.25, 4.1, RED_DARK]),
  piece([1.0, 0.9, 1.9, 0, 0.6, 6.25, RED]),
  piece([2.5, 0.3, 4.5, 0, 0.15, -1.95, CREAM]),
  piece([2.1, 0.3, 2.6, 0, 0.25, 1.6, CREAM]),
  piece([1.6, 0.3, 2.4, 0, 0.35, 4.1, CREAM]),
  piece([0.3, 0.3, 0.9, 0.95, -0.55, -4.7, DARK]), // exhaust
  // ---- cabin
  piece([1.9, 1.1, 3.0, 0, 1.3, -1.4, TEAL]),
  piece([1.5, 0.3, 2.2, 0, 1.95, -1.2, TEAL_LIGHT]),
  // ---- high wing: cream, red tips, flaps inboard and ailerons outboard along the trailing edge
  piece([12.0, 0.4, 2.0, 0, 1.25, -1.1, CREAM]),
  piece([12.0, 0.14, 2.0, 0, 0.98, -1.1, CREAM_DARK]),
  piece([5.2, 0.3, 0.8, 0, 1.25, 0.3, CREAM_DARK]),
  piece([3.2, 0.3, 0.8, -4.2, 1.25, 0.3, CREAM], AILERON_L, [-4.2, 1.25, -0.1]),
  piece([3.2, 0.3, 0.8, 4.2, 1.25, 0.3, CREAM], AILERON_R, [4.2, 1.25, -0.1]),
  piece([0.9, 0.5, 2.8, -5.75, 1.25, -0.7, RED]),
  piece([0.9, 0.5, 2.8, 5.75, 1.25, -0.7, RED]),
  piece([0.2, 1.4, 0.3, -2.5, 0.45, -1.0, DARK]),
  piece([0.2, 1.4, 0.3, 2.5, 0.45, -1.0, DARK]),
  // ---- tail: tailplane and elevator, fin and rudder
  piece([4.6, 0.3, 0.9, 0, 0.75, 6.05, CREAM]),
  piece([4.6, 0.26, 0.8, 0, 0.75, 6.9, CREAM_DARK], ELEVATOR, [0, 0.75, 6.5]),
  piece([0.35, 2.2, 1.1, 0, 1.95, 6.05, RED]),
  piece([0.37, 0.45, 1.1, 0, 2.85, 6.05, CREAM]),
  piece([0.3, 2.2, 0.8, 0, 1.95, 7.0, RED_DARK], RUDDER, [0, 1.95, 6.6]),
  // ---- undercarriage: legs, spats over the wheels, a tail wheel
  piece([0.22, 1.0, 0.22, -1.2, -1.45, -2.2, DARK]),
  piece([0.22, 1.0, 0.22, 1.2, -1.45, -2.2, DARK]),
  piece([0.55, 0.6, 1.5, -1.2, -2.1, -2.2, RED]),
  piece([0.55, 0.6, 1.5, 1.2, -2.1, -2.2, RED]),
  piece([0.35, 0.45, 0.7, -1.2, -2.45, -2.2, DARK]),
  piece([0.35, 0.45, 0.7, 1.2, -2.45, -2.2, DARK]),
  piece([0.2, 0.5, 0.4, 0, -0.35, 6.3, DARK]),
  // ---- lights: red to port (-x), green to starboard, a strobe on the fin, a landing light under the nose
  piece([0.5, 0.5, 0.5, -6.25, 1.25, -0.7, 0xff3030], BODY, ORIGIN, NAV_RED),
  piece([0.5, 0.5, 0.5, 6.25, 1.25, -0.7, 0x35ff7a], BODY, ORIGIN, NAV_GREEN),
  piece([0.4, 0.3, 0.4, 0, 3.2, 6.3, CREAM], BODY, ORIGIN, STROBE),
  piece([0.6, 0.35, 0.3, 0, -0.55, -5.9, 0xfff6c9], BODY, ORIGIN, LANDING),
  // ---- propeller: spinner and two blades, and the disc they blur into
  piece([0.75, 0.75, 0.9, 0, 0.25, -6.45, RED], PROPELLER, PROP_HUB),
  piece([0.3, 4.6, 0.14, 0, 0.25, -6.5, DARK], PROPELLER, PROP_HUB),
  piece([4.6, 0.3, 0.14, 0, 0.25, -6.48, DARK], PROPELLER, PROP_HUB),
  piece([4.8, 4.8, 0.05, 0, 0.25, -6.58, DARK], DISC, PROP_HUB),
  // ---- boost flame, grown from the tail by the material
  piece([1.0, 1.0, 3.5, 0, 0.55, 8.95, 0xffb02e], FLAME, FLAME_ROOT, FIRE),
  piece([0.5, 0.5, 5.0, 0, 0.55, 9.7, 0xfff3b0], FLAME, FLAME_ROOT, FIRE),
];

/** A 3 x 5 pixel face for the registration painted on the wing. */
const GLYPHS: Record<string, readonly string[]> = {
  Z: ['111', '001', '010', '100', '111'],
  K: ['101', '101', '110', '101', '101'],
  R: ['110', '101', '110', '101', '101'],
  M: ['101', '111', '111', '101', '101'],
  T: ['111', '010', '010', '010', '010'],
};
const GLYPH_PIXEL = 0.3;

/**
 * Letters on the top of the wing, read from behind the plane as the chase camera sees it: left to
 * right along +x, tops towards the nose. `x` is the left edge of the first letter.
 */
function registration(text: string, x: number): Piece[] {
  const out: Piece[] = [];
  const top = -1.85; // z of the letters' top row, on the wing's upper skin
  [...text].forEach((ch, n) => {
    const rows = GLYPHS[ch];
    if (!rows) return;
    rows.forEach((row, r) => {
      // One box per run of pixels in the row.
      for (let c = 0; c < row.length; ) {
        if (row[c] !== '1') {
          c++;
          continue;
        }
        let w = 1;
        while (row[c + w] === '1') w++;
        const cx = x + n * 4 * GLYPH_PIXEL + (c + w / 2) * GLYPH_PIXEL;
        out.push(piece([w * GLYPH_PIXEL, 0.06, GLYPH_PIXEL, cx, 1.47, top + (r + 0.5) * GLYPH_PIXEL, DARK]));
        c += w;
      }
    });
  });
  return out;
}

/** ZK- is New Zealand's aircraft prefix; the rest is the pilot's initials. Split across the two wings. */
const MARKS: Piece[] = [...registration('ZK', -4.65), ...registration('RMT', 1.95)];

function buildGeometry(pieces: readonly Piece[]) {
  const g = mergeBoxes(
    pieces.map((p) => p.box),
    true,
  );
  // The plane's shader names its own attributes (three only declares `color` for its own materials).
  g.setAttribute('aTint', g.getAttribute('color'));
  g.deleteAttribute('color');
  const n = pieces.length * VERTS_PER_BOX;
  const glow = new Float32Array(n);
  const part = new Float32Array(n);
  const pivot = new Float32Array(n * 3);
  pieces.forEach((p, i) => {
    for (let v = i * VERTS_PER_BOX; v < (i + 1) * VERTS_PER_BOX; v++) {
      glow[v] = p.glow;
      part[v] = p.part;
      pivot.set(p.pivot, v * 3);
    }
  });
  g.setAttribute('aGlow', new BufferAttribute(glow, 1));
  g.setAttribute('aPart', new BufferAttribute(part, 1));
  g.setAttribute('aPivot', new BufferAttribute(pivot, 3));
  return g;
}

/**
 * `lighting` is the world's shared uniforms (WorldScene.lighting): the plane is lit by them and
 * writes its shadow into them. Without a world (the flight harness, tests) it keeps a set of its own.
 */
export function createPlane(lighting?: SharedUniforms): PlaneModel {
  const shared = lighting ?? createSharedUniforms(FOG_FAR.high);
  const root = new Group();
  root.name = 'plane';
  const material = createPlaneMaterial(shared);
  const mesh = new Mesh(buildGeometry([...PIECES, ...MARKS]), material);
  mesh.name = 'plane-airframe';
  // Parts move in the vertex stage, beyond the box three would cull by.
  mesh.frustumCulled = false;
  root.add(mesh);
  root.rotation.order = 'YXZ';

  const surf = material.uniforms.uSurf.value as Vector3;
  let last: (Attitude & { time: number }) | null = null;
  const right = new Vector3();
  const forward = new Vector3();

  return {
    object: root,
    update(s: FlightState, time: number) {
      root.position.set(s.pos.x, s.pos.y, s.pos.z);
      // yaw, then pitch, then bank (order YXZ). Nose is -z: yaw = -heading, pitch up = +x rotation,
      // right-wing-down bank = clockwise from behind = -z rotation.
      root.rotation.set(s.pitch, -s.heading, -s.bank, 'YXZ');

      // The surfaces follow what the flight model just did, eased so they do not twitch.
      const dt = last ? time - last.time : 0;
      if (last && dt > 0 && dt < 0.5) {
        const want = surfaceDeflections(last, s, dt);
        const k = 1 - Math.exp(-dt * 9);
        surf.x += (want.aileron - surf.x) * k;
        surf.y += (want.elevator - surf.y) * k;
        surf.z += (want.rudder - surf.z) * k;
      }
      last = { heading: s.heading, pitch: s.pitch, bank: s.bank, time };
      // Slow enough to see the blades turn through the disc, as a real propeller does on film.
      material.uniforms.uProp.value = time * (s.boosting ? 22 : 14);
      material.uniforms.uBoost.value = s.boosting ? 0.7 + 0.5 * Math.abs(Math.sin(time * 40)) : 0;
      if (!lighting) shared.uTime.value = time;

      // Tell the world where the plane is, for its shadow. Hidden (title screen, a room): no shadow.
      right.set(1, 0, 0).applyQuaternion(root.quaternion);
      forward.set(0, 0, -1).applyQuaternion(root.quaternion);
      shared.uShadowPos.value.copy(root.position);
      shared.uShadowRight.value.copy(right);
      shared.uShadowFwd.value.copy(forward);
      const sun = shared.uSunDir.value;
      shared.uShadowDir.value.set(...shadowDirection([sun.x, sun.y, sun.z], SHADOW_MIN_ELEVATION));
      shared.uShadowK.value = root.visible ? 1 - 0.5 * shared.uNight.value : 0;
    },
  };
}

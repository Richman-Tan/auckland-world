/**
 * An original chunky voxel-style light aircraft, ~12 m wingspan, nose along -z.
 *
 * It is modelled as a list of coloured boxes, but drawn as few meshes as the animation allows: the
 * whole airframe is one vertex-coloured geometry, and only the parts that move on their own (the
 * propeller, the two blinking nav lights, the boost flame) are separate. That is 4 draw calls in
 * level flight instead of one per box.
 */
import { Group, Mesh, MeshBasicMaterial, SRGBColorSpace } from 'three';
import type { FlightState, PlaneModel } from '../app/contracts';
import { type Box, mergeBoxes } from '../render/boxes';

const RED = 0xd7263d;
const RED_DARK = 0x9c1a2c;
const CREAM = 0xf4ecd8;
const CREAM_DARK = 0xc9bfa6;
const TEAL = 0x0f4c5c;
const TEAL_LIGHT = 0x2a7f8f;
const DARK = 0x22252b;

const AIRFRAME: readonly Box[] = [
  // fuselage: red top, darker belly, cream cowl
  [2.4, 1.5, 9, 0, 0.3, 0, RED],
  [2.2, 0.7, 8.6, 0, -0.8, 0.1, RED_DARK],
  [2.6, 2.0, 1.8, 0, 0.2, -4.9, CREAM],
  [1.4, 1.2, 3.0, 0, 0.5, 5.6, RED],
  // wing (high wing, cream) with red tips
  [12, 0.4, 2.8, 0, 1.15, -0.8, CREAM],
  [12, 0.15, 2.8, 0, 0.9, -0.8, CREAM_DARK],
  [1.1, 0.5, 2.8, -5.7, 1.15, -0.8, RED],
  [1.1, 0.5, 2.8, 5.7, 1.15, -0.8, RED],
  // wing struts
  [0.2, 1.4, 0.3, -2.6, 0.45, -0.8, DARK],
  [0.2, 1.4, 0.3, 2.6, 0.45, -0.8, DARK],
  // tail
  [4.6, 0.3, 1.6, 0, 0.7, 6.4, CREAM],
  [0.35, 2.4, 1.8, 0, 1.9, 6.3, RED],
  // canopy
  [1.9, 1.1, 3.0, 0, 1.3, -0.7, TEAL],
  [1.5, 0.3, 2.2, 0, 1.95, -0.5, TEAL_LIGHT],
  // landing gear
  [0.25, 1.1, 0.25, -1.1, -1.6, -1.8, DARK],
  [0.25, 1.1, 0.25, 1.1, -1.6, -1.8, DARK],
  [0.6, 0.9, 0.9, -1.1, -2.2, -1.8, DARK],
  [0.6, 0.9, 0.9, 1.1, -2.2, -1.8, DARK],
];

/** Hub and two blades, around the propeller's own axis. */
const PROPELLER: readonly Box[] = [
  [0.7, 0.7, 0.8, 0, 0, 0.1, RED],
  [0.28, 4.6, 0.12, 0, 0, 0, DARK],
  [4.6, 0.28, 0.12, 0, 0, 0.02, DARK],
];

const FLAME: readonly Box[] = [
  [1.0, 1.0, 3.5, 0, 0, 1.6, 0xffb02e],
  [0.5, 0.5, 5.0, 0, 0, 2.5, 0xfff3b0],
];

export function createPlane(): PlaneModel {
  const root = new Group();
  root.name = 'plane';
  // One material for every vertex-coloured part.
  const paint = new MeshBasicMaterial({ vertexColors: true });

  const airframe = new Mesh(mergeBoxes(AIRFRAME), paint);
  airframe.name = 'plane-airframe';
  root.add(airframe);

  const prop = new Mesh(mergeBoxes(PROPELLER), paint);
  prop.name = 'plane-propeller';
  prop.position.set(0, 0.2, -5.95);
  root.add(prop);

  // nav lights: red on the left (port, -x), green on the right (starboard, +x). They pulse out of
  // step with each other, so each keeps its own mesh.
  const light = mergeBoxes([[0.7, 0.7, 0.7, 0, 0, 0, 0xffffff]]);
  const navL = new Mesh(light, new MeshBasicMaterial({ color: 0xff3030 }));
  navL.position.set(-6.1, 1.2, -0.8);
  const navR = new Mesh(light, new MeshBasicMaterial({ color: 0x35ff7a }));
  navR.position.set(6.1, 1.2, -0.8);
  root.add(navL, navR);

  // boost flame
  const flame = new Mesh(mergeBoxes(FLAME), paint);
  flame.name = 'plane-flame';
  flame.position.set(0, 0.5, 7.2);
  flame.visible = false;
  root.add(flame);

  root.rotation.order = 'YXZ';

  return {
    object: root,
    setTint(rgb) {
      // The tint is authored like the shaders' light colours, as a multiplier on displayed colour.
      paint.color.setRGB(Math.min(rgb[0], 1), Math.min(rgb[1], 1), Math.min(rgb[2], 1), SRGBColorSpace);
    },
    update(s: FlightState, time: number) {
      root.position.set(s.pos.x, s.pos.y, s.pos.z);
      // yaw, then pitch, then bank (order YXZ). Nose is -z: yaw = -heading, pitch up = +x rotation,
      // right-wing-down bank = clockwise from behind = -z rotation.
      root.rotation.set(s.pitch, -s.heading, -s.bank, 'YXZ');
      prop.rotation.z = time * (s.boosting ? 90 : 60);
      const blink = 0.55 + 0.45 * Math.sin(time * 9);
      navL.scale.setScalar(0.6 + 0.4 * blink);
      navR.scale.setScalar(0.6 + 0.4 * (1 - blink));
      flame.visible = s.boosting;
      if (s.boosting) flame.scale.set(1, 1, 0.7 + 0.5 * Math.abs(Math.sin(time * 40)));
    },
  };
}

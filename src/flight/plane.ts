/** An original chunky voxel-style light aircraft, ~12 m wingspan, nose along -z. */
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import type { FlightState, PlaneModel } from '../app/contracts';

const RED = 0xd7263d;
const RED_DARK = 0x9c1a2c;
const CREAM = 0xf4ecd8;
const CREAM_DARK = 0xc9bfa6;
const TEAL = 0x0f4c5c;
const TEAL_LIGHT = 0x2a7f8f;
const DARK = 0x22252b;

export function createPlane(): PlaneModel {
  const root = new Group();
  root.name = 'plane';
  const mats = new Map<number, MeshBasicMaterial>();
  const mat = (c: number) => {
    let m = mats.get(c);
    if (!m) mats.set(c, (m = new MeshBasicMaterial({ color: c })));
    return m;
  };
  const box = (parent: Group, w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // fuselage: red top, darker belly, cream cowl
  box(root, 2.4, 1.5, 9, 0, 0.3, 0, RED);
  box(root, 2.2, 0.7, 8.6, 0, -0.8, 0.1, RED_DARK);
  box(root, 2.6, 2.0, 1.8, 0, 0.2, -4.9, CREAM);
  box(root, 1.4, 1.2, 3.0, 0, 0.5, 5.6, RED);
  // wing (high wing, cream) with red/green tips
  box(root, 12, 0.4, 2.8, 0, 1.15, -0.8, CREAM);
  box(root, 12, 0.15, 2.8, 0, 0.9, -0.8, CREAM_DARK);
  box(root, 1.1, 0.5, 2.8, -5.7, 1.15, -0.8, RED);
  box(root, 1.1, 0.5, 2.8, 5.7, 1.15, -0.8, RED);
  // wing struts
  box(root, 0.2, 1.4, 0.3, -2.6, 0.45, -0.8, DARK);
  box(root, 0.2, 1.4, 0.3, 2.6, 0.45, -0.8, DARK);
  // tail
  box(root, 4.6, 0.3, 1.6, 0, 0.7, 6.4, CREAM);
  box(root, 0.35, 2.4, 1.8, 0, 1.9, 6.3, RED);
  // canopy
  box(root, 1.9, 1.1, 3.0, 0, 1.3, -0.7, TEAL);
  box(root, 1.5, 0.3, 2.2, 0, 1.95, -0.5, TEAL_LIGHT);
  // landing gear
  box(root, 0.25, 1.1, 0.25, -1.1, -1.6, -1.8, DARK);
  box(root, 0.25, 1.1, 0.25, 1.1, -1.6, -1.8, DARK);
  box(root, 0.6, 0.9, 0.9, -1.1, -2.2, -1.8, DARK);
  box(root, 0.6, 0.9, 0.9, 1.1, -2.2, -1.8, DARK);

  // propeller
  const prop = new Group();
  prop.position.set(0, 0.2, -5.95);
  box(prop, 0.7, 0.7, 0.8, 0, 0, 0.1, RED);
  box(prop, 0.28, 4.6, 0.12, 0, 0, 0, DARK);
  box(prop, 4.6, 0.28, 0.12, 0, 0, 0.02, DARK);
  root.add(prop);

  // nav lights: red on the left (port, -x), green on the right (starboard, +x)
  const navL = new Mesh(new BoxGeometry(0.7, 0.7, 0.7), new MeshBasicMaterial({ color: 0xff3030 }));
  navL.position.set(-6.1, 1.2, -0.8);
  const navR = new Mesh(new BoxGeometry(0.7, 0.7, 0.7), new MeshBasicMaterial({ color: 0x35ff7a }));
  navR.position.set(6.1, 1.2, -0.8);
  root.add(navL, navR);

  // boost flame
  const flame = new Group();
  flame.position.set(0, 0.5, 7.2);
  box(flame, 1.0, 1.0, 3.5, 0, 0, 1.6, 0xffb02e);
  box(flame, 0.5, 0.5, 5.0, 0, 0, 2.5, 0xfff3b0);
  flame.visible = false;
  root.add(flame);

  root.rotation.order = 'YXZ';

  return {
    object: root,
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

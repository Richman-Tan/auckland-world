import { Color, Vector3 } from 'three';
import { ROOF_PALETTE, SKY, WALL_PALETTE, hexToRgb } from '../shared/palette';
import { type Look, SOLAR, lookAtSolar } from '../shared/timeOfDay';

export type Uniform<T> = { value: T };

export interface SharedUniforms {
  uTime: Uniform<number>;
  uSunDir: Uniform<Vector3>;
  uFogColor: Uniform<Color>;
  uFogNear: Uniform<number>;
  uFogFar: Uniform<number>;
  uResY: Uniform<number>;
  /** The three steps of the toon lighting (facing the light, side-on, facing away). */
  uLightHi: Uniform<Vector3>;
  uLightMid: Uniform<Vector3>;
  uLightLo: Uniform<Vector3>;
  /** Overall brightness of the ground, foam and anything else not lit by the three steps. */
  uAmbient: Uniform<Vector3>;
  /** 0 by day to 1 at night: windows, floodlights, headlights and stars come up with it. */
  uNight: Uniform<number>;
  /**
   * Beacon icons whose centre is left of this x (clip space, -1 = left edge, 1 = right) are not
   * drawn. Icons ignore depth so they can be seen through buildings; that also lets them show
   * through the title card, on top of its text. -2 draws them all.
   */
  uIconClipLeft: Uniform<number>;
  uWall: Uniform<Vector3[]>;
  uRoof: Uniform<Vector3[]>;
}

/** Sun direction (towards the sun): azimuth clockwise from north (-z), altitude above the horizon. */
export function sunDirection(azimuthDeg = SKY.sunAzimuthDeg, altitudeDeg = SKY.sunAltitudeDeg): Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  return new Vector3(Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)).normalize();
}

function palette(list: readonly string[]): Vector3[] {
  return list.map((h) => {
    const [r, g, b] = hexToRgb(h);
    return new Vector3(r, g, b);
  });
}

/** One set of uniform objects, referenced (not copied) by every material so they update together. */
export function createSharedUniforms(fogFar: number): SharedUniforms {
  const [r, g, b] = hexToRgb(SKY.horizon);
  const shared: SharedUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDirection() },
    uFogColor: { value: new Color(r, g, b) },
    uFogNear: { value: Math.round(fogFar * 0.1) },
    uFogFar: { value: fogFar },
    uResY: { value: 360 },
    uLightHi: { value: new Vector3() },
    uLightMid: { value: new Vector3() },
    uLightLo: { value: new Vector3() },
    uAmbient: { value: new Vector3(1, 1, 1) },
    uNight: { value: 0 },
    uIconClipLeft: { value: -2 },
    uWall: { value: palette(WALL_PALETTE) },
    uRoof: { value: palette(ROOF_PALETTE) },
  };
  // Until the app says otherwise, the afternoon the site was first drawn in.
  applyLook(shared, lookAtSolar(SOLAR.afternoon));
  return shared;
}

/** Write a time-of-day look into the uniforms every material shares. */
export function applyLook(shared: SharedUniforms, look: Look): void {
  shared.uSunDir.value.set(...look.sunDir).normalize();
  shared.uFogColor.value.setRGB(...look.horizon);
  shared.uLightHi.value.set(...look.lightHi);
  shared.uLightMid.value.set(...look.lightMid);
  shared.uLightLo.value.set(...look.lightLo);
  shared.uAmbient.value.set(...look.ambient);
  shared.uNight.value = look.night;
}

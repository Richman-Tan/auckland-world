import { Color, Vector3 } from 'three';
import { ROOF_PALETTE, SKY, WALL_PALETTE, hexToRgb } from '../shared/palette';

export type Uniform<T> = { value: T };

export interface SharedUniforms {
  uTime: Uniform<number>;
  uSunDir: Uniform<Vector3>;
  uFogColor: Uniform<Color>;
  uFogNear: Uniform<number>;
  uFogFar: Uniform<number>;
  uResY: Uniform<number>;
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
  return {
    uTime: { value: 0 },
    uSunDir: { value: sunDirection() },
    uFogColor: { value: new Color(r, g, b) },
    uFogNear: { value: Math.round(fogFar * 0.1) },
    uFogFar: { value: fogFar },
    uResY: { value: 360 },
    uWall: { value: palette(WALL_PALETTE) },
    uRoof: { value: palette(ROOF_PALETTE) },
  };
}

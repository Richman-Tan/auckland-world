/**
 * Coordinates for the pipeline. proj4 does WGS84 <-> NZTM2000; the runtime never needs proj4
 * because we fit quadratics (lat/lon <-> local metres) over the world and ship those in meta.
 */
import proj4 from 'proj4';
import type { GeoFit, Poly2 } from '../../src/shared/mapFormat';
import { evalPoly2 } from '../../src/shared/mapFormat';
import { WORLD } from '../config';

export const NZTM_DEF =
  '+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

const toNztm = proj4('EPSG:4326', NZTM_DEF);

export function lonLatToNztm(lon: number, lat: number): [number, number] {
  const [e, n] = toNztm.forward([lon, lat]);
  return [e, n];
}

export function nztmToLonLat(e: number, n: number): [number, number] {
  const [lon, lat] = toNztm.inverse([e, n]);
  return [lon, lat];
}

export function nztmToLocal(e: number, n: number): { x: number; z: number } {
  return { x: e - WORLD.originE, z: -(n - WORLD.originN) };
}

export function localToNztm(x: number, z: number): [number, number] {
  return [x + WORLD.originE, WORLD.originN - z];
}

export function lonLatToLocal(lon: number, lat: number): { x: number; z: number } {
  const [e, n] = lonLatToNztm(lon, lat);
  return nztmToLocal(e, n);
}

export function localToLonLat(x: number, z: number): [number, number] {
  const [e, n] = localToNztm(x, z);
  return nztmToLonLat(e, n);
}

/** Least-squares fit of a Poly2 with column scaling for conditioning. */
function fitPoly2(samples: { a: number; b: number; v: number }[]): Poly2 {
  const rows = samples.map(({ a, b }) => [1, a, b, a * a, a * b, b * b]);
  const scale = [0, 1, 2, 3, 4, 5].map((j) => Math.max(...rows.map((r) => Math.abs(r[j]))) || 1);
  const A = rows.map((r) => r.map((x, j) => x / scale[j]));
  const n = 6;
  const M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let k = 0; k < A.length; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) M[i][j] += A[k][i] * A[k][j];
      M[i][n] += A[k][i] * samples[k].v;
    }
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i] / scale[i]) as Poly2;
}

/** Fit lat/lon <-> local over the world rectangle (plus margin) and report the worst residual. */
export function fitGeo(marginM = 3000, steps = 21): GeoFit {
  const [refLon, refLat] = nztmToLonLat(WORLD.originE, WORLD.originN);
  const fwd: { a: number; b: number; x: number; z: number }[] = [];
  const inv: { x: number; z: number; lat: number; lon: number }[] = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const e = WORLD.minE - marginM + ((WORLD.maxE - WORLD.minE + 2 * marginM) * i) / (steps - 1);
      const n = WORLD.minN - marginM + ((WORLD.maxN - WORLD.minN + 2 * marginM) * j) / (steps - 1);
      const [lon, lat] = nztmToLonLat(e, n);
      const { x, z } = nztmToLocal(e, n);
      fwd.push({ a: lat - refLat, b: lon - refLon, x, z });
      inv.push({ x, z, lat, lon });
    }
  }
  const geo: GeoFit = {
    ref: { lat: refLat, lon: refLon },
    toLocal: {
      x: fitPoly2(fwd.map((s) => ({ a: s.a, b: s.b, v: s.x }))),
      z: fitPoly2(fwd.map((s) => ({ a: s.a, b: s.b, v: s.z }))),
    },
    toLatLon: {
      lat: fitPoly2(inv.map((s) => ({ a: s.x, b: s.z, v: s.lat }))),
      lon: fitPoly2(inv.map((s) => ({ a: s.x, b: s.z, v: s.lon }))),
    },
    maxResidualM: 0,
  };
  let worst = 0;
  for (const s of fwd) {
    const x = evalPoly2(geo.toLocal.x, s.a, s.b);
    const z = evalPoly2(geo.toLocal.z, s.a, s.b);
    worst = Math.max(worst, Math.hypot(x - s.x, z - s.z));
  }
  for (const s of inv) {
    const lat = evalPoly2(geo.toLatLon.lat, s.x, s.z);
    const lon = evalPoly2(geo.toLatLon.lon, s.x, s.z);
    const back = lonLatToLocal(lon, lat);
    worst = Math.max(worst, Math.hypot(back.x - s.x, back.z - s.z));
  }
  geo.maxResidualM = worst;
  return geo;
}

/** Clockwise angle from grid north to true north at the origin, radians. */
export function trueNorthAngleRad(): number {
  const [lon, lat] = nztmToLonLat(WORLD.originE, WORLD.originN);
  const [e0, n0] = lonLatToNztm(lon, lat);
  const [e1, n1] = lonLatToNztm(lon, lat + 0.01);
  return Math.atan2(e1 - e0, n1 - n0);
}

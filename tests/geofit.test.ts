import { describe, expect, it } from 'vitest';
import { latLonToLocal, localToLatLon } from '../src/shared/mapFormat';
import { fitGeo, lonLatToLocal, trueNorthAngleRad } from '../scripts/lib/geo';

describe('geo fit', () => {
  const geo = fitGeo();

  it('fits lat/lon <-> local to under 5 cm', () => {
    expect(geo.maxResidualM).toBeLessThan(0.05);
  });

  it('agrees with proj4 at random points', () => {
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const lat = -36.886 + r() * 0.072;
      const lon = 174.7235 + r() * 0.0805;
      const p = lonLatToLocal(lon, lat);
      const q = latLonToLocal(geo, lat, lon);
      expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(0.05);
      const back = localToLatLon(geo, p.x, p.z);
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-6);
      expect(Math.abs(back.lon - lon)).toBeLessThan(1e-6);
    }
  });

  it('puts Sky Tower near the origin and north at -z', () => {
    const st = lonLatToLocal(174.7622, -36.8485);
    expect(Math.hypot(st.x, st.z)).toBeLessThan(250);
    const north = lonLatToLocal(174.7622, -36.8385);
    expect(north.z).toBeLessThan(st.z - 1000);
  });

  it('has a small grid convergence', () => {
    expect(Math.abs(trueNorthAngleRad())).toBeLessThan((2 * Math.PI) / 180);
  });
});

import { describe, expect, it } from 'vitest';
import { SKY, WATER, hexToRgb } from '../src/shared/palette';
import {
  MIN_ALTITUDE,
  SOLAR,
  aucklandClock,
  aucklandDaylight,
  aucklandSolarHour,
  chosenSolarHour,
  lightDirection,
  lookAtSolar,
  solarHour,
} from '../src/shared/timeOfDay';

const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('time of day', () => {
  it('Afternoon is exactly the look the site was first drawn in', () => {
    const look = lookAtSolar(SOLAR.afternoon);
    close(look.zenith, hexToRgb(SKY.zenith));
    close(look.horizon, hexToRgb(SKY.horizon));
    close(look.sun, hexToRgb(SKY.sun));
    close(look.waterDeep, hexToRgb(WATER.deep));
    close(look.waterShallow, hexToRgb(WATER.shallow));
    // The three steps that used to be constants in the lambert3 shader chunk.
    close(look.lightHi, [1.08, 1.02, 0.9]);
    close(look.lightMid, [0.86, 0.86, 0.9]);
    close(look.lightLo, [0.62, 0.68, 0.8]);
    close(look.ambient, [1, 1, 1]);
    // The sun where it used to be fixed: north-west, 40 degrees up.
    close(look.sunDir, lightDirection(SKY.sunAzimuthDeg, SKY.sunAltitudeDeg));
    expect(look.night).toBe(0);
    expect(look.cloud).toBe(0);
    // The old shader painted the disc vec3(1.0, 0.97, 0.85): the same 8-bit colour.
    expect(look.disc.map((v) => Math.round(v * 255))).toEqual([1.0, 0.97, 0.85].map((v) => Math.round(v * 255)));
  });

  it('every moment of the day gives a usable look', () => {
    for (let h = 0; h <= 24; h += 0.05) {
      const look = lookAtSolar(h);
      const len = Math.hypot(...look.sunDir);
      expect(len).toBeCloseTo(1, 6);
      // The light is always above the horizon: nothing is lit from underneath.
      expect(Math.asin(look.sunDir[1]) * (180 / Math.PI)).toBeGreaterThanOrEqual(MIN_ALTITUDE - 1e-6);
      expect(look.night).toBeGreaterThanOrEqual(0);
      expect(look.night).toBeLessThanOrEqual(1);
      expect(look.cloud).toBeGreaterThanOrEqual(0);
      expect(look.cloud).toBeLessThanOrEqual(1);
      for (const c of [look.zenith, look.horizon, look.sun, look.disc, look.waterDeep, look.waterShallow, look.ambient]) {
        for (const v of c) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
      // Light facing the sun or moon is never darker than light facing away.
      const sum = (c: readonly number[]) => c[0] + c[1] + c[2];
      expect(sum(look.lightHi)).toBeGreaterThanOrEqual(sum(look.lightMid));
      expect(sum(look.lightMid)).toBeGreaterThanOrEqual(sum(look.lightLo));
      // Even at night the city stays readable: this is moonlight, not blackout.
      expect(sum(look.lightLo)).toBeGreaterThan(1.2);
    }
  });

  it('wraps round midnight and changes smoothly, with no jump between neighbours', () => {
    expect(lookAtSolar(24)).toEqual(lookAtSolar(0));
    expect(lookAtSolar(-2)).toEqual(lookAtSolar(22));
    expect(lookAtSolar(39.5)).toEqual(lookAtSolar(15.5));
    for (let h = 0; h < 24; h += 0.02) {
      const a = lookAtSolar(h);
      const b = lookAtSolar(h + 0.02);
      for (const k of ['zenith', 'horizon', 'lightHi', 'lightLo', 'waterDeep'] as const) {
        for (let i = 0; i < 3; i++) expect(Math.abs(a[k][i] - b[k][i])).toBeLessThan(0.04);
      }
      expect(Math.abs(a.night - b.night)).toBeLessThan(0.06);
    }
  });

  it('is dark at night and bright by day', () => {
    expect(lookAtSolar(SOLAR.night).night).toBe(1);
    expect(lookAtSolar(2).night).toBe(1);
    expect(lookAtSolar(12).night).toBe(0);
    expect(lookAtSolar(SOLAR.morning).night).toBe(0);
    const dusk = lookAtSolar(SOLAR.dusk).night;
    expect(dusk).toBeGreaterThan(0.2);
    expect(dusk).toBeLessThan(0.8);
  });

  it('reads the wall clock in Auckland, daylight saving included, wherever the visitor is', () => {
    // 2026-01-15 00:30 UTC is 13:30 on the 15th in Auckland (UTC+13, summer).
    const summer = aucklandClock(new Date('2026-01-15T00:30:00Z'));
    expect(summer.hour).toBeCloseTo(13.5, 6);
    expect(summer.dst).toBe(true);
    expect(summer.dayOfYear).toBe(15);
    // 2026-07-01 00:30 UTC is 12:30 in Auckland (UTC+12, winter).
    const winter = aucklandClock(new Date('2026-07-01T00:30:00Z'));
    expect(winter.hour).toBeCloseTo(12.5, 6);
    expect(winter.dst).toBe(false);
    expect(winter.dayOfYear).toBe(182);
    // Either side of the change back to standard time (5 April 2026, 3 am becomes 2 am).
    expect(aucklandClock(new Date('2026-04-04T12:00:00Z')).dst).toBe(true); // 01:00 NZDT on the 5th
    expect(aucklandClock(new Date('2026-04-04T15:00:00Z')).dst).toBe(false); // 03:00 NZST
    // And of the change to daylight time (27 September 2026, 2 am becomes 3 am).
    expect(aucklandClock(new Date('2026-09-26T13:00:00Z')).dst).toBe(false); // 01:00 NZST on the 27th
    expect(aucklandClock(new Date('2026-09-26T15:00:00Z')).dst).toBe(true); // 04:00 NZDT
    // Late on New Year's Eve in UTC is already New Year's Day in Auckland.
    expect(aucklandClock(new Date('2026-12-31T12:00:00Z')).dayOfYear).toBe(1);
  });

  it('knows roughly when the sun is up in Auckland through the year', () => {
    const dec = aucklandDaylight(355, true);
    expect(dec.sunrise).toBeGreaterThan(5.6);
    expect(dec.sunrise).toBeLessThan(6.4);
    expect(dec.sunset).toBeGreaterThan(20.3);
    expect(dec.sunset).toBeLessThan(21.0);
    const jun = aucklandDaylight(172, false);
    expect(jun.sunrise).toBeGreaterThan(7.2);
    expect(jun.sunrise).toBeLessThan(7.9);
    expect(jun.sunset).toBeGreaterThan(16.8);
    expect(jun.sunset).toBeLessThan(17.5);
  });

  it('maps the wall clock onto the solar clock: sunrise is 6, noon 12, sunset 18', () => {
    expect(solarHour(6.5, 6.5, 20.5)).toBeCloseTo(6, 6);
    expect(solarHour(13.5, 6.5, 20.5)).toBeCloseTo(12, 6);
    expect(solarHour(20.5, 6.5, 20.5)).toBeCloseTo(18, 6);
    // Half-way through a ten-hour night is solar midnight, from either side of 24:00.
    expect(solarHour(1.5, 6.5, 20.5)).toBeCloseTo(0, 6);
    expect(solarHour(23, 6.5, 20.5)).toBeCloseTo(21, 6);
    expect(solarHour(4, 6.5, 20.5)).toBeCloseTo(3, 6);
    // 8 pm is broad daylight in December and night in June.
    expect(lookAtSolar(aucklandSolarHour(new Date('2026-12-21T07:00:00Z'))).night).toBeLessThan(0.3);
    expect(lookAtSolar(aucklandSolarHour(new Date('2026-06-21T08:00:00Z'))).night).toBe(1);
  });

  it('?time= beats the setting, which beats the real clock', () => {
    const now = new Date('2026-06-21T08:00:00Z'); // 8 pm in Auckland, midwinter: night
    expect(chosenSolarHour('auto', null, now)).toBeCloseTo(aucklandSolarHour(now), 6);
    expect(chosenSolarHour('afternoon', null, now)).toBe(SOLAR.afternoon);
    expect(chosenSolarHour('night', null, now)).toBe(SOLAR.night);
    expect(chosenSolarHour('night', '15.5', now)).toBe(15.5);
    expect(chosenSolarHour('auto', 'dusk', now)).toBe(SOLAR.dusk);
    expect(chosenSolarHour('auto', '27', now)).toBe(3);
    // Nonsense falls through to the setting.
    expect(chosenSolarHour('morning', 'teatime', now)).toBe(SOLAR.morning);
    expect(chosenSolarHour('morning', '', now)).toBe(SOLAR.morning);
  });
});

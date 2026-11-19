/**
 * Time of day: the sky, light and water colours for any moment, as plain numbers. Pure (no three.js,
 * no DOM), so the app can compute a look without loading the renderer and tests can pin it.
 *
 * Looks are authored as keyframes on a *solar* clock where sunrise is always 6 and sunset always 18,
 * and blended in between. The real Auckland clock is mapped onto that solar clock using the day's
 * sunrise and sunset, so a December evening is still light at 8 pm and a June one is dark by 6.
 *
 * The AFTERNOON keyframe is the look the site was first drawn in (the constants that used to be
 * fixed in palette.ts and shaderChunks.ts). A test holds it to those values.
 */
import { SKY, WATER, hexToRgb } from './palette';

export type Rgb = readonly [number, number, number];

export interface Look {
  /** Top of the sky. */
  zenith: Rgb;
  /** Horizon, and the fog everything fades into. */
  horizon: Rgb;
  /** Glow around the sun or moon. */
  sun: Rgb;
  /** The disc itself. */
  disc: Rgb;
  /** Unit vector towards the key light (sun by day, moon by night); always above the horizon. */
  sunDir: readonly [number, number, number];
  /** The three steps of the toon lighting: facing the light, side-on, facing away. */
  lightHi: Rgb;
  lightMid: Rgb;
  lightLo: Rgb;
  /** Overall brightness of unlit-ish surfaces (ground, foam, the plane). White by day. */
  ambient: Rgb;
  waterDeep: Rgb;
  waterShallow: Rgb;
  /** 0 by day to 1 at night: window lights, floodlights, headlights and stars come up with it. */
  night: number;
  /** Cloud cover, 0 to 1. */
  cloud: number;
}

interface Key {
  /** Solar hour, 0..24 (6 = sunrise, 12 = noon, 18 = sunset). */
  at: number;
  zenith: string;
  horizon: string;
  sun: string;
  disc: string;
  /** Key light azimuth, degrees clockwise from north. Unwrapped so neighbours blend the short way. */
  az: number;
  /** Key light altitude above the horizon, degrees. Never below MIN_ALTITUDE. */
  alt: number;
  hi: Rgb;
  mid: Rgb;
  lo: Rgb;
  ambient: Rgb;
  deep: string;
  shallow: string;
  night: number;
  cloud: number;
}

/** The light never drops below this, so nothing is ever lit from underneath. */
export const MIN_ALTITUDE = 10;

export const SOLAR = { morning: 8, afternoon: 15.5, dusk: 18, night: 22 } as const;

const WHITE: Rgb = [1, 1, 1];

/** The moon sits in the north-east all night: a fixed, readable light rather than an ephemeris. */
const MOON = { az: 40, alt: 48 };

const NIGHT: Omit<Key, 'at'> = {
  zenith: '#0b1226',
  horizon: '#1d2b4a',
  sun: '#8fa3d9',
  disc: '#e8ecff',
  ...MOON,
  hi: [0.6, 0.68, 0.94],
  mid: [0.45, 0.53, 0.8],
  lo: [0.33, 0.41, 0.66],
  ambient: [0.56, 0.64, 0.9],
  deep: '#0c2638',
  shallow: '#133a52',
  night: 1,
  cloud: 0.25,
};

/** Blue hour: the light is nearly flat, which hides the hand-over between sun and moon. */
const BLUE_HOUR: Omit<Key, 'at' | 'az' | 'alt'> = {
  zenith: '#1c2c55',
  horizon: '#6f6a98',
  sun: '#b9a8d0',
  disc: '#f1e6ee',
  hi: [0.62, 0.64, 0.84],
  mid: [0.56, 0.6, 0.82],
  lo: [0.48, 0.54, 0.78],
  ambient: [0.7, 0.72, 0.92],
  deep: '#143449',
  shallow: '#1f5068',
  night: 0.8,
  cloud: 0.35,
};

const KEYS: Key[] = [
  { at: 0, ...NIGHT },
  { at: 4.9, ...NIGHT },
  { at: 5.5, ...BLUE_HOUR, ...MOON },
  {
    at: 6,
    zenith: '#3d5a8a',
    horizon: '#f4a981',
    sun: '#ffc79a',
    disc: '#fff0d8',
    az: 90,
    alt: MIN_ALTITUDE,
    hi: [1.02, 0.86, 0.74],
    mid: [0.76, 0.72, 0.8],
    lo: [0.5, 0.52, 0.7],
    ambient: [0.88, 0.84, 0.88],
    deep: '#1c5a6c',
    shallow: '#2f7f88',
    night: 0.4,
    cloud: 0.45,
  },
  {
    at: 8,
    zenith: '#4c8eb0',
    horizon: '#e9dfc9',
    sun: '#fff6dc',
    disc: '#fffbe6',
    az: 62,
    alt: 26,
    hi: [1.06, 1.03, 0.96],
    mid: [0.86, 0.88, 0.93],
    lo: [0.6, 0.68, 0.84],
    ambient: WHITE,
    deep: '#20727e',
    shallow: '#2c9092',
    night: 0,
    cloud: 0.35,
  },
  {
    at: 12,
    zenith: '#3a86b4',
    horizon: '#dde6dd',
    sun: '#fffbe8',
    disc: '#ffffff',
    az: 0,
    alt: 62,
    hi: [1.1, 1.08, 1.0],
    mid: [0.88, 0.9, 0.94],
    lo: [0.62, 0.7, 0.86],
    ambient: WHITE,
    deep: '#1e7482',
    shallow: '#2a9496',
    night: 0,
    cloud: 0.3,
  },
  {
    // The original look. Keep in step with SKY and WATER in palette.ts.
    at: SOLAR.afternoon,
    zenith: SKY.zenith,
    horizon: SKY.horizon,
    sun: SKY.sun,
    disc: '#fff7d9',
    az: SKY.sunAzimuthDeg - 360,
    alt: SKY.sunAltitudeDeg,
    hi: [1.08, 1.02, 0.9],
    mid: [0.86, 0.86, 0.9],
    lo: [0.62, 0.68, 0.8],
    ambient: WHITE,
    deep: WATER.deep,
    shallow: WATER.shallow,
    night: 0,
    cloud: 0,
  },
  {
    at: 17.2,
    zenith: '#4a6c8e',
    horizon: '#f6b47c',
    sun: '#ffd49a',
    disc: '#fff0c8',
    az: -75,
    alt: 16,
    hi: [1.12, 0.94, 0.72],
    mid: [0.82, 0.76, 0.78],
    lo: [0.52, 0.54, 0.7],
    ambient: [0.96, 0.9, 0.86],
    deep: '#1d5f6c',
    shallow: '#2c8084',
    night: 0.12,
    cloud: 0.4,
  },
  {
    at: SOLAR.dusk,
    zenith: '#39497a',
    horizon: '#f08f63',
    sun: '#ffb37a',
    disc: '#ffe1b0',
    az: -90,
    alt: MIN_ALTITUDE,
    hi: [1.0, 0.8, 0.64],
    mid: [0.72, 0.66, 0.74],
    lo: [0.46, 0.48, 0.66],
    ambient: [0.86, 0.78, 0.82],
    deep: '#1a4a5e',
    shallow: '#2a6a78',
    night: 0.5,
    cloud: 0.5,
  },
  { at: 18.6, ...BLUE_HOUR, ...MOON },
  { at: 19.3, ...NIGHT },
  { at: 24, ...NIGHT },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hex = (h: string): Rgb => hexToRgb(h);

/** Direction towards a light at this azimuth (clockwise from north, -z) and altitude. Matches render/uniforms.ts. */
export function lightDirection(azimuthDeg: number, altitudeDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  return [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)];
}

/** The look at a solar hour (any number; it wraps round the day). */
export function lookAtSolar(hour: number): Look {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].at <= h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = b.at > a.at ? Math.min(Math.max((h - a.at) / (b.at - a.at), 0), 1) : 0;
  return {
    zenith: lerp3(hex(a.zenith), hex(b.zenith), t),
    horizon: lerp3(hex(a.horizon), hex(b.horizon), t),
    sun: lerp3(hex(a.sun), hex(b.sun), t),
    disc: lerp3(hex(a.disc), hex(b.disc), t),
    sunDir: lightDirection(lerp(a.az, b.az, t), Math.max(MIN_ALTITUDE, lerp(a.alt, b.alt, t))),
    lightHi: lerp3(a.hi, b.hi, t),
    lightMid: lerp3(a.mid, b.mid, t),
    lightLo: lerp3(a.lo, b.lo, t),
    ambient: lerp3(a.ambient, b.ambient, t),
    waterDeep: lerp3(hex(a.deep), hex(b.deep), t),
    waterShallow: lerp3(hex(a.shallow), hex(b.shallow), t),
    night: lerp(a.night, b.night, t),
    cloud: lerp(a.cloud, b.cloud, t),
  };
}

/* ------------------------------------------------------------- Auckland's clock */

export interface AucklandClock {
  /** Local clock time in Auckland, hours with a fraction (daylight saving included). */
  hour: number;
  /** 1..366. */
  dayOfYear: number;
  /** True while Auckland is on daylight time (UTC+13). */
  dst: boolean;
}

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Pacific/Auckland',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  timeZoneName: 'shortOffset',
});

/** What a clock on the wall in Auckland says at this instant, wherever the visitor is. */
export function aucklandClock(date: Date): AucklandClock {
  const parts: Record<string, string> = {};
  for (const p of CLOCK.formatToParts(date)) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const dayOfYear = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000);
  return {
    hour: Number(parts.hour) + Number(parts.minute) / 60,
    dayOfYear,
    dst: /13/.test(parts.timeZoneName ?? ''),
  };
}

/**
 * Sunrise and sunset in Auckland on the wall clock, to within about a quarter of an hour: day length
 * swings between roughly 9.6 hours in June and 14.7 in December, around a solar noon of about 12:20
 * standard time (Auckland sits a little west of its time zone's meridian).
 */
export function aucklandDaylight(dayOfYear: number, dst: boolean): { sunrise: number; sunset: number } {
  const length = 12.15 + 2.55 * Math.cos((2 * Math.PI * (dayOfYear - 355)) / 365);
  const noon = 12.35 + (dst ? 1 : 0);
  return { sunrise: noon - length / 2, sunset: noon + length / 2 };
}

/** Map a wall-clock hour onto the solar clock (sunrise = 6, sunset = 18) for a given day. */
export function solarHour(hour: number, sunrise: number, sunset: number): number {
  const day = sunset - sunrise;
  const night = 24 - day;
  if (hour >= sunrise && hour <= sunset) return 6 + (12 * (hour - sunrise)) / day;
  const sinceSunset = hour > sunset ? hour - sunset : hour + 24 - sunset;
  return (18 + (12 * sinceSunset) / night) % 24;
}

/** The solar hour in Auckland right now (or at `date`). */
export function aucklandSolarHour(date: Date): number {
  const c = aucklandClock(date);
  const d = aucklandDaylight(c.dayOfYear, c.dst);
  return solarHour(c.hour, d.sunrise, d.sunset);
}

export type TimeChoice = 'auto' | keyof typeof SOLAR;

/**
 * The solar hour to show: `?time=` wins (a solar hour 0..24, or one of the preset names), then a
 * pinned setting, else the real time in Auckland.
 */
export function chosenSolarHour(setting: TimeChoice, param: string | null, date: Date): number {
  if (param !== null && param !== '') {
    if (param in SOLAR) return SOLAR[param as keyof typeof SOLAR];
    const n = Number(param);
    if (Number.isFinite(n)) return ((n % 24) + 24) % 24;
  }
  return setting === 'auto' ? aucklandSolarHour(date) : SOLAR[setting];
}

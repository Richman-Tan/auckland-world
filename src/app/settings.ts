/**
 * Visitor settings, remembered between visits. Pure apart from the injected storage. Every field
 * has a safe default and anything unreadable in storage falls back to it, so a setting can be added
 * or renamed without breaking returning visitors.
 */
import { type StorageLike, readJson, writeJson } from './storage';

export const SETTINGS_KEY = 'aw:settings:v1';

export interface Settings {
  /** auto adapts to the frame rate; high and low pin it. */
  graphics: 'auto' | 'high' | 'low';
  /** false: W or stick-up is nose down (yoke style). true: W is nose up. */
  invertPitch: boolean;
  /** auto follows the device's "reduce motion" preference; reduced forces it on. */
  motion: 'auto' | 'reduced';
  sound: boolean;
  /** auto is the real time in Auckland. */
  time: 'auto' | 'morning' | 'afternoon' | 'dusk' | 'night';
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: 'auto',
  invertPitch: false,
  motion: 'auto',
  sound: false,
  time: 'auto',
};

/** The allowed values of each choice setting, in the order the panel shows them. */
export const SETTING_CHOICES = {
  graphics: ['auto', 'high', 'low'],
  motion: ['auto', 'reduced'],
  time: ['auto', 'morning', 'afternoon', 'dusk', 'night'],
} as const satisfies { [K in 'graphics' | 'motion' | 'time']: readonly Settings[K][] };

/** Whatever is in storage, made into a complete, valid Settings. */
export function sanitiseSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const pick = <K extends keyof typeof SETTING_CHOICES>(key: K) => {
    const v = r[key];
    if (typeof v === 'string' && (SETTING_CHOICES[key] as readonly string[]).includes(v)) (out[key] as string) = v;
  };
  pick('graphics');
  pick('motion');
  pick('time');
  if (typeof r.invertPitch === 'boolean') out.invertPitch = r.invertPitch;
  if (typeof r.sound === 'boolean') out.sound = r.sound;
  return out;
}

export interface SettingsStore {
  get(): Settings;
  /** Change some settings. Listeners run only if something actually changed. */
  set(patch: Partial<Settings>): void;
  /** Called after every change with the new and previous values. Returns an unsubscribe function. */
  subscribe(cb: (now: Settings, before: Settings) => void): () => void;
}

export function createSettings(storage: StorageLike | null): SettingsStore {
  let current = sanitiseSettings(readJson(storage, SETTINGS_KEY));
  const listeners = new Set<(now: Settings, before: Settings) => void>();
  return {
    get: () => current,
    set(patch) {
      const next = sanitiseSettings({ ...current, ...patch });
      if ((Object.keys(next) as (keyof Settings)[]).every((k) => next[k] === current[k])) return;
      const before = current;
      current = next;
      writeJson(storage, SETTINGS_KEY, next);
      for (const cb of [...listeners]) cb(next, before);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
